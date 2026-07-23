"use strict";

// Project Beacon MP7·B — the multiplayer event commands & conditional operands,
// exercised against the REAL interpreter registry + Interp.testCond (bundled
// with esbuild, the harness dialogue-workspace.test.js uses). Proves:
//   - Control Switch scope:"player" writes the origin player's own namespace;
//     world scope is unchanged.
//   - testCond reads per-player switches, "Playing Online", and "Player Count".
//   - Wait for All Players is INSTANT in solo (mpOnline false) and a bounded
//     barrier online.
//   - Show Text to:"all" threads the broadcast flag into the message directive.
// Every path is solo-inert: without the new fields, behavior is byte-identical.

const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");

(async () => {
  const { build } = require("esbuild");
  const root = path.resolve(__dirname, "..");
  const entry = `
    export { G } from ${JSON.stringify(path.join(root, "src/engine/state/game-state.ts").replace(/\\/g, "/"))};
    export { Interp, initInterpServices } from ${JSON.stringify(path.join(root, "src/engine/interpreter/interp.ts").replace(/\\/g, "/"))};
    export { registerBuiltinCommands } from ${JSON.stringify(path.join(root, "src/engine/interpreter/commands/index.ts").replace(/\\/g, "/"))};
    export { registerCommand, getCommand } from ${JSON.stringify(path.join(root, "src/engine/interpreter/registry.ts").replace(/\\/g, "/"))};
  `;
  const output = (await build({
    stdin: { contents: entry, resolveDir: root, loader: "ts" },
    bundle: true, format: "cjs", write: false, platform: "node", logLevel: "silent",
  })).outputFiles[0].text;
  const mod = { exports: {} };
  vm.runInNewContext(output, {
    module: mod, exports: mod.exports, require, setTimeout, clearTimeout, console,
    window: { RPGAtlasDeps: { Assets: { TILE: 48 }, RA: { byId: (l, id) => (l || []).find((e) => e.id === id) || null } } },
    location: { search: "" }, URLSearchParams,
  });
  const engine = mod.exports;
  engine.registerBuiltinCommands();

  // Module-level services testCond reads (mpOnline / mpPlayerCount). Mutable so
  // each test flips them.
  const mp = { online: false, count: 1 };
  engine.initInterpServices({
    mpOnline: () => mp.online,
    mpPlayerCount: () => mp.count,
    presentation: { localEcho: true, message: async () => {} },
  });

  const G = engine.G;
  G.switches = {}; G.pSwitches = {};

  // Bare handler context helper.
  const svc = { refreshAllPages() {}, evaluateQuestFailures() {} };
  const runSwitch = (cmd, pid) => engine.getCommand("switch")(cmd, { interp: { origin: { playerId: pid } }, state: G, services: svc });

  // ---- Control Switch: world scope (default) vs per-player scope ----
  runSwitch({ t: "switch", id: 5, val: true }); // world (no scope)
  assert.equal(G.switches[5], true, "world switch writes G.switches");
  assert.deepEqual(G.pSwitches, {}, "world switch never touches per-player store");

  runSwitch({ t: "switch", id: 7, val: true, scope: "player" }, 0); // player 0
  runSwitch({ t: "switch", id: 7, val: true, scope: "player" }, 2); // player 2
  runSwitch({ t: "switch", id: 7, val: false, scope: "player" }, 0); // player 0 back off
  assert.equal(G.pSwitches[0][7], false, "player 0's copy is off");
  assert.equal(G.pSwitches[2][7], true, "player 2's copy is independent + on");
  assert.equal(G.switches[7], undefined, "a per-player switch never leaks into the shared store");

  // ---- testCond: per-player switch read via the origin player ----
  const interp0 = new engine.Interp(null); // origin defaults { playerId: 0 }
  assert.equal(interp0.testCond({ kind: "switch", id: 7, scope: "player", val: true }), false, "player 0's #7 is OFF");
  assert.equal(interp0.testCond({ kind: "switch", id: 7, scope: "player", val: false }), true, "…and reads OFF correctly");
  const interp2 = new engine.Interp(null, undefined, undefined, { playerId: 2 });
  assert.equal(interp2.testCond({ kind: "switch", id: 7, scope: "player", val: true }), true, "player 2's #7 is ON");
  // world-scope switch condition unchanged
  assert.equal(interp0.testCond({ kind: "switch", id: 5 }), true, "world switch condition reads G.switches");

  // ---- testCond: Playing Online ----
  mp.online = false;
  assert.equal(interp0.testCond({ kind: "online", val: true }), false, "solo: not online");
  assert.equal(interp0.testCond({ kind: "online", val: false }), true, "solo: 'is offline' is true");
  mp.online = true;
  assert.equal(interp0.testCond({ kind: "online", val: true }), true, "in a room: online");

  // ---- testCond: Player Count ----
  mp.count = 1;
  assert.equal(interp0.testCond({ kind: "playerCount", cmp: ">=", val: 2 }), false, "solo count 1 < 2");
  mp.count = 3;
  assert.equal(interp0.testCond({ kind: "playerCount", cmp: ">=", val: 2 }), true, "count 3 >= 2");
  assert.equal(interp0.testCond({ kind: "playerCount", cmp: "==", val: 3 }), true, "count == 3");

  // ---- testCond: variable-vs-variable + item-count operands (conditional-
  // branch expansion that shipped with Show Choices conditions). Both are
  // additive: without the new fields the old comparisons are byte-identical.
  G.vars = { 1: 5, 2: 5, 3: 9 };
  assert.equal(interp0.testCond({ kind: "var", id: 1, cmp: "==", val: 999, valVarId: 2 }), true,
    "var-vs-var compares the two variables (constant val is ignored)");
  assert.equal(interp0.testCond({ kind: "var", id: 1, cmp: ">=", valVarId: 3 }), false, "5 >= 9 is false");
  assert.equal(interp0.testCond({ kind: "var", id: 1, cmp: "==", val: 5, valVarId: 0 }), true,
    "valVarId 0 keeps the classic constant comparison");
  assert.equal(interp0.testCond({ kind: "var", id: 4, cmp: "==", valVarId: 5 }), true,
    "unset variables read 0 on both sides");
  G.inv = { item: { 7: 3 }, weapon: {}, armor: {} };
  assert.equal(interp0.testCond({ kind: "item", id: 7 }), true, "classic has-item check unchanged");
  assert.equal(interp0.testCond({ kind: "item", id: 9 }), false, "classic has-item check: none owned");
  assert.equal(interp0.testCond({ kind: "item", id: 7, count: 3, cmp: ">=" }), true, "owned 3 >= 3");
  assert.equal(interp0.testCond({ kind: "item", id: 7, count: 4, cmp: ">=" }), false, "owned 3 >= 4 is false");
  assert.equal(interp0.testCond({ kind: "item", id: 7, count: 3 }), true, "count compare defaults to >=");
  assert.equal(interp0.testCond({ kind: "item", id: 9, count: 0, cmp: "==" }), true, "count == 0 expresses 'has none'");
  assert.equal(interp0.testCond({ kind: "item", id: 7, val: 99 }), true,
    "a stale val (editor kind-flip leftovers) never becomes a count compare");

  // ---- Wait for All Players: instant in solo, bounded barrier online ----
  let frameWaits = 0;
  const waitSvc = {
    mpOnline: () => mp.online,
    mpAllOnMap: () => waitSvc._present,
    _present: false,
    waitFrames: async () => { frameWaits++; },
  };
  const runWait = (cmd) => engine.getCommand("waitPlayers")(cmd, { interp: { origin: { playerId: 0 } }, state: { mapId: 5 }, services: waitSvc });

  mp.online = false;
  await runWait({ t: "waitPlayers", timeout: 10 });
  assert.equal(frameWaits, 0, "solo: Wait for All Players returns immediately (no frame waits)");

  // Online + peers arrive on the 2nd poll → resolves quickly, well under the cap.
  mp.online = true;
  waitSvc._present = false;
  frameWaits = 0;
  let polls = 0;
  waitSvc.mpAllOnMap = () => { polls++; if (polls >= 2) waitSvc._present = true; return waitSvc._present; };
  await runWait({ t: "waitPlayers", timeout: 10 });
  assert.ok(frameWaits >= 1 && frameWaits < 100, "online: waited a few frames then released when everyone gathered");

  // Online + nobody ever arrives → the timeout releases it (can't hang forever).
  mp.online = true;
  frameWaits = 0;
  waitSvc.mpAllOnMap = () => false;
  await runWait({ t: "waitPlayers", timeout: 1 }); // 1s = 60 ticks / 6 per poll = ~10 waits
  assert.ok(frameWaits > 0 && frameWaits <= 11, "online timeout: bounded number of waits then gives up");

  // ---- Show Text to:"all" threads the broadcast flag ----
  const seen = [];
  const textSvc = { presentation: { message: async (_o, d) => seen.push(d) } };
  await engine.getCommand("text")({ t: "text", text: "hi all", to: "all" }, { interp: { origin: { playerId: 0 } }, state: G, services: textSvc });
  assert.equal(seen[0].to, "all", "to:'all' sets the broadcast flag on the message directive");
  seen.length = 0;
  await engine.getCommand("text")({ t: "text", text: "just me" }, { interp: { origin: { playerId: 0 } }, state: G, services: textSvc });
  assert.equal(seen[0].to, undefined, "a normal message carries no broadcast flag (byte-identical)");

  console.log("mp-commands tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
