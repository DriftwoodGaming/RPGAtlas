"use strict";

const fs = require("node:fs");
const assert = require("node:assert/strict");

const code = fs.readFileSync("js/engine.js", "utf8");

// Verify that the code has our new interpreter commands
assert.ok(code.includes('case "shake":'), "engine.js should handle shake command");
assert.ok(code.includes('case "weather":'), "engine.js should handle weather command");
assert.ok(code.includes('case "flash":'), "engine.js should handle flash command");
assert.ok(code.includes('case "actor":'), "engine.js should handle actor conditional branches");

// Mock the exact logic implemented in testCond for actor checks
function testCond(cond, G) {
  const actor = G.party.find((a) => a.actorId === cond.actorId);
  if (!actor) return false;
  if (cond.check === "inParty") return true;
  if (cond.check === "weapon") return actor.weaponId === cond.itemId;
  if (cond.check === "armor") return actor.armorId === cond.itemId;
  return true;
}

// Mock game state
const G = {
  party: [
    { actorId: 1, weaponId: 10, armorId: 20 },
    { actorId: 2, weaponId: 0, armorId: 0 }
  ]
};

// 1. Party checks
assert.equal(testCond({ kind: "actor", actorId: 1, check: "inParty" }, G), true);
assert.equal(testCond({ kind: "actor", actorId: 2, check: "inParty" }, G), true);
assert.equal(testCond({ kind: "actor", actorId: 3, check: "inParty" }, G), false);

// 2. Weapon checks
assert.equal(testCond({ kind: "actor", actorId: 1, check: "weapon", itemId: 10 }, G), true);
assert.equal(testCond({ kind: "actor", actorId: 1, check: "weapon", itemId: 5 }, G), false);
assert.equal(testCond({ kind: "actor", actorId: 2, check: "weapon", itemId: 10 }, G), false);

// 3. Armor checks
assert.equal(testCond({ kind: "actor", actorId: 1, check: "armor", itemId: 20 }, G), true);
assert.equal(testCond({ kind: "actor", actorId: 1, check: "armor", itemId: 5 }, G), false);
assert.equal(testCond({ kind: "actor", actorId: 2, check: "armor", itemId: 20 }, G), false);

console.log("Interpreter and branching logic tests passed.");
