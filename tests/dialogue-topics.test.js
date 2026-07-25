"use strict";

/* RPGAtlas — tests/dialogue-topics.test.js
   The Dialogue System's conditional choices and the Topic Hub (the
   "ask them about…" model), plus the AND/OR condition groups that back both.
   Runs the REAL Interp against a synthetic presentation port, so what is
   asserted here is what a player would actually be offered.
   GPL-3.0-or-later. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { build } = require("esbuild");

const dataContext = vm.createContext({ console, Assets: { T: {} } });
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), dataContext, { filename: "js/plugins.js" });
vm.runInContext(fs.readFileSync("js/data.js", "utf8"), dataContext, { filename: "js/data.js" });
const evaluate = (source) => vm.runInContext(source, dataContext);
const plain = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------- migration
// Topics and per-option conditions survive a load; a dialogue that has
// neither keeps its exact previous shape (no empty `topics` key appears).
dataContext.__project = {
  meta: { engine: "rpgatlas", formatVersion: evaluate("RA.FORMAT_VERSION") },
  assets: {}, maps: [],
  dialogues: [
    {
      id: 1, name: "Smith", startNodeId: 1,
      topics: [
        { id: "2", text: "About the forge", nextId: "5", priority: "3", once: true,
          condition: { kind: "switch", id: 4, val: true } },
        { text: "Rumours" },
        "junk",
      ],
      nodes: [
        { id: 1, kind: "hub", text: "Ask me anything.", exitText: "Bye", includeIds: ["2", 0], maxTopics: "5" },
        { id: 5, kind: "choice", options: [
          { text: "Sure", nextId: 0, condition: { kind: "all", conds: [{ kind: "switch", id: 1 }] } },
          { text: "Never mind", nextId: 0 },
        ] },
      ],
    },
    { id: 2, name: "Plain", startNodeId: 1, nodes: [{ id: 1, kind: "line", text: "Hi" }] },
  ],
};
const migrated = evaluate("RA.migrateProject(__project)");
const smith = migrated.dialogues[0];
assert.deepEqual(plain(smith.topics), [
  { id: 2, text: "About the forge", key: "", nextId: 5, priority: 3, once: true,
    condition: { kind: "switch", id: 4, val: true } },
  { id: 1, text: "Rumours", key: "", nextId: 0 },
], "topics normalize; non-objects are dropped, empty extras stay off the shape, and ids stay unique");
assert.equal(smith.nodes[0].kind, "hub", "the hub node kind survives migration");
assert.deepEqual(plain(smith.nodes[0].includeIds), [2], "include ids coerce to numbers and drop zeros");
assert.equal(smith.nodes[0].maxTopics, 5);
assert.equal(smith.nodes[0].exitText, "Bye");
assert.deepEqual(plain(smith.nodes[1].options[0].condition), { kind: "all", conds: [{ kind: "switch", id: 1 }] },
  "per-option conditions round-trip");
assert.deepEqual(Object.keys(smith.nodes[1].options[1]), ["text", "key", "nextId"],
  "an option with no condition keeps its exact pre-upgrade shape");
assert.ok(!("topics" in migrated.dialogues[1]),
  "a dialogue with no topics gains no empty topics key");

// A hub with no exitText authored still gets the default "Leave" back.
dataContext.__hub = {
  meta: { engine: "rpgatlas", formatVersion: evaluate("RA.FORMAT_VERSION") },
  assets: {}, maps: [],
  dialogues: [{ id: 1, name: "H", startNodeId: 1, nodes: [{ id: 1, kind: "hub" }] }],
};
assert.equal(evaluate("RA.migrateProject(__hub)").dialogues[0].nodes[0].exitText, "Leave");

// ------------------------------------------------------------------ runtime
(async () => {
  const root = path.resolve(__dirname, "..");
  const entry = `
    export { ctx } from ${JSON.stringify(path.join(root, "src/engine/state/engine-context.ts").replace(/\\/g, "/"))};
    export { G } from ${JSON.stringify(path.join(root, "src/engine/state/game-state.ts").replace(/\\/g, "/"))};
    export { Interp, initInterpServices } from ${JSON.stringify(path.join(root, "src/engine/interpreter/interp.ts").replace(/\\/g, "/"))};
    export { registerBuiltinCommands } from ${JSON.stringify(path.join(root, "src/engine/interpreter/commands/index.ts").replace(/\\/g, "/"))};
    export { registerCommand } from ${JSON.stringify(path.join(root, "src/engine/interpreter/registry.ts").replace(/\\/g, "/"))};
  `;
  const output = (await build({
    stdin: { contents: entry, resolveDir: root, loader: "ts" },
    bundle: true, format: "cjs", write: false, platform: "node", logLevel: "silent",
  })).outputFiles[0].text;
  const mod = { exports: {} };
  const warnings = [];
  vm.runInNewContext(output, {
    module: mod, exports: mod.exports, require, setTimeout, clearTimeout,
    console: { ...console, warn: (...args) => warnings.push(args.join(" ")) },
    window: { RPGAtlasDeps: { Assets: { TILE: 48 }, RA: { byId: (list, id) => (list || []).find((e) => e.id === id) || null } } },
    location: { search: "" }, URLSearchParams,
  });
  const engine = mod.exports;
  engine.registerBuiltinCommands();

  /** Drives a conversation: `replies` are the indexes the player picks, in
   *  order. Returns every list they were shown and every line they heard. */
  const shown = [];
  const heard = [];
  let replies = [];
  engine.initInterpServices({
    presentation: {
      localEcho: true,
      message: async (_o, d) => heard.push(d.text),
      choices: async (_o, d) => {
        // Array.from re-homes the list into THIS realm: the hub builds its
        // options inside the bundled engine, and assert.deepEqual compares
        // prototypes, so a vm-realm array never matches a literal here.
        shown.push(Array.from(d.options));
        // Out of scripted picks ⇒ take the last entry, which is the hub's
        // exit option, so a test that stops replying ends the conversation
        // instead of asking forever.
        return replies.length ? replies.shift() : d.options.length - 1;
      },
    },
    Sfx: { play: () => {} },
  });
  const run = async (id, picks) => {
    shown.length = 0; heard.length = 0; replies = picks.slice();
    await new engine.Interp(null).callDialogue(id);
  };

  // ---- condition groups (AND / OR / nested / empty) ----
  const interp = new engine.Interp(null);
  engine.G.switches[1] = true;
  engine.G.switches[2] = false;
  const sw = (id) => ({ kind: "switch", id, val: true });
  assert.equal(interp.testCond({ kind: "all", conds: [sw(1), sw(2)] }), false, "AND fails when one member fails");
  assert.equal(interp.testCond({ kind: "any", conds: [sw(1), sw(2)] }), true, "OR passes when one member passes");
  assert.equal(interp.testCond({ kind: "all", conds: [sw(1)] }), true);
  assert.equal(interp.testCond({ kind: "any", conds: [sw(2)] }), false);
  assert.equal(interp.testCond({ kind: "all", conds: [] }), true, "an empty group reads as always, never as 'hide it'");
  assert.equal(interp.testCond({ kind: "any", conds: [] }), true);
  assert.equal(interp.testCond({ kind: "all", conds: [sw(1), { kind: "any", conds: [sw(2), sw(1)] }] }), true,
    "groups nest: A AND (B OR C)");
  // A hand-edited/imported file can't recurse away: past the cap it reads true.
  let deep = sw(2);
  for (let i = 0; i < 40; i++) deep = { kind: "all", conds: [deep] };
  assert.equal(interp.testCond(deep), true, "over-deep nesting degrades to 'always' instead of blowing the stack");

  // ---- per-option conditions on a dialogue choice node ----
  engine.ctx.proj = {
    dialogues: [{
      id: 1, name: "Door", startNodeId: 1,
      speakers: [],
      nodes: [
        { id: 1, kind: "choice", text: "The door is locked.", nextId: 9, options: [
          { text: "Use Rusty Key", nextId: 2, condition: { kind: "switch", id: 5, val: true } },
          { text: "Knock", nextId: 3, condition: { kind: "all", conds: [{ kind: "switch", id: 6, val: true }, { kind: "switch", id: 7, val: true }] } },
          { text: "Leave", nextId: 4 },
        ] },
        { id: 2, kind: "line", text: "unlocked", nextId: 0 },
        { id: 3, kind: "line", text: "knocked", nextId: 0 },
        { id: 4, kind: "line", text: "left", nextId: 0 },
        { id: 9, kind: "line", text: "fallback", nextId: 0 },
      ],
    }],
  };
  engine.G.switches = {};
  await run(1, [0]);
  assert.deepEqual(shown, [["Leave"]], "options whose conditions fail are not offered");
  assert.deepEqual(heard, ["The door is locked.", "left"], "picking the only visible option runs ITS branch");

  // The key makes a second option appear — and picking it must still reach
  // the branch its own line authored, not the one at that list position.
  engine.G.switches = { 5: true };
  await run(1, [0]);
  assert.deepEqual(shown, [["Use Rusty Key", "Leave"]]);
  assert.deepEqual(heard, ["The door is locked.", "unlocked"], "a hidden option never shifts another onto its branch");
  engine.G.switches = { 5: true };
  await run(1, [1]);
  assert.deepEqual(heard, ["The door is locked.", "left"], "the option after a shown one still runs its own branch");

  // AND group: both switches needed.
  engine.G.switches = { 6: true };
  await run(1, [0]);
  assert.deepEqual(shown, [["Leave"]], "an AND option stays hidden while one member is false");
  engine.G.switches = { 6: true, 7: true };
  await run(1, [0]);
  assert.deepEqual(shown, [["Knock", "Leave"]], "an AND option appears once every member passes");

  // Every option hidden ⇒ the node falls through on its fallback target.
  engine.ctx.proj.dialogues[0].nodes[0].options[2].condition = { kind: "switch", id: 8, val: true };
  engine.G.switches = {};
  await run(1, []);
  assert.deepEqual(shown, [], "no list is shown when every option is hidden");
  assert.deepEqual(heard, ["The door is locked.", "fallback"], "the node falls through to its fallback node");
  delete engine.ctx.proj.dialogues[0].nodes[0].options[2].condition;

  // ---- the Topic Hub ----
  engine.ctx.proj = {
    dialogues: [
      {
        id: 1, name: "Smith", startNodeId: 1,
        speakers: [],
        topics: [
          { id: 1, text: "The forge", nextId: 10 },
          { id: 2, text: "The guild", nextId: 11, priority: 5, condition: { kind: "switch", id: 20, val: true } },
          { id: 3, text: "A secret", nextId: 12, once: true },
        ],
        nodes: [
          { id: 1, kind: "hub", text: "Ask away.", exitText: "Goodbye", nextId: 13, includeIds: [2] },
          { id: 10, kind: "line", text: "forge answer", nextId: 0 },
          { id: 11, kind: "line", text: "guild answer", nextId: 0 },
          { id: 12, kind: "line", text: "secret answer", nextId: 0 },
          { id: 13, kind: "line", text: "farewell", nextId: 0 },
        ],
      },
      {
        id: 2, name: "Shared guild topics", startNodeId: 1,
        speakers: [],
        topics: [{ id: 1, text: "Guild dues", nextId: 1, priority: 9 }],
        nodes: [{ id: 1, kind: "line", text: "dues answer", nextId: 0 }],
      },
    ],
  };
  engine.G.switches = {};
  engine.G.topicsUsed = {};

  // Conditions filter the pool; priority orders what is left (highest first,
  // ties in authored order); borrowed topics join the same list.
  await run(1, [3]); // 3 = the "Goodbye" option
  assert.deepEqual(shown, [["Guild dues", "The forge", "A secret", "Goodbye"]],
    "an unmet topic is not offered; borrowed topics join the list and priority sorts it");
  assert.deepEqual(heard, ["Ask away.", "farewell"], "leaving the hub continues at the hub's own next node");

  engine.G.switches = { 20: true };
  await run(1, [4]);
  assert.deepEqual(shown, [["Guild dues", "The guild", "The forge", "A secret", "Goodbye"]],
    "the topic appears as soon as its condition is met");

  // Picking a topic runs its answer and RETURNS to the list — that is what
  // makes the model work: you keep asking until you choose to leave.
  engine.G.switches = {};
  await run(1, [1, 3]); // "The forge", then "Goodbye"
  assert.deepEqual(heard, ["Ask away.", "forge answer", "Ask away.", "farewell"]);
  assert.deepEqual(shown, [
    ["Guild dues", "The forge", "A secret", "Goodbye"],
    ["Guild dues", "The forge", "A secret", "Goodbye"],
  ], "the hub re-offers its list after each answer");

  // "Ask once" retires a topic for the rest of the save.
  engine.G.topicsUsed = {};
  await run(1, [2, 2]); // "A secret", then "Goodbye" (list is now 3 long)
  assert.deepEqual(heard, ["Ask away.", "secret answer", "Ask away.", "farewell"]);
  assert.deepEqual(shown[1], ["Guild dues", "The forge", "Goodbye"], "a once-only topic is gone from the next round");
  assert.deepEqual(engine.G.topicsUsed, { "1:3": true }, "the spent topic is recorded under its OWNING dialogue");
  await run(1, [2]);
  assert.deepEqual(shown[0], ["Guild dues", "The forge", "Goodbye"], "and stays gone on a later conversation");

  // A borrowed topic's answer runs inside the asset that owns it.
  engine.G.topicsUsed = {};
  await run(1, [0, 3]);
  assert.deepEqual(heard, ["Ask away.", "dues answer", "Ask away.", "farewell"],
    "a topic borrowed from another dialogue runs that dialogue's node, then returns");

  // With nothing left to offer, the hub leaves on its own rather than
  // showing an empty list.
  engine.ctx.proj.dialogues[0].topics = [{ id: 3, text: "A secret", nextId: 12, once: true }];
  engine.ctx.proj.dialogues[0].nodes[0].includeIds = [];
  engine.G.topicsUsed = { "1:3": true };
  await run(1, []);
  assert.deepEqual(shown, [], "an exhausted pool shows no list");
  assert.deepEqual(heard, ["farewell"], "and the conversation continues past the hub");

  // maxTopics caps the list to the highest-priority entries.
  engine.ctx.proj.dialogues[0].topics = [
    { id: 1, text: "low", nextId: 10 },
    { id: 2, text: "high", nextId: 11, priority: 5 },
    { id: 3, text: "mid", nextId: 12, priority: 2 },
  ];
  engine.ctx.proj.dialogues[0].nodes[0].maxTopics = 2;
  engine.G.topicsUsed = {};
  await run(1, [2]);
  assert.deepEqual(shown[0], ["high", "mid", "Goodbye"], "maxTopics keeps the highest priorities");

  // A hub with no exit option and topics that never retire still can't hang
  // the game — the round guard ends it.
  engine.ctx.proj.dialogues[0].nodes[0].exitText = "";
  engine.ctx.proj.dialogues[0].nodes[0].maxTopics = 0;
  await run(1, []);
  assert.ok(warnings.some((w) => w.includes("Stopped dialogue hub")), "a runaway hub is stopped and warned about");
  assert.deepEqual(heard[heard.length - 1], "farewell", "and it still continues past the hub");

  console.log("dialogue topics + conditional choices ok");
})();
