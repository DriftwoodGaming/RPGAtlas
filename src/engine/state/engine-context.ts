/* RPGAtlas — src/engine/state/engine-context.ts
   The shared mutable engine context: the seam that replaced the engine
   monolith's closure variables (Phase 1 Stage B). Engine modules read and
   write live engine state through `ctx` (project, scene, camera/shake/flash
   scalars, map runtime state, DOM roots, late-bound message/input systems)
   and reach functions across scene boundaries — where a direct import would
   create a cycle — through the `fns` forward-ref registry (each entry is
   self-installed by its owning module at evaluation; boot.ts is the
   composition root). The initial values below mirror the monolith's `let`
   initializers; boot() assigns the DOM roots and project. Typed loosely this
   phase; Stage D tightens. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { defaultWorld } from "./default-world.js";

export const ctx: any = {
  // project + DOM roots (set at boot)
  proj: null,
  stage: null,
  canvas: null,
  g2d: null, // the game canvas 2d context (the monolith's `ctx`)
  uiLayer: null,
  fader: null,
  // screen size (overridden at boot from system.screenWidth/Height)
  SCREEN_W: 0,
  SCREEN_H: 0,
  // scene flags
  scene: "boot", // boot | title | map | battle | gameover
  menuOpen: false,
  playtestMode: false, // editor-launched ?playtest only; always false in exports
  // camera / shake / flash scalars (written by interpreter command handlers)
  cameraZoom: 1,
  shakePower: 0,
  shakeSpeed: 0,
  shakeDuration: 0,
  shakeTimer: 0,
  flashColor: "#ffffff",
  flashOpacity: 0.5,
  flashDuration: 0,
  flashTimer: 0,
  // unified input system (created at wiring, rebound at boot)
  Input: null,
  // message system (late-bound: assigned at wiring)
  richText: null,
  showMessage: null,
  setMsgSpeed: null,
  // map runtime
  map: null,
  lowerBuf: null,
  upperBuf: null,
  hdActive: false, // current map renders through the WebGL HD-2D path
  evRTs: [],
  blockingRun: false, // an action/touch/autorun interpreter is active
  parallels: new Map(), // evRT -> running flag
  commonParallels: new Map(), // common event id -> running flag
  // map scene clock + fixed-timestep loop accumulator (render interpolates)
  globalT: 0,
  loopLast: 0,
  loopAcc: 0,
  // per-player overrides (input rebinds + audio/game settings)
  playerOptions: {},
  dashLatch: false,
  dashPrev: false,
};

// ---- Project Beacon MP1·A compat shim -------------------------------------
// The world-classed ctx fields (MP0·B singleton audit) now LIVE on the
// default world instance (src/shared/sim/world.ts); the accessors below keep
// every existing `ctx.<field>` read/write working unchanged — same values,
// same object identities, same enumeration order (the literal keys above are
// redefined in place; their initializers are mirrored by createWorld()).
// `globalT` is the one rename: it is the world's `tick`, the clock every
// future snapshot/delta message carries. Client and config fields stay plain
// data properties on ctx — a browser tab is one client; module scope remains
// correct for those.
const WORLD_SLICE = [
  ["proj", "proj"],
  ["cameraZoom", "cameraZoom"],
  ["map", "map"],
  ["evRTs", "evRTs"],
  ["blockingRun", "blockingRun"],
  ["parallels", "parallels"],
  ["commonParallels", "commonParallels"],
  ["globalT", "tick"],
] as const;
for (const [ctxKey, worldKey] of WORLD_SLICE) {
  Object.defineProperty(ctx, ctxKey, {
    enumerable: true,
    configurable: true,
    get: () => (defaultWorld as any)[worldKey],
    set: (v: any) => {
      (defaultWorld as any)[worldKey] = v;
    },
  });
}

/** Late-bound engine functions (refreshAllPages, openMenu, Battle, Plugins,
 *  gameOver, toTitle). Modules that would need an upward/cyclic import call
 *  through here instead; each owner self-installs its entries at module
 *  evaluation, before anything can call them. */
export const fns: any = {};
