# Phase 2 Spec — Rendering Core v2 (three.js HD-2D)

**Status:** IN PROGRESS — Stage A COMPLETE (2026-07-01, merged to main): parity port green
against unchanged baselines, classic fallback pinned to the same goldens, post-stack golden
added. Stage B.1 COMPLETE (2026-07-01): directional sun shadow maps (3×3 PCF) behind
`map.hd2d.shadows` (+ optional `hd2d.sun {azimuth, elevation}`), terrain/sprites/overhead
cast & receive via a `#define SHADOWS` compile variant — OFF compiles byte-identical to the
parity shaders, so every Stage A golden still passes; editor Map Properties toggle; new
three-captured golden `hd2d-shadows-meridian-village.png`.
Stage B.2 COMPLETE (2026-07-02): omnidirectional point-light shadows behind
`map.hd2d.pointShadows` (`POINT_SHADOWS` define, same byte-identical-when-off discipline).
The 4 lights nearest the camera target render 6 cube faces each into one shared 2D depth
atlas (256px faces, 3×2 tiles per light, lights stacked; the face axes are pinned between
the JS view matrices and an analytic GLSL lookup — no per-fragment matrix indexing), with a
4-tap PCF + slope bias against the near-grazing ground. Editor Map Properties toggle; new
three-captured golden `hd2d-pointshadows-meridian-village.png` (injected lights + raised
wall). Gotcha for future passes: three.js only applies a render target's `.viewport` inside
`setRenderTarget()`, so per-tile viewport changes must re-call it.
Remaining: C water/materials, D post stack & day/night, E particles/terrain/perf.
**Branch:** `phase-2-renderer` (off `main` at tag `phase-1`)
**Architect & Stage A implementation:** Claude Fable 5 (roadmap assignment: "three.js scene
architecture + parity skeleton"). Stages B–E cores: Claude Opus (high).

## Objective

Port the raw-WebGL2 HD-2D renderer (`js/renderer.js`, 747 lines) to **three.js** behind the
`RendererAdapter` seam cut in Phase 1, reaching **strict visual parity** validated by the
Phase 0 golden images — then (later stages) build the new capabilities (shadows, materials,
water, day/night, post stack, GPU particles, terrain upgrades) on the three.js scene graph.

**Stage A is parity-frozen.** The golden baselines
(`tests-e2e/__snapshots__/win32/renderer-golden.spec.mjs/*.png`, tolerance
`maxDiffPixelRatio: 0.02`) must pass unchanged with the new renderer as the default. The
classic renderer stays loaded as a runtime fallback (`?renderer=classic`) until parity is
signed off at phase exit, then is retired.

## Non-goals (Stage A)

- No new visual features, no per-map settings changes, no editor UI work.
- No changes to map prerender composition (`prerenderMap` / `hdBuildBuffers` keep producing
  the lower/upper canvas buffers; the renderer consumes them exactly as today).
- No perf work beyond not regressing (the perf budget CI check lands with Stage E).

---

## Current-state facts that constrain the design

1. **The surface to reimplement** (used by three hosts — `src/engine/render-glue.ts`,
   `src/engine/scenes/map-runtime.ts`, `src/editor/map-editor/hd-preview.ts`):
   - `available(options?: { canvas? }): Promise<boolean>` — creates the GL canvas (player:
     inserts `#glcanvas` behind `#gamecanvas`; editor: renders into the given canvas).
   - `setMap(lowerBuf, upperBuf, map): void` — rebuild chunk textures + static geometry.
   - `renderFrame(w, h, camX, camY, sprites, extra): canvas|null` — one frame;
     `sprites: [{id, canvas, rx, ry, pr}]`, `extra: {focus, lights, zoom, shakeX, shakeY,
     ambient, tilt, tilePassable}`.
   - `isLost(): boolean` — context-loss gate render-glue checks every frame.
   - `planWalls(map)`, `planLightOccluders(map, light, tilePassable)` — pure helpers,
     unit-tested in `tests/wall-extrusion.test.js`.
2. **Determinism contract** (tests-e2e/renderer-golden.spec.mjs): no internal
   `Math.random()/Date.now()/performance.now()` — every animated value derives from engine
   tick state passed in. SwiftShader rasterizes the goldens; identical GLSL + identical
   vertex data + identical draw order ⇒ within tolerance.
3. **Rendering recipe that produces today's pixels** (all of it must be replicated):
   - World units are px: X = map x·48, Z = map y·48 (south), Y = height·48 up. 45° FOV
     perspective camera at `dist = (h/2)/tan(FOV/2)/zoom`, pitch = tilt (25–89°).
   - Terrain: map prerender chopped into ≤1008px chunk textures (NEAREST, clamp);
     per chunk one batch = flat ground quad + per-tile extruded tops + south/east/west
     wall segments tinted 0.62 / 0.48. Overhead tiles float one tile-unit above ground.
   - Sprites: upright world-space billboards, feet at the 2D path's position
     (`(ry+1)·48 − 8` + priority nudge ±6), height-sampled bilinearly (`sampleH`).
     Drawn far-to-near sorted by `ry`, after terrain, before overhead.
   - Forward lighting in the fragment shader: ambient + up to 16 point lights,
     `(1 − d/r)²` falloff; alpha-test discard at 0.25; premultiplied-alpha blending
     (`ONE, ONE_MINUS_SRC_ALPHA`), `LEQUAL` depth.
   - Distance fog mixes toward `fog.color` over `[near, far]` view distance.
   - Post (only when bloom/dof enabled): scene to FBO (RGBA8 + DEPTH_COMPONENT24
     texture), half-res bright-pass/Gaussian ping-pong (DoF: 1 blur pass of the full
     scene; bloom: threshold 0.6, 2 blur passes), composite with depth-linearized
     circle-of-confusion DoF + additive bloom.
4. **Load model:** `js/renderer.js` is a classic script (window.Renderer/GLRender) loaded
   by both HTML pages and inlined in the standalone export. The engine/editor are Vite
   module entries, so a module renderer bundles automatically (dev, `vite build`, and the
   esbuild player bundle for exports all consume `src/` imports).
5. **Color-management trap:** three r150+ defaults to sRGB output color space and sRGB
   texture decode. Everything here is authored in display space (canvas prerenders);
   textures and render targets must be `NoColorSpace` and materials `RawShaderMaterial`
   (verbatim GLSL, three prepends nothing) or the goldens will shift globally.

---

## Stage A — Parity port (this session)

*Owner: Fable. The flagship risky migration; shader-exact, seam-respecting.*

### File map

| File | Role |
|---|---|
| `src/renderer/plan.ts` | `planWalls` / `planLightOccluders` — pure, typed, verbatim logic |
| `src/renderer/three-renderer.ts` | The three.js implementation of the classic surface |
| `src/renderer/index.ts` | Selection seam: default three, `?renderer=classic` fallback to `window.Renderer`; exports the process-wide `Renderer` the hosts import |
| `tests-unit/renderer-plan.test.ts` | Vitest port of the wall-extrusion suite (node vm test stays until the classic script retires) |

### Design decisions

- **three.js as managed context, not as material system (yet).** Stage A uses
  `RawShaderMaterial` with the classic shaders **verbatim** (same `#version 300 es`
  strings, same uniforms incl. the `TILE*3` DoF CoC constant), custom `uMVP` computed by
  the classic tiny-mat4 code (bit-identical matrices), `sortObjects: false` with
  explicit group order (terrain → sprites sorted by `ry` → overhead). three provides:
  context/extension management, buffer/texture/render-target lifecycles, and the scene
  graph later stages hang shadows/water/particles on. Parity risk is concentrated in
  state details, all pinned: `flipY: false`, `premultiplyAlpha: true`,
  `NoColorSpace`, `CustomBlending(ONE, ONE_MINUS_SRC_ALPHA)`, `LessEqualDepth`,
  NEAREST chunk/sprite textures, LINEAR half-res targets, opaque render list only
  (`transparent: false` — blending still applies; keeps three from resorting).
- **Post chain** on `WebGLRenderTarget`s mirroring the classic FBO layout: full-res scene
  target with `DepthTexture` (UnsignedInt ⇒ DEPTH_COMPONENT24), 4 half-res LINEAR
  targets, fullscreen-triangle passes. The attribute-less `gl_VertexID` trick becomes a
  3-vertex position attribute producing the identical triangle — same rasterization.
- **Selection seam:** `src/renderer/index.ts` is what `render-glue.ts`, `map-runtime.ts`
  and `hd-preview.ts` now import (they stop reading the `Renderer`/`GLRender` globals).
  Default = three. `?renderer=classic` (and `localStorage.rpgatlas_renderer`) routes to
  the classic script for A/B and as the risk-register fallback. The classic script keeps
  loading in both pages until phase exit.
- **Context loss:** same canvas events, same semantics (`ok=false` on loss, rebuild +
  `setMap` replay on restore); `isLost()` keeps render-glue's per-frame 2D fallback
  working.
- **License:** three.js is MIT — compatible with GPL-3.0-or-later (risk-register audit).

### Acceptance criteria (Stage A)

1. `renderer-golden.spec.mjs` passes **against the existing baselines** with three as
   default (`?hd2d=1`), plus a new third spec proving the classic fallback
   (`?hd2d=1&renderer=classic`) still matches the same baseline.
2. Full gate green: `tsc --noEmit`, `eslint`, `node --test tests/`, `vitest run`,
   full Playwright suite (editor, player, export specs untouched and green — the export
   spec implicitly validates the player bundle grew but still boots).
3. Editor HD-2D preview panel works on the three renderer (manual + existing editor spec).
4. No behavioral change to the Canvas 2D (`?hd2d=0`) path.
5. Patch-notes entry per AGENTS.md.

## Stages B–E — new capabilities (subsequent sessions, spec'd on entry)

- **B — Lighting & shadows** (Opus): directional sun + point-light shadow maps (PCF-soft),
  three-native materials for terrain/sprites replacing the raw parity shaders — gated by
  re-baselined goldens once parity sign-off retires the classic renderer.
- **C — Water & materials** (Opus): animated water plane (planar reflection/refraction,
  shore foam), tile normal/emissive maps, specular.
- **D — Post stack & day/night** (Opus + Sonnet plumbing): ACES, LUTs, vignette, SSAO,
  FXAA/MSAA, per-map toggles; sun curve + `time` system hooks.
- **E — GPU particles, terrain upgrades, perf budget** (Opus): weather/ambient particles
  shared with Phase 5 battle VFX; slopes/stairs; instancing + culling; 60 fps @1080p
  integrated-GPU CI check; fallback renderer retired; "Atlas Quest HD" showcase map.
