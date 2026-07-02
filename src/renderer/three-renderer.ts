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
  const MAX_LIGHTS = 16;

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
    "void main() {\n" +
    "  vec4 c = texture(uTex, vUV);\n" +
    "  if (c.a < 0.25) discard;\n" +
    "  vec3 rgb = c.rgb * vTint;\n" +
    "  if (uAmbient >= 0.0) {\n" +
    "    vec3 lit = vec3(uAmbient);\n" +
    "    for (int i = 0; i < " + MAX_LIGHTS + "; i++) {\n" +
    "      if (i >= uLightCount) break;\n" +
    "      float f = max(0.0, 1.0 - distance(vWorld, uLightPos[i].xyz) / uLightPos[i].w);\n" +
    "      lit += f * f * uLightCol[i];\n" +
    "    }\n" +
    "    rgb *= lit;\n" +
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
  // Sun-depth pass (Stage B): world geometry rasterized from the sun's
  // orthographic view; alpha-tested like the scene pass so sprite cutouts and
  // tile transparency cast correct silhouettes.
  const DEPTH_VS =
    "layout(location=0) in vec3 aPos;\n" +
    "layout(location=1) in vec2 aUV;\n" +
    "uniform mat4 uSunMVP;\n" +
    "out vec2 vUV;\n" +
    "void main() {\n" +
    "  gl_Position = uSunMVP * vec4(aPos, 1.0);\n" +
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
  const COMP_FS =
    "precision highp float;\n" +
    "in vec2 vUV;\n" +
    "uniform sampler2D uScene, uBlurScene, uBlurBright, uDepth;\n" +
    "uniform float uBloom, uDof, uFocusDist, uFocusRange;\n" +
    "uniform vec2 uNearFar;\n" +
    "out vec4 outColor;\n" +
    "void main() {\n" +
    "  vec3 col = texture(uScene, vUV).rgb;\n" +
    "  if (uDof > 0.0) {\n" +
    "    float d = texture(uDepth, vUV).r * 2.0 - 1.0;\n" +
    "    float z = 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - d * (uNearFar.y - uNearFar.x));\n" +
    "    float coc = clamp((abs(z - uFocusDist) - " + (TILE * 3).toFixed(1) + ") / uFocusRange, 0.0, 1.0) * uDof;\n" +
    "    col = mix(col, texture(uBlurScene, vUV).rgb, coc);\n" +
    "  }\n" +
    "  if (uBloom > 0.0) col += texture(uBlurBright, vUV).rgb * uBloom;\n" +
    "  outColor = vec4(col, 1.0);\n" +
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
    // Stage B sun shadows (only uploaded to programs compiled with SHADOWS).
    uSunMVP: { value: new THREE.Matrix4() },
    uShadowMap: { value: null as THREE.Texture | null },
    uShadowStrength: { value: 0 },
    uShadowTexel: { value: new Float32Array(2) },
  };

  const camera = new THREE.Camera(); // dummy — uMVP is computed manually
  const scene = new THREE.Scene();
  const terrainGroup = new THREE.Group();
  const spriteGroup = new THREE.Group();
  const overheadGroup = new THREE.Group();
  scene.add(terrainGroup, spriteGroup, overheadGroup);
  [scene, terrainGroup, spriteGroup, overheadGroup].forEach((o) => (o.matrixAutoUpdate = false));

  function sceneMaterial(tex: THREE.Texture): THREE.RawShaderMaterial {
    const m = new THREE.RawShaderMaterial({
      vertexShader: SCENE_VS,
      fragmentShader: SCENE_FS,
      uniforms: { ...U, uTex: { value: tex } },
    });
    if (cfg.shadows > 0) m.defines.SHADOWS = 1;
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

  function batchMesh(verts: number[], tex: THREE.Texture): THREE.Mesh {
    const { geo } = batchGeometry(verts);
    const mesh = new THREE.Mesh(geo, sceneMaterial(tex));
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
    scene: THREE.WebGLRenderTarget;
    half: THREE.WebGLRenderTarget[];
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
    rt = null;
  }

  function ensureTargets(w: number, h: number) {
    if (rt && rt.w === w && rt.h === h) return;
    freeTargets();
    const hw = Math.max(1, w >> 1),
      hh = Math.max(1, h >> 1);
    rt = {
      w, h, hw, hh,
      scene: makeTarget(w, h, true),
      half: [makeTarget(hw, hh, false), makeTarget(hw, hh, false), makeTarget(hw, hh, false), makeTarget(hw, hh, false)],
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
    uBloom: { value: 0 },
    uDof: { value: 0 },
    uFocusDist: { value: 0 },
    uFocusRange: { value: 1 },
    uNearFar: { value: new Float32Array([1, 2]) },
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
  // HD-2D preview), otherwise a canvas is inserted behind #gamecanvas.
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
  let cfg: any = { tilt: 50, bloom: 0, dof: 0, fog: null, lights: false, ambient: 0.45, shadows: 0 };
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

  // Chop a prerendered map buffer into chunk textures. Each chunk gets its OWN
  // canvas (not a reused scratch): three uploads canvas textures lazily at
  // first render, so the source canvas must stay alive and untouched.
  function chopBuffer(buf: HTMLCanvasElement) {
    const list: Array<{ tex: THREE.CanvasTexture; x: number; y: number; w: number; h: number }> = [];
    for (let y = 0; y < buf.height; y += CHUNK) {
      for (let x = 0; x < buf.width; x += CHUNK) {
        const w = Math.min(CHUNK, buf.width - x),
          h = Math.min(CHUNK, buf.height - y);
        const piece = document.createElement("canvas");
        piece.width = w;
        piece.height = h;
        piece.getContext("2d")!.drawImage(buf, x, y, w, h, 0, 0, w, h);
        list.push({ tex: makeTexture(piece), x, y, w, h });
      }
    }
    return list;
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
    };
    // Toggle the SHADOWS compile variant on the long-lived sprite-pool
    // materials (terrain/overhead materials are rebuilt below and pick the
    // define up in sceneMaterial()).
    for (const p of spritePool) {
      const has = !!p.mat.defines.SHADOWS;
      if (cfg.shadows > 0 && !has) {
        p.mat.defines.SHADOWS = 1;
        p.mat.needsUpdate = true;
      } else if (cfg.shadows <= 0 && has) {
        delete p.mat.defines.SHADOWS;
        p.mat.needsUpdate = true;
      }
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
      for (let ty = ty0; ty < ty1; ty++) {
        for (let tx = tx0; tx < tx1; tx++) {
          const h = hAt(tx, ty);
          if (h <= 0) continue;
          const uv = tileUV(ch, tx, ty);
          const x0 = tx * TILE,
            x1 = x0 + TILE,
            z0 = ty * TILE,
            z1 = z0 + TILE,
            top = h * TILE;
          // top face, textured with the tile's own prerendered appearance
          quad(verts,
            x0, top, z0, uv.u0, uv.v0, x1, top, z0, uv.u1, uv.v0,
            x0, top, z1, uv.u0, uv.v1, x1, top, z1, uv.u1, uv.v1, 1);
          // exposed walls, one tile-unit segment at a time, auto-shaded.
          // North walls face away from the fixed camera and are never visible.
          for (let k = hAt(tx, ty + 1); k < h; k++) { // south
            quad(verts,
              x0, (k + 1) * TILE, z1, uv.u0, uv.v0, x1, (k + 1) * TILE, z1, uv.u1, uv.v0,
              x0, k * TILE, z1, uv.u0, uv.v1, x1, k * TILE, z1, uv.u1, uv.v1, TINT_S);
          }
          for (let k = hAt(tx + 1, ty); k < h; k++) { // east
            quad(verts,
              x1, (k + 1) * TILE, z1, uv.u0, uv.v0, x1, (k + 1) * TILE, z0, uv.u1, uv.v0,
              x1, k * TILE, z1, uv.u0, uv.v1, x1, k * TILE, z0, uv.u1, uv.v1, TINT_EW);
          }
          for (let k = hAt(tx - 1, ty); k < h; k++) { // west
            quad(verts,
              x0, (k + 1) * TILE, z0, uv.u0, uv.v0, x0, (k + 1) * TILE, z1, uv.u1, uv.v0,
              x0, k * TILE, z0, uv.u0, uv.v1, x0, k * TILE, z1, uv.u1, uv.v1, TINT_EW);
          }
        }
      }
      const mesh = batchMesh(verts, ch.tex);
      terrainGroup.add(mesh);
      mapDisposables.push(mesh.geometry, mesh.material as THREE.Material, ch.tex);
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
        uniforms: { uSunMVP: U.uSunMVP, uTex: (mesh.material as any).uniforms.uTex },
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

  // Render the sun depth map: every visible world mesh, drawn with its depth
  // material. Material swap-and-restore keeps a single scene graph (no
  // parallel shadow scene to keep in sync).
  function renderSunDepth(r: THREE.WebGLRenderer) {
    ensureShadowRT();
    const swapped: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
    for (const group of [terrainGroup, spriteGroup, overheadGroup]) {
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        if (!mesh.visible) continue;
        swapped.push([mesh, mesh.material]);
        mesh.material = depthMatFor(mesh);
      }
    }
    r.setRenderTarget(shadowRT);
    r.clear(true, true, false);
    r.render(scene, camera);
    for (const [mesh, mat] of swapped) mesh.material = mat;
    U.uShadowMap.value = shadowRT!.depthTexture;
    U.uShadowStrength.value = cfg.shadows;
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
    const lights = (cfg.lights && extra.lights) || [];
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
      p.mesh.visible = true;
    }
    for (let i = sprites.length; i < spritePool.length; i++) spritePool[i].mesh.visible = false;

    // ---- sun depth pass (only when this map casts shadows) ----
    if (cfg.shadows > 0) renderSunDepth(r);

    // ---- scene pass (direct to canvas unless a post effect needs a target) ----
    const post = cfg.bloom > 0 || cfg.dof > 0;
    if (post) {
      ensureTargets(w, h);
      r.setRenderTarget(rt!.scene);
    } else {
      r.setRenderTarget(null);
    }
    // The GL canvas is the bottom layer (the engine's 2D #gamecanvas sits on
    // top, transparent over the map), so clear opaque.
    const clear = cfg.fog ? cfg.fog.color : [16 / 255, 16 / 255, 24 / 255];
    r.setClearColor(new THREE.Color(clear[0], clear[1], clear[2]), 1);
    r.clear(true, true, false);
    r.render(scene, camera);

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

      // composite to the canvas
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
      r.setRenderTarget(null);
      r.render(compScene, camera);
    }
    return cv;
  }

  // True while the GL context is lost (between webglcontextlost and a
  // successful webglcontextrestored rebuild). Lets the host fall back to the
  // Canvas 2D path for the duration instead of freezing on the last frame.
  function isLost(): boolean {
    return !ok || (!!gl && gl.isContextLost());
  }

  return { available, setMap, renderFrame, isLost };
}
