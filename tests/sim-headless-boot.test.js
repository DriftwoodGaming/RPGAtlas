"use strict";

// Project Beacon MP1·C — headless boot + the determinism canary.
//
// Boots a world from the real Atlas_Quest fixture with NO browser (the sim
// core is headless by law — MP1·C's lint wall enforces the import side; this
// test proves it runs), then ticks it 600 times through the world's own
// surface — the seeded RNG stream plus the REAL migrated world subsystems
// (scenes/presentation-runtime pictures/tint/timer/scroll, now living on the
// world instance). A stable state hash over the resulting world state is the
// determinism canary that guards every later phase: same seed ⇒ identical
// hash, a different seed ⇒ a different hash, and the hash is pinned so a change
// to mulberry32 or the world RNG draw order is caught immediately.
//
// The engine's real per-tick driver (update()/onPlayerStep()) is DOM/render/
// input-bound and does not move INTO the world until MP2 (loopback tick
// ownership); this test therefore drives the world at MP1's level — the world
// instance's determinism surface — mirroring the engine's per-tick world RNG
// consumption (NPC random walk, step + encounter roll) against real world
// state. MP2's gate re-runs determinism through the real loopback tick.
//
// Bundled with esbuild and evaluated under the classic-script window stub,
// exactly like tests/presentation-runtime.test.js — each realm gets its own
// fresh default world, so same-seed determinism is a true two-instance compare.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

// FNV-1a (32-bit) — a tiny, dependency-free, order-sensitive hash. Deterministic
// on every machine, which is the whole point of the canary.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function buildBundle() {
  const { build } = require("esbuild");
  const j = (rel) => JSON.stringify(path.join(root, rel).replace(/\\/g, "/"));
  const entry = `
    export * from ${j("src/engine/scenes/presentation-runtime.ts")};
    export { createWorld } from ${j("src/shared/sim/world.ts")};
    export { defaultWorld } from ${j("src/engine/state/default-world.ts")};
  `;
  return (
    await build({
      stdin: { contents: entry, resolveDir: root, loader: "ts" },
      bundle: true,
      format: "cjs",
      write: false,
      platform: "node",
      logLevel: "silent",
    })
  ).outputFiles[0].text;
}

// A fresh realm = a fresh default world (module singletons are re-evaluated),
// so two same-seed runs are genuinely independent instances.
function freshRealm(code) {
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require,
    console,
    // deps.js reads window.RPGAtlasDeps.Assets at eval; scrollOffsetPx() reads TILE.
    window: { RPGAtlasDeps: { Assets: { TILE: 48 } } },
  });
  return module.exports;
}

// Tick the world 600 times. Every branch consumes the world's seeded stream
// exactly where the engine does (NPC random walk in update(); step + encounter
// roll in onPlayerStep()), and every presentation op is REAL migrated code
// (scenes/presentation-runtime), so its per-tick tweens advance real world
// state. Deterministic function of seed + tick count — the MP1 contract.
function simulate(P, ticks) {
  const world = P.defaultWorld;
  P.resetPresentation(); // fresh world screen state (pictures/tint/timer/scroll)
  world.g.steps = 0;
  world.g.encSteps = 0;
  world.g.vars = {};
  world.tick = 0;
  const RATE = 30;
  let battles = 0;
  const dirs = ["up", "down", "left", "right"];
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    // NPC random-walk decision (mirrors scenes/map.ts update()).
    const turn = world.rnd(4) === 0;
    const dir = world.rnd(4);
    if (!turn && dir >= 0) world.g.vars.npcMoves = (world.g.vars.npcMoves || 0) + 1;
    // Event-driven presentation, params drawn from the seeded stream so the
    // final screen state depends on the seed.
    if (world.tick % 30 === 0) P.tintScreen({ tone: [world.rnd(255), world.rnd(255), 0, 0], frames: 20 });
    if (world.tick % 45 === 0) P.showPicture({ id: 1 + world.rnd(3), name: "", x: world.rnd(600), y: world.rnd(400) });
    if (world.tick % 90 === 0) P.scrollMap({ dir: dirs[world.rnd(4)], distance: 1 + world.rnd(3), speed: 4 });
    // Step + random encounter every 8 ticks (mirrors onPlayerStep()).
    if (world.tick % 8 === 0) {
      world.g.steps++;
      world.g.encSteps++;
      if (world.g.encSteps >= RATE * (0.7 + world.rndf() * 0.6)) {
        world.g.encSteps = 0;
        world.g.vars.lastTroop = 1 + world.rnd(3);
        battles++;
      }
    }
    // Advance the REAL world presentation tweens + count-down timer this tick.
    P.updatePresentation();
    P.tickTimer();
  }
  world.g.vars.battles = battles;
  return world;
}

