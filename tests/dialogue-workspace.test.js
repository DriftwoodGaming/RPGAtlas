"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { build } = require("esbuild");

const context = vm.createContext({ console, Assets: { T: {} } });
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });
vm.runInContext(fs.readFileSync("js/data.js", "utf8"), context, { filename: "js/data.js" });
const evaluate = (source) => vm.runInContext(source, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(evaluate("RA.defaultDialogue()")), {
  id: 0,
  name: "New Dialogue",
  description: "",
  startNodeId: 1,
  speakers: [],
  nodes: [{
    id: 1, kind: "line", speakerId: 0, portrait: "", voice: "",
    text: "New dialogue line.", key: "", nextId: 0,
  }],
});
assert.deepEqual(plain(evaluate("DataDefaults.newProject().dialogues")), [],
  "new projects expose an empty reusable-dialogue collection");

context.__project = {
  meta: { engine: "rpgatlas", formatVersion: evaluate("RA.FORMAT_VERSION") },
  assets: {}, maps: [],
  dialogues: [{
    id: "7", name: "", startNodeId: 99,
    speakers: [{ id: "2", name: "Guide", portrait: "asset:characters/guide" }],
    nodes: [{ id: "4", kind: "choice", options: null, nextId: "0" }],
  }],
};
const migrated = evaluate("RA.migrateProject(__project)");
assert.equal(migrated.dialogues[0].id, 7);
assert.equal(migrated.dialogues[0].name, "Dialogue");
assert.equal(migrated.dialogues[0].startNodeId, 4, "a dangling start node falls back to the first node");
assert.deepEqual(plain(migrated.dialogues[0].nodes[0].options), [], "malformed choices normalize safely");

const workspaceSource = fs.readFileSync("src/editor/tools/dialogue-workspace.ts", "utf8");
const commandSource = fs.readFileSync("src/editor/event-editor/command-defs.ts", "utf8");
const workspaceChrome = fs.readFileSync("src/editor/workspace.ts", "utf8");
assert.match(workspaceChrome, /Dialogue & Cutscenes/, "Tools exposes the dedicated workspace");
assert.match(workspaceSource, /Conversation tree/);
assert.match(workspaceSource, /Generate keys/);
assert.match(workspaceSource, /Voice cue/);
assert.match(commandSource, /t: "dialogue", label: "Play Dialogue"/,
  "the event picker and Atlas Graph expose reusable dialogue assets");

(async () => {
  const root = path.resolve(__dirname, "..");
  const entry = `
    export { ctx } from ${JSON.stringify(path.join(root, "src/engine/state/engine-context.ts").replace(/\\/g, "/"))};
    export { G } from ${JSON.stringify(path.join(root, "src/engine/state/game-state.ts").replace(/\\/g, "/"))};
    export { Interp, initInterpServices } from ${JSON.stringify(path.join(root, "src/engine/interpreter/interp.ts").replace(/\\/g, "/"))};
    export { registerBuiltinCommands } from ${JSON.stringify(path.join(root, "src/engine/interpreter/commands/index.ts").replace(/\\/g, "/"))};
    export { registerCommand, getCommand } from ${JSON.stringify(path.join(root, "src/engine/interpreter/registry.ts").replace(/\\/g, "/"))};
    export { usedAssetKeys, rewriteAssetKey } from ${JSON.stringify(path.join(root, "src/shared/asset-library.ts").replace(/\\/g, "/"))};
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
    window: { RPGAtlasDeps: { Assets: { TILE: 48 }, RA: { byId: (list, id) => (list || []).find((entry2) => entry2.id === id) || null } } },
    location: { search: "" }, URLSearchParams,
  });
  const engine = mod.exports;
  engine.registerBuiltinCommands();
  const messages = [];
  const sounds = [];
  const probes = [];
  engine.registerCommand("probe", () => probes.push("ran"));
  engine.initInterpServices({
    showMessage: async (name, text, face) => messages.push({ name, text, face }),
    showList: async () => 1,
    richText: (text) => text,
    Sfx: { play: (name) => sounds.push(name) },
  });
  engine.ctx.proj = {
    dialogues: [{
      id: 7, name: "Gate Talk", startNodeId: 1,
      speakers: [{ id: 1, name: "Guide", portrait: "asset:characters/guide" }],
      nodes: [
        { id: 1, kind: "line", speakerId: 1, voice: "asset:audio/hello", text: "Welcome.", nextId: 2 },
        { id: 2, kind: "choice", speakerId: 1, text: "Where next?", options: [
          { text: "Town", nextId: 3 }, { text: "Wilds", nextId: 4 },
        ], nextId: 0 },
        { id: 3, kind: "line", text: "Town", nextId: 0 },
        { id: 4, kind: "line", text: "Locked", condition: { kind: "switch", id: 9, val: true }, nextId: 5 },
        { id: 5, kind: "cutscene", commands: [{ t: "probe" }], nextId: 0 },
      ],
    }],
  };
  engine.G.switches[9] = false;
  assert.equal(typeof engine.getCommand("dialogue"), "function");
  assert.equal(await new engine.Interp(null).callDialogue(7), true);
  assert.deepEqual(messages, [
    { name: "Guide", text: "Welcome.", face: "asset:characters/guide" },
    { name: "Guide", text: "Where next?", face: "asset:characters/guide" },
  ], "lines and choice prompts reuse the normal message service; false conditions skip nodes");
  assert.deepEqual(sounds, ["asset:audio/hello"], "line voice cues reuse the normal SE channel");
  assert.deepEqual(probes, ["ran"], "cutscene nodes run ordinary event commands");

  const assetProject = plain(engine.ctx.proj);
  assetProject.dialogues[0].nodes[4].commands.push({ t: "se", name: "asset:audio/sting" });
  const used = engine.usedAssetKeys(assetProject, [
    { key: "asset:characters/guide", type: "characters", name: "guide" },
    { key: "asset:facesets/guide", type: "facesets", name: "guide" },
    { key: "asset:audio/hello", type: "audio", name: "hello" },
    { key: "asset:audio/sting", type: "audio", name: "sting" },
  ]);
  assert.deepEqual([...used].sort(), [
    "asset:audio/hello", "asset:audio/sting", "asset:characters/guide", "asset:facesets/guide",
  ], "dialogue portraits, paired faces, voice cues, and cutscene assets are export-visible");
  assert.equal(engine.rewriteAssetKey(assetProject, "asset:audio/hello", "asset:audio/greeting"), 1);
  assert.equal(assetProject.dialogues[0].nodes[0].voice, "asset:audio/greeting");

  console.log("Dialogue workspace tests passed.");
})().catch((error) => { console.error(error); process.exit(1); });
