"use strict";

// Phase 1 Stage B migrated this from grepping js/engine.js source
// (`code.includes('case "shake":')`) to a behavior test against the extracted
// interpreter registry (src/engine/interpreter/). Interp.exec is now a registry
// lookup; the built-in commands live in src/engine/interpreter/commands/*.ts and
// register handlers by type. We bundle just the registry + built-in
// registration with esbuild (the same tool the player bundle uses) and assert
// the handlers are registered — the real dispatch path — then exercise one end
// to end. The `actor` conditional branch still lives in engine.js's
// Interp.testCond (not a registry command), so its logic is mirrored below as
// before.

const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

// Bundle the registry + built-in command registration to a CJS module we can
// require in-process, exposing getCommand/registerCommand and a function that
// registers every built-in (matching what the engine does at boot).
async function loadRegistry() {
  const { build } = require("esbuild");
  const entry = `
    export { getCommand, registerCommand } from ${JSON.stringify(
      path.join(root, "src/engine/interpreter/registry.ts").replace(/\\/g, "/"),
    )};
    export { registerBuiltinCommands } from ${JSON.stringify(
      path.join(root, "src/engine/interpreter/commands/index.ts").replace(/\\/g, "/"),
    )};
  `;
  const out = (await build({
    stdin: { contents: entry, resolveDir: root, loader: "ts" },
    bundle: true,
    format: "cjs",
    write: false,
    platform: "node",
    logLevel: "silent",
  })).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInNewContext(out, {
    module,
    exports: module.exports,
    require,
    console,
    // The presentation commands (M2·A) pull src/shared/deps.js into the bundle,
    // which reads window.RPGAtlasDeps.Assets at eval — stub the classic-script
    // globals so the bundle evaluates outside a browser.
    window: { RPGAtlasDeps: { Assets: { TILE: 48 } } },
  });
  return module.exports;
}

