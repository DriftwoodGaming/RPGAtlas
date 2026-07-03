/* RPGAtlas — src/renderer/three-renderer.ts
   The HD-2D renderer on three.js (Phase 2 Stage A: parity port of
   js/renderer.js). Same public surface as the classic script — available /
   setMap / renderFrame / isLost — same scene recipe, and the SAME GLSL:
   Stage A uses three as a managed context (canvas/context lifecycle, buffers,
   textures, render targets, scene-graph scaffolding for Stages B–E), not as a
   material system. Every draw goes through RawShaderMaterial with the classic
   shaders verbatim and a manually computed uMVP, so the golden images gate
   this port pixel-for-pixel (docs/phase-2-spec.md).

   Parity pins (each of these shifted the goldens when wrong in development):
   - THREE.ColorManagement disabled; every texture/render target NoColorSpace
     (three would otherwise sRGB-decode the canvas prerenders on sample).
   - flipY=false (classic texImage2D never flipped), premultiplyAlpha=true,
     NEAREST chunk/sprite filters, CustomBlending(ONE, ONE_MINUS_SRC_ALPHA),
     LessEqualDepth, DoubleSide (classic never enabled CULL_FACE).
   - transparent=false on everything + sortObjects=false: the whole scene stays
     in three's opaque list in scene-graph order — terrain, sprites (host order,
     far-to-near), overhead — exactly the classic draw order.
   - The attribute-less gl_VertexID fullscreen triangle becomes a 3-vertex
     attribute producing the identical triangle (three needs an attribute to
     size the draw); same rasterization.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as THREE from "three";

// Raw display-space pipeline: the prerendered canvases are authored in display
// space and the classic renderer never color-converted anything.
THREE.ColorManagement.enabled = false;

export function createThreeRenderer(): any {
  // Resolved from the classic assets script like js/renderer.js did (both HTML
  // pages load assets.js before any module code runs).
  const TILE = ((window as any).Assets && (window as any).Assets.TILE) || 48;
  // Map prerenders are split into squares of at most CHUNK px so a large map
  // never exceeds the GPU's maximum texture size (4096 on older hardware).
  const CHUNK = TILE * 21; // 1008
  const FOV = Math.PI / 4; // 45° vertical field of view
  const TINT_S = 0.62,
    TINT_EW = 0.48; // auto-shading for exposed block walls
  // Stage D2 (Phase 3): cliff auto-texturing. With map.hd2d.cliffs on, the flat
  // face tint above is sculpted into a rock cliff entirely in the vertex-tint
  // pipeline (no new texture, no shader, no save-format change): a top-down
  // ambient-occlusion gradient darkens each face toward the cliff base, the
  // crest edge keeps a sunlit lip, and vertical corners darken where the run
  // ends laterally — the corner test is the same 8-neighbour connectivity the
  // 47-blob floor autotiles use. OFF by default → wall verts are byte-identical
  // to Stage E, so every Phase 2 golden holds.
  const CLIFF_AO = 0.5, // darkest multiplier reached at the cliff base
    CLIFF_LIP = 1.18, // crest-edge sunlit lip (still ≤1 after the ≤0.62 base)
    CLIFF_EDGE = 0.72; // outer vertical-corner darkening
  const MAX_LIGHTS = 16;
  // Stage B.2: point-light shadows. Up to MAX_PLS lights (the nearest to the
  // camera target) render omnidirectional depth into one shared 2D atlas —
  // 6 faces of PL_FACE px per light, 3 columns x 2 rows per light, lights
  // stacked vertically (three.js's own cube-in-2D trick, done raw here so the
  // face convention is pinned between the JS matrices and the GLSL lookup).
  const MAX_PLS = 4;
  const PL_FACE = 256;
  const PL_NEAR = 6; // px — inside this radius nothing occludes
  const PL_W = PL_FACE * 3,
    PL_H = PL_FACE * 2 * MAX_PLS;
  // Stage C: water & materials. The water surface floats WATER_Y px above the
  // tile's ground so it never z-fights the prerendered water pixels below
  // (which stay visible as the refraction source). The mirror plane for
  // planar reflections is the height-0 surface — elevated water still gets
  // waves/foam/specular, just not a geometrically exact reflection.
  const WATER_Y = 3;
  const T = ((window as any).Assets && (window as any).Assets.T) || {};
  const WATER_TILES = new Set([T.water, T.deepwater, T.swamp].filter((v: any) => v != null));
  // Auto-material tile classes: specular (wet/ice/crystal floors) and
  // emissive (glowing at night — scaled by pixel luminance so window panes
  // glow but their frames don't).
  const SPEC_TILES = new Set(
    [T.water, T.deepwater, T.swamp, T.ice, T.crystalfloor, T.crystals].filter((v: any) => v != null),
  );
  const EMIS_TILES = new Set(
    [T.window, T.lava, T.lava_rock, T.crystals, T.crystalfloor, T.torch].filter((v: any) => v != null),
  );

  // ---------------------------- shaders ----------------------------
  // Verbatim from js/renderer.js (see header) — do not "modernize" these while
  // the parity goldens gate the port.
  const SCENE_VS =
    "layout(location=0) in vec3 aPos;\n" +
    "layout(location=1) in vec2 aUV;\n" +
    "layout(location=2) in float aTint;\n" +
    "uniform mat4 uMVP;\n" +
    "out vec2 vUV; out float vTint; out vec3 vWorld;\n" +
    "void main() {\n" +
    "  gl_Position = uMVP * vec4(aPos, 1.0);\n" +
    "  vUV = aUV; vTint = aTint; vWorld = aPos;\n" +
    "}";
  const SCENE_FS =
    "precision mediump float;\n" +
    "in vec2 vUV; in float vTint; in vec3 vWorld;\n" +
    "uniform sampler2D uTex;\n" +
    "uniform vec3 uEye;\n" +
    "uniform float uAmbient;\n" + // < 0 means lighting disabled
    "uniform int uLightCount;\n" +
    "uniform vec4 uLightPos[" + MAX_LIGHTS + "];\n" + // xyz + radius
    "uniform vec3 uLightCol[" + MAX_LIGHTS + "];\n" +
    "uniform vec4 uFog;\n" + // rgb + on/off
    "uniform vec2 uFogRange;\n" + // near, far (view distance px)
    "out vec4 outColor;\n" +
    // Stage B: sun shadow mapping. Compiled ONLY when the material carries the
    // SHADOWS define (map.hd2d.shadows) — without it the preprocessor strips
    // all of this and the program is identical to the Stage A parity shader.
    "#ifdef SHADOWS\n" +
    "uniform sampler2D uShadowMap;\n" +
    "uniform mat4 uSunMVP;\n" +
    "uniform float uShadowStrength;\n" +
    "uniform vec2 uShadowTexel;\n" +
    "float shadowVis() {\n" + // 3x3 PCF, 1 = fully lit
    "  vec4 sc = uSunMVP * vec4(vWorld, 1.0);\n" +
    "  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;\n" +
    "  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;\n" +
    "  float vis = 0.0;\n" +
    "  for (int dy = -1; dy <= 1; dy++) {\n" +
    "    for (int dx = -1; dx <= 1; dx++) {\n" +
    "      float d = texture(uShadowMap, p.xy + vec2(float(dx), float(dy)) * uShadowTexel).r;\n" +
    "      vis += (p.z - 0.0018) <= d ? 1.0 : 0.0;\n" +
    "    }\n" +
    "  }\n" +
    "  return vis / 9.0;\n" +
    "}\n" +
    "#endif\n" +
    // Stage B.2: point-light shadows. Compiled ONLY under POINT_SHADOWS
    // (map.hd2d.pointShadows) — stripped otherwise, so programs without the
    // define stay identical to the Stage A/B.1 shaders. The first uPLCount
    // entries of the light arrays are the shadow casters; each has 6 depth
    // faces in the shared uPLMap atlas (see renderPointDepth for the layout —
    // the face axes here MUST match the JS view matrices in PL_FACES).
    "#ifdef POINT_SHADOWS\n" +
    "uniform sampler2D uPLMap;\n" +
    "uniform int uPLCount;\n" +
    "uniform float uPLStrength;\n" +
    "float plLinZ(float s, float f) {\n" + // window z -> view distance
    "  float d = s * 2.0 - 1.0;\n" +
    "  return 2.0 * " + PL_NEAR.toFixed(1) + " * f / (f + " + PL_NEAR.toFixed(1) + " - d * (f - " + PL_NEAR.toFixed(1) + "));\n" +
    "}\n" +
    "float plVis(int i) {\n" + // 1 = fully lit by caster i
    "  vec3 d = vWorld - uLightPos[i].xyz;\n" +
    "  float range = max(uLightPos[i].w, " + (PL_NEAR * 2).toFixed(1) + ");\n" +
    "  vec3 a = abs(d);\n" +
    "  float zv; vec2 uv; float face;\n" +
    "  if (a.x >= a.y && a.x >= a.z) {\n" +
    "    zv = a.x;\n" +
    "    uv = d.x > 0.0 ? vec2(-d.z, d.y) : vec2(d.z, d.y);\n" +
    "    face = d.x > 0.0 ? 0.0 : 1.0;\n" +
    "  } else if (a.y >= a.x && a.y >= a.z) {\n" +
    "    zv = a.y;\n" +
    "    uv = d.y > 0.0 ? vec2(d.x, d.z) : vec2(d.x, -d.z);\n" +
    "    face = d.y > 0.0 ? 2.0 : 3.0;\n" +
    "  } else {\n" +
    "    zv = a.z;\n" +
    "    uv = d.z > 0.0 ? vec2(d.x, d.y) : vec2(-d.x, d.y);\n" +
    "    face = d.z > 0.0 ? 4.0 : 5.0;\n" +
    "  }\n" +
    "  if (zv >= range) return 1.0;\n" +
    "  uv = uv / zv * 0.5 + 0.5;\n" +
    "  float col = face >= 3.0 ? face - 3.0 : face;\n" +
    "  float row = float(i) * 2.0 + (face >= 3.0 ? 1.0 : 0.0);\n" +
    "  float bias = 3.0 + zv * 0.05;\n" + // slope term: ground is near-grazing in the side faces
    "  float vis = 0.0;\n" +
    "  for (int ty = 0; ty < 2; ty++) {\n" + // 4-tap PCF inside the face
    "    for (int tx = 0; tx < 2; tx++) {\n" +
    "      vec2 t = uv + (vec2(float(tx), float(ty)) - 0.5) * " + (2 / PL_FACE).toFixed(6) + ";\n" +
    "      t = clamp(t, " + (1.5 / PL_FACE).toFixed(6) + ", " + (1 - 1.5 / PL_FACE).toFixed(6) + ");\n" +
    "      vec2 at = vec2((col + t.x) / 3.0, (row + t.y) / " + (MAX_PLS * 2).toFixed(1) + ");\n" +
    // textureLod: this runs inside the light loop (non-uniform control flow),
    // where implicit-derivative sampling is undefined; the map has no mips.
    "      vis += (zv - bias) <= plLinZ(textureLod(uPLMap, at, 0.0).r, range) ? 1.0 : 0.0;\n" +
    "    }\n" +
    "  }\n" +
    "  return vis * 0.25;\n" +
    "}\n" +
    "#endif\n" +
    // Stage C: CLIPY discards below-waterline fragments during the planar-
    // reflection pass (compiled only when the map has water); MATERIALS adds
    // the auto-generated normal/specular/emissive maps (terrain chunks only).
    "#ifdef CLIPY\n" +
    "uniform vec2 uClipY;\n" + // x: pass active, y: waterline
    "#endif\n" +
    "#ifdef MATERIALS\n" +
    "uniform sampler2D uMatMap;\n" + // rgb: world-space normal, a: specular
    "uniform sampler2D uEmisMap;\n" + // rgb: emissive color
    "uniform float uGlow;\n" + // emissive engagement (rises as ambient falls)
    "#endif\n" +
    // Stage D: the day/night cycle tints the ambient term (dawn gold, night
    // blue). Compiled only under map.hd2d.dayNight.
    "#ifdef DAYNIGHT\n" +
    "uniform vec3 uAmbTint;\n" +
    "#endif\n" +
    "void main() {\n" +
    "#ifdef CLIPY\n" +
    "  if (uClipY.x > 0.5 && vWorld.y < uClipY.y) discard;\n" +
    "#endif\n" +
    "  vec4 c = texture(uTex, vUV);\n" +
    "  if (c.a < 0.25) discard;\n" +
    "  vec3 rgb = c.rgb * vTint;\n" +
    "  if (uAmbient >= 0.0) {\n" +
    "    vec3 lit = vec3(uAmbient);\n" +
    "#ifdef DAYNIGHT\n" +
    "    lit *= uAmbTint;\n" +
    "#endif\n" +
    "#ifdef MATERIALS\n" +
    "    vec3 N = normalize(texture(uMatMap, vUV).rgb * 2.0 - 1.0);\n" +
    "    float specM = texture(uMatMap, vUV).a;\n" +
    "    vec3 V = normalize(uEye - vWorld);\n" +
    "    vec3 spec = vec3(0.0);\n" +
    "#endif\n" +
    "    for (int i = 0; i < " + MAX_LIGHTS + "; i++) {\n" +
    "      if (i >= uLightCount) break;\n" +
    "      float f = max(0.0, 1.0 - distance(vWorld, uLightPos[i].xyz) / uLightPos[i].w);\n" +
    // sqrt so the squared falloff scales linearly with the PCF visibility
    "#ifdef POINT_SHADOWS\n" +
    "      if (i < uPLCount && f > 0.0) f *= sqrt(mix(1.0, plVis(i), uPLStrength));\n" +
    "#endif\n" +
    "#ifdef MATERIALS\n" +
    "      vec3 Ld = normalize(uLightPos[i].xyz - vWorld);\n" +
    // relief shading: darken faces turned away, keep the flat look's base
    "      f *= sqrt(mix(0.45, 1.0, clamp(dot(N, Ld), 0.0, 1.0)));\n" +
    "      spec += uLightCol[i] * (f * specM * pow(max(dot(N, normalize(Ld + V)), 0.0), 48.0));\n" +
    "#endif\n" +
    "      lit += f * f * uLightCol[i];\n" +
    "    }\n" +
    "    rgb *= lit;\n" +
    "#ifdef MATERIALS\n" +
    "    rgb += spec * 0.9;\n" +
    "    rgb += texture(uEmisMap, vUV).rgb * uGlow;\n" +
    "#endif\n" +
    "  }\n" +
    "#ifdef SHADOWS\n" +
    "  rgb *= 1.0 - uShadowStrength * (1.0 - shadowVis());\n" +
    "#endif\n" +
    "  if (uFog.a > 0.0) {\n" +
    "    float f = clamp((distance(vWorld, uEye) - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);\n" +
    "    rgb = mix(rgb, uFog.rgb * c.a, f);\n" +
    "  }\n" +
    "  outColor = vec4(rgb, c.a);\n" +
    "}";
  // Depth pass (Stage B): world geometry rasterized from a light's view —
  // the sun's orthographic frustum or one point-light cube face (uDepthMVP is
  // set per pass); alpha-tested like the scene pass so sprite cutouts and
  // tile transparency cast correct silhouettes.
  const DEPTH_VS =
    "layout(location=0) in vec3 aPos;\n" +
    "layout(location=1) in vec2 aUV;\n" +
    "uniform mat4 uDepthMVP;\n" +
    "out vec2 vUV;\n" +
    "void main() {\n" +
    "  gl_Position = uDepthMVP * vec4(aPos, 1.0);\n" +
    "  vUV = aUV;\n" +
    "}";
  const DEPTH_FS =
    "precision mediump float;\n" +
    "in vec2 vUV;\n" +
    "uniform sampler2D uTex;\n" +
    "out vec4 outColor;\n" +
    "void main() {\n" +
    "  if (texture(uTex, vUV).a < 0.25) discard;\n" +
    "  outColor = vec4(1.0);\n" +
    "}";

  // Water surface (Stage C): refraction = the chunk's own prerendered pixels
  // sampled with wave-distorted UVs; reflection = the mirrored-camera pass
  // sampled at (distorted) screen position; foam rides the aTint attribute
  // (1 at shore corners, 0 inside). Lighting/fog mirror the scene shader so
  // water sits in the same ambiance. Everything animates off uTime, which the
  // hosts derive from the engine tick — no internal clocks (determinism).
  const WATER_VS =
    "layout(location=0) in vec3 aPos;\n" +
    "layout(location=1) in vec2 aUV;\n" +
    "layout(location=2) in float aTint;\n" +
    "uniform mat4 uMVP;\n" +
    "out vec2 vUV; out float vFoam; out vec3 vWorld;\n" +
    "void main() {\n" +
    "  gl_Position = uMVP * vec4(aPos, 1.0);\n" +
    "  vUV = aUV; vFoam = aTint; vWorld = aPos;\n" +
    "}";
  const WATER_FS =
    "precision mediump float;\n" +
    "in vec2 vUV; in float vFoam; in vec3 vWorld;\n" +
    "uniform sampler2D uTex;\n" + // this chunk's prerender (refraction source)
    "uniform sampler2D uReflect;\n" + // mirrored scene, screen-space
    "uniform vec2 uScreen;\n" +
    "uniform vec2 uChunkPx;\n" +
    "uniform float uTime;\n" +
    "uniform vec3 uEye;\n" +
    "uniform vec3 uSunDir;\n" +
    "uniform float uAmbient;\n" +
    "uniform int uLightCount;\n" +
    "uniform vec4 uLightPos[" + MAX_LIGHTS + "];\n" +
    "uniform vec3 uLightCol[" + MAX_LIGHTS + "];\n" +
    "uniform vec4 uFog;\n" +
    "uniform vec2 uFogRange;\n" +
    "#ifdef DAYNIGHT\n" +
    "uniform vec3 uAmbTint;\n" +
    "#endif\n" +
    "out vec4 outColor;\n" +
    "vec3 waveN(vec2 p, float t) {\n" + // analytic normal of 3 summed sines
    "  vec2 d = vec2(cos(p.x * 0.130 + t * 1.7) * 0.286, 0.0);\n" +
    "  d.y += cos(p.y * 0.087 + t * 1.3) * 0.226;\n" +
    "  vec2 dir = vec2(0.6, 0.8);\n" +
    "  d += dir * (cos(dot(p, dir) * 0.176 + t * 2.3) * 0.246);\n" +
    "  return normalize(vec3(-d.x, 1.0, -d.y));\n" +
    "}\n" +
    "void main() {\n" +
    "  vec3 n = waveN(vWorld.xz, uTime);\n" +
    "  vec3 refr = texture(uTex, vUV + n.xz * 5.0 / uChunkPx).rgb;\n" +
    "  vec2 suv = clamp(gl_FragCoord.xy / uScreen + n.xz * 0.02, 0.001, 0.999);\n" +
    "  vec3 refl = texture(uReflect, suv).rgb;\n" +
    "  vec3 V = normalize(uEye - vWorld);\n" +
    "  float fres = 0.08 + 0.55 * pow(1.0 - max(dot(V, n), 0.0), 3.0);\n" +
    "  vec3 rgb = mix(refr * vec3(0.78, 0.92, 1.0), refl, fres);\n" +
    "  rgb += vec3(0.5) * pow(max(dot(n, normalize(V + uSunDir)), 0.0), 90.0);\n" + // sun glint
    "  float foam = vFoam * (0.55 + 0.45 * sin(uTime * 2.0 + (vWorld.x + vWorld.z) * 0.21));\n" +
    "  rgb = mix(rgb, vec3(0.92, 0.96, 1.0), clamp(foam, 0.0, 1.0) * 0.7);\n" +
    "  if (uAmbient >= 0.0) {\n" + // same forward lighting as the scene pass
    "    vec3 lit = vec3(uAmbient);\n" +
    "#ifdef DAYNIGHT\n" +
    "    lit *= uAmbTint;\n" +
    "#endif\n" +
    "    for (int i = 0; i < " + MAX_LIGHTS + "; i++) {\n" +
    "      if (i >= uLightCount) break;\n" +
    "      float f = max(0.0, 1.0 - distance(vWorld, uLightPos[i].xyz) / uLightPos[i].w);\n" +
    "      lit += f * f * uLightCol[i];\n" +
    "    }\n" +
    "    rgb *= lit;\n" +
    "  }\n" +
    "  if (uFog.a > 0.0) {\n" +
    "    float f = clamp((distance(vWorld, uEye) - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);\n" +
    "    rgb = mix(rgb, uFog.rgb, f);\n" +
    "  }\n" +
    "  outColor = vec4(rgb, 1.0);\n" +
    "}";

  // GPU weather particles (Stage E): stateless — every particle's position is
  // a pure function of its per-particle seeds and uTime, evaluated in the
  // vertex shader. No CPU simulation, no state, fully deterministic under the
  // frozen-clock goldens. One static buffer holds WEATHER_MAX quads; unused
  // particles collapse to a degenerate position.
  const WEATHER_VS =
    "layout(location=0) in vec3 aSeed;\n" +
    "layout(location=1) in vec2 aCorner;\n" +
    "layout(location=2) in float aId;\n" +
    "uniform mat4 uMVP;\n" +
    "uniform float uTime;\n" +
    "uniform vec4 uArea;\n" + // cx, cz, halfW, halfH (world px around the camera)
    "uniform float uWCount, uWMode;\n" + // 0 rain, 1 snow, 2 motes
    "out vec2 vUV; out float vA;\n" +
    "void main() {\n" +
    "  if (aId >= uWCount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUV = vec2(0.0); vA = 0.0; return; }\n" +
    "  const float H = 380.0;\n" + // fall-column height, px
    "  vec3 p; vec2 sz; float a;\n" +
    "  float px = uArea.x + (aSeed.x * 2.0 - 1.0) * uArea.z;\n" +
    "  float pz = uArea.y + (fract(aSeed.x * 7.31 + aSeed.y * 3.7) * 2.0 - 1.0) * uArea.w;\n" +
    "  if (uWMode < 0.5) {\n" + // rain: fast fall, slight slant
    "    float y = H - mod(aSeed.y * H + uTime * (620.0 + aSeed.z * 260.0), H + 30.0);\n" +
    "    p = vec3(px + (H - y) * 0.12, y, pz);\n" +
    "    sz = vec2(1.4, 16.0); a = 0.38;\n" +
    "  } else if (uWMode < 1.5) {\n" + // snow: slow fall, sway
    "    float y = H - mod(aSeed.y * H + uTime * (42.0 + aSeed.z * 34.0), H + 12.0);\n" +
    "    p = vec3(px + sin(uTime * 0.9 + aSeed.z * 6.28) * 14.0, y, pz);\n" +
    "    sz = vec2(3.0, 3.0); a = 0.8;\n" +
    "  } else {\n" + // ambient motes: hovering drift + pulse
    "    float y = 16.0 + aSeed.y * 110.0 + sin(uTime * 0.5 + aSeed.z * 6.28) * 9.0;\n" +
    "    p = vec3(px + sin(uTime * 0.23 + aSeed.z * 12.6) * 22.0, y, pz + cos(uTime * 0.31 + aSeed.x * 9.4) * 18.0);\n" +
    "    sz = vec2(2.6, 2.6); a = 0.3 * (0.55 + 0.45 * sin(uTime * 1.7 + aSeed.z * 17.0));\n" +
    "  }\n" +
    "  vec3 world = p + vec3(aCorner.x * sz.x, aCorner.y * sz.y, 0.0);\n" +
    "  gl_Position = uMVP * vec4(world, 1.0);\n" +
    "  vUV = aCorner + 0.5; vA = a;\n" +
    "}";
  const WEATHER_FS =
    "precision mediump float;\n" +
    "in vec2 vUV; in float vA;\n" +
    // highp to match the vertex stage's default precision — strict linkers
    // (ANGLE D3D) reject a mediump/highp mismatch on a shared uniform.
    "uniform highp float uWMode;\n" +
    "out vec4 outColor;\n" +
    "void main() {\n" +
    "  float d; vec3 col;\n" +
    "  if (uWMode < 0.5) {\n" + // soft vertical streak
    "    d = (1.0 - abs(vUV.x - 0.5) * 2.0) * (1.0 - abs(vUV.y - 0.5) * 1.6);\n" +
    "    col = vec3(0.62, 0.72, 0.92);\n" +
    "  } else {\n" +
    "    float r = length(vUV - 0.5) * 2.0;\n" +
    "    d = clamp(1.0 - r, 0.0, 1.0);\n" +
    "    if (uWMode < 1.5) { col = vec3(0.96); d = smoothstep(0.0, 0.7, d); }\n" +
    "    else { col = vec3(1.0, 0.95, 0.7); d *= d; }\n" +
    "  }\n" +
    "  float alpha = clamp(d, 0.0, 1.0) * vA;\n" +
    "  outColor = vec4(col * alpha, alpha);\n" + // premultiplied
    "}";
  // Soft character drop shadows (Stage E): a radial-gradient blob under each
  // sprite, faded slightly by distance — cheap grounding when the real sun
  // shadows are off (and harmless alongside them).
  const DROP_FS =
    "precision mediump float;\n" +
    "in vec2 vUV; in float vFoam; in vec3 vWorld;\n" +
    "uniform sampler2D uTex;\n" +
    "out vec4 outColor;\n" +
    "void main() {\n" +
    "  float a = texture(uTex, vUV).a * 0.34;\n" +
    "  outColor = vec4(0.04 * a, 0.04 * a, 0.09 * a, a);\n" +
    "}";

  // Fullscreen triangle: same three clip-space vertices the classic
  // gl_VertexID trick produced — (-1,-1) (3,-1) (-1,3).
  const POST_VS =
    "layout(location=0) in vec2 aPos;\n" +
    "out vec2 vUV;\n" +
    "void main() {\n" +
    "  gl_Position = vec4(aPos, 0.0, 1.0);\n" +
    "  vUV = aPos * 0.5 + 0.5;\n" +
    "}";
  const BRIGHT_FS =
    "precision mediump float;\n" +
    "in vec2 vUV; uniform sampler2D uTex; uniform float uThreshold;\n" +
    "out vec4 outColor;\n" +
    "void main() {\n" +
    "  vec3 c = texture(uTex, vUV).rgb;\n" +
    "  outColor = vec4(max(c - uThreshold, 0.0) / (1.0 - min(uThreshold, 0.99)), 1.0);\n" +
    "}";
  const BLUR_FS =
    "precision mediump float;\n" +
    "in vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir;\n" +
    "out vec4 outColor;\n" +
    "void main() {\n" +
    "  const float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);\n" +
    "  vec3 c = texture(uTex, vUV).rgb * w[0];\n" +
    "  for (int i = 1; i < 5; i++) {\n" +
    "    c += texture(uTex, vUV + uDir * float(i)).rgb * w[i];\n" +
    "    c += texture(uTex, vUV - uDir * float(i)).rgb * w[i];\n" +
    "  }\n" +
    "  outColor = vec4(c, 1.0);\n" +
    "}";
  // Stage D extensions (SSAO multiply, ACES, color grade, vignette) are all
  // behind runtime `if` gates on uniforms that default to off, so a map using
  // only the classic bloom/DoF still composites bit-identically — the Stage A
  // post-stack golden holds.
  const COMP_FS =
    "precision highp float;\n" +
    "in vec2 vUV;\n" +
    "uniform sampler2D uScene, uBlurScene, uBlurBright, uDepth, uAO;\n" +
    "uniform float uBloom, uDof, uFocusDist, uFocusRange;\n" +
    "uniform vec2 uNearFar;\n" +
    "uniform float uSsao, uAces, uVignette, uGradeOn;\n" +
    "uniform mat3 uGradeM;\n" +
    "uniform vec3 uGradeB;\n" +
    "out vec4 outColor;\n" +
    "vec3 aces(vec3 x) {\n" + // Narkowicz ACES filmic fit
    "  return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);\n" +
    "}\n" +
    "void main() {\n" +
    "  vec3 col = texture(uScene, vUV).rgb;\n" +
    "  if (uDof > 0.0) {\n" +
    "    float d = texture(uDepth, vUV).r * 2.0 - 1.0;\n" +
    "    float z = 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - d * (uNearFar.y - uNearFar.x));\n" +
    "    float coc = clamp((abs(z - uFocusDist) - " + (TILE * 3).toFixed(1) + ") / uFocusRange, 0.0, 1.0) * uDof;\n" +
    "    col = mix(col, texture(uBlurScene, vUV).rgb, coc);\n" +
    "  }\n" +
    "  if (uSsao > 0.0) col *= mix(1.0, texture(uAO, vUV).r, uSsao);\n" +
    "  if (uBloom > 0.0) col += texture(uBlurBright, vUV).rgb * uBloom;\n" +
    "  if (uAces > 0.5) col = aces(col * 1.25);\n" + // slight exposure lift into the shoulder
    "  if (uGradeOn > 0.5) col = clamp(uGradeM * col + uGradeB, 0.0, 1.0);\n" +
    "  if (uVignette > 0.0) {\n" +
    "    vec2 q = vUV - 0.5;\n" +
    "    col *= 1.0 - uVignette * smoothstep(0.15, 0.5, dot(q, q));\n" +
    "  }\n" +
    "  outColor = vec4(col, 1.0);\n" +
    "}";
  // Depth-derived ambient occlusion at half res (Stage D): fixed spiral taps
  // (no per-pixel noise — determinism), world-space depth deltas, blurred by
  // the shared Gaussian before the composite multiplies it in.
  const AO_FS =
    "precision highp float;\n" +
    "in vec2 vUV;\n" +
    "uniform sampler2D uDepth;\n" +
    "uniform vec2 uNearFar;\n" +
    "uniform vec2 uInvSize;\n" + // 1 / half-res target size
    "uniform float uProjScale;\n" + // (h/2)/tan(fov/2): world px -> screen px at z=1
    "out vec4 outColor;\n" +
    "float lin(float s) {\n" +
    "  float d = s * 2.0 - 1.0;\n" +
    "  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - d * (uNearFar.y - uNearFar.x));\n" +
    "}\n" +
    "void main() {\n" +
    "  float z0 = lin(texture(uDepth, vUV).r);\n" +
    "  float rp = clamp(30.0 * uProjScale / z0 * 0.5, 2.0, 24.0);\n" + // ~30 world px
    "  const vec2 taps[8] = vec2[](\n" +
    "    vec2(1.0, 0.0), vec2(0.5257, 0.8507), vec2(-0.4045, 0.6545), vec2(-0.9511, -0.3090),\n" +
    "    vec2(-0.2245, -0.6909), vec2(0.4635, -0.6373), vec2(0.7290, 0.2367), vec2(-0.0784, 0.2412));\n" +
    "  float occ = 0.0;\n" +
    "  for (int i = 0; i < 8; i++) {\n" +
    "    float zi = lin(texture(uDepth, vUV + taps[i] * rp * uInvSize).r);\n" +
    "    float d = z0 - zi;\n" + // occluder in front of us -> positive
    "    occ += clamp(d / 24.0, 0.0, 1.0) * clamp(1.0 - d / 260.0, 0.0, 1.0);\n" +
    "  }\n" +
    "  outColor = vec4(vec3(1.0 - occ / 8.0 * 0.9), 1.0);\n" +
    "}";
  // Compact luma FXAA (Stage D, the classic diagonal-tap variant): edge-
  // blended final resolve when map.hd2d.fxaa.
  const FXAA_FS =
    "precision highp float;\n" +
    "in vec2 vUV;\n" +
    "uniform sampler2D uTex;\n" +
    "uniform vec2 uInvSize;\n" +
    "out vec4 outColor;\n" +
    "float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }\n" +
    "void main() {\n" +
    "  vec3 cM = texture(uTex, vUV).rgb;\n" +
    "  float lM = luma(cM);\n" +
    "  float lNW = luma(texture(uTex, vUV + vec2(-1.0, -1.0) * uInvSize).rgb);\n" +
    "  float lNE = luma(texture(uTex, vUV + vec2(1.0, -1.0) * uInvSize).rgb);\n" +
    "  float lSW = luma(texture(uTex, vUV + vec2(-1.0, 1.0) * uInvSize).rgb);\n" +
    "  float lSE = luma(texture(uTex, vUV + vec2(1.0, 1.0) * uInvSize).rgb);\n" +
    "  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));\n" +
    "  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));\n" +
    "  if (lMax - lMin < max(0.0312, lMax * 0.125)) { outColor = vec4(cM, 1.0); return; }\n" +
    "  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));\n" +
    "  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);\n" +
    "  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);\n" +
    "  dir = clamp(dir * rcpDirMin, -8.0, 8.0) * uInvSize;\n" +
    "  vec3 a = 0.5 * (texture(uTex, vUV + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uTex, vUV + dir * (2.0 / 3.0 - 0.5)).rgb);\n" +
    "  vec3 b = a * 0.5 + 0.25 * (texture(uTex, vUV + dir * -0.5).rgb + texture(uTex, vUV + dir * 0.5).rgb);\n" +
    "  float lB = luma(b);\n" +
    "  outColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);\n" +
    "}";

  // ---------------------------- tiny mat4 ----------------------------
  // Verbatim from the classic renderer: bit-identical camera matrices.
  function perspective(fovY: number, aspect: number, near: number, far: number) {
    const f = 1 / Math.tan(fovY / 2),
      nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number) {
    let zx = ex - tx,
      zy = ey - ty,
      zz = ez - tz;
    const zl = Math.hypot(zx, zy, zz);
    zx /= zl; zy /= zl; zz /= zl;
    let xx = zz,
      xy = 0,
      xz = -zx; // up × z
    const xl = Math.hypot(xx, xy, xz);
    xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy,
      yy = zz * xx - zx * xz,
      yz = zx * xy - zy * xx; // z × x
    return [
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * ex + xy * ey + xz * ez), -(yx * ex + yy * ey + yz * ez), -(zx * ex + zy * ey + zz * ez), 1,
    ];
  }
  function mul(a: number[], b: number[]) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }
  function hexRGB(s: any): [number, number, number] {
    const v = parseInt(String(s || "").replace("#", ""), 16) || 0;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  function ortho(l: number, r: number, b: number, t: number, n: number, f: number) {
    return [
      2 / (r - l), 0, 0, 0,
      0, 2 / (t - b), 0, 0,
      0, 0, -2 / (f - n), 0,
      -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
    ];
  }

  // ---------------------------- GPU state ----------------------------
  let cv: HTMLCanvasElement | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let ok: boolean | null = null;
  let sizedW = 0,
    sizedH = 0;

  const lightPos = new Float32Array(MAX_LIGHTS * 4);
  const lightCol = new Float32Array(MAX_LIGHTS * 3);

  // Shared uniform refs: one object per uniform, referenced by every scene
  // material, so per-frame updates hit all chunk/sprite programs.
  const U = {
    uMVP: { value: new THREE.Matrix4() },
    uEye: { value: new Float32Array(3) },
    uAmbient: { value: 0.45 },
    uLightCount: { value: 0 },
    uLightPos: { value: lightPos },
    uLightCol: { value: lightCol },
    uFog: { value: new Float32Array(4) },
    uFogRange: { value: new Float32Array([1, 2]) },
    // Stage D day/night ambient tint (DAYNIGHT programs only).
    uAmbTint: { value: new Float32Array([1, 1, 1]) },
    // Stage B sun shadows (only uploaded to programs compiled with SHADOWS).
    uSunMVP: { value: new THREE.Matrix4() },
    uShadowMap: { value: null as THREE.Texture | null },
    uShadowStrength: { value: 0 },
    uShadowTexel: { value: new Float32Array(2) },
    // Stage B.2 point-light shadows (POINT_SHADOWS programs only).
    uPLMap: { value: null as THREE.Texture | null },
    uPLCount: { value: 0 },
    uPLStrength: { value: 0 },
    // Stage C water & materials.
    uClipY: { value: new Float32Array(2) }, // reflection-pass waterline clip
    uReflect: { value: null as THREE.Texture | null },
    uScreen: { value: new Float32Array([1, 1]) },
    uTime: { value: 0 },
    uSunDir: { value: new Float32Array([0.33, 0.82, -0.47]) }, // az 35°, el 55°
    uGlow: { value: 0 }, // emissive engagement, rises as ambient falls
  };

  // The depth-pass materials' shared view-projection — the sun pass copies
  // uSunMVP into it; the point-light pass writes each cube face's matrix.
  const depthMVP = { value: new THREE.Matrix4() };

  const camera = new THREE.Camera(); // dummy — uMVP is computed manually
  const scene = new THREE.Scene();
  const terrainGroup = new THREE.Group();
  const waterGroup = new THREE.Group(); // after terrain, before sprites: sprites blend over water
  const dropGroup = new THREE.Group(); // soft blob shadows under sprites
  const spriteGroup = new THREE.Group();
  const overheadGroup = new THREE.Group();
  const weatherGroup = new THREE.Group(); // particles draw last, over everything
  scene.add(terrainGroup, waterGroup, dropGroup, spriteGroup, overheadGroup, weatherGroup);
  [scene, terrainGroup, waterGroup, dropGroup, spriteGroup, overheadGroup, weatherGroup].forEach(
    (o) => (o.matrixAutoUpdate = false),
  );

  function sceneMaterial(
    tex: THREE.Texture,
    aux?: { mat: THREE.Texture; emis: THREE.Texture } | null,
  ): THREE.RawShaderMaterial {
    const m = new THREE.RawShaderMaterial({
      vertexShader: SCENE_VS,
      fragmentShader: SCENE_FS,
      uniforms: aux
        ? { ...U, uTex: { value: tex }, uMatMap: { value: aux.mat }, uEmisMap: { value: aux.emis } }
        : { ...U, uTex: { value: tex } },
    });
    if (cfg.shadows > 0) m.defines.SHADOWS = 1;
    if (cfg.pointShadows > 0) m.defines.POINT_SHADOWS = 1;
    if (cfg.water > 0) m.defines.CLIPY = 1;
    if (cfg.dayNight) m.defines.DAYNIGHT = 1;
    if (aux) m.defines.MATERIALS = 1;
    m.glslVersion = THREE.GLSL3; // three emits #version first (its defines precede raw sources)
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.depthTest = true;
    m.depthWrite = true;
    m.depthFunc = THREE.LessEqualDepth;
    m.transparent = false; // stay in the opaque list — order is scene order
    m.side = THREE.DoubleSide; // classic never enabled CULL_FACE
    return m;
  }

  function waterMaterial(tex: THREE.Texture, chunkW: number, chunkH: number): THREE.RawShaderMaterial {
    const m = new THREE.RawShaderMaterial({
      vertexShader: WATER_VS,
      fragmentShader: WATER_FS,
      uniforms: {
        ...U,
        uTex: { value: tex },
        uChunkPx: { value: new Float32Array([chunkW, chunkH]) },
      },
    });
    m.glslVersion = THREE.GLSL3;
    if (cfg.dayNight) m.defines.DAYNIGHT = 1;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.depthTest = true;
    m.depthWrite = true;
    m.depthFunc = THREE.LessEqualDepth;
    m.transparent = false;
    m.side = THREE.DoubleSide;
    return m;
  }

  function postMaterial(fragmentShader: string, uniforms: Record<string, { value: any }>) {
    const m = new THREE.RawShaderMaterial({
      vertexShader: POST_VS,
      fragmentShader,
      uniforms,
    });
    m.glslVersion = THREE.GLSL3;
    m.blending = THREE.NoBlending;
    m.depthTest = false;
    m.depthWrite = false;
    m.side = THREE.DoubleSide;
    return m;
  }

  function makeTexture(srcCanvas: HTMLCanvasElement): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(srcCanvas);
    t.flipY = false;
    t.premultiplyAlpha = true; // matches UNPACK_PREMULTIPLY_ALPHA_WEBGL upload
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    return t;
  }

  // Interleaved layout identical to the classic VBO: 6 floats per vertex
  // (x, y, z, u, v, tint) under the shader's attribute names.
  function batchGeometry(verts: number[], dynamic = false) {
    const geo = new THREE.BufferGeometry();
    const buf = new THREE.InterleavedBuffer(new Float32Array(verts), 6);
    if (dynamic) buf.setUsage(THREE.DynamicDrawUsage);
    const pos = new THREE.InterleavedBufferAttribute(buf, 3, 0);
    geo.setAttribute("aPos", pos);
    // Alias under three's canonical name: the renderer derives the drawArrays
    // vertex count from geometry.attributes.position (the shader binds aPos).
    geo.setAttribute("position", pos);
    geo.setAttribute("aUV", new THREE.InterleavedBufferAttribute(buf, 2, 3));
    geo.setAttribute("aTint", new THREE.InterleavedBufferAttribute(buf, 1, 5));
    // Culling is off everywhere; make the bounding volume infinite and explicit
    // so nothing ever computes one from the interleaved data.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return { geo, buf };
  }

  function batchMesh(
    verts: number[],
    tex: THREE.Texture,
    aux?: { mat: THREE.Texture; emis: THREE.Texture } | null,
  ): THREE.Mesh {
    const { geo } = batchGeometry(verts);
    const mesh = new THREE.Mesh(geo, sceneMaterial(tex, aux));
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  // ---------------------------- render targets ----------------------------
  let rt: {
    w: number;
    h: number;
    hw: number;
    hh: number;
    fx: boolean;
    scene: THREE.WebGLRenderTarget;
    half: THREE.WebGLRenderTarget[];
    post: THREE.WebGLRenderTarget | null;
  } | null = null;

  function makeTarget(w: number, h: number, depth: boolean) {
    const t = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: depth,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    if (depth) {
      // DEPTH_COMPONENT24 texture, NEAREST — sampled by the DoF composite.
      const dt = new THREE.DepthTexture(w, h);
      dt.format = THREE.DepthFormat;
      dt.type = THREE.UnsignedIntType;
      t.depthTexture = dt;
    }
    return t;
  }

  function freeTargets() {
    if (!rt) return;
    rt.scene.depthTexture?.dispose();
    rt.scene.dispose();
    rt.half.forEach((t) => t.dispose());
    rt.post?.dispose();
    rt = null;
  }

  function ensureTargets(w: number, h: number, fxaa = false) {
    if (rt && rt.w === w && rt.h === h && rt.fx === fxaa) return;
    freeTargets();
    const hw = Math.max(1, w >> 1),
      hh = Math.max(1, h >> 1);
    rt = {
      w, h, hw, hh, fx: fxaa,
      scene: makeTarget(w, h, true),
      // 0/1: DoF ping-pong, 2/3: bloom ping-pong, 4/5: SSAO ping-pong
      half: [
        makeTarget(hw, hh, false), makeTarget(hw, hh, false), makeTarget(hw, hh, false),
        makeTarget(hw, hh, false), makeTarget(hw, hh, false), makeTarget(hw, hh, false),
      ],
      post: fxaa ? makeTarget(w, h, false) : null, // FXAA reads the composite from here
    };
  }

  // ---------------------------- post passes ----------------------------
  // One fullscreen-triangle mesh per pass program, each in its own scene.
  const postGeo = new THREE.BufferGeometry();
  const postPos = new THREE.BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2);
  postGeo.setAttribute("aPos", postPos);
  postGeo.setAttribute("position", postPos); // vertex count (see batchGeometry)
  postGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

  const brightU = { uTex: { value: null as any }, uThreshold: { value: 0 } };
  const blurU = { uTex: { value: null as any }, uDir: { value: new Float32Array(2) } };
  const compU = {
    uScene: { value: null as any },
    uBlurScene: { value: null as any },
    uBlurBright: { value: null as any },
    uDepth: { value: null as any },
    uAO: { value: null as any },
    uBloom: { value: 0 },
    uDof: { value: 0 },
    uFocusDist: { value: 0 },
    uFocusRange: { value: 1 },
    uNearFar: { value: new Float32Array([1, 2]) },
    uSsao: { value: 0 },
    uAces: { value: 0 },
    uVignette: { value: 0 },
    uGradeOn: { value: 0 },
    uGradeM: { value: new THREE.Matrix3() },
    uGradeB: { value: new Float32Array(3) },
  };
  const aoU = {
    uDepth: { value: null as any },
    uNearFar: { value: new Float32Array([1, 2]) },
    uInvSize: { value: new Float32Array(2) },
    uProjScale: { value: 1 },
  };
  const fxaaU = {
    uTex: { value: null as any },
    uInvSize: { value: new Float32Array(2) },
  };
  function passScene(fs: string, uniforms: Record<string, { value: any }>) {
    const mesh = new THREE.Mesh(postGeo, postMaterial(fs, uniforms));
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    const s = new THREE.Scene();
    s.matrixAutoUpdate = false;
    s.add(mesh);
    return s;
  }
  const brightScene = passScene(BRIGHT_FS, brightU);
  const blurScene = passScene(BLUR_FS, blurU);
  const compScene = passScene(COMP_FS, compU);
  const aoScene = passScene(AO_FS, aoU);
  const fxaaScene = passScene(FXAA_FS, fxaaU);

  function blurPass(srcTex: THREE.Texture, dst: THREE.WebGLRenderTarget, dirX: number, dirY: number) {
    const r = renderer!;
    blurU.uTex.value = srcTex;
    blurU.uDir.value[0] = dirX / rt!.hw;
    blurU.uDir.value[1] = dirY / rt!.hh;
    r.setRenderTarget(dst);
    r.render(blurScene, camera);
  }

  // ---------------------------- availability ----------------------------
  // Same contract as the classic renderer: memoized; false forever after an
  // init failure; options.canvas renders into an existing canvas (the editor's
  // HD-2D viewport), otherwise a canvas is inserted behind #gamecanvas.
  async function available(options: any = {}): Promise<boolean> {
    if (ok !== null) return ok;
    try {
      const targetCanvas = options.canvas || null;
      if (targetCanvas) {
        cv = targetCanvas;
      } else {
        const gameCanvas = document.getElementById("gamecanvas");
        if (!gameCanvas || !gameCanvas.parentNode) return (ok = false);
        cv = document.createElement("canvas");
        cv.id = "glcanvas";
        cv.style.cssText = "position:absolute;inset:0;z-index:0;image-rendering:pixelated";
        gameCanvas.parentNode.insertBefore(cv, gameCanvas);
      }
      renderer = new THREE.WebGLRenderer({
        canvas: cv!,
        antialias: false,
        premultipliedAlpha: true,
        stencil: false,
      });
      gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof WebGL2RenderingContext === "undefined" || !(gl instanceof WebGL2RenderingContext)) {
        throw new Error("WebGL2 required");
      }
      renderer.autoClear = false;
      renderer.sortObjects = false;
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // raw shaders: no output transform
      renderer.toneMapping = THREE.NoToneMapping;
      // preventDefault tells the browser we intend to handle recovery, which is
      // required for a webglcontextrestored event to ever fire. (three's own
      // internal handler also prevents default; ours keeps the classic ok gate.)
      cv!.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        console.warn("HD-2D: WebGL context lost — falling back to Canvas 2D.");
        ok = false;
      });
      cv!.addEventListener("webglcontextrestored", () => {
        console.warn("HD-2D: WebGL context restored — rebuilding GPU resources.");
        ok = true;
        // three re-creates its internal GL state; replaying setMap rebuilds our
        // chunk textures/geometry fresh (sprite textures re-upload lazily).
        if (lastMapArgs) setMap(lastMapArgs[0], lastMapArgs[1], lastMapArgs[2]);
      });
      ok = true;
    } catch (e) {
      console.error("HD-2D: WebGL2 init failed", e);
      renderer = null;
      gl = null;
      ok = false;
    }
    if (!ok) console.warn("HD-2D: WebGL2 unavailable — using the Canvas 2D renderer.");
    return ok;
  }

  // ---------------------------- map scene ----------------------------
  let mapW = 0,
    mapH = 0,
    heights: any = null,
    mapDiag = 0;
  let cfg: any = { tilt: 50, bloom: 0, dof: 0, fog: null, lights: false, ambient: 0.45, shadows: 0, pointShadows: 0 };

  // Color-grade presets (map.hd2d.lut): a mat3 + bias applied in the
  // composite. Procedural stand-ins for image LUTs — deterministic, tiny, and
  // per-map like every other hd2d flag.
  function gradeFor(name: any): { m: number[]; b: number[] } | null {
    const desat = (m: number[], s: number) => {
      // mix toward the luma projection by s
      const L = [0.299, 0.587, 0.114];
      const out = m.slice();
      for (let r = 0; r < 3; r++) {
        for (let c2 = 0; c2 < 3; c2++) {
          out[c2 * 3 + r] = m[c2 * 3 + r] * (1 - s) + L[c2] * s; // column-major
        }
      }
      return out;
    };
    const diag = (x: number, y: number, z: number) => [x, 0, 0, 0, y, 0, 0, 0, z];
    switch (String(name || "")) {
      case "warm":
        return { m: diag(1.1, 1.0, 0.88), b: [0.012, 0.004, 0] };
      case "cool":
        return { m: diag(0.88, 1.0, 1.12), b: [0, 0.004, 0.015] };
      case "night":
        return { m: desat(diag(0.6, 0.7, 1.08), 0.25), b: [0, 0.004, 0.02] };
      case "sepia":
        // classic sepia (column-major)
        return { m: [0.393, 0.349, 0.272, 0.769, 0.686, 0.534, 0.189, 0.168, 0.131], b: [0, 0, 0] };
      case "noir":
        return { m: desat(diag(1.18, 1.18, 1.18), 1), b: [-0.06, -0.06, -0.06] };
      default:
        return null;
    }
  }

  // Day/night curve (Stage D): hour 0–24 -> sun daylight factor, ambient
  // scale, ambient tint, sun azimuth/elevation. Dawn ~6h, dusk ~18h.
  function dayNightAt(h: number) {
    const daylight = Math.max(0, Math.sin((Math.PI * (h - 6)) / 12));
    const dl = Math.pow(daylight, 0.7);
    const dusk = daylight * (1 - daylight) * 4 * (daylight > 0 ? 1 : 0);
    const night = [0.55, 0.62, 1.05],
      day = [1, 1, 1],
      gold = [1.2, 0.85, 0.6];
    const tint = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      tint[i] = night[i] + (day[i] - night[i]) * dl;
      tint[i] += (gold[i] - tint[i]) * dusk * 0.45;
    }
    return {
      daylight: dl,
      scale: 0.25 + 0.75 * dl,
      tint,
      azimuth: 90 + Math.min(1, Math.max(0, (h - 6) / 12)) * 180, // east -> west
      elevation: 15 + 60 * daylight,
    };
  }
  let mapDisposables: Array<{ dispose(): void }> = [];

  function hAt(tx: number, ty: number): number {
    if (!heights || tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return 0;
    return heights[ty * mapW + tx] || 0;
  }
  // Bilinear height in tile units at a continuous tile position, so sprites
  // glide up cliffs during a step instead of popping.
  function sampleH(rx: number, ry: number): number {
    const x0 = Math.floor(rx),
      y0 = Math.floor(ry);
    const fx = rx - x0,
      fy = ry - y0;
    const a = hAt(x0, y0) * (1 - fx) + hAt(x0 + 1, y0) * fx;
    const b = hAt(x0, y0 + 1) * (1 - fx) + hAt(x0 + 1, y0 + 1) * fx;
    return a * (1 - fy) + b * fy;
  }

  function quad(
    verts: number[],
    ax: number, ay: number, az: number, au: number, av: number,
    bx: number, by: number, bz: number, bu: number, bv: number,
    cx: number, cy: number, cz: number, cu: number, cvv: number,
    dx: number, dy: number, dz: number, du: number, dv: number,
    tint: number,
  ) {
    verts.push(
      ax, ay, az, au, av, tint, bx, by, bz, bu, bv, tint, cx, cy, cz, cu, cvv, tint,
      cx, cy, cz, cu, cvv, tint, bx, by, bz, bu, bv, tint, dx, dy, dz, du, dv, tint,
    );
  }

  // As quad(), but with an independent tint per corner (A=top-left, B=top-right,
  // C=bottom-left, D=bottom-right) — used for cliff-shaded wall faces. Passing a
  // single value for all four reproduces quad(...,tint) byte-for-byte, so the
  // cliffs-off path stays golden-identical.
  function quad4(
    verts: number[],
    ax: number, ay: number, az: number, au: number, av: number, tA: number,
    bx: number, by: number, bz: number, bu: number, bv: number, tB: number,
    cx: number, cy: number, cz: number, cu: number, cvv: number, tC: number,
    dx: number, dy: number, dz: number, du: number, dv: number, tD: number,
  ) {
    verts.push(
      ax, ay, az, au, av, tA, bx, by, bz, bu, bv, tB, cx, cy, cz, cu, cvv, tC,
      cx, cy, cz, cu, cvv, tC, bx, by, bz, bu, bv, tB, dx, dy, dz, du, dv, tD,
    );
  }

  // Cliff-face shade for one wall vertex (Stage D2). `level` is the vertex's
  // height in tile units, `h` the top of the cliff, `base` the flat face tint,
  // `foot` the height the exposed run starts at (the outward neighbour's height).
  // `edge` marks a vertex on a lateral corner (the perpendicular neighbour is
  // lower) so it reads as a chiselled outer edge.
  function cliffShade(base: number, level: number, h: number, foot: number, edge: boolean): number {
    const runH = Math.max(1, h - foot);
    const frac = (h - level) / runH; // 0 at the crest, 1 at the base
    let f = 1 - CLIFF_AO * frac;
    if (level >= h) f *= CLIFF_LIP; // sunlit lip along the very top edge
    if (edge) f *= CLIFF_EDGE;
    return base * f;
  }

  // Chop a prerendered map buffer into chunk textures. Each chunk gets its OWN
  // canvas (not a reused scratch): three uploads canvas textures lazily at
  // first render, so the source canvas must stay alive and untouched.
  function chopBuffer(buf: HTMLCanvasElement) {
    const list: Array<{
      tex: THREE.CanvasTexture;
      canvas: HTMLCanvasElement;
      x: number;
      y: number;
      w: number;
      h: number;
    }> = [];
    for (let y = 0; y < buf.height; y += CHUNK) {
      for (let x = 0; x < buf.width; x += CHUNK) {
        const w = Math.min(CHUNK, buf.width - x),
          h = Math.min(CHUNK, buf.height - y);
        const piece = document.createElement("canvas");
        piece.width = w;
        piece.height = h;
        piece.getContext("2d")!.drawImage(buf, x, y, w, h, 0, 0, w, h);
        list.push({ tex: makeTexture(piece), canvas: piece, x, y, w, h });
      }
    }
    return list;
  }

  // ---------------------- auto materials (Stage C) ----------------------
  // Normal map from a Sobel of the chunk's prerendered luminance (world-space,
  // y up), specular strength in alpha from the tile class, plus an emissive
  // color map (tile class, scaled by pixel luminance so bright panes glow and
  // dark frames don't). Raw DataTextures — a canvas would premultiply the
  // normal RGB by the spec alpha and corrupt it.
  function buildAuxTextures(
    ch: { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number },
    map: any,
  ): { mat: THREE.DataTexture; emis: THREE.DataTexture } {
    const w = ch.w,
      h = ch.h;
    const img = ch.canvas.getContext("2d")!.getImageData(0, 0, w, h).data;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      lum[i] = (img[i * 4] * 0.299 + img[i * 4 + 1] * 0.587 + img[i * 4 + 2] * 0.114) / 255;
    }
    const mat = new Uint8Array(w * h * 4);
    const emis = new Uint8Array(w * h * 4);
    const S = 2.5; // relief strength
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const gx = lum[y * w + Math.min(w - 1, x + 1)] - lum[y * w + Math.max(0, x - 1)];
        const gy = lum[Math.min(h - 1, y + 1) * w + x] - lum[Math.max(0, y - 1) * w + x];
        const nx = -gx * S,
          nz = -gy * S;
        const il = 1 / Math.hypot(nx, 1, nz);
        mat[i * 4] = 128 + 127 * nx * il;
        mat[i * 4 + 1] = 128 + 127 * il;
        mat[i * 4 + 2] = 128 + 127 * nz * il;
      }
    }
    // Per-tile classes from the lower layers (ground + decor + decor2).
    const L = map.layers || {};
    const tileAt = (layer: any, tx: number, ty: number) =>
      layer ? layer[ty * map.width + tx] : 0;
    const tx0 = ch.x / TILE,
      ty0 = ch.y / TILE;
    const tx1 = Math.min(map.width, (ch.x + ch.w) / TILE),
      ty1 = Math.min(map.height, (ch.y + ch.h) / TILE);
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        const ids = [tileAt(L.ground, tx, ty), tileAt(L.decor, tx, ty), tileAt(L.decor2, tx, ty)];
        const isSpec = ids.some((id) => SPEC_TILES.has(id));
        const isEmis = ids.some((id) => EMIS_TILES.has(id));
        if (!isSpec && !isEmis) continue;
        const px0 = tx * TILE - ch.x,
          py0 = ty * TILE - ch.y;
        for (let py = py0; py < py0 + TILE; py++) {
          for (let px = px0; px < px0 + TILE; px++) {
            const i = py * w + px;
            if (isSpec) mat[i * 4 + 3] = 230;
            if (isEmis) {
              const e = Math.pow(lum[i], 1.5);
              emis[i * 4] = img[i * 4] * e;
              emis[i * 4 + 1] = img[i * 4 + 1] * e;
              emis[i * 4 + 2] = img[i * 4 + 2] * e;
              emis[i * 4 + 3] = 255;
            }
          }
        }
      }
    }
    const mk = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    return { mat: mk(mat), emis: mk(emis) };
  }

  // UVs of one tile inside its chunk.
  function tileUV(chunk: { x: number; y: number; w: number; h: number }, tx: number, ty: number) {
    const px = tx * TILE - chunk.x,
      py = ty * TILE - chunk.y;
    return { u0: px / chunk.w, v0: py / chunk.h, u1: (px + TILE) / chunk.w, v1: (py + TILE) / chunk.h };
  }

  // Rebuild the whole scene for a map: chunk textures plus per-chunk meshes for
  // the flat ground + extruded blocks and the elevated overhead tiles.
  // Remembered so a webglcontextrestored handler can replay the last call.
  let lastMapArgs: any = null;
  function setMap(lowerBuf: HTMLCanvasElement, upperBuf: HTMLCanvasElement, map: any): void {
    if (!ok) return;
    lastMapArgs = [lowerBuf, upperBuf, map];
    for (const d of mapDisposables) d.dispose();
    mapDisposables = [];
    // Depth-pass companions of the per-map meshes go with them (sprite-pool
    // meshes are persistent and keep theirs).
    for (const group of [terrainGroup, overheadGroup]) {
      for (const child of group.children) {
        (child.userData.depthMat as THREE.Material | undefined)?.dispose();
      }
    }
    terrainGroup.clear();
    waterGroup.clear();
    overheadGroup.clear();
    mapW = map.width;
    mapH = map.height;
    heights = map.heights || null;
    mapDiag = (mapW + mapH) * TILE;

    const c = map.hd2d || {};
    cfg = {
      tilt: Math.min(89, Math.max(25, Number(c.tilt) || 50)),
      bloom: c.bloom === true ? 0.45 : Math.max(0, Number(c.bloom) || 0),
      dof: c.dof === true ? 0.6 : Math.max(0, Number(c.dof) || 0),
      fog: c.fog
        ? {
            color: hexRGB((c.fog && c.fog.color) || "#101018"),
            near: Number(c.fog && c.fog.near) || 0, // 0 = derive from camera distance
            far: Number(c.fog && c.fog.far) || 0,
          }
        : null,
      lights: c.lights !== false,
      ambient: c.ambient == null ? 0.45 : Math.min(2, Math.max(0, Number(c.ambient))),
      // Stage B: shadows === true → default strength; number → 0..1 strength.
      shadows: c.shadows === true ? 0.5 : Math.min(1, Math.max(0, Number(c.shadows) || 0)),
      // Stage B.2: point-light shadows — true → full occlusion, number → 0..1.
      pointShadows: c.pointShadows === true ? 1 : Math.min(1, Math.max(0, Number(c.pointShadows) || 0)),
      // Stage C: animated water surface + auto-generated material maps.
      water: c.water === true ? 1 : Math.min(1, Math.max(0, Number(c.water) || 0)),
      materials: !!c.materials,
      // Stage D2: sculpt exposed block walls into rock cliffs (off → flat tint).
      cliffs: !!c.cliffs,
      // Stage E: ambient weather particles + soft character drop shadows.
      weather: typeof c.weather === "string" && WEATHER_COUNTS[c.weather] ? c.weather : "",
      dropShadows: !!c.dropShadows,
      // Stage D: post-stack toggles + day/night cycle.
      aces: !!c.aces,
      vignette: c.vignette === true ? 0.5 : Math.min(1, Math.max(0, Number(c.vignette) || 0)),
      grade: gradeFor(c.lut),
      ssao: c.ssao === true ? 0.55 : Math.min(1, Math.max(0, Number(c.ssao) || 0)),
      fxaa: !!c.fxaa,
      dayNight: !!c.dayNight,
      sun: c.sun || null,
    };
    // Sun direction (used by water glints now, the day/night cycle later) —
    // available even when sun shadows are off.
    {
      const sun = c.sun || {};
      const azDeg = Number.isFinite(Number(sun.azimuth)) ? Number(sun.azimuth) : 35;
      const elDeg = Math.min(85, Math.max(15, Number.isFinite(Number(sun.elevation)) ? Number(sun.elevation) : 55));
      const az = (azDeg * Math.PI) / 180,
        el = (elDeg * Math.PI) / 180;
      U.uSunDir.value[0] = Math.sin(az) * Math.cos(el);
      U.uSunDir.value[1] = Math.sin(el);
      U.uSunDir.value[2] = -Math.cos(az) * Math.cos(el);
    }
    // Toggle the shadow compile variants on the long-lived sprite-pool
    // materials (terrain/overhead materials are rebuilt below and pick the
    // defines up in sceneMaterial()).
    for (const p of spritePool) {
      let dirty = false;
      for (const [def, on] of [
        ["SHADOWS", cfg.shadows > 0],
        ["POINT_SHADOWS", cfg.pointShadows > 0],
        ["CLIPY", cfg.water > 0],
        ["DAYNIGHT", !!cfg.dayNight],
      ] as const) {
        const has = !!p.mat.defines[def];
        if (on && !has) { p.mat.defines[def] = 1; dirty = true; }
        else if (!on && has) { delete p.mat.defines[def]; dirty = true; }
      }
      if (dirty) p.mat.needsUpdate = true;
    }
    if (cfg.shadows > 0) fitSunCamera(map, c.sun);

    const lower = chopBuffer(lowerBuf),
      upper = chopBuffer(upperBuf);

    // ground + blocks, batched per lower chunk texture
    for (const ch of lower) {
      const verts: number[] = [];
      // flat ground plane for this chunk (raised blocks simply cover their cells)
      quad(verts,
        ch.x, 0, ch.y, 0, 0, ch.x + ch.w, 0, ch.y, 1, 0,
        ch.x, 0, ch.y + ch.h, 0, 1, ch.x + ch.w, 0, ch.y + ch.h, 1, 1, 1);
      const tx0 = ch.x / TILE,
        ty0 = ch.y / TILE;
      const tx1 = Math.min(mapW, (ch.x + ch.w) / TILE),
        ty1 = Math.min(mapH, (ch.y + ch.h) / TILE);
      const Lyr = map.layers || {};
      const stairsAt = (tx: number, ty: number) => {
        if (T.stairs == null) return false;
        const i = ty * mapW + tx;
        return (
          (Lyr.ground && Lyr.ground[i] === T.stairs) ||
          (Lyr.decor && Lyr.decor[i] === T.stairs) ||
          (Lyr.decor2 && Lyr.decor2[i] === T.stairs)
        );
      };
      for (let ty = ty0; ty < ty1; ty++) {
        for (let tx = tx0; tx < tx1; tx++) {
          const h = hAt(tx, ty);
          // Stage E ramps: a stairs tile below a higher north neighbour slopes
          // up to it instead of rendering a flat top.
          const hN = hAt(tx, ty - 1);
          const ramp = hN > h && stairsAt(tx, ty);
          if (h <= 0 && !ramp) continue;
          const uv = tileUV(ch, tx, ty);
          const x0 = tx * TILE,
            x1 = x0 + TILE,
            z0 = ty * TILE,
            z1 = z0 + TILE,
            top = h * TILE;
          if (ramp) {
            const yN = hN * TILE;
            // sloped surface: north edge lifted to the neighbour's height
            quad(verts,
              x0, yN, z0, uv.u0, uv.v0, x1, yN, z0, uv.u1, uv.v0,
              x0, top, z1, uv.u0, uv.v1, x1, top, z1, uv.u1, uv.v1, 1);
            // triangular side skirts so the ramp reads as solid from the side
            verts.push(
              x1, yN, z0, uv.u1, uv.v0, TINT_EW, x1, top, z1, uv.u1, uv.v1, TINT_EW, x1, top, z0, uv.u1, uv.v1, TINT_EW,
              x0, yN, z0, uv.u0, uv.v0, TINT_EW, x0, top, z0, uv.u0, uv.v1, TINT_EW, x0, top, z1, uv.u0, uv.v1, TINT_EW,
            );
          } else {
            // top face, textured with the tile's own prerendered appearance
            quad(verts,
              x0, top, z0, uv.u0, uv.v0, x1, top, z0, uv.u1, uv.v0,
              x0, top, z1, uv.u0, uv.v1, x1, top, z1, uv.u1, uv.v1, 1);
          }
          // exposed walls, one tile-unit segment at a time, auto-shaded. With
          // map.hd2d.cliffs on each face is sculpted per-corner (Stage D2); off,
          // the four corners collapse to the flat face tint and the verts are
          // byte-identical to Stage E. North walls face away from the fixed
          // camera and are never visible.
          const cl = cfg.cliffs;
          for (let foot = hAt(tx, ty + 1), k = foot; k < h; k++) { // south
            const eW = cl && hAt(tx - 1, ty) <= k, eE = cl && hAt(tx + 1, ty) <= k;
            const uT = cl ? cliffShade(TINT_S, k + 1, h, foot, eW) : TINT_S,
              vT = cl ? cliffShade(TINT_S, k + 1, h, foot, eE) : TINT_S,
              uB = cl ? cliffShade(TINT_S, k, h, foot, eW) : TINT_S,
              vB = cl ? cliffShade(TINT_S, k, h, foot, eE) : TINT_S;
            quad4(verts,
              x0, (k + 1) * TILE, z1, uv.u0, uv.v0, uT, x1, (k + 1) * TILE, z1, uv.u1, uv.v0, vT,
              x0, k * TILE, z1, uv.u0, uv.v1, uB, x1, k * TILE, z1, uv.u1, uv.v1, vB);
          }
          for (let foot = hAt(tx + 1, ty), k = foot; k < h; k++) { // east
            const eS = cl && hAt(tx, ty + 1) <= k, eN = cl && hAt(tx, ty - 1) <= k;
            const uT = cl ? cliffShade(TINT_EW, k + 1, h, foot, eS) : TINT_EW,
              vT = cl ? cliffShade(TINT_EW, k + 1, h, foot, eN) : TINT_EW,
              uB = cl ? cliffShade(TINT_EW, k, h, foot, eS) : TINT_EW,
              vB = cl ? cliffShade(TINT_EW, k, h, foot, eN) : TINT_EW;
            quad4(verts,
              x1, (k + 1) * TILE, z1, uv.u0, uv.v0, uT, x1, (k + 1) * TILE, z0, uv.u1, uv.v0, vT,
              x1, k * TILE, z1, uv.u0, uv.v1, uB, x1, k * TILE, z0, uv.u1, uv.v1, vB);
          }
          for (let foot = hAt(tx - 1, ty), k = foot; k < h; k++) { // west
            const eN = cl && hAt(tx, ty - 1) <= k, eS = cl && hAt(tx, ty + 1) <= k;
            const uT = cl ? cliffShade(TINT_EW, k + 1, h, foot, eN) : TINT_EW,
              vT = cl ? cliffShade(TINT_EW, k + 1, h, foot, eS) : TINT_EW,
              uB = cl ? cliffShade(TINT_EW, k, h, foot, eN) : TINT_EW,
              vB = cl ? cliffShade(TINT_EW, k, h, foot, eS) : TINT_EW;
            quad4(verts,
              x0, (k + 1) * TILE, z0, uv.u0, uv.v0, uT, x0, (k + 1) * TILE, z1, uv.u1, uv.v0, vT,
              x0, k * TILE, z0, uv.u0, uv.v1, uB, x0, k * TILE, z1, uv.u1, uv.v1, vB);
          }
        }
      }
      const aux = cfg.materials ? buildAuxTextures(ch, map) : null;
      const mesh = batchMesh(verts, ch.tex, aux);
      // XZ bounds for the point-shadow pass's per-light cull.
      mesh.userData.rect = { x0: ch.x, z0: ch.y, x1: ch.x + ch.w, z1: ch.y + ch.h };
      terrainGroup.add(mesh);
      mapDisposables.push(mesh.geometry, mesh.material as THREE.Material, ch.tex);
      if (aux) mapDisposables.push(aux.mat, aux.emis);

      // ---- animated water surface for this chunk (Stage C) ----
      if (cfg.water > 0) {
        const ground = map.layers && map.layers.ground;
        const isWater = (tx: number, ty: number) =>
          !!ground && tx >= 0 && ty >= 0 && tx < mapW && ty < mapH &&
          WATER_TILES.has(ground[ty * mapW + tx]);
        // foam at corners that touch any non-water tile
        const foamAt = (cx: number, cy: number) =>
          isWater(cx - 1, cy - 1) && isWater(cx, cy - 1) && isWater(cx - 1, cy) && isWater(cx, cy) ? 0 : 1;
        const wverts: number[] = [];
        for (let ty = ty0; ty < ty1; ty++) {
          for (let tx = tx0; tx < tx1; tx++) {
            if (!isWater(tx, ty)) continue;
            const uv = tileUV(ch, tx, ty);
            const y = hAt(tx, ty) * TILE + WATER_Y;
            const x0 = tx * TILE, x1 = x0 + TILE, z0 = ty * TILE, z1 = z0 + TILE;
            const fA = foamAt(tx, ty), fB = foamAt(tx + 1, ty),
              fC = foamAt(tx, ty + 1), fD = foamAt(tx + 1, ty + 1);
            wverts.push(
              x0, y, z0, uv.u0, uv.v0, fA, x1, y, z0, uv.u1, uv.v0, fB, x0, y, z1, uv.u0, uv.v1, fC,
              x0, y, z1, uv.u0, uv.v1, fC, x1, y, z0, uv.u1, uv.v0, fB, x1, y, z1, uv.u1, uv.v1, fD,
            );
          }
        }
        if (wverts.length) {
          const { geo } = batchGeometry(wverts);
          const wmesh = new THREE.Mesh(geo, waterMaterial(ch.tex, ch.w, ch.h));
          wmesh.frustumCulled = false;
          wmesh.matrixAutoUpdate = false;
          wmesh.userData.rect = { x0: ch.x, z0: ch.y, x1: ch.x + ch.w, z1: ch.y + ch.h };
          waterGroup.add(wmesh);
          // ch.tex is disposed with the terrain mesh above — only our own here.
          mapDisposables.push(wmesh.geometry, wmesh.material as THREE.Material);
        }
      }
    }

    // overhead tiles float one tile unit above their ground height
    const over = map.layers && map.layers.over;
    for (const ch of upper) {
      const verts: number[] = [];
      const tx0 = ch.x / TILE,
        ty0 = ch.y / TILE;
      const tx1 = Math.min(mapW, (ch.x + ch.w) / TILE),
        ty1 = Math.min(mapH, (ch.y + ch.h) / TILE);
      for (let ty = ty0; ty < ty1; ty++) {
        for (let tx = tx0; tx < tx1; tx++) {
          if (!over || !over[ty * mapW + tx]) continue;
          const uv = tileUV(ch, tx, ty);
          const y = (hAt(tx, ty) + 1) * TILE;
          quad(verts,
            tx * TILE, y, ty * TILE, uv.u0, uv.v0, (tx + 1) * TILE, y, ty * TILE, uv.u1, uv.v0,
            tx * TILE, y, (ty + 1) * TILE, uv.u0, uv.v1, (tx + 1) * TILE, y, (ty + 1) * TILE, uv.u1, uv.v1, 1);
        }
      }
      if (!verts.length) {
        ch.tex.dispose(); // chunk has no overhead tiles — no mesh, no texture
        continue;
      }
      const mesh = batchMesh(verts, ch.tex);
      mesh.userData.rect = { x0: ch.x, z0: ch.y, x1: ch.x + ch.w, z1: ch.y + ch.h };
      overheadGroup.add(mesh);
      mapDisposables.push(mesh.geometry, mesh.material as THREE.Material, ch.tex);
    }
  }

  // ---------------------------- sun shadows (Stage B) ----------------------------
  const SHADOW_RES = 2048;
  let shadowRT: THREE.WebGLRenderTarget | null = null;

  function ensureShadowRT() {
    if (shadowRT) return;
    shadowRT = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    const dt = new THREE.DepthTexture(SHADOW_RES, SHADOW_RES);
    dt.format = THREE.DepthFormat;
    dt.type = THREE.UnsignedIntType;
    shadowRT.depthTexture = dt;
    U.uShadowTexel.value[0] = 1 / SHADOW_RES;
    U.uShadowTexel.value[1] = 1 / SHADOW_RES;
  }

  // Fit an orthographic sun frustum to the whole map's AABB (heights included,
  // plus headroom for sprites standing on the tallest tile). The sun is fixed
  // per map — azimuth: compass degrees clockwise from north (default 35, sun
  // in the NE sky, shadows falling toward the camera); elevation: degrees
  // above the horizon (default 55). Stage D's day/night cycle will animate
  // these; for now they are static so golden captures stay deterministic.
  function fitSunCamera(map: any, sun: any) {
    const azDeg = sun && Number.isFinite(Number(sun.azimuth)) ? Number(sun.azimuth) : 35;
    const elDeg = Math.min(85, Math.max(15, sun && Number.isFinite(Number(sun.elevation)) ? Number(sun.elevation) : 55));
    const az = (azDeg * Math.PI) / 180,
      el = (elDeg * Math.PI) / 180;
    // Unit vector toward the sun; world x = east, z = south, so north is -z.
    const dir = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
    let maxH = 0;
    if (map.heights) for (const v of map.heights) if (v > maxH) maxH = Number(v);
    const wpx = map.width * TILE,
      hpx = map.height * TILE,
      top = (maxH + 2) * TILE;
    const cx = wpx / 2,
      cy = top / 2,
      cz = hpx / 2;
    const dist = Math.hypot(wpx, top, hpx);
    const view = lookAt(cx + dir[0] * dist, cy + dir[1] * dist, cz + dir[2] * dist, cx, cy, cz);
    let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const x of [0, wpx]) {
      for (const y of [0, top]) {
        for (const z of [0, hpx]) {
          const vx = view[0] * x + view[4] * y + view[8] * z + view[12];
          const vy = view[1] * x + view[5] * y + view[9] * z + view[13];
          const vz = view[2] * x + view[6] * y + view[10] * z + view[14];
          l = Math.min(l, vx); r = Math.max(r, vx);
          b = Math.min(b, vy); t = Math.max(t, vy);
          zMin = Math.min(zMin, vz); zMax = Math.max(zMax, vz);
        }
      }
    }
    const pad = TILE; // keep casters on the map edge inside the frustum
    U.uSunMVP.value.fromArray(
      mul(ortho(l - pad, r + pad, b - pad, t + pad, -zMax - pad, -zMin + pad), view),
    );
  }

  // Depth-pass material mirroring a scene material's texture (same uniform
  // OBJECT, so per-frame sprite texture swaps propagate automatically).
  function depthMatFor(mesh: THREE.Mesh): THREE.RawShaderMaterial {
    let dm = mesh.userData.depthMat as THREE.RawShaderMaterial | undefined;
    if (!dm) {
      dm = new THREE.RawShaderMaterial({
        vertexShader: DEPTH_VS,
        fragmentShader: DEPTH_FS,
        uniforms: { uDepthMVP: depthMVP, uTex: (mesh.material as any).uniforms.uTex },
      });
      dm.glslVersion = THREE.GLSL3;
      dm.blending = THREE.NoBlending;
      dm.depthTest = true;
      dm.depthWrite = true;
      dm.side = THREE.DoubleSide;
      mesh.userData.depthMat = dm;
    }
    return dm;
  }

  // Swap every visible world mesh to its depth material, run fn, restore.
  // Material swap-and-restore keeps a single scene graph (no parallel shadow
  // scene to keep in sync).
  function withDepthMaterials(fn: (swapped: THREE.Mesh[]) => void) {
    const swapped: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
    const meshes: THREE.Mesh[] = [];
    for (const group of [terrainGroup, spriteGroup, overheadGroup]) {
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        if (!mesh.visible) continue;
        swapped.push([mesh, mesh.material]);
        meshes.push(mesh);
        mesh.material = depthMatFor(mesh);
      }
    }
    // Non-casters (water surface, drop blobs, weather particles) must not
    // reach the depth passes at all — they'd draw with their own camera-space
    // shaders and pollute the light's depth map.
    const wasVisible: Array<[THREE.Group, boolean]> = [];
    for (const g of [waterGroup, dropGroup, weatherGroup]) {
      wasVisible.push([g, g.visible]);
      g.visible = false;
    }
    fn(meshes);
    for (const [g, v] of wasVisible) g.visible = v;
    for (const [mesh, mat] of swapped) mesh.material = mat;
  }

  // Render the sun depth map. `dl` scales strength (day/night fades shadows
  // toward dusk; 1 when the cycle is off).
  function renderSunDepth(r: THREE.WebGLRenderer, dl = 1) {
    ensureShadowRT();
    depthMVP.value.copy(U.uSunMVP.value);
    withDepthMaterials(() => {
      r.setRenderTarget(shadowRT);
      r.clear(true, true, false);
      r.render(scene, camera);
    });
    U.uShadowMap.value = shadowRT!.depthTexture;
    U.uShadowStrength.value = cfg.shadows * dl;
  }

  // ------------------------ point-light shadows (Stage B.2) ------------------------
  let plRT: THREE.WebGLRenderTarget | null = null;

  function ensurePLRT() {
    if (plRT) return;
    plRT = new THREE.WebGLRenderTarget(PL_W, PL_H, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    const dt = new THREE.DepthTexture(PL_W, PL_H);
    dt.format = THREE.DepthFormat;
    dt.type = THREE.UnsignedIntType;
    plRT.depthTexture = dt;
  }

  // Cube-face axes [right, up, forward] — the SCENE_FS plVis() lookup is the
  // analytic mirror of these; change one and you must change both.
  const PL_FACES: Array<[number[], number[], number[]]> = [
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]], // +X
    [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], // -X
    [[1, 0, 0], [0, 0, 1], [0, 1, 0]], // +Y
    [[1, 0, 0], [0, 0, -1], [0, -1, 0]], // -Y
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], // +Z
    [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], // -Z
  ];

  function faceView(R: number[], Uv: number[], F: number[], px: number, py: number, pz: number) {
    return [
      R[0], Uv[0], -F[0], 0,
      R[1], Uv[1], -F[1], 0,
      R[2], Uv[2], -F[2], 0,
      -(R[0] * px + R[1] * py + R[2] * pz),
      -(Uv[0] * px + Uv[1] * py + Uv[2] * pz),
      F[0] * px + F[1] * py + F[2] * pz,
      1,
    ];
  }

  // Render the first `count` lights' omnidirectional depth into the shared
  // atlas: per light, 6 cube-face passes into their viewport tiles; meshes
  // outside the light's range are hidden for its passes (cheap XZ cull).
  function renderPointDepth(r: THREE.WebGLRenderer, count: number) {
    withDepthMaterials((meshes) => {
      // NOTE: three only applies a target's .viewport inside setRenderTarget,
      // so every viewport change below re-calls it (same target, cheap).
      plRT!.viewport.set(0, 0, PL_W, PL_H);
      r.setRenderTarget(plRT);
      r.clear(true, true, false);
      const hidden: THREE.Mesh[] = [];
      for (let i = 0; i < count; i++) {
        const lx = lightPos[i * 4],
          ly = lightPos[i * 4 + 1],
          lz = lightPos[i * 4 + 2];
        const range = Math.max(lightPos[i * 4 + 3], PL_NEAR * 2);
        for (const mesh of meshes) {
          const ud = mesh.userData;
          let out = false;
          if (ud.rect) {
            const dx = Math.max(ud.rect.x0 - lx, 0, lx - ud.rect.x1);
            const dz = Math.max(ud.rect.z0 - lz, 0, lz - ud.rect.z1);
            out = Math.hypot(dx, dz) > range + TILE;
          } else if (ud.bound) {
            out = Math.hypot(ud.bound[0] - lx, ud.bound[1] - lz) - ud.bound[2] > range + TILE;
          }
          if (out) {
            mesh.visible = false;
            hidden.push(mesh);
          }
        }
        const proj = perspective(Math.PI / 2, 1, PL_NEAR, range);
        for (let f = 0; f < 6; f++) {
          const [R, Uv, F] = PL_FACES[f];
          depthMVP.value.fromArray(mul(proj, faceView(R, Uv, F, lx, ly, lz)));
          plRT!.viewport.set((f % 3) * PL_FACE, (i * 2 + (f < 3 ? 0 : 1)) * PL_FACE, PL_FACE, PL_FACE);
          r.setRenderTarget(plRT); // re-applies the viewport
          r.render(scene, camera);
        }
        for (const m of hidden) m.visible = true;
        hidden.length = 0;
      }
      plRT!.viewport.set(0, 0, PL_W, PL_H);
    });
    U.uPLMap.value = plRT!.depthTexture;
    U.uPLStrength.value = cfg.pointShadows;
  }

  // ---------------------- planar reflection (Stage C) ----------------------
  let reflectRT: THREE.WebGLRenderTarget | null = null;
  let reflectW = 0,
    reflectH = 0;

  function ensureReflectRT(w: number, h: number) {
    const hw = Math.max(1, w >> 1),
      hh = Math.max(1, h >> 1);
    if (reflectRT && reflectW === hw && reflectH === hh) return;
    reflectRT?.dispose();
    reflectRT = new THREE.WebGLRenderTarget(hw, hh, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    reflectW = hw;
    reflectH = hh;
  }

  // Mirror about the water plane: y' = 2*WATER_Y - y (column-major).
  const MIRROR_Y = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 2 * WATER_Y, 0, 1];

  // Render the mirrored scene for the water's reflection lookup: same
  // projection/viewport, camera reflected about the water plane, everything
  // below the waterline discarded (CLIPY) so the submerged ground doesn't
  // shadow the reflections, and the water surface itself hidden.
  function renderReflection(r: THREE.WebGLRenderer, mvp: number[], clear: number[]) {
    ensureReflectRT(sizedW, sizedH);
    waterGroup.visible = false;
    dropGroup.visible = false;
    weatherGroup.visible = false;
    U.uClipY.value[0] = 1;
    U.uClipY.value[1] = WATER_Y + 0.5;
    U.uMVP.value.fromArray(mul(mvp, MIRROR_Y));
    r.setRenderTarget(reflectRT);
    r.setClearColor(new THREE.Color(clear[0], clear[1], clear[2]), 1);
    r.clear(true, true, false);
    r.render(scene, camera);
    U.uMVP.value.fromArray(mvp);
    U.uClipY.value[0] = 0;
    waterGroup.visible = true;
    dropGroup.visible = true;
    weatherGroup.visible = true;
    U.uReflect.value = reflectRT!.texture;
  }

  // Coarse XZ view culling (Stage E): chunk-granular, applied only around the
  // reflection + scene passes so off-screen chunks still cast shadows in the
  // depth passes. Margins absorb the tilt (the camera sees further north) and
  // tall geometry near the edges.
  function setViewCull(camX: number, camY: number, viewW: number, viewH: number, on: boolean) {
    const m = 6 * TILE;
    const x0 = camX - m,
      x1 = camX + viewW + m;
    const z0 = camY - 10 * TILE,
      z1 = camY + viewH + m;
    for (const g of [terrainGroup, waterGroup, overheadGroup]) {
      for (const child of g.children) {
        const rect = child.userData.rect;
        if (!rect) continue;
        child.visible =
          !on || !(rect.x1 < x0 || rect.x0 > x1 || rect.z1 < z0 || rect.z0 > z1);
      }
    }
  }

  // ---------------------- weather & drop shadows (Stage E) ----------------------
  const WEATHER_MAX = 800;
  const WEATHER_COUNTS: Record<string, [number, number]> = {
    rain: [0, 700],
    snow: [1, 420],
    motes: [2, 140],
  };
  const weatherU = {
    uMVP: U.uMVP,
    uTime: U.uTime,
    uArea: { value: new Float32Array(4) },
    uWCount: { value: 0 },
    uWMode: { value: 0 },
  };
  let weatherMesh: THREE.Mesh | null = null;

  function ensureWeatherMesh() {
    if (weatherMesh) return;
    // Deterministic per-particle seeds from a fixed LCG.
    let s = 48271;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
    const CORNERS = [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5];
    const data = new Float32Array(WEATHER_MAX * 6 * 6); // aSeed(3) aCorner(2) aId(1)
    let o = 0;
    for (let i = 0; i < WEATHER_MAX; i++) {
      const s0 = rnd(), s1 = rnd(), s2 = rnd();
      for (let v = 0; v < 6; v++) {
        data[o++] = s0;
        data[o++] = s1;
        data[o++] = s2;
        data[o++] = CORNERS[v * 2];
        data[o++] = CORNERS[v * 2 + 1];
        data[o++] = i;
      }
    }
    const geo = new THREE.BufferGeometry();
    const buf = new THREE.InterleavedBuffer(data, 6);
    const seed = new THREE.InterleavedBufferAttribute(buf, 3, 0);
    geo.setAttribute("aSeed", seed);
    geo.setAttribute("position", seed); // sizes the draw (see batchGeometry)
    geo.setAttribute("aCorner", new THREE.InterleavedBufferAttribute(buf, 2, 3));
    geo.setAttribute("aId", new THREE.InterleavedBufferAttribute(buf, 1, 5));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    const m = new THREE.RawShaderMaterial({
      vertexShader: WEATHER_VS,
      fragmentShader: WEATHER_FS,
      uniforms: weatherU,
    });
    m.glslVersion = THREE.GLSL3;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.depthTest = true;
    m.depthWrite = false;
    m.side = THREE.DoubleSide;
    m.transparent = false;
    weatherMesh = new THREE.Mesh(geo, m);
    weatherMesh.frustumCulled = false;
    weatherMesh.matrixAutoUpdate = false;
    weatherGroup.add(weatherMesh);
  }

  // Radial blob texture for drop shadows, generated once.
  let dropTex: THREE.CanvasTexture | null = null;
  function ensureDropTex() {
    if (dropTex) return;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.7, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    dropTex = makeTexture(c);
    dropTex.magFilter = THREE.LinearFilter;
    dropTex.minFilter = THREE.LinearFilter;
  }

  const dropPool: Array<{ mesh: THREE.Mesh; buf: THREE.InterleavedBuffer }> = [];
  function poolDrop(i: number) {
    ensureDropTex();
    while (dropPool.length <= i) {
      const { geo, buf } = batchGeometry(new Array(36).fill(0), true);
      const m = new THREE.RawShaderMaterial({
        vertexShader: WATER_VS, // pos/uv/tint passthrough
        fragmentShader: DROP_FS,
        uniforms: { uMVP: U.uMVP, uTex: { value: dropTex } },
      });
      m.glslVersion = THREE.GLSL3;
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.OneFactor;
      m.blendDst = THREE.OneMinusSrcAlphaFactor;
      m.depthTest = true;
      m.depthWrite = false;
      m.side = THREE.DoubleSide;
      m.transparent = false;
      const mesh = new THREE.Mesh(geo, m);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      dropGroup.add(mesh);
      dropPool.push({ mesh, buf });
    }
    return dropPool[i];
  }

  // ---------------------------- sprites ----------------------------
  // Assets.charFrameCanvas caches its canvases, so keying textures off the
  // canvas object means each frame is uploaded once and reused.
  const spriteTexCache = new WeakMap<HTMLCanvasElement, THREE.CanvasTexture>();
  function texFor(srcCanvas: HTMLCanvasElement): THREE.CanvasTexture {
    let t = spriteTexCache.get(srcCanvas);
    if (!t) {
      t = makeTexture(srcCanvas);
      spriteTexCache.set(srcCanvas, t);
    }
    return t;
  }

  // Reusable pool of one-quad meshes; pool index = draw order, so the sorted
  // sprite list renders far-to-near exactly like the classic per-sprite draws.
  const spritePool: Array<{ mesh: THREE.Mesh; buf: THREE.InterleavedBuffer; mat: THREE.RawShaderMaterial }> = [];
  function poolSprite(i: number) {
    while (spritePool.length <= i) {
      const { geo, buf } = batchGeometry(new Array(36).fill(0), true);
      const mat = sceneMaterial(null as any);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      spriteGroup.add(mesh);
      spritePool.push({ mesh, buf, mat });
    }
    return spritePool[i];
  }

  // ---------------------------- frame ----------------------------
  // Render one frame. camX/camY are the engine's clamped 2D camera origin; the
  // look-at target reuses them so the 3D camera tracks like the 2D one.
  // sprites: [{canvas, rx, ry, pr}] in tile coords; pr 0|1|2 = below/same/above.
  function renderFrame(w: number, h: number, camX: number, camY: number, sprites: any[], extra: any) {
    if (!ok || !renderer || !gl || gl.isContextLost()) return null;
    extra = extra || {};
    const r = renderer;
    if (sizedW !== w || sizedH !== h) {
      r.setSize(w, h, false); // sets canvas width/height; CSS stays the host's
      sizedW = w;
      sizedH = h;
    }

    const tiltDeg = Math.min(89, Math.max(25, extra.tilt != null ? Number(extra.tilt) : cfg.tilt));
    const pitch = (tiltDeg * Math.PI) / 180;
    const zoom = Math.max(0.25, Math.min(4, Number(extra.zoom) || 1));
    const ambient =
      extra.ambient != null ? Math.min(2, Math.max(0, Number(extra.ambient))) : cfg.ambient;
    const dist = h / 2 / Math.tan(FOV / 2) / zoom;
    const near = dist / 10,
      far = dist * 2 + mapDiag;
    // Screen-space shake → world pan of the whole camera (eye + target together).
    const shX = (extra.shakeX || 0) / zoom,
      shZ = (extra.shakeY || 0) / zoom;
    const tX = camX + w / zoom / 2 + shX,
      tZ = camY + h / zoom / 2 + shZ;
    const eye = [tX, dist * Math.sin(pitch), tZ + dist * Math.cos(pitch)];
    const mvp = mul(perspective(FOV, w / h, near, far), lookAt(eye[0], eye[1], eye[2], tX, 0, tZ));
    U.uMVP.value.fromArray(mvp); // both column-major — direct copy
    U.uEye.value[0] = eye[0];
    U.uEye.value[1] = eye[1];
    U.uEye.value[2] = eye[2];

    if (cfg.fog) {
      U.uFog.value.set([cfg.fog.color[0], cfg.fog.color[1], cfg.fog.color[2], 1]);
      U.uFogRange.value[0] = cfg.fog.near || dist;
      U.uFogRange.value[1] = cfg.fog.far || dist * 2.2;
    } else {
      U.uFog.value.set([0, 0, 0, 0]);
      U.uFogRange.value[0] = 1;
      U.uFogRange.value[1] = 2;
    }
    // Ambient is always the base light level; point-light events (already gated
    // by the host's "Point lights" toggle) add on top of it.
    let lights = (cfg.lights && extra.lights) || [];
    if (cfg.pointShadows > 0 && lights.length > 1) {
      // Shadow casters are the first MAX_PLS entries — sort by distance to the
      // camera target so the closest lights are the ones that cast.
      const d2 = (L: any) => ((L.rx + 0.5) * TILE - tX) ** 2 + ((L.ry + 0.5) * TILE - tZ) ** 2;
      lights = lights.slice().sort((a: any, b: any) => d2(a) - d2(b));
    }
    const nLights = Math.min(lights.length, MAX_LIGHTS);
    for (let i = 0; i < nLights; i++) {
      const L = lights[i];
      lightPos[i * 4] = (L.rx + 0.5) * TILE;
      lightPos[i * 4 + 1] = sampleH(L.rx, L.ry) * TILE + TILE * 0.75;
      lightPos[i * 4 + 2] = (L.ry + 0.5) * TILE;
      lightPos[i * 4 + 3] = Math.max(1, L.radius);
      const rgb = hexRGB(L.color);
      lightCol[i * 3] = rgb[0];
      lightCol[i * 3 + 1] = rgb[1];
      lightCol[i * 3 + 2] = rgb[2];
    }
    U.uAmbient.value = ambient;
    U.uLightCount.value = nLights;
    // Stage C: tick-driven time (determinism: hosts pass the engine tick),
    // emissive glow engagement (full at pitch black, zero at default ambient),
    // and the water shader's screen size for its reflection lookup.
    U.uTime.value = (Number(extra.t) || 0) / 60;
    U.uScreen.value[0] = w;
    U.uScreen.value[1] = h;
    // Stage D: day/night — the hour drives the sun's position, a tinted &
    // scaled ambient (folded into uAmbTint), sun-shadow strength, and the
    // emissive glow below. Everything derives from extra.timeOfDay, which the
    // engine owns (map default / script hooks) — nothing here ticks on its own.
    let effAmbient = ambient;
    let sunDl = 1;
    if (cfg.dayNight) {
      const h24 = Number.isFinite(Number(extra.timeOfDay))
        ? Math.min(24, Math.max(0, Number(extra.timeOfDay)))
        : 12;
      const dn = dayNightAt(h24);
      sunDl = dn.daylight;
      effAmbient = ambient * dn.scale;
      for (let i = 0; i < 3; i++) U.uAmbTint.value[i] = dn.tint[i] * dn.scale;
      const az = (dn.azimuth * Math.PI) / 180,
        el = (dn.elevation * Math.PI) / 180;
      U.uSunDir.value[0] = Math.sin(az) * Math.cos(el);
      U.uSunDir.value[1] = Math.sin(el);
      U.uSunDir.value[2] = -Math.cos(az) * Math.cos(el);
      if (cfg.shadows > 0 && lastMapArgs) {
        fitSunCamera(lastMapArgs[2], { azimuth: dn.azimuth, elevation: dn.elevation });
      }
    }
    U.uGlow.value = Math.min(1, Math.max(0, (0.45 - effAmbient) / 0.45));

    // far-to-near so soft alpha edges blend correctly between sprites
    sprites.sort((a, b) => a.ry - b.ry);
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      const p = poolSprite(i);
      const sw = s.canvas.width,
        sh = s.canvas.height;
      const x0 = s.rx * TILE + (TILE - sw) / 2;
      const base = sampleH(s.rx, s.ry) * TILE;
      // feet sit where the 2D path drew them (8px above the tile's south edge);
      // priority nudges the plane so below/above sprites layer like in 2D
      const z = (s.ry + 1) * TILE - 8 + ((s.pr || 1) - 1) * 6;
      (p.buf.array as Float32Array).set([
        x0, base + sh, z, 0, 0, 1, x0 + sw, base + sh, z, 1, 0, 1, x0, base, z, 0, 1, 1,
        x0, base, z, 0, 1, 1, x0 + sw, base + sh, z, 1, 0, 1, x0 + sw, base, z, 1, 1, 1,
      ]);
      p.buf.needsUpdate = true;
      p.mat.uniforms.uTex.value = texFor(s.canvas);
      p.mesh.userData.bound = [x0 + sw / 2, z, Math.max(sw, sh)]; // XZ cull circle
      p.mesh.visible = true;
      if (cfg.dropShadows) { // soft blob under the feet
        const d = poolDrop(i);
        const dw = sw * 0.72,
          dh = sw * 0.42;
        const cx = x0 + sw / 2,
          cz2 = z - 4,
          dy = base + 1.5;
        (d.buf.array as Float32Array).set([
          cx - dw / 2, dy, cz2 - dh / 2, 0, 0, 1, cx + dw / 2, dy, cz2 - dh / 2, 1, 0, 1, cx - dw / 2, dy, cz2 + dh / 2, 0, 1, 1,
          cx - dw / 2, dy, cz2 + dh / 2, 0, 1, 1, cx + dw / 2, dy, cz2 - dh / 2, 1, 0, 1, cx + dw / 2, dy, cz2 + dh / 2, 1, 1, 1,
        ]);
        d.buf.needsUpdate = true;
        d.mesh.visible = true;
      }
    }
    for (let i = sprites.length; i < spritePool.length; i++) spritePool[i].mesh.visible = false;
    for (let i = cfg.dropShadows ? sprites.length : 0; i < dropPool.length; i++) {
      dropPool[i].mesh.visible = false;
    }

    // ---- weather particles (Stage E) ----
    if (cfg.weather) {
      ensureWeatherMesh();
      const [mode, count] = WEATHER_COUNTS[cfg.weather];
      weatherU.uWMode.value = mode;
      weatherU.uWCount.value = count;
      weatherU.uArea.value[0] = tX;
      weatherU.uArea.value[1] = tZ - 40;
      weatherU.uArea.value[2] = w / zoom / 2 + 100;
      weatherU.uArea.value[3] = h / zoom / 2 + 200;
      weatherMesh!.visible = true;
    } else if (weatherMesh) {
      weatherMesh.visible = false;
    }

    // ---- sun depth pass (only when this map casts shadows; none at night) ----
    if (cfg.shadows > 0 && sunDl > 0.003) renderSunDepth(r, sunDl);
    else if (cfg.shadows > 0) U.uShadowStrength.value = 0;

    // ---- point-light depth pass (map.hd2d.pointShadows) ----
    const plCount = cfg.pointShadows > 0 ? Math.min(nLights, MAX_PLS) : 0;
    U.uPLCount.value = plCount;
    if (cfg.pointShadows > 0) {
      ensurePLRT();
      U.uPLMap.value = plRT!.depthTexture; // bound even at 0 casters (sampler is active)
      if (plCount > 0) renderPointDepth(r, plCount);
    }

    // The GL canvas is the bottom layer (the engine's 2D #gamecanvas sits on
    // top, transparent over the map), so clear opaque.
    const clear = cfg.fog ? cfg.fog.color : [16 / 255, 16 / 255, 24 / 255];

    // Chunk-level view culling for the visual passes (shadow passes above saw
    // the full scene, so off-screen casters still shadow the view).
    setViewCull(camX + shX, camY + shZ, w / zoom, h / zoom, true);

    // ---- planar-reflection pass (only when this map has water) ----
    if (cfg.water > 0 && waterGroup.children.length) renderReflection(r, mvp, clear);

    // ---- scene pass (direct to canvas unless a post effect needs a target) ----
    const post =
      cfg.bloom > 0 || cfg.dof > 0 || cfg.ssao > 0 || cfg.aces || cfg.vignette > 0 ||
      !!cfg.grade || cfg.fxaa;
    if (post) {
      ensureTargets(w, h, cfg.fxaa);
      r.setRenderTarget(rt!.scene);
    } else {
      r.setRenderTarget(null);
    }
    r.setClearColor(new THREE.Color(clear[0], clear[1], clear[2]), 1);
    r.clear(true, true, false);
    r.render(scene, camera);
    setViewCull(0, 0, 0, 0, false); // restore chunk visibility for the next frame's depth passes

    // ---- post passes ----
    if (post) {
      if (cfg.dof > 0) { // blurred copy of the whole scene → half[0]
        brightU.uTex.value = rt!.scene.texture;
        brightU.uThreshold.value = 0;
        r.setRenderTarget(rt!.half[0]);
        r.render(brightScene, camera);
        blurPass(rt!.half[0].texture, rt!.half[1], 1, 0);
        blurPass(rt!.half[1].texture, rt!.half[0], 0, 1);
      }
      if (cfg.bloom > 0) { // bright areas, blurred twice → half[2]
        brightU.uTex.value = rt!.scene.texture;
        brightU.uThreshold.value = 0.6;
        r.setRenderTarget(rt!.half[2]);
        r.render(brightScene, camera);
        blurPass(rt!.half[2].texture, rt!.half[3], 1, 0);
        blurPass(rt!.half[3].texture, rt!.half[2], 0, 1);
        blurPass(rt!.half[2].texture, rt!.half[3], 1, 0);
        blurPass(rt!.half[3].texture, rt!.half[2], 0, 1);
      }
      if (cfg.ssao > 0) { // depth-derived AO, blurred once → half[4]
        aoU.uDepth.value = rt!.scene.depthTexture;
        aoU.uNearFar.value[0] = near;
        aoU.uNearFar.value[1] = far;
        aoU.uInvSize.value[0] = 1 / rt!.hw;
        aoU.uInvSize.value[1] = 1 / rt!.hh;
        aoU.uProjScale.value = h / 2 / Math.tan(FOV / 2);
        r.setRenderTarget(rt!.half[4]);
        r.render(aoScene, camera);
        blurPass(rt!.half[4].texture, rt!.half[5], 1, 0);
        blurPass(rt!.half[5].texture, rt!.half[4], 0, 1);
      }

      // composite to the canvas (or to the FXAA source target)
      compU.uScene.value = rt!.scene.texture;
      compU.uBlurScene.value = rt!.half[0].texture;
      compU.uBlurBright.value = rt!.half[2].texture;
      compU.uDepth.value = rt!.scene.depthTexture;
      compU.uBloom.value = cfg.bloom;
      compU.uDof.value = cfg.dof;
      compU.uNearFar.value[0] = near;
      compU.uNearFar.value[1] = far;
      let focusDist = dist;
      if (extra.focus) {
        const f = extra.focus;
        const fx = (f.rx + 0.5) * TILE,
          fy = sampleH(f.rx, f.ry) * TILE,
          fz = (f.ry + 0.5) * TILE;
        focusDist = Math.hypot(fx - eye[0], fy - eye[1], fz - eye[2]);
      }
      compU.uFocusDist.value = focusDist;
      compU.uFocusRange.value = dist * 0.9;
      compU.uAO.value = rt!.half[4].texture;
      compU.uSsao.value = cfg.ssao;
      compU.uAces.value = cfg.aces ? 1 : 0;
      compU.uVignette.value = cfg.vignette;
      compU.uGradeOn.value = cfg.grade ? 1 : 0;
      if (cfg.grade) {
        compU.uGradeM.value.fromArray(cfg.grade.m);
        compU.uGradeB.value.set(cfg.grade.b);
      }
      r.setRenderTarget(cfg.fxaa ? rt!.post : null);
      r.render(compScene, camera);
      if (cfg.fxaa) { // final edge-blended resolve to the canvas
        fxaaU.uTex.value = rt!.post!.texture;
        fxaaU.uInvSize.value[0] = 1 / w;
        fxaaU.uInvSize.value[1] = 1 / h;
        r.setRenderTarget(null);
        r.render(fxaaScene, camera);
      }
    }
    return cv;
  }

  // True while the GL context is lost (between webglcontextlost and a
  // successful webglcontextrestored rebuild). Lets the host fall back to the
  // Canvas 2D path for the duration instead of freezing on the last frame.
  function isLost(): boolean {
    return !ok || (!!gl && gl.isContextLost());
  }

  // Live GPU-side counters for the perf overlay and the memory-stability e2e
  // (Phase 7): draw calls / triangles reset per frame; geometries / textures
  // are three's alive-resource counts, the signal for dispose() leaks.
  function stats(): any {
    if (!renderer) return null;
    const info = renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs ? info.programs.length : 0,
    };
  }

  return { available, setMap, renderFrame, isLost, stats };
}
