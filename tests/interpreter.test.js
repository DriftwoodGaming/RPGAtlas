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
    "timer", "scrollMap", "balloon", "scrollText",
    "inputNumber", "selectItem", "nameInput",
    // M2·C: the change-actor-data family, flow labels, and system toggles.
    "label", "jump", "changeExp", "changeLevel", "changeParam", "changeSkill",
    "changeEquip", "changeName", "changeClass", "changeActorImage",
    "changeNickname", "changeProfile", "changeState",
    // M3·B: the TP pair.
    "changeTp", "changeEnemyTp",
    "access", "followers", "windowTone", "getLocationInfo",
    // M4·B: the streamed-audio channels.
    "bgs", "me", "saveBgm", "resumeBgm", "stopSe", "jingle",
    // M5·B: the read-only RPG Maker Script-command adapter.
    "mzScript"]) {
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
      // M4·B audio handlers: no-op safely when services.AudioDeck is absent.
      { t: "bgs", key: "asset:audio/waves", vol: 0.6 },
      { t: "bgs", key: "" },
      { t: "saveBgm" },
      { t: "resumeBgm" },
      { t: "stopSe" },
      { t: "jingle", channel: "victory", key: "asset:audio/fanfare" },
    ]) {
      await getCommand(cmd.t)(cmd, { interp: { evRT: null }, state: pstate, services: psvc });
    }
    assert.ok(true, "presentation handlers run without throwing outside a browser");
  }

  // ---- Message-system input commands (M2·B) drive their scenes + store results ----
  {
    let numArgs = null, nameArgs = null, msgOpts = null;
    const mstate = { vars: {}, party: [{ actorId: 5, name: "Old" }] };
    const msvc = {
      numberInput: async (digits, initial) => { numArgs = { digits, initial }; return 123; },
      selectItem: async () => 9,
      nameInput: async (cur, max) => { nameArgs = { cur, max }; return "Zed"; },
      showMessage: async (_n, _t, _f, opts) => { msgOpts = opts; },
    };
    await getCommand("inputNumber")({ t: "inputNumber", varId: 2, digits: 3 }, { interp: {}, state: mstate, services: msvc });
    assert.equal(mstate.vars[2], 123, "inputNumber stores the entered number in its variable");
    assert.equal(numArgs.digits, 3, "inputNumber passes the digit count to the scene");
    await getCommand("selectItem")({ t: "selectItem", varId: 4, itemType: 1 }, { interp: {}, state: mstate, services: msvc });
    assert.equal(mstate.vars[4], 9, "selectItem stores the chosen item id");
    await getCommand("nameInput")({ t: "nameInput", actorId: 5, maxChars: 6 }, { interp: {}, state: mstate, services: msvc });
    assert.equal(mstate.party[0].name, "Zed", "nameInput renames the matching party actor");
    assert.equal(nameArgs.max, 6, "nameInput passes the max length to the scene");
    await getCommand("text")({ t: "text", text: "hi", background: 1, position: 0 }, { interp: {}, state: mstate, services: msvc });
    // (assert per-field — the opts object is built inside the vm realm, so a
    // deep-equal against an outer-realm literal would fail on prototype identity.)
    assert.equal(msgOpts.background, 1, "text forwards the window background option");
    assert.equal(msgOpts.position, 0, "text forwards the window position option");
  }
  // ---- Change-actor-data family + system toggles (M2·C) mutate live state ----
  {
    let toneApplied = "unset", follSynced = 0, charsetRefreshed = 0;
    const astate = {
      vars: {},
      party: [{ actorId: 1, name: "Ann", level: 3, exp: 200, hp: 20, mp: 5, classId: 1, weaponId: 0, armorId: 0 }],
    };
    const asvc = {
      param: (_a, stat) => (stat === "mhp" ? 30 : stat === "mmp" ? 10 : 5),
      expForLevel: (lv) => (lv - 1) * 100, // toy curve: level N floor = (N-1)*100
      gainExp: (a, amt) => { a.exp += amt; while (a.exp >= a.level * 100) a.level++; },
      sanitizeEquipment: () => {},
      refreshAllPages: () => {},
      refreshPlayerCharset: () => { charsetRefreshed++; },
      syncFollowers: () => { follSynced++; },
      applyWindowTone: (t) => { toneApplied = t; },
      locationInfo: (x, y, info) => (info === "region" ? 7 : 0),
      // M3·B: changeState reads the state's maxTurns off the project.
      getProj: () => ({ states: [{ id: 3, maxTurns: 4 }, { id: 4, maxTurns: 5 }] }),
    };
    const run = (cmd) => getCommand(cmd.t)(cmd, { interp: {}, state: astate, services: asvc });
    const ann = astate.party[0];

    await run({ t: "changeExp", actorId: 1, op: "add", value: 50 });
    assert.equal(ann.exp, 250, "changeExp adds experience");
    await run({ t: "changeParam", actorId: 1, param: "atk", op: "add", value: 6 });
    assert.equal(ann.paramPlus.atk, 6, "changeParam records a permanent param bonus");
    await run({ t: "changeName", actorId: 1, name: "Annette" });
    assert.equal(ann.name, "Annette", "changeName renames the actor");
    await run({ t: "changeState", actorId: 1, op: "add", stateId: 4 });
    // M3·B fix: entries are the battle's {id, turns} objects (the M2·C
    // version pushed bare numbers the battle scene couldn't read).
    assert.ok(ann.states.some((st) => st.id === 4), "changeState adds a state");
    assert.equal(ann.states.find((st) => st.id === 4).turns, 5, "changeState takes turns from the state's maxTurns");
    await run({ t: "changeState", actorId: 1, op: "remove", stateId: 4 });
    assert.ok(!ann.states.some((st) => st.id === 4), "changeState removes a state");
    await run({ t: "changeSkill", actorId: 1, op: "learn", skillId: 9 });
    assert.ok(ann.skills.includes(9), "changeSkill (learn) adds a skill");
    await run({ t: "changeSkill", actorId: 1, op: "forget", skillId: 9 });
    assert.ok(ann.forgot.includes(9) && !ann.skills.includes(9), "changeSkill (forget) suppresses a skill");
    await run({ t: "changeEquip", actorId: 1, slot: "weapon", itemId: 4 });
    assert.equal(ann.weaponId, 4, "changeEquip force-equips the slot");
    await run({ t: "changeClass", actorId: 1, classId: 2 });
    assert.equal(ann.classId, 2, "changeClass swaps the class");
    await run({ t: "changeActorImage", actorId: 1, charset: "knight-1" });
    assert.equal(ann.charset, "knight-1", "changeActorImage swaps the charset");
    assert.ok(charsetRefreshed > 0 && follSynced > 0, "changeActorImage refreshes the on-map sprites");
    await run({ t: "changeNickname", actorId: 1, nickname: "The Bold" });
    assert.equal(ann.nickname, "The Bold", "changeNickname stores the nickname");

    // whole-party target (actorId 0)
    astate.party.push({ actorId: 2, name: "Bo", level: 1, exp: 0, hp: 5, mp: 1, classId: 1, weaponId: 0, armorId: 0 });
    await run({ t: "changeState", actorId: 0, op: "add", stateId: 3 });
    assert.ok(astate.party.every((a) => a.states && a.states.some((st) => st.id === 3)), "actorId 0 targets the whole party");

    await run({ t: "access", kind: "menu", enabled: false });
    assert.equal(astate.menuDisabled, true, "access(menu, disable) locks the menu");
    await run({ t: "access", kind: "save", enabled: true });
    assert.equal(astate.saveDisabled, false, "access(save, enable) unlocks saving");
    await run({ t: "followers", show: false });
    assert.equal(astate.followersHidden, true, "followers(hide) sets the flag");
    await run({ t: "windowTone", tone: [64, 96, 128] });
    // (per-element: the tone array is built inside the vm realm, so a strict
    // deep-equal against an outer-realm literal fails on prototype identity.)
    assert.deepEqual(Array.from(astate.windowTone), [64, 96, 128], "windowTone stores the override");
    assert.deepEqual(Array.from(toneApplied), [64, 96, 128], "windowTone applies the CSS tone");
    await run({ t: "getLocationInfo", varId: 5, infoType: "region", x: 2, y: 3 });
    assert.equal(astate.vars[5], 7, "getLocationInfo stores the read value in its variable");
  }

  // ---- Multi-currency wallet: Change Gold with a currencyId ----
  // Ids ≥ 2 (system.types.currencyTypes) move a wallet balance; absent/0/1 is
  // the byte-identical classic-gold path.
  {
    const wstate = { gold: 100 };
    const wsvc = { clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) };
    const wrun = (cmd) => getCommand("gold")(cmd, { interp: {}, state: wstate, services: wsvc });
    await wrun({ t: "gold", op: "add", val: 50 });
    assert.equal(wstate.gold, 150, "classic Change Gold (no currencyId) still moves state.gold");
    assert.equal(wstate.wallet, undefined, "the classic path never creates a wallet");
    await wrun({ t: "gold", op: "add", val: 50, currencyId: 1 });
    assert.equal(wstate.gold, 200, "currencyId 1 aliases the classic gold purse");
    await wrun({ t: "gold", op: "add", val: 30, currencyId: 2 });
    assert.equal(wstate.wallet[2], 30, "a wallet id creates and fills its balance");
    assert.equal(wstate.gold, 200, "wallet changes never touch classic gold");
    await wrun({ t: "gold", op: "sub", val: 100, currencyId: 2 });
    assert.equal(wstate.wallet[2], 0, "wallet balances clamp at zero like gold");
  }

  // ---- Change Gold amount from a variable (valVarId) ----
  // valVarId ≥ 1 reads the amount from that variable at run time; the stored
  // constant `val` is ignored. Absent/0 = the byte-identical constant path.
  {
    const vstate = { gold: 100, vars: { 3: 25, 4: -10 } };
    const vsvc = { clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) };
    const vrun = (cmd) => getCommand("gold")(cmd, { interp: {}, state: vstate, services: vsvc });
    await vrun({ t: "gold", op: "add", val: 999, valVarId: 3 });
    assert.equal(vstate.gold, 125, "valVarId reads the variable and ignores val");
    await vrun({ t: "gold", op: "sub", val: 0, valVarId: 3 });
    assert.equal(vstate.gold, 100, "sub with valVarId takes the variable's amount");
    await vrun({ t: "gold", op: "add", val: 0, valVarId: 7 });
    assert.equal(vstate.gold, 100, "an unset variable reads 0 — gold unchanged");
    await vrun({ t: "gold", op: "add", val: 0, valVarId: 4 });
    assert.equal(vstate.gold, 90, "a negative variable amount subtracts (RM semantics)");
    await vrun({ t: "gold", op: "add", val: 0, valVarId: 3, currencyId: 2 });
    assert.equal(vstate.wallet[2], 25, "valVarId works for wallet currencies too");
    assert.equal(vstate.gold, 90, "wallet + valVarId never touches classic gold");
    await vrun({ t: "gold", op: "add", val: 50, valVarId: 0 });
    assert.equal(vstate.gold, 140, "valVarId 0 is the classic constant path");
  }

  // ---- Change Items amount from a variable (valVarId) ----
  // Same contract as Change Gold: valVarId ≥ 1 reads that variable at run
  // time and the stored constant `val` is ignored; absent/0 = the
  // byte-identical constant path.
  {
    const istate = { vars: { 3: 25, 4: -10 } };
    const invCalls = [];
    const isvc = { addInv: (kind, id, delta) => invCalls.push([kind, id, delta]) };
    const irun = (cmd) => getCommand("item")(cmd, { interp: {}, state: istate, services: isvc });
    await irun({ t: "item", kind: "item", id: 2, op: "add", val: 999, valVarId: 3 });
    assert.deepEqual(invCalls.pop(), ["item", 2, 25], "valVarId reads the variable and ignores val");
    await irun({ t: "item", kind: "weapon", id: 1, op: "sub", val: 0, valVarId: 3 });
    assert.deepEqual(invCalls.pop(), ["weapon", 1, -25], "sub with valVarId takes the variable's amount");
    await irun({ t: "item", kind: "armor", id: 1, op: "add", val: 0, valVarId: 7 });
    assert.deepEqual(invCalls.pop(), ["armor", 1, 0], "an unset variable reads 0 — nothing gained");
    await irun({ t: "item", kind: "item", id: 2, op: "add", val: 0, valVarId: 4 });
    assert.deepEqual(invCalls.pop(), ["item", 2, -10], "a negative variable amount removes items (RM semantics)");
    await irun({ t: "item", kind: "item", id: 2, op: "add", val: 5, valVarId: 0 });
    assert.deepEqual(invCalls.pop(), ["item", 2, 5], "valVarId 0 is the classic constant path");
  }

  // ---- Jump labels (M2·C): the runList contract seeks the target label ----
  {
    const jstate = { vars: {} };
    const jsvc = { refreshAllPages() {}, evaluateQuestFailures() {}, waitFrames: async () => {}, rnd: () => 0 };
    const interp = {
      breakLoop: false, jumpLabel: null, jumpSpins: 0,
      async exec(c) { const handler = getCommand(c.t); if (handler) await handler(c, { interp: this, state: jstate, services: jsvc }); },
      async runList(list) {
        const arr = list || [];
        for (let i = 0; i < arr.length; i++) {
          await this.exec(arr[i]);
          if (this.breakLoop) return;
          if (this.jumpLabel != null) {
            const idx = arr.findIndex((cmd) => cmd && cmd.t === "label" && String(cmd.name) === this.jumpLabel);
            if (idx < 0) return;
            this.jumpLabel = null;
            i = idx;
          }
        }
      },
    };
    await interp.runList([
      { t: "var", id: 1, op: "set", val: 1 },
      { t: "jump", name: "End" },
      { t: "var", id: 1, op: "set", val: 99 }, // skipped
      { t: "label", name: "End" },
      { t: "var", id: 2, op: "set", val: 2 },
    ]);
    assert.equal(jstate.vars[1], 1, "jump skips the commands between it and the target label");
    assert.equal(jstate.vars[2], 2, "execution resumes just after the target label");
  }

  // ---- M5·B: the read-only Script-command adapter runs under the shim ----
  // The mzScript command builds the $game* shim from the passed state and runs
  // the (importer-gated) snippet under the same new Function sandbox as
  // `script`. Read-only by design: it must not throw and must not mutate state.
  {
    const sstate = { switches: { 2: true }, vars: { 1: 42 }, party: [{ actorId: 1 }], gold: 100, inv: { item: {}, weapon: {}, armor: {} } };
    const before = JSON.stringify(sstate);
    await getCommand("mzScript")(
      { t: "mzScript", code: "$gameSwitches.value(2) && $gameVariables.value(1) > 0 && $gameParty.size()" },
      { interp: {}, state: sstate, services: {} },
    );
    assert.equal(JSON.stringify(sstate), before, "mzScript reads state but the shim exposes no setter, so nothing changes");
    // A snippet that tries to write is a swallowed TypeError (no such setter).
    await getCommand("mzScript")(
      { t: "mzScript", code: "$gameVariables.setValue(1, 0)" },
      { interp: {}, state: sstate, services: {} },
    );
    assert.equal(sstate.vars[1], 42, "a write attempt through the shim is a no-op, not a crash");
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