(async () => {
  const { getCommand, registerBuiltinCommands } = await loadRegistry();
  registerBuiltinCommands();

  // The commands the old grep test pinned are registered handlers now — plus
  // the M2·A presentation family (pictures, tint, timer, scroll, balloons,
  // scrolling text).
  for (const type of ["shake", "weather", "flash", "text", "choices", "if",
    "switch", "var", "battle", "shop", "transfer", "commonEvent",
    "showPic", "movePic", "rotatePic", "tintPic", "erasePic", "tint",
    "timer", "scrollMap", "balloon", "scrollText"]) {
    assert.equal(
      typeof getCommand(type),
      "function",
      "interpreter registers a handler for the '" + type + "' command",
    );
  }

  // Behavior: the presentation handlers run without a DOM (map scene state is
  // set in presentation-runtime; drawing/loading are guarded for Node). These
  // must not throw when invoked with the same context shape the engine passes.
  {
    const pctx = { SCREEN_W: 816, SCREEN_H: 624, globalT: 0, evRTs: [] };
    const psvc = { ctx: pctx, frameWait: async () => {}, waitFrames: async () => {} };
    const pstate = { player: { rx: 1, ry: 1 } };
    for (const cmd of [
      { t: "showPic", id: 1, name: "", origin: 0, x: 10, y: 10, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 },
      { t: "rotatePic", id: 1, speed: 5 },
      { t: "erasePic", id: 1 },
      { t: "tint", tone: [-68, -68, -68, 0], frames: 0 },
      { t: "timer", op: "start", seconds: 5 },
      { t: "timer", op: "stop" },
    ]) {
      await getCommand(cmd.t)(cmd, { interp: { evRT: null }, state: pstate, services: psvc });
    }
    assert.ok(true, "presentation handlers run without throwing outside a browser");
  }
  // Unknown command types resolve to undefined — the interpreter's silent-skip
  // (the old switch `default` when no plugin handler existed).
  assert.equal(getCommand("no-such-command"), undefined,
    "unknown command types are a silent no-op");

  // Behavior: the `shake` handler writes the clamped shake scalars onto the
  // shared engine context (services.ctx), exactly as the old case did.
  const ctx = {
    cameraZoom: 1, shakePower: 0, shakeSpeed: 0, shakeTimer: 0, shakeDuration: 0,
    flashColor: "#ffffff", flashOpacity: 0.5, flashTimer: 0, flashDuration: 0,
  };
  const services = { ctx, clamp: (v, a, b) => (v < a ? a : v > b ? b : v) };
  await getCommand("shake")({ t: "shake", power: 99, speed: 4, duration: 40 },
    { interp: {}, state: {}, services });
  assert.equal(ctx.shakePower, 9, "shake power is clamped to 9");
  assert.equal(ctx.shakeSpeed, 4, "shake speed passes through");
  assert.equal(ctx.shakeTimer, 40, "shake duration seeds the timer");
  assert.equal(ctx.shakeDuration, 40, "shake duration is recorded");

  // Behavior: the `switch` handler sets state + refreshes pages/quests.
  let refreshed = 0, quests = 0;
  const state = { switches: {} };
  await getCommand("switch")({ t: "switch", id: 5, val: true }, {
    interp: {}, state,
    services: { refreshAllPages: () => refreshed++, evaluateQuestFailures: () => quests++ },
  });
  assert.equal(state.switches[5], true, "switch command sets the switch");
  assert.equal(refreshed, 1, "switch command refreshes event pages");
  assert.equal(quests, 1, "switch command re-evaluates quest failures");

  // ---- loop / breakLoop (Phase 4 Atlas Graph flow commands) ----
  // A minimal interp implementing the runList/breakLoop contract from
  // src/engine/interpreter/interp.ts: exec dispatches through the registry,
  // runList unwinds while breakLoop is set, the loop handler consumes it.
  {
    assert.equal(typeof getCommand("loop"), "function", "loop handler registered");
    assert.equal(typeof getCommand("breakLoop"), "function", "breakLoop handler registered");
    const loopState = { vars: {} };
    const loopServices = {
      refreshAllPages: () => {},
      evaluateQuestFailures: () => {},
      waitFrames: async () => {},
      rnd: () => 0,
    };
    const interp = {
      breakLoop: false,
      testCond(cond) { return (loopState.vars[cond.id] || 0) >= cond.val; },
      async exec(c) {
        const handler = getCommand(c.t);
        if (handler) await handler(c, { interp: this, state: loopState, services: loopServices });
      },
      async runList(list) {
        for (const cmd of list || []) {
          await this.exec(cmd);
          if (this.breakLoop) return;
        }
      },
    };
    // Loop: add 1 to var 1 each pass; break (nested in an if) once it hits 3.
    await interp.runList([{
      t: "loop", body: [
        { t: "var", id: 1, op: "add", val: 1 },
        { t: "if", cond: { kind: "var", id: 1, val: 3 }, then: [{ t: "breakLoop" }], else: [] },
      ],
    }, { t: "var", id: 2, op: "set", val: 7 }]);
    assert.equal(loopState.vars[1], 3, "loop repeats its body until Break Loop fires");
    assert.equal(interp.breakLoop, false, "the innermost loop consumes the break flag");
    assert.equal(loopState.vars[2], 7, "execution continues after the loop");
  }

  // ---- actor conditional branch (still in engine.js Interp.testCond) ----
  function testCond(cond, G) {
    const actor = G.party.find((a) => a.actorId === cond.actorId);
    if (!actor) return false;
    if (cond.check === "inParty") return true;
    if (cond.check === "weapon") return actor.weaponId === cond.itemId;
    if (cond.check === "armor") return actor.armorId === cond.itemId;
    return true;
  }
  const G = {
    party: [
      { actorId: 1, weaponId: 10, armorId: 20 },
      { actorId: 2, weaponId: 0, armorId: 0 },
    ],
  };
  assert.equal(testCond({ kind: "actor", actorId: 1, check: "inParty" }, G), true);
  assert.equal(testCond({ kind: "actor", actorId: 3, check: "inParty" }, G), false);
  assert.equal(testCond({ kind: "actor", actorId: 1, check: "weapon", itemId: 10 }, G), true);
  assert.equal(testCond({ kind: "actor", actorId: 1, check: "weapon", itemId: 5 }, G), false);
  assert.equal(testCond({ kind: "actor", actorId: 1, check: "armor", itemId: 20 }, G), true);
  assert.equal(testCond({ kind: "actor", actorId: 2, check: "armor", itemId: 20 }, G), false);

  console.log("Interpreter registry and branching logic tests passed.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
