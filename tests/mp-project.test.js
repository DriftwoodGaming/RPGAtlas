"use strict";

// Project Beacon MP7·A — the online-multiplayer project settings: the
// RA.defaultMultiplayer / RA.normalizeMultiplayer helpers and the
// every-load-boundary backfill in migrateProject. Mirrors the tests/
// types-lists.test.js vm harness (data.js is a window-global classic script).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({
  console,
  Assets: { T: {} },
});
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });
vm.runInContext(fs.readFileSync("js/data.js", "utf8"), context, { filename: "js/data.js" });

function evaluate(source) {
  return vm.runInContext(source, context);
}
// vm-realm objects carry the vm's prototypes → JSON round-trip before deepEqual.
function toHost(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---- defaults: inert, so a project that never opts in is byte-identical ----
const def = toHost(evaluate("RA.defaultMultiplayer()"));
assert.equal(def.enabled, false);
assert.equal(def.maxPlayers, 4);
assert.equal(def.relayUrl, "");
assert.equal(def.chatMode, "off");
assert.deepEqual(def.presets, []);
assert.deepEqual(def.spawns, {});

// ---- normalize clamps every field to its safe range ----
const norm = toHost(evaluate(`RA.normalizeMultiplayer({
  enabled: true,
  maxPlayers: 999,
  relayUrl: "wss://my.server/",
  chatMode: "text",
  presets: ["  Follow me!  ", "", "Nice!", 42],
  spawns: { "3": { x: 5, y: 7, dir: "up" }, "-1": { x: 0, y: 0 }, "bad": {}, "9": { x: 1000, y: -3, dir: "sideways" } }
})`));
assert.equal(norm.enabled, true);
assert.equal(norm.maxPlayers, 16, "maxPlayers clamps to 16");
assert.equal(norm.relayUrl, "wss://my.server/");
assert.equal(norm.chatMode, "text");
assert.deepEqual(norm.presets, ["Follow me!", "Nice!", "42"], "presets trimmed, blanks dropped, coerced to strings");
assert.deepEqual(norm.spawns["3"], { x: 5, y: 7, dir: "up" });
assert.equal(norm.spawns["-1"], undefined, "negative mapId dropped");
assert.equal(norm.spawns["bad"], undefined, "non-numeric key dropped");
assert.deepEqual(norm.spawns["9"], { x: 999, y: 0, dir: "down" }, "x clamps high, y floors at 0, bad dir → down");

// low bound + invalid chat mode
const low = toHost(evaluate(`RA.normalizeMultiplayer({ maxPlayers: 1, chatMode: "shout" })`));
assert.equal(low.maxPlayers, 2, "maxPlayers floors at 2");
assert.equal(low.chatMode, "off", "unknown chat mode → off");

// garbage / missing input → the full default
assert.deepEqual(toHost(evaluate("RA.normalizeMultiplayer(null)")), def);
assert.deepEqual(toHost(evaluate("RA.normalizeMultiplayer(undefined)")), def);
assert.deepEqual(toHost(evaluate('RA.normalizeMultiplayer("nope")')), def);

// ---- migrateProject backfills the block on a v2 project that lacks it ----
const v2 = toHost(evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3, formatVersion: 2 },
  system: {},
  maps: []
})`));
assert.deepEqual(v2.system.multiplayer, def, "v2 project gains the inert default");
assert.equal(v2.system.multiplayer.enabled, false, "multiplayerEnabled() stays false → byte-identical");

// ---- an authored config survives migration (only re-validated) ----
const authored = toHost(evaluate(`RA.migrateProject({
  meta: { engine: "rpgatlas", version: 3, formatVersion: 2 },
  system: { multiplayer: { enabled: true, maxPlayers: 8, chatMode: "presets", presets: ["Hi!"], spawns: { "1": { x: 2, y: 3, dir: "left" } } } },
  maps: []
})`));
assert.equal(authored.system.multiplayer.enabled, true);
assert.equal(authored.system.multiplayer.maxPlayers, 8);
assert.equal(authored.system.multiplayer.chatMode, "presets");
assert.deepEqual(authored.system.multiplayer.presets, ["Hi!"]);
assert.deepEqual(authored.system.multiplayer.spawns["1"], { x: 2, y: 3, dir: "left" });

// ---- migration is idempotent (running it twice changes nothing) ----
const twice = toHost(evaluate(`(function () {
  const p = RA.migrateProject({ meta: { engine: "rpgatlas", version: 3, formatVersion: 2 }, system: { multiplayer: { enabled: true, maxPlayers: 6 } }, maps: [] });
  return RA.migrateProject(p);
})()`));
assert.equal(twice.system.multiplayer.enabled, true);
assert.equal(twice.system.multiplayer.maxPlayers, 6);

console.log("mp-project tests passed");