// A stable hash over the world state that the 600-tick sim produced.
function stateHash(P) {
  const world = P.defaultWorld;
  const canon = JSON.stringify({
    tick: world.tick,
    steps: world.g.steps,
    encSteps: world.g.encSteps,
    vars: world.g.vars,
    rngSeed: world.rngSeed,
    tint: world.tint,
    scroll: world.scroll,
    presentation: P.serializePresentation(),
  });
  return fnv1a(canon);
}

// The pinned 600-tick determinism hash for SEED_A (mulberry32 + the world RNG
// draw order above). If this changes, EITHER the RNG generator/draw order drifted
// (a determinism regression — investigate) OR this driver was intentionally
// edited (re-pin from the printed value).
const GOLDEN_SEED_A = "46633057";
const SEED_A = 20260719;
const SEED_B = 987654321;

(async () => {
  const code = await buildBundle();
  const fixtureProj = JSON.parse(fs.readFileSync(path.join(root, "Atlas_Quest.json"), "utf8"));

  // ---- Headless boot: a world created FROM the fixture, no browser ----------
  {
    const P = freshRealm(code);
    const w = P.createWorld(fixtureProj, { seed: SEED_A });
    assert.equal(w.proj, fixtureProj, "createWorld binds the fixture project by reference");
    assert.equal(w.rngSeed, SEED_A, "the world boots seeded");
    assert.equal(w.tick, 0, "a fresh world starts at tick 0");
    // vm-realm deepEqual trap: w.g.party has the sandbox's Array prototype, so
    // compare structurally, not with assert.deepEqual.
    assert.ok(Array.isArray(w.g.party) && w.g.party.length === 0, "fresh game state — empty party");
    assert.equal(w.g.gold, 0, "fresh game state — no gold");
    // The world really was created FROM Atlas_Quest.
    assert.ok(Array.isArray(fixtureProj.maps) && fixtureProj.maps.length >= 1, "fixture has maps");
    assert.ok(fixtureProj.system, "fixture has a system block");
    // A second instance from the same fixture shares no state (server-hosting).
    const w2 = P.createWorld(fixtureProj, { seed: SEED_A });
    w.g.gold = 999;
    assert.equal(w2.g.gold, 0, "two worlds from one fixture are fully isolated");
  }

  // ---- Determinism canary: two same-seed runs, one different-seed run -------
  const r1 = freshRealm(code);
  r1.defaultWorld.proj = fixtureProj;
  r1.defaultWorld.seedRnd(SEED_A);
  const w1 = simulate(r1, 600);
  const hashA1 = stateHash(r1);

  const r2 = freshRealm(code);
  r2.defaultWorld.proj = fixtureProj;
  r2.defaultWorld.seedRnd(SEED_A);
  simulate(r2, 600);
  const hashA2 = stateHash(r2);

  const r3 = freshRealm(code);
  r3.defaultWorld.proj = fixtureProj;
  r3.defaultWorld.seedRnd(SEED_B);
  simulate(r3, 600);
  const hashB = stateHash(r3);

  // ---- Invariants after 600 ticks -------------------------------------------
  assert.equal(w1.tick, 600, "the world advanced exactly 600 ticks");
  assert.equal(w1.g.steps, 75, "600 ticks = 75 steps (one every 8 ticks)");
  assert.ok(w1.g.encSteps >= 0 && w1.g.encSteps < 30, "encounter counter stays within [0, rate)");
  assert.ok(Number.isInteger(w1.g.vars.battles) && w1.g.vars.battles >= 0, "battle count is a non-negative integer");

  // ---- The determinism guarantee --------------------------------------------
  assert.equal(hashA1, hashA2, "same seed ⇒ identical 600-tick world-state hash (the canary)");
  assert.notEqual(hashA1, hashB, "a different seed ⇒ a different hash (RNG truly drives the sim)");
  assert.equal(hashA1, GOLDEN_SEED_A, "the 600-tick determinism hash is pinned (mulberry32 + world RNG draw order)");

  console.log("sim-headless-boot: 600-tick determinism hash (seed", SEED_A + "):", hashA1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
