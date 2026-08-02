"use strict";

// The game-over hand-off. A battle lost inside an event used to call
// services.gameOver() from the `battle` handler and then RETURN — which handed
// control straight back to Interp.runList, so every command after the battle
// (typically the author's "you have fallen…" Show Text) executed on top of the
// title screen the game-over had already gone to.
//
// Now the loss latches ctx.pendingGameOver onto the run that caused it: the
// event finishes speaking on the map, the game over follows, and the run
// epoch (bumped when the title screen takes over) stops anything still
// unwinding. This test drives the real Interp + the real registered `battle`
// handler with a stub service surface, exactly like tests/interpreter.test.js.

const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const abs = (p) => JSON.stringify(path.join(root, p).replace(/\\/g, "/"));

async function loadEngineBits() {
  const { build } = require("esbuild");
  const entry = `
    export { Interp, initInterpServices } from ${abs("src/engine/interpreter/interp.ts")};
    export { registerBuiltinCommands } from ${abs("src/engine/interpreter/commands/index.ts")};
    export { ctx } from ${abs("src/engine/state/engine-context.ts")};
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
    window: { RPGAtlasDeps: { Assets: { TILE: 48 } } },
  });
  return module.exports;
}

(async () => {
  const { Interp, initInterpServices, registerBuiltinCommands, ctx } = await loadEngineBits();
  registerBuiltinCommands();

  /** A minimal service surface: a battle that always ends `result`, a
   *  game-over that records when it ran, and a text command that records the
   *  scene it was spoken in. `toTitle` models the real one: it bumps the run
   *  epoch, which is what stops a stale run. */
  function makeServices(result, opts) {
    opts = opts || {};
    const log = [];
    const services = {
      Battle: { run: async () => { log.push("battle"); return result; }, lastShared: !!opts.lastShared },
      autosaveNow: () => log.push("autosave"),
      requestGameOver(owner) {
        if (ctx.pendingGameOver) return;
        if (owner) { ctx.pendingGameOver = owner; return; }
        void services.gameOver();
      },
      async gameOver() {
        log.push("gameover");
        ctx.pendingGameOver = null;
        // The real flow ends at the title screen, which bumps the epoch.
        if (!opts.stayOnMap) ctx.runEpoch = (ctx.runEpoch || 0) + 1;
      },
      presentation: {
        localEcho: true,
        message: async (_o, d) => { log.push("text:" + d.text); },
      },
    };
    return { services, log };
  }

  const run = async (commands, services) => {
    initInterpServices(services);
    ctx.pendingGameOver = null;
    await new Interp(null).runList(commands);
  };

  // ---- 1. The reported bug: text after a lost battle, in the right order ----
  {
    const { services, log } = makeServices("lose");
    await run([
      { t: "battle", troopId: 1 },
      { t: "text", text: "You have fallen…" },
    ], services);
    assert.deepEqual(
      log,
      ["battle", "text:You have fallen…", "gameover"],
      "a lost battle lets the event finish speaking, THEN takes the game over",
    );
  }

  // ---- 2. Nothing runs once the title screen has taken over ----
  {
    const { services, log } = makeServices("lose");
    // The game-over here does NOT hand control back mid-list, but a stale run
    // must still be stopped: bump the epoch from inside a command and assert
    // the rest of the list is skipped.
    initInterpServices(services);
    ctx.pendingGameOver = null;
    const interp = new Interp(null);
    await interp.runList([{ t: "text", text: "one" }]);
    // A run whose epoch is stale executes nothing at all.
    ctx.runEpoch = (ctx.runEpoch || 0) + 1;
    const stale = log.length;
    await interp.runList([{ t: "text", text: "leaked onto the title" }]);
    assert.equal(log.length, stale, "a stale run executes no further commands");
    assert.ok(interp.stale, "the run reports itself stale once the epoch moves");
  }

  // ---- 3. "Can Lose" still means the author handles the defeat ----
  {
    const { services, log } = makeServices("lose");
    await run([
      { t: "battle", troopId: 1, lose: true, onLose: [{ t: "text", text: "captured!" }] },
      { t: "text", text: "after" },
    ], services);
    assert.deepEqual(
      log,
      ["battle", "autosave", "text:captured!", "text:after"],
      "a Can-Lose battle runs its lose branch and never games over",
    );
    assert.equal(ctx.pendingGameOver, null, "no game over is left pending");
  }

  // ---- 4. A shared (co-op) defeat never ends a friend's world ----
  {
    const { services, log } = makeServices("lose", { lastShared: true });
    await run([{ t: "battle", troopId: 1 }, { t: "text", text: "still playing" }], services);
    assert.deepEqual(
      log,
      ["battle", "autosave", "text:still playing"],
      "a shared battle's defeat is suppressed (MP6·A A-7) and the event continues",
    );
  }

  // ---- 5. A won battle is untouched ----
  {
    const { services, log } = makeServices("win");
    await run([
      { t: "battle", troopId: 1, onWin: [{ t: "text", text: "victory" }] },
      { t: "text", text: "after" },
    ], services);
    assert.deepEqual(
      log,
      ["battle", "autosave", "text:victory", "text:after"],
      "a won battle autosaves, runs its win branch, and continues",
    );
    assert.equal(ctx.pendingGameOver, null, "a win leaves nothing pending");
  }

  // ---- 6. The latch belongs to ONE run: a nested list doesn't consume it ----
  {
    const { services, log } = makeServices("lose");
    await run([
      { t: "loop", body: [{ t: "battle", troopId: 1 }, { t: "breakLoop" }] },
      { t: "text", text: "last word" },
    ], services);
    assert.deepEqual(
      log,
      ["battle", "text:last word", "gameover"],
      "the game over waits for the OUTERMOST list, not the loop body that lost",
    );
  }

  console.log("Game-over hand-off tests passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
