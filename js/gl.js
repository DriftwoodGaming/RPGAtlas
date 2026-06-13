/* RPGAtlas — gl.js
   HD-2D renderer (Phase 3). Raw WebGL2, no dependencies, no build step.
   The map is a 3D scene viewed through a tilted perspective camera: tiles
   with a height extrude into blocks (top face textured from the map
   prerender, exposed sides auto-shaded), characters are upright billboards
   standing at their tile's elevation, and overhead tiles hover one tile
   unit above their ground. World units are pixels: X = map x, Z = map y
   (south, toward the camera), Y = up = height * TILE.
   Atmosphere, each individually toggleable per map via map.hd2d:
     bloom  — bright areas glow (true or strength 0..1)
     dof    — depth of field focused on the player (true or strength 0..1)
     fog    — distance fog (true or {color, near, far} in px from camera)
     lights — point lights from events named "light [#rrggbb] [radius]",
              with `ambient` setting the base brightness (default 0.45)
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
"use strict";

const GLRender = (() => {
  const TILE = Assets.TILE;
  // Map prerenders are split into squares of at most CHUNK px so a large map
  // never exceeds the GPU's maximum texture size (4096 on older hardware).
  // Must be a multiple of TILE so every tile lives inside exactly one chunk.
  const CHUNK = TILE * 21; // 1008
  const FOV = Math.PI / 4; // 45° vertical field of view
  const TINT_S = 0.62, TINT_EW = 0.48; // auto-shading for exposed block walls
  const MAX_LIGHTS = 16;

  let cv = null, gl = null, ok = null;
  let sceneProg = null, brightProg = null, blurProg = null, compProg = null;
  let staticVAO = null, staticVBO = null, spriteVAO = null, spriteVBO = null, postVAO = null;
  const spriteVerts = new Float32Array(36); // 6 verts x (x,y,z,u,v,tint)
  const lightPos = new Float32Array(MAX_LIGHTS * 4);
  const lightCol = new Float32Array(MAX_LIGHTS * 3);

  // ---------------------------- shaders ----------------------------
  const SCENE_VS =
    "#version 300 es\n" +
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
    "#version 300 es\n" +
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
    "void main() {\n" +
    "  vec4 c = texture(uTex, vUV);\n" +
    "  if (c.a < 0.25) discard;\n" + // pixel art has hard edges; keeps depth-tested blending clean
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
    "  if (uFog.a > 0.0) {\n" +
    "    float f = clamp((distance(vWorld, uEye) - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);\n" +
    "    rgb = mix(rgb, uFog.rgb * c.a, f);\n" + // premultiplied: fog scales with alpha
    "  }\n" +
    "  outColor = vec4(rgb, c.a);\n" +
    "}";
  // attribute-less fullscreen triangle for the post passes
  const POST_VS =
    "#version 300 es\n" +
    "out vec2 vUV;\n" +
    "void main() {\n" +
    "  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;\n" +
    "  gl_Position = vec4(p, 0.0, 1.0);\n" +
    "  vUV = p * 0.5 + 0.5;\n" +
    "}";
  // threshold 0 = plain downsample; > 0 = bloom bright-pass
  const BRIGHT_FS =
    "#version 300 es\n" +
    "precision mediump float;\n" +
    "in vec2 vUV; uniform sampler2D uTex; uniform float uThreshold;\n" +
    "out vec4 outColor;\n" +
    "void main() {\n" +
    "  vec3 c = texture(uTex, vUV).rgb;\n" +
    "  outColor = vec4(max(c - uThreshold, 0.0) / (1.0 - min(uThreshold, 0.99)), 1.0);\n" +
    "}";
  const BLUR_FS =
    "#version 300 es\n" +
    "precision mediump float;\n" +
    "in vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir;\n" + // dir / texture size
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
    "#version 300 es\n" +
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

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function link(vsSrc, fsSrc, uniforms) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const o = { prog: p, u: {} };
    for (const name of uniforms) o.u[name] = gl.getUniformLocation(p, name);
    return o;
  }

  function makeVAO() {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); // x, y, z
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); // u, v
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2); // tint
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    return { vao, vbo };
  }

  function init() {
    sceneProg = link(SCENE_VS, SCENE_FS,
      ["uMVP", "uTex", "uEye", "uAmbient", "uLightCount", "uLightPos", "uLightCol", "uFog", "uFogRange"]);
    brightProg = link(POST_VS, BRIGHT_FS, ["uTex", "uThreshold"]);
    blurProg = link(POST_VS, BLUR_FS, ["uTex", "uDir"]);
    compProg = link(POST_VS, COMP_FS,
      ["uScene", "uBlurScene", "uBlurBright", "uDepth", "uBloom", "uDof", "uFocusDist", "uFocusRange", "uNearFar"]);
    gl.useProgram(compProg.prog);
    gl.uniform1i(compProg.u.uScene, 0);
    gl.uniform1i(compProg.u.uBlurScene, 1);
    gl.uniform1i(compProg.u.uBlurBright, 2);
    gl.uniform1i(compProg.u.uDepth, 3);

    const st = makeVAO();
    staticVAO = st.vao; staticVBO = st.vbo;
    const sp = makeVAO();
    spriteVAO = sp.vao; spriteVBO = sp.vbo;
    gl.bufferData(gl.ARRAY_BUFFER, spriteVerts.byteLength, gl.DYNAMIC_DRAW);
    postVAO = gl.createVertexArray(); // attribute-less; positions come from gl_VertexID

    // Canvas-sourced textures are unpremultiplied; premultiply on upload so
    // blending matches what drawImage produces on the 2D canvas.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthFunc(gl.LEQUAL);
  }

  // True when WebGL2 works here. Creates the context on first call; if the
  // context is ever lost we permanently report false and the engine falls
  // back to the Canvas 2D path (all GPU resources are invalid after a loss).
  function available() {
    if (ok !== null) return ok;
    try {
      cv = document.createElement("canvas");
      gl = cv.getContext("webgl2", { antialias: false, premultipliedAlpha: true });
      if (gl) {
        init();
        cv.addEventListener("webglcontextlost", () => {
          console.warn("HD-2D: WebGL context lost — falling back to Canvas 2D.");
          ok = false;
        });
      }
      ok = !!gl;
    } catch (e) {
      gl = null;
      ok = false;
    }
    if (!ok) console.warn("HD-2D: WebGL2 unavailable — using the Canvas 2D renderer.");
    return ok;
  }

  function makeTexture(srcCanvas) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // ---------------------------- render targets ----------------------------
  let rt = null; // { w, h, sceneFBO, sceneTex, depthTex, half: [{fbo, tex} x4], hw, hh }

  function makeTarget(w, h, depthTex) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (depthTex) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    return { fbo, tex };
  }

  function freeTargets() {
    if (!rt) return;
    gl.deleteFramebuffer(rt.scene.fbo);
    gl.deleteTexture(rt.scene.tex);
    gl.deleteTexture(rt.depthTex);
    rt.half.forEach((t) => { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); });
    rt = null;
  }

  function ensureTargets(w, h) {
    if (rt && rt.w === w && rt.h === h) return;
    freeTargets();
    const depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    rt = {
      w, h, hw, hh, depthTex,
      scene: makeTarget(w, h, depthTex),
      half: [makeTarget(hw, hh), makeTarget(hw, hh), makeTarget(hw, hh), makeTarget(hw, hh)],
    };
  }

  // ---------------------------- tiny mat4 ----------------------------
  // Column-major, just enough for one camera. No external math library.
  function perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(ex, ey, ez, tx, ty, tz) { // up = +Y
    let zx = ex - tx, zy = ey - ty, zz = ez - tz;
    const zl = Math.hypot(zx, zy, zz);
    zx /= zl; zy /= zl; zz /= zl;
    let xx = zz, xy = 0, xz = -zx; // up × z
    const xl = Math.hypot(xx, xy, xz);
    xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx; // z × x
    return [
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * ex + xy * ey + xz * ez), -(yx * ex + yy * ey + yz * ez), -(zx * ex + zy * ey + zz * ez), 1,
    ];
  }
  function mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }
  function hexRGB(s) {
    const v = parseInt(String(s || "").replace("#", ""), 16) || 0;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  // ---------------------------- map scene ----------------------------
  let texList = [];              // chunk textures (lower chunks, then upper)
  let terrainBatches = [];       // {tex, start, count} — ground + blocks
  let overheadBatches = [];      // {tex, start, count} — elevated over-layer
  let mapW = 0, mapH = 0, heights = null, mapDiag = 0;
  let cfg = { tilt: 50, bloom: 0, dof: 0, fog: null, lights: false, ambient: 0.45 };

  function hAt(tx, ty) {
    if (!heights || tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return 0;
    return heights[ty * mapW + tx] || 0;
  }
  // Bilinear height in tile units at a continuous tile position, so sprites
  // glide up cliffs during a step instead of popping.
  function sampleH(rx, ry) {
    const x0 = Math.floor(rx), y0 = Math.floor(ry);
    const fx = rx - x0, fy = ry - y0;
    const a = hAt(x0, y0) * (1 - fx) + hAt(x0 + 1, y0) * fx;
    const b = hAt(x0, y0 + 1) * (1 - fx) + hAt(x0 + 1, y0 + 1) * fx;
    return a * (1 - fy) + b * fy;
  }

  function quad(verts, ax, ay, az, au, av, bx, by, bz, bu, bv, cx, cy, cz, cu, cvv, dx, dy, dz, du, dv, tint) {
    verts.push(
      ax, ay, az, au, av, tint, bx, by, bz, bu, bv, tint, cx, cy, cz, cu, cvv, tint,
      cx, cy, cz, cu, cvv, tint, bx, by, bz, bu, bv, tint, dx, dy, dz, du, dv, tint
    );
  }

  // Chop a prerendered map buffer into chunk textures. Returns chunk descriptors
  // with their pixel rect so tile UVs can be computed into the owning chunk.
  function chopBuffer(buf) {
    const list = [];
    const scratch = document.createElement("canvas");
    for (let y = 0; y < buf.height; y += CHUNK) {
      for (let x = 0; x < buf.width; x += CHUNK) {
        const w = Math.min(CHUNK, buf.width - x), h = Math.min(CHUNK, buf.height - y);
        scratch.width = w; scratch.height = h;
        scratch.getContext("2d").drawImage(buf, x, y, w, h, 0, 0, w, h);
        list.push({ tex: makeTexture(scratch), x, y, w, h });
      }
    }
    return list;
  }

  // UVs of one tile inside its chunk.
  function tileUV(chunk, tx, ty) {
    const px = tx * TILE - chunk.x, py = ty * TILE - chunk.y;
    return { u0: px / chunk.w, v0: py / chunk.h, u1: (px + TILE) / chunk.w, v1: (py + TILE) / chunk.h };
  }

  // Rebuild the whole scene for a map: chunk textures plus one static vertex
  // buffer holding the flat ground, extruded blocks and elevated overhead tiles.
  function setMap(lowerBuf, upperBuf, map) {
    texList.forEach((t) => gl.deleteTexture(t));
    texList = [];
    terrainBatches = [];
    overheadBatches = [];
    mapW = map.width; mapH = map.height;
    heights = map.heights || null;
    mapDiag = (mapW + mapH) * TILE;

    const c = map.hd2d || {};
    cfg = {
      tilt: Math.min(89, Math.max(25, Number(c.tilt) || 50)),
      bloom: c.bloom === true ? 0.45 : Math.max(0, Number(c.bloom) || 0),
      dof: c.dof === true ? 0.6 : Math.max(0, Number(c.dof) || 0),
      fog: c.fog ? {
        color: hexRGB((c.fog && c.fog.color) || "#101018"),
        near: Number(c.fog && c.fog.near) || 0,  // 0 = derive from camera distance
        far: Number(c.fog && c.fog.far) || 0,
      } : null,
      lights: !!c.lights,
      ambient: c.ambient == null ? 0.45 : Math.min(2, Math.max(0, Number(c.ambient))),
    };

    const lower = chopBuffer(lowerBuf), upper = chopBuffer(upperBuf);
    const verts = [];

    // ground + blocks, batched per lower chunk texture
    for (const ch of lower) {
      const start = verts.length / 6;
      // flat ground plane for this chunk (raised blocks simply cover their cells)
      quad(verts,
        ch.x, 0, ch.y, 0, 0, ch.x + ch.w, 0, ch.y, 1, 0,
        ch.x, 0, ch.y + ch.h, 0, 1, ch.x + ch.w, 0, ch.y + ch.h, 1, 1, 1);
      const tx0 = ch.x / TILE, ty0 = ch.y / TILE;
      const tx1 = Math.min(mapW, (ch.x + ch.w) / TILE), ty1 = Math.min(mapH, (ch.y + ch.h) / TILE);
      for (let ty = ty0; ty < ty1; ty++) {
        for (let tx = tx0; tx < tx1; tx++) {
          const h = hAt(tx, ty);
          if (h <= 0) continue;
          const uv = tileUV(ch, tx, ty);
          const x0 = tx * TILE, x1 = x0 + TILE, z0 = ty * TILE, z1 = z0 + TILE, top = h * TILE;
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
      terrainBatches.push({ tex: ch.tex, start, count: verts.length / 6 - start });
    }

    // overhead tiles float one tile unit above their ground height
    const over = map.layers && map.layers.over;
    for (const ch of upper) {
      const start = verts.length / 6;
      const tx0 = ch.x / TILE, ty0 = ch.y / TILE;
      const tx1 = Math.min(mapW, (ch.x + ch.w) / TILE), ty1 = Math.min(mapH, (ch.y + ch.h) / TILE);
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
      const count = verts.length / 6 - start;
      if (count) overheadBatches.push({ tex: ch.tex, start, count });
    }

    texList = lower.map((c2) => c2.tex).concat(upper.map((c2) => c2.tex));
    gl.bindVertexArray(staticVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, staticVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  }

  // ---------------------------- sprites ----------------------------
  // Assets.charFrameCanvas caches its canvases, so keying GPU textures off
  // the canvas object means each frame is uploaded once and reused.
  const spriteTexCache = new WeakMap();
  function texFor(srcCanvas) {
    let t = spriteTexCache.get(srcCanvas);
    if (!t) { t = makeTexture(srcCanvas); spriteTexCache.set(srcCanvas, t); }
    return t;
  }

  function blurPass(srcTex, dst, dirX, dirY) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, rt.hw, rt.hh);
    gl.uniform2f(blurProg.u.uDir, dirX / rt.hw, dirY / rt.hh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Render one frame. camX/camY are the engine's clamped 2D camera origin;
  // the look-at target reuses them so the 3D camera tracks like the 2D one.
  // sprites: [{canvas, rx, ry, pr}] in tile coords; pr 0|1|2 = below/same/above
  // priority, used as a small depth bias so same-tile sprites layer stably.
  // extra (optional): { focus: {rx, ry} — player, for depth of field;
  //                     lights: [{rx, ry, color, radius}] — active light events }
  function renderFrame(w, h, camX, camY, sprites, extra) {
    if (!ok || gl.isContextLost()) return null;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }

    const pitch = cfg.tilt * Math.PI / 180;
    const zoom = Math.max(0.25, Math.min(4, Number(extra && extra.zoom) || 1));
    const dist = (h / 2) / Math.tan(FOV / 2) / zoom;
    const near = dist / 10, far = dist * 2 + mapDiag;
    const tX = camX + w / zoom / 2, tZ = camY + h / zoom / 2;
    const eye = [tX, dist * Math.sin(pitch), tZ + dist * Math.cos(pitch)];
    const mvp = mul(perspective(FOV, w / h, near, far), lookAt(eye[0], eye[1], eye[2], tX, 0, tZ));

    // ---- scene pass (direct to canvas unless a post effect needs an FBO) ----
    const post = cfg.bloom > 0 || cfg.dof > 0;
    if (post) {
      ensureTargets(w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.scene.fbo);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    const clear = cfg.fog ? cfg.fog.color : [16 / 255, 16 / 255, 24 / 255];
    gl.clearColor(clear[0], clear[1], clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(sceneProg.prog);
    gl.uniformMatrix4fv(sceneProg.u.uMVP, false, mvp);
    gl.uniform3f(sceneProg.u.uEye, eye[0], eye[1], eye[2]);
    if (cfg.fog) {
      gl.uniform4f(sceneProg.u.uFog, cfg.fog.color[0], cfg.fog.color[1], cfg.fog.color[2], 1);
      gl.uniform2f(sceneProg.u.uFogRange, cfg.fog.near || dist, cfg.fog.far || dist * 2.2);
    } else {
      gl.uniform4f(sceneProg.u.uFog, 0, 0, 0, 0);
      gl.uniform2f(sceneProg.u.uFogRange, 1, 2);
    }
    const lights = (cfg.lights && extra && extra.lights) || [];
    const nLights = Math.min(lights.length, MAX_LIGHTS);
    if (cfg.lights) {
      for (let i = 0; i < nLights; i++) {
        const L = lights[i];
        lightPos[i * 4] = (L.rx + 0.5) * TILE;
        lightPos[i * 4 + 1] = sampleH(L.rx, L.ry) * TILE + TILE * 0.75;
        lightPos[i * 4 + 2] = (L.ry + 0.5) * TILE;
        lightPos[i * 4 + 3] = Math.max(1, L.radius);
        const rgb = hexRGB(L.color);
        lightCol[i * 3] = rgb[0]; lightCol[i * 3 + 1] = rgb[1]; lightCol[i * 3 + 2] = rgb[2];
      }
      gl.uniform1f(sceneProg.u.uAmbient, cfg.ambient);
      gl.uniform1i(sceneProg.u.uLightCount, nLights);
      gl.uniform4fv(sceneProg.u.uLightPos, lightPos);
      gl.uniform3fv(sceneProg.u.uLightCol, lightCol);
    } else {
      gl.uniform1f(sceneProg.u.uAmbient, -1); // lighting disabled
      gl.uniform1i(sceneProg.u.uLightCount, 0);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(staticVAO);
    for (const b of terrainBatches) {
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.drawArrays(gl.TRIANGLES, b.start, b.count);
    }

    // far-to-near so soft alpha edges blend correctly between sprites
    sprites.sort((a, b) => a.ry - b.ry);
    gl.bindVertexArray(spriteVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteVBO); // buffer binding is not VAO state
    for (const s of sprites) {
      const sw = s.canvas.width, sh = s.canvas.height;
      const x0 = s.rx * TILE + (TILE - sw) / 2;
      const base = sampleH(s.rx, s.ry) * TILE;
      // feet sit where the 2D path drew them (8px above the tile's south edge);
      // priority nudges the plane so below/above sprites layer like in 2D
      const z = (s.ry + 1) * TILE - 8 + ((s.pr || 1) - 1) * 6;
      spriteVerts.set([
        x0, base + sh, z, 0, 0, 1, x0 + sw, base + sh, z, 1, 0, 1, x0, base, z, 0, 1, 1,
        x0, base, z, 0, 1, 1, x0 + sw, base + sh, z, 1, 0, 1, x0 + sw, base, z, 1, 1, 1,
      ]);
      gl.bindTexture(gl.TEXTURE_2D, texFor(s.canvas));
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, spriteVerts);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.bindVertexArray(staticVAO);
    for (const b of overheadBatches) {
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.drawArrays(gl.TRIANGLES, b.start, b.count);
    }

    // ---- post passes ----
    if (post) {
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(postVAO);

      if (cfg.dof > 0) { // blurred copy of the whole scene → half[0]
        gl.useProgram(brightProg.prog);
        gl.uniform1f(brightProg.u.uThreshold, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, rt.half[0].fbo);
        gl.viewport(0, 0, rt.hw, rt.hh);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rt.scene.tex);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.useProgram(blurProg.prog);
        blurPass(rt.half[0].tex, rt.half[1], 1, 0);
        blurPass(rt.half[1].tex, rt.half[0], 0, 1);
      }
      if (cfg.bloom > 0) { // bright areas, blurred twice → half[2]
        gl.useProgram(brightProg.prog);
        gl.uniform1f(brightProg.u.uThreshold, 0.6);
        gl.bindFramebuffer(gl.FRAMEBUFFER, rt.half[2].fbo);
        gl.viewport(0, 0, rt.hw, rt.hh);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rt.scene.tex);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.useProgram(blurProg.prog);
        blurPass(rt.half[2].tex, rt.half[3], 1, 0);
        blurPass(rt.half[3].tex, rt.half[2], 0, 1);
        blurPass(rt.half[2].tex, rt.half[3], 1, 0);
        blurPass(rt.half[3].tex, rt.half[2], 0, 1);
      }

      // composite to the canvas
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(compProg.prog);
      gl.uniform1f(compProg.u.uBloom, cfg.bloom);
      gl.uniform1f(compProg.u.uDof, cfg.dof);
      gl.uniform2f(compProg.u.uNearFar, near, far);
      let focusDist = dist;
      if (extra && extra.focus) {
        const f = extra.focus;
        const fx = (f.rx + 0.5) * TILE, fy = sampleH(f.rx, f.ry) * TILE, fz = (f.ry + 0.5) * TILE;
        focusDist = Math.hypot(fx - eye[0], fy - eye[1], fz - eye[2]);
      }
      gl.uniform1f(compProg.u.uFocusDist, focusDist);
      gl.uniform1f(compProg.u.uFocusRange, dist * 0.9);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, rt.scene.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, rt.half[0].tex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, rt.half[2].tex);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, rt.depthTex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
    return cv;
  }

  return { available, setMap, renderFrame };
})();
if (typeof window !== "undefined") window.GLRender = GLRender;
