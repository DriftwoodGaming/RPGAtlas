"use strict";

// Project Beacon MP1·A — the compat shim, proven end-to-end. The engine's
// historical module-level names (G in game-state.ts, the world slice of ctx
// in engine-context.ts, rnd/rndf/seedRnd in util.ts, the window.AtlasRng /
// RPGATLAS_RNG_SEED hooks) must all be live views of ONE default world
// instance (src/shared/sim/world.ts) — same objects, same RNG stream — so
// the sim can become instanced with zero behavior change. Bundled with
// esbuild and evaluated under the classic-script window stub, exactly like
// interpreter.test.js / playtest-through.test.js.

const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");

function bundle(entry) {
  return buildSync({
    stdin: { contents: entry, resolveDir: root, loader: "ts" },
    bundle: true,
    format: "cjs",
    write: false,
    platform: "node",
    logLevel: "silent",
  }).outputFiles[0].text;
}

const p = (rel) => JSON.stringify(path.join(root, rel).replace(/\\/g, "/"));
const shimEntry = `
  export { ctx } from ${p("src/engine/state/engine-context.ts")};
  export { defaultWorld } from ${p("src/engine/state/default-world.ts")};
  export { G } from ${p("src/engine/state/game-state.ts")};
  export { seedRnd, rnd, rndf } from ${p("src/engine/util.ts")};
  export { mulberry32 } from ${p("src/shared/rng.ts")};
`;
const code = bundle(shimEntry);

function loadShim(windowStub) {
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require,
    console,
    window: windowStub,
    URLSearchParams,
  });
  return module.exports;
}

// ---- One world behind every legacy name ------------------------------------
const win = { RPGAtlasDeps: { Assets: { TILE: 48 }, RA: {} } };
const shim = loadShim(win);

assert.equal(shim.G, shim.defaultWorld.g, "G IS the default world's game state");
assert.equal(shim.ctx.evRTs, shim.defaultWorld.evRTs, "ctx.evRTs is the world's array");
assert.equal(shim.ctx.parallels, shim.defaultWorld.parallels, "ctx.parallels is the world's map");
assert.equal(
  shim.ctx.commonParallels,
  shim.defaultWorld.commonParallels,
  "ctx.commonParallels is the world's map",
);

shim.ctx.globalT = 41;
assert.equal(shim.defaultWorld.tick, 41, "ctx.globalT writes land on world.tick");
shim.ctx.globalT++;
assert.equal(shim.ctx.globalT, 42, "ctx.globalT increments through the accessor");
shim.defaultWorld.cameraZoom = 2.5;
assert.equal(shim.ctx.cameraZoom, 2.5, "world writes are visible through ctx");
const proj = { system: { title: "Shim Proof" } };
shim.ctx.proj = proj;
assert.equal(shim.defaultWorld.proj, proj, "ctx.proj binds the project onto the world");
shim.G.switches.door = true;
assert.equal(shim.defaultWorld.g.switches.door, true, "G mutations are world mutations");

// ---- util.ts RNG delegates to the SAME stream -------------------------------
shim.seedRnd(123);
const ref = shim.mulberry32(123);
assert.equal(shim.rndf(), ref(), "seedRnd(123): util rndf draws the world's stream");
assert.equal(
  shim.defaultWorld.rndf(),
  ref(),
  "world.rndf continues the SAME stream (one stream, not two)",
);
assert.equal(shim.rnd(100), Math.floor(ref() * 100), "util rnd floors the shared stream");
assert.equal(shim.defaultWorld.rngSeed, 123, "the seed is visible on the world");

// ---- window.AtlasRng binds to the default world -----------------------------
assert.ok(win.AtlasRng, "util.ts installs window.AtlasRng under the stub");
win.AtlasRng.seed(7);
const ref7 = shim.mulberry32(7);
assert.equal(shim.rndf(), ref7(), "AtlasRng.seed reseeds the default world");
assert.equal(shim.defaultWorld.rngSeed, 7, "…and the world records it");
win.AtlasRng.unseed();
assert.equal(shim.defaultWorld.rngSeed, null, "AtlasRng.unseed restores Math.random");

// ---- pre-boot RPGATLAS_RNG_SEED seeds the world at module eval ---------------
const seededWin = {
  RPGAtlasDeps: { Assets: { TILE: 48 }, RA: {} },
  RPGATLAS_RNG_SEED: 555,
};
const seeded = loadShim(seededWin);
const ref555 = seeded.mulberry32(555);
assert.equal(
  seeded.rndf(),
  ref555(),
  "a pre-boot RPGATLAS_RNG_SEED already drives the default world's first roll",
);
assert.equal(seeded.defaultWorld.rngSeed, 555, "the Playwright seed lands on the world");

console.log("world-shim: compat shim is a pure view of the default world");
