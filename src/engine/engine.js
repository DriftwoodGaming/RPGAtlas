/* RPGAtlas — engine.js
   Game runtime: scenes, map, events, interpreter, menus, battle, shop, save/load.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
"use strict";

import { registerCommand, getCommand } from "./interpreter/registry.js";
import { registerBuiltinCommands } from "./interpreter/commands/index.js";
import { el, sleep, clamp, rnd, esc, sysSe, sysBgm, setSysProjectProvider, compareVariable } from "./util.js";
import { UIStack, pushUI, removeUI, showList, initUiStack } from "./ui-stack.js";
import { Interp, initInterpServices } from "./interpreter/interp.js";
import { scriptApi } from "./script-api.js";
import { Plugins } from "./plugin-runtime.js";
import {
  refreshAllPages,
  loadMap,
  entityAt,
  blockingEventAt,
  tilePassable,
  canEntityPass,
  startMove,
  dirTo,
  DIRD,
  setRoute,
  updateRoute,
  updateEntityMotion,
  walkFrame,
  updateMapCombat,
  combatChaseDir,
  combatStaggered,
  startPlayerAttack,
  drawMapCombatOverlay,
  initPlayer,
  refreshPlayerCharset,
} from "./scenes/map-runtime.js";
import { render, TICK_MS } from "./render-glue.js";
import {
  update,
  transferPlayer,
  waitFrames,
  frameWait,
  tickTween,
} from "./scenes/map.js";
// Shared engine context (Phase 1 Stage B): imported as EC because `ctx` here is
// the game canvas 2d context. The IIFE installs getter/setter bridges onto EC
// (below, before the boot section) so extracted modules see this closure's
// live state; fns carries the closure functions extracted modules call.
import { ctx as EC, fns } from "./state/engine-context.js";
import { fadeTo, initMessageSystem } from "./message.js";
import { initInputSystem, actionLabel } from "./input.js";
import {
  loadOptions,
  saveOptions,
  audioVol,
  setOptAudio,
  setOpt,
  setOptTextSpeed,
  wantsDash,
} from "./state/player-options.js";
import {
  G,
  expForLevel,
  actorClass,
  skillElement,
  skillMpCost,
  skillPowerRate,
  actorIncomingRate,
  canActorEquip,
  sanitizeEquipment,
  param,
  learnedSkills,
  makeActor,
  gainExp,
  addInv,
  invCount,
  dbFor,
  initQuestRuntime,
  Quests,
  questState,
  objectiveDone,
  evaluateQuestFailures,
  noteBattleFailure,
  onEnemyKilled,
  traitDescription,
} from "./state/game-state.js";

const _Assets = window.RPGAtlasDeps.Assets;
const _DataDefaults = window.RPGAtlasDeps.DataDefaults;
const _Renderer = window.RPGAtlasDeps.Renderer;
const _Music = window.RPGAtlasDeps.Music;
const _RA = window.RPGAtlasDeps.RA;
const _Sfx = window.RPGAtlasDeps.Sfx;
const _createMessageSystem = window.createMessageSystem;
const _createInputSystem = window.createInputSystem;

(() => {
  const Assets = _Assets;
  const DataDefaults = _DataDefaults;
  const Renderer = _Renderer;
  const Music = _Music;
  const RA = _RA;
  const Sfx = _Sfx;
  const createMessageSystem = _createMessageSystem;
  const createInputSystem = _createInputSystem;

  const TILE = Assets.TILE;
  // defaults (overridden at boot from system.screenWidth/Height)
  let SCREEN_W = 17 * TILE,
    SCREEN_H = 13 * TILE;

  let proj = null;
  setSysProjectProvider(() => proj); // util.js sys* helpers read the live project
  let stage, canvas, ctx, uiLayer, fader;
  initUiStack(() => uiLayer); // ui-stack.js showList appends to the live uiLayer
  // Closure functions the extracted modules call through the fns registry.
  // Function declarations hoist, so installing here is safe. Entries are
  // removed as their owners move out of this file (fns.refreshAllPages is now
  // self-installed by scenes/map-runtime.ts; fns.Battle near EngineServices).
  fns.gameOver = gameOver; // map-runtime's touch-damage defeat path + encounters
  fns.openMenu = openMenu; // map scene update's cancel-press menu open
  let scene = "boot"; // boot | title | map | battle | gameover
  let menuOpen = false;
  let cameraZoom = 1;

  let shakePower = 0;
  let shakeSpeed = 0;
  let shakeDuration = 0;
  let shakeTimer = 0;

  let flashColor = "#ffffff";
  let flashOpacity = 0.5;
  let flashDuration = 0;
  let flashTimer = 0;

  // ============================ utils ============================
  // el / sleep / clamp / rnd / esc / sysSe / sysBgm are imported from
  // ./util.js (Phase 1 Stage B). The sys* helpers read the live project through
  // a provider installed at boot (setSysProjectProvider below).

  // ============================ input / UI stack ============================
  // UIStack / pushUI / removeUI / showList are imported from ./ui-stack.js
  // (Phase 1 Stage B). showList reaches the game UI root through a provider the
  // engine installs at boot (initUiStack below).
  // All physical input flows through the unified Input system (js/runtime/input.js);
  // it is instantiated near the message-system wiring once UIStack/onKey exist.
  let Input = null;

  let richText;
  let showMessage;
  let setMsgSpeed = null; // message-system typewriter speed setter (captured at wiring)

  // ---- closure-state bridge (Phase 1 Stage B) ----
  // Bridge this closure's mutable state onto the shared engine context (EC) so
  // extracted modules — and the command handlers via services.ctx — read/write
  // the SAME live values the remaining closure code does. This generalizes the
  // old ctxScalars get/set bridge (camera/shake/flash) to every closure `let`
  // an extracted module needs. The accessors only run at call time, so vars
  // declared further down (map, playerOptions, loop scalars…) are fine — they
  // are never written through EC before boot. Bridges disappear with this file
  // at the end of Stage B, when boot.ts assigns the context's fields directly.
  Object.defineProperties(EC, Object.getOwnPropertyDescriptors({
    get proj() { return proj; }, set proj(v) { proj = v; },
    get stage() { return stage; }, set stage(v) { stage = v; },
    get canvas() { return canvas; }, set canvas(v) { canvas = v; },
    get g2d() { return ctx; }, set g2d(v) { ctx = v; },
    get uiLayer() { return uiLayer; }, set uiLayer(v) { uiLayer = v; },
    get fader() { return fader; }, set fader(v) { fader = v; },
    get SCREEN_W() { return SCREEN_W; }, set SCREEN_W(v) { SCREEN_W = v; },
    get SCREEN_H() { return SCREEN_H; }, set SCREEN_H(v) { SCREEN_H = v; },
    get scene() { return scene; }, set scene(v) { scene = v; },
    get menuOpen() { return menuOpen; }, set menuOpen(v) { menuOpen = v; },
    get cameraZoom() { return cameraZoom; }, set cameraZoom(v) { cameraZoom = v; },
    get shakePower() { return shakePower; }, set shakePower(v) { shakePower = v; },
    get shakeSpeed() { return shakeSpeed; }, set shakeSpeed(v) { shakeSpeed = v; },
    get shakeTimer() { return shakeTimer; }, set shakeTimer(v) { shakeTimer = v; },
    get shakeDuration() { return shakeDuration; }, set shakeDuration(v) { shakeDuration = v; },
    get flashColor() { return flashColor; }, set flashColor(v) { flashColor = v; },
    get flashOpacity() { return flashOpacity; }, set flashOpacity(v) { flashOpacity = v; },
    get flashTimer() { return flashTimer; }, set flashTimer(v) { flashTimer = v; },
    get flashDuration() { return flashDuration; }, set flashDuration(v) { flashDuration = v; },
    get Input() { return Input; }, set Input(v) { Input = v; },
    get richText() { return richText; }, set richText(v) { richText = v; },
    get showMessage() { return showMessage; }, set showMessage(v) { showMessage = v; },
    get setMsgSpeed() { return setMsgSpeed; }, set setMsgSpeed(v) { setMsgSpeed = v; },
    get map() { return map; }, set map(v) { map = v; },
    get lowerBuf() { return lowerBuf; }, set lowerBuf(v) { lowerBuf = v; },
    get upperBuf() { return upperBuf; }, set upperBuf(v) { upperBuf = v; },
    get hdActive() { return hdActive; }, set hdActive(v) { hdActive = v; },
    get evRTs() { return evRTs; }, set evRTs(v) { evRTs = v; },
    get blockingRun() { return blockingRun; }, set blockingRun(v) { blockingRun = v; },
    get globalT() { return globalT; }, set globalT(v) { globalT = v; },
    get loopLast() { return loopLast; }, set loopLast(v) { loopLast = v; },
    get loopAcc() { return loopAcc; }, set loopAcc(v) { loopAcc = v; },
    get playerOptions() { return playerOptions; }, set playerOptions(v) { playerOptions = v; },
    get dashLatch() { return dashLatch; }, set dashLatch(v) { dashLatch = v; },
    get dashPrev() { return dashPrev; }, set dashPrev(v) { dashPrev = v; },
  }));


  // ============================ message window ============================
  // fadeTo and the message-system wiring live in ./message.ts (Phase 1
  // Stage B); the message system itself is js/runtime/messages.js as before.
  // initMessageSystem() below assigns richText/showMessage/setMsgSpeed through
  // the closure-state bridge, so this closure's `let`s stay live.

  // ============================ game state ============================
  // G and the actor/param/exp/inventory helpers live in ./state/game-state.ts
  // (Phase 1 Stage B). The quest runtime is created here, exactly where the
  // monolith created it; game-state reaches this closure's refreshAllPages
  // through fns (installed at the top of this IIFE).
  initQuestRuntime();


  // ============================ map runtime ============================
  // The map runtime lives in ./scenes/map-runtime.ts (Phase 1 Stage B): map
  // loading/prerender, passability, event pages/lights, entity queries,
  // motion, routes, the on-map action-combat system, and player-entity init —
  // imported above. The map state itself stays in these closure `let`s
  // (bridged onto the shared context) until the map scene update and
  // rendering sections move out.
  let map = null;
  let lowerBuf = null,
    upperBuf = null;
  let hdActive = false; // current map renders through the WebGL HD-2D path
  let evRTs = [];
  let blockingRun = false; // an action/touch/autorun interpreter is active
  const parallels = new Map(); // evRT -> running flag
  const commonParallels = new Map(); // common event id -> running flag
  EC.parallels = parallels; // shared with extracted modules (same Map identity)
  EC.commonParallels = commonParallels;


  // ============================ interpreter ============================
  // The Interp class lives in ./interpreter/interp.ts and the frozen `game`
  // Script API in ./script-api.ts (Phase 1 Stage B); both are imported above.
  // The EngineServices surface handlers receive is injected below via
  // initInterpServices(), preserving the closure-live getters.

  // ============================ plugins ============================
  // The plugin runtime lives in ./plugin-runtime.ts (Phase 1 Stage B),
  // imported above; it self-installs onto fns.Plugins at module evaluation.
  // Plugins reach the battle scene (still in this file) through fns.Battle,
  // installed near the EngineServices block below.

  // The message-system wiring and the unified-input wiring (including the
  // "\input[action]" glyph text processor) live in ./message.ts and ./input.ts
  // (Phase 1 Stage B). Both init calls run at the exact points the monolith
  // did the wiring; the created values land in this closure's richText /
  // showMessage / setMsgSpeed / Input `let`s through the closure-state bridge.
  initMessageSystem();
  initInputSystem();

  // Frame/tick timers, blocking/autorun/parallel event scheduling, and
  // transferPlayer live in ./scenes/map.ts (Phase 1 Stage B), imported above.

  // ============================ map scene update ============================
  let globalT = 0;

  // activePlayerControl / update / onPlayerStep / checkActionTrigger live in
  // ./scenes/map.ts (Phase 1 Stage B), imported above.

  // ============================ rendering ============================
  // render() lives in ../render-glue.ts (Phase 1 Stage B), imported above;
  // it reads this closure's state through the shared engine context.

  // Fixed-timestep loop: update() runs at a steady 60 ticks/sec regardless of refresh rate,
  // render() once per frame (every frame, at full refresh). Keeps the tick-based engine in
  // sync without per-system delta time, and stops fast displays from running in fast-forward.
  // render() is async (WebGL HD-2D path), so we await it to avoid overlapping frames.

  let loopLast = 0, loopAcc = 0;
  async function loop(now) {
    if (loopLast === 0) loopLast = now;   // first frame: establish baseline, no delta
    loopAcc += now - loopLast;
    loopLast = now;
    if (loopAcc > 250) loopAcc = 250;     // clamp after a stall / tab switch (avoid spiral)
    while (loopAcc >= TICK_MS) { update(); loopAcc -= TICK_MS; }
    await render();
    requestAnimationFrame(loop);
  }

  // ============================ menus ============================
  function bar(cur, max, color) {
    const pct = max > 0 ? clamp((cur / max) * 100, 0, 100) : 0;
    return (
      '<span class="bar"><span class="bar-fill" style="width:' +
      pct +
      "%;background:" +
      color +
      '"></span></span>'
    );
  }
  function iconEntryHtml(entry, text) {
    return (
      Assets.iconHtml(entry && entry.icon, "menu-icon") +
      (text == null ? esc(entry.name) : text)
    );
  }
  function actorRowHTML(a) {
    const cls = actorClass(a);
    return (
      '<div class="arow"><span class="aface"></span><div class="ainfo">' +
      Assets.iconHtml(cls && cls.icon, "menu-icon") +
      "<b>" +
      esc(a.name) +
      '</b> <span class="lv">' +
      esc(cls ? cls.name : "") +
      " · Lv " +
      a.level +
      "</span><br>" +
      "HP " +
      a.hp +
      "/" +
      param(a, "mhp") +
      " " +
      bar(a.hp, param(a, "mhp"), "#58c46a") +
      "<br>" +
      "MP " +
      a.mp +
      "/" +
      param(a, "mmp") +
      " " +
      bar(a.mp, param(a, "mmp"), "#5a8ad8") +
      "</div></div>"
    );
  }
  function attachFaces(container, actors) {
    const slots = container.querySelectorAll(".aface");
    actors.forEach((a, i) => {
      if (!slots[i]) return;
      const ci = Assets.charsetIndex(a.charset);
      if (ci >= 0) slots[i].appendChild(Assets.faceCanvas(ci));
    });
  }

  async function pickPartyMember(title) {
    const i = await showList(
      G.party.map((a) => ({ html: actorRowHTML(a) })),
      { title, className: "partywin" },
    );
    return i < 0 ? null : G.party[i];
  }
  const journalView = window.RPGAtlasJournalView.create({
    el,
    esc,
    pushUI,
    removeUI,
    sysSe,
    appendUI: (node) => uiLayer.appendChild(node),
    showMessage: (...args) => showMessage(...args),
    getProj: () => proj,
    questState,
    Quests,
  });
  async function menuJournal() {
    return journalView.open();
  }

  async function openMenu() {
    if (menuOpen || blockingRun) return;
    menuOpen = true;
    sysSe("ok");
    const panel = el("div", "win menupanel");
    const partyBox = el("div", "menu-party");
    panel.appendChild(partyBox);
    const goldBox = el("div", "menu-gold");
    panel.appendChild(goldBox);
    uiLayer.appendChild(panel);
    function refreshPanel() {
      partyBox.innerHTML = G.party.map(actorRowHTML).join("");
      attachFaces(partyBox, G.party);
      goldBox.textContent = G.gold + " " + proj.system.currency;
    }
    try {
      let idx = 0;
      while (true) {
        refreshPanel();
        const i = await showList(
          [            
            { html: Assets.iconHtml(24, "menu-icon") + "Items" },
            { html: Assets.iconHtml(8, "menu-icon") + "Skills" },
            { html: Assets.iconHtml(48, "menu-icon") + "Equip" },
            {
              html:
                Assets.iconHtml(
                  (actorClass(G.party[0]) || {}).icon,
                  "menu-icon",
                ) + "Status",
            },
            { html: Assets.iconHtml(16, "menu-icon") + "Journal" },
            { html: Assets.iconHtml(46, "menu-icon") + "Options" },
            { html: Assets.iconHtml(44, "menu-icon") + "Save" },
            { html: Assets.iconHtml(45, "menu-icon") + "Load" },
            { html: Assets.iconHtml(47, "menu-icon") + "To Title" },
          ],
          { className: "mainmenu", start: idx },
        );
        if (i < 0) break;
        idx = i;

        if (i === 0) {
          await menuItems();
        } else if (i === 1) {
          await menuSkills();
        } else if (i === 2) {
          await menuEquip();
        } else if (i === 3) {
          await menuStatus();
        } else if (i === 4) {
          panel.style.display = "none";
          try {
            if (await menuJournal() === "close") return;
          } finally {
            panel.style.display = "";
          }
        } else if (i === 5) {
          await optionsMenu();
        } else if (i === 6) {
          await saveLoadMenu("save");
        } else if (i === 7) {
          if (await saveLoadMenu("load")) break;
        } else if (i === 8) {
          const c = await showList(
            [{ label: "Return to title" }, { label: "Cancel" }],
            { className: "choicewin" },
          );
          if (c === 0) {
            panel.remove();
            menuOpen = false;
            await toTitle();
            return;
          }
        }
      }
    } finally {
      panel.remove();
      menuOpen = false;
    }
  }

  // ---- player options (per-player overrides: input rebinds + audio/game settings) ----
  // The option store and its setters live in ./state/player-options.ts (Phase 1
  // Stage B); they mutate this closure's playerOptions/dash state through the
  // closure-state bridge, so the `let`s below stay the single source of truth
  // for the code remaining in this file.
  let playerOptions = {};
  let dashLatch = false;
  let dashPrev = false;

  // In-game Options: rebind keyboard / gamepad per action (editable list — add / replace
  // / remove), audio mixer + game settings, reset. Built on showList/UIStack; capture uses
  // Input.beginCapture (ignore-held-until-release + conflict prompt). Player overrides
  // persist to the options store and apply live via Input.setBindings.
  // (actionLabel is imported from ./input.ts.)
  // Build a 10-segment volume bar like "▰▰▰▰▰▱▱▱▱▱".
  function volBar(v) {
    const n = Math.max(0, Math.min(10, Math.round(v * 10)));
    return "▰".repeat(n) + "▱".repeat(10 - n);
  }
  const OPT_TEXT_SPEED = [["Slow", 1], ["Normal", 2], ["Fast", 4], ["Instant", 9999]];
  const OPT_DASH = [["Hold", "hold"], ["Toggle", "toggle"], ["Always On", "always"]];
  const OPT_SHAKE = [["Off", 0], ["Reduced", 0.5], ["Full", 1]];
  // Registry-row builders: a slider (continuous 0..1) and a cycler (fixed [label,value] list).
  // sliderRow exposes bar()/pct() for the split display and seek(frac) for click-to-seek.
  function sliderRow(label, getVal, setVal) {
    const set = (v) => setVal(Math.max(0, Math.min(1, v)));
    return {
      label,
      slider: true,
      get() {
        return volBar(getVal()) + " " + Math.round(getVal() * 100) + "%";
      },
      bar() {
        return volBar(getVal());
      },
      pct() {
        return Math.round(getVal() * 100) + "%";
      },
      adjust(dir) {
        set(getVal() + dir * 0.1);
      },
      seek(frac) {
        set(Math.ceil(frac * 10) / 10); // fill up to the segment the cursor is over (click anywhere in it)
      },
    };
  }
  function choiceRow(label, list, getVal, setVal) {
    return {
      label,
      get() {
        const v = getVal();
        const m = list.find((x) => x[1] === v);
        return (m || list[0])[0];
      },
      adjust(dir) {
        let i = list.findIndex((x) => x[1] === getVal());
        if (i < 0) i = 0;
        i = (i + dir + list.length) % list.length;
        setVal(list[i][1]);
      },
    };
  }
  async function optionsMenu() {
    let idx = 0;
    while (true) {
      const rows = [
        sliderRow("Master Volume", () => audioVol("master"), (v) => setOptAudio("master", v)),
        sliderRow("Music Volume", () => audioVol("bgm"), (v) => setOptAudio("bgm", v)),
        sliderRow("SFX Volume", () => audioVol("se"), (v) => setOptAudio("se", v)),
        choiceRow("Text Speed", OPT_TEXT_SPEED, () => playerOptions.textSpeed || 2, (v) => setOptTextSpeed(v)),
        choiceRow("Dash", OPT_DASH, () => playerOptions.dashMode || "hold", (v) => setOpt("dashMode", v)),
        choiceRow("Screen Shake", OPT_SHAKE, () => (playerOptions.shakeScale == null ? 1 : playerOptions.shakeScale), (v) => setOpt("shakeScale", v)),
        { label: "Controls", nav: true },
        { label: "Back", nav: true },
      ];
      const i = await showList(rows, { title: "Options", className: "optionswin optionswin-wide", start: idx });
      if (i < 0 || i === rows.length - 1) return; // Back / cancel
      idx = i;
      if (rows[i] && rows[i].label === "Controls") await controlsMenu();
    }
  }
  // Controls submenu (Options ▸ Controls): per-device rebinders + reset to author defaults.
  async function controlsMenu() {
    let idx = 0;
    while (true) {
      const items = [
        { label: "Keyboard", nav: true },
        { label: "Gamepad", nav: true },
        { label: "Reset to Defaults", nav: true },
        { label: "Back", nav: true },
      ];
      const i = await showList(items, {
        title: "Controls",
        start: idx,
      });
      if (i < 0 || i === items.length - 1) return;
      idx = i;
      if (i === 0) await controlsDevice("keyboard");
      else if (i === 1) await controlsDevice("gamepad");
      else if (i === 2) {
        const c = await showList(
          [{ label: "Yes", nav: true }, { label: "Cancel", nav: true }],
          { title: "Reset controls to defaults?" },
        );
        if (c === 0) {
          delete playerOptions.input;
          Input.setBindings(RA.mergeInputBindings(proj.system.input, null));
          saveOptions();
        }
      }
    }
  }
  // Render a binding array as the same procedural glyphs the editor draws, skinned to the
  // player's live controller family for gamepad. Dim em-dash when an action is unbound.
  function bindGlyphsHtml(device, action) {
    const arr = (Input.getBindings()[device] || {})[action] || [];
    if (!arr.length) return "<span class='bind-none'>—</span>";
    const fam = device === "gamepad" && Input.padFamily ? Input.padFamily() : "xbox";
    return arr.map((code) => Assets.inputGlyphHtml(device, code, fam, "bind-icon")).join("");
  }
  // Per-device action list: each row shows the action and its bindings (as glyphs).
  async function controlsDevice(device) {
    let idx = 0;
    while (true) {
      const rows = RA.INPUT_ACTIONS.map((a) => ({
        html:
          "<span>" + esc(a.label) + "</span>" +
          "<span class='bind'>" + bindGlyphsHtml(device, a.key) + "</span>",
      }));
      rows.push({ label: "Back", nav: true });
      const i = await showList(rows, {
        title: (device === "keyboard" ? "Keyboard" : "Gamepad") + " — pick an action",
        className: "optionswin",
        start: idx,
      });
      if (i < 0 || i === rows.length - 1) return; // cancel or Back
      idx = i;
      await actionBindings(device, RA.INPUT_ACTIONS[i].key);
    }
  }
  // Editable binding list for one action: existing bindings + Add + Back. Selecting a
  // binding offers Replace / Remove; Add captures a new one. First entry = primary.
  async function actionBindings(device, action) {
    let idx = 0;
    while (true) {
      const arr = (Input.getBindings()[device] || {})[action] || [];
      const fam = device === "gamepad" && Input.padFamily ? Input.padFamily() : "xbox";
      const items = arr.map((code) => ({
        html:
          Assets.inputGlyphHtml(device, code, fam, "bind-icon") +
          "<span class='bind-name'>" + esc(Input.codeLabel(device, code)) + "</span>",
      }));
      items.push({ label: "+ Add binding" });
      items.push({ label: "Back", nav: true });
      const i = await showList(items, {
        title: actionLabel(action),
        start: idx,
      });
      if (i < 0 || i === items.length - 1) return; // cancel or Back
      idx = i;
      if (i === arr.length) {
        const code = await rebindCapture(device);
        if (code) await applyCapturedCode(device, action, code, -1);
      } else {
        const c = await showList(
          [
            { label: "Replace", nav: true },
            { label: "Remove", nav: true },
            { label: "Back", nav: true },
          ],
          {
            titleHtml:
              Assets.inputGlyphHtml(device, arr[i], fam, "bind-icon") +
              " " + esc(Input.codeLabel(device, arr[i])),
          },
        );
        if (c === 0) {
          const code = await rebindCapture(device);
          if (code) await applyCapturedCode(device, action, code, i);
        } else if (c === 1) {
          await removeBinding(device, action, i);
        }
      }
    }
  }
  // Show a centered "press any input" prompt and resolve to the captured code, or null
  // if cancelled. The capture itself (ignore-held-until-release) lives in input.js.
  async function rebindCapture(device) {
    const prompt = el(
      "div",
      "win listwin cap-prompt",
      "<div class='win-title'>Press any " + (device === "keyboard" ? "key" : "button") + "</div>" +
        "<div class='win-help'>Esc cancels</div>",
    );
    uiLayer.appendChild(prompt);
    let cap;
    try {
      cap = await new Promise((res) => Input.beginCapture(device, res));
    } finally {
      prompt.remove();
    }
    return cap ? cap.code : null;
  }
  // Apply a captured code to an action (slot -1 = append, otherwise replace that index),
  // resolving a cross-action conflict via a Replace/Cancel prompt, then persist + apply.
  async function applyCapturedCode(device, action, code, slot) {
    const merged = RA.mergeInputBindings(proj.system.input, playerOptions.input || null);
    const clash = RA.inputConflict(merged, device, code, action);
    if (clash) {
      // Refuse a Replace that would orphan a menu-driving action (its last binding on this
      // device) — otherwise unbinding Confirm/Cancel this way could lock the player out.
      if (RA.INPUT_CRITICAL.indexOf(clash) !== -1 && merged[device][clash].length <= 1) {
        sysSe("buzzer");
        await showMessage("", actionLabel(clash) + " needs at least one binding — free it up first.");
        return;
      }
      const c = await showList(
        [{ label: "Replace" }, { label: "Cancel" }],
        { title: Input.codeLabel(device, code) + " is bound to " + actionLabel(clash) },
      );
      if (c !== 0) return;
      merged[device][clash] = merged[device][clash].filter((x) => x !== code);
    }
    const arr = merged[device][action].slice();
    if (slot >= 0) arr[slot] = code;
    else arr.push(code);
    // drop empties and de-duplicate within the action (keep first occurrence)
    merged[device][action] = arr.filter((x, j) => x && arr.indexOf(x) === j);
    commitBindings(merged);
  }
  async function removeBinding(device, action, slot) {
    const merged = RA.mergeInputBindings(proj.system.input, playerOptions.input || null);
    // Don't let the last Confirm/Cancel binding on this device be removed — they drive every
    // menu, so emptying them could lock the player out (recoverable only via mouse/reload).
    if (RA.INPUT_CRITICAL.indexOf(action) !== -1 && merged[device][action].length <= 1) {
      sysSe("buzzer");
      await showMessage("", actionLabel(action) + " needs at least one binding.");
      return;
    }
    const arr = merged[device][action].slice();
    arr.splice(slot, 1);
    merged[device][action] = arr;
    commitBindings(merged);
  }
  function commitBindings(merged) {
    playerOptions.input = merged;
    Input.setBindings(merged);
    saveOptions();
  }

  async function menuItems() {
    while (true) {
      const list = proj.items.filter((it) => invCount("item", it.id) > 0);
      if (!list.length) {
        await showMessage("", "You have no items.");
        return;
      }
      const i = await showList(
        list.map((it) => ({
          html:
            iconEntryHtml(it) +
            ' <span class="cnt">×' +
            invCount("item", it.id) +
            "</span>",
          help: it.desc || "",
        })),
        { title: "Items", className: "itemwin" },
      );
      if (i < 0) return;
      const it = list[i];
      const target = await pickPartyMember("Use on…");
      if (!target) continue;
      useItemOn(it, target);
    }
  }
  function useItemOn(it, target) {
    if (it.hp) target.hp = clamp(target.hp + it.hp, 0, param(target, "mhp"));
    if (it.mp) target.mp = clamp(target.mp + it.mp, 0, param(target, "mmp"));
    sysSe("heal");
    addInv("item", it.id, -1);
  }

  async function menuSkills() {
    const a = await pickPartyMember("Whose skills?");
    if (!a) return;
    while (true) {
      const skills = learnedSkills(a);
      if (!skills.length) {
        await showMessage("", a.name + " knows no skills.");
        return;
      }
      const i = await showList(
        skills.map((s) => ({
          html:
            iconEntryHtml(s) +
            ' <span class="cnt">' +
            skillMpCost(a, s) +
            " MP</span>",
          disabled: s.type !== "heal" || a.mp < skillMpCost(a, s),
          help: s.type === "heal" ? "Restores HP." : "Usable in battle only.",
        })),
        { title: a.name + "'s Skills", className: "itemwin" },
      );
      if (i < 0) return;
      const s = skills[i];
      const target = await pickPartyMember("Heal whom?");
      if (!target) continue;
      a.mp -= skillMpCost(a, s);
      const amount = Math.max(
        1,
        Math.floor((s.power + param(a, "mat") * 1.2) * skillPowerRate(a, s)),
      );
      target.hp = clamp(target.hp + amount, 0, param(target, "mhp"));
      sysSe("heal");
    }
  }

  async function menuEquip() {
    const a = await pickPartyMember("Equip whom?");
    if (!a) return;
    while (true) {
      const w = RA.byId(proj.weapons, a.weaponId),
        ar = RA.byId(proj.armors, a.armorId);
      const slot = await showList(
        [
          {
            html: iconEntryHtml(
              w || { icon: 48 },
              "Weapon: <b>" + esc(w ? w.name : "—") + "</b>",
            ),
          },
          {
            html: iconEntryHtml(
              ar || { icon: 56 },
              "Armor: <b>" + esc(ar ? ar.name : "—") + "</b>",
            ),
          },
        ],
        {
          title:
            a.name +
            " — ATK " +
            param(a, "atk") +
            " / DEF " +
            param(a, "def") +
            " / MAT " +
            param(a, "mat"),
          className: "itemwin",
        },
      );
      if (slot < 0) return;
      const kind = slot === 0 ? "weapon" : "armor";
      const db = dbFor(kind);
      const candidates = db.filter((e) => invCount(kind, e.id) > 0);
      const opts = candidates.map((e) => ({
        html:
          iconEntryHtml(e) +
          ' <span class="cnt">' +
          Object.entries(e.params || {})
            .map(([k, v]) => k.toUpperCase() + "+" + v)
            .join(" ") +
          "</span>",
        disabled: !canActorEquip(a, kind, e.id),
        help: canActorEquip(a, kind, e.id)
          ? ""
          : actorClass(a).name + " cannot equip this item.",
      }));
      opts.push({ label: "(Remove)" });
      const ci = await showList(opts, {
        title: "Equip " + kind,
        className: "itemwin",
      });
      if (ci < 0) continue;
      const cur = kind === "weapon" ? a.weaponId : a.armorId;
      if (cur) addInv(kind, cur, 1);
      const next = ci < candidates.length ? candidates[ci].id : 0;
      if (next) addInv(kind, next, -1);
      if (kind === "weapon") a.weaponId = next;
      else a.armorId = next;
      sysSe("equip");
      a.hp = Math.min(a.hp, param(a, "mhp"));
      a.mp = Math.min(a.mp, param(a, "mmp"));
    }
  }

  async function menuStatus() {
    const a = await pickPartyMember("Status of…");
    if (!a) return;
    const c = actorClass(a);
    const next = expForLevel(a.level + 1) - a.exp;
    const stats = ["mhp", "mmp", "atk", "def", "mat", "mdf", "agi"]
      .map(
        (s) =>
          "<tr><td>" +
          s.toUpperCase() +
          "</td><td>" +
          param(a, s) +
          "</td></tr>",
      )
      .join("");
    const traits = (c.traits || []).map(traitDescription);
    await showList(
      [
        {
          html:
            Assets.iconHtml(c.icon, "menu-icon") +
            "<b>" +
            esc(a.name) +
            "</b> — " +
            esc(c.name) +
            " Lv " +
            a.level +
            "<br>EXP " +
            a.exp +
            " (next in " +
            next +
            ")" +
            '<table class="stats">' +
            stats +
            "</table>" +
            "Skills: " +
            (learnedSkills(a)
              .map((s) => esc(s.name))
              .join(", ") || "none") +
            "<br>Traits: " +
            (traits.map(esc).join(" · ") || "none"),
        },
      ],
      { title: "Status", className: "statuswin" },
    );
  }

  // ---- save / load ----
  function saveKey(slot) {
    const gameId = window.RPGATLAS_GAME_ID;
    return gameId
      ? "rpgatlas_" + gameId + "_save_" + slot
      : "rpgatlas_save_" + slot;
  }
  function slotInfo(slot) {
    try {
      const raw =
        localStorage.getItem(saveKey(slot)) ||
        localStorage.getItem(saveKey(slot).replace(/^rpgatlas/, "driftwood")); // pre-rebrand saves
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  async function saveLoadMenu(mode) {
    const slots = [1, 2, 3];
    const i = await showList(
      slots.map((s) => {
        const info = slotInfo(s);
        return {
          html:
            "<b>Slot " +
            s +
            "</b> — " +
            (info
              ? esc(info.mapName) +
                " · Lv " +
                info.level +
                " · " +
                new Date(info.ts).toLocaleString()
              : "(empty)"),
          disabled: mode === "load" && !info,
        };
      }),
      {
        title: mode === "save" ? "Save Game" : "Load Game",
        className: "savewin",
      },
    );
    if (i < 0) return false;
    const slot = slots[i];
    if (mode === "save") {
      const payload = {
        ts: Date.now(),
        mapName: map ? map.name : "",
        level: G.party[0] ? G.party[0].level : 1,
        data: {
          switches: G.switches,
          vars: G.vars,
          selfSw: G.selfSw,
          quests: G.quests,
          party: G.party,
          inv: G.inv,
          gold: G.gold,
          steps: G.steps,
          cameraZoom: cameraZoom,
          mapId: G.mapId,
          player: {
            x: G.player.x,
            y: G.player.y,
            dir: G.player.dir,
            transparent: !!G.player.transparent,
          },
        },
      };
      try {
        localStorage.setItem(saveKey(slot), JSON.stringify(payload));
      } catch (e) {
        await showMessage("", "Could not save — storage is full or unavailable.");
        return false;
      }
      sysSe("save");
      await showMessage("", "Game saved to slot " + slot + ".");
      return false;
    } else {
      const info = slotInfo(slot);
      if (!info) return false;
      try {
        await applySave(info.data);
      } catch (e) {
        await showMessage("", "That save could not be loaded — it may be corrupted or reference content that no longer exists.");
        return false;
      }
      sysSe("save");
      return true;
    }
  }
  async function applySave(d) {
    commonParallels.clear();
    G.switches = d.switches || {};
    G.vars = d.vars || {};
    G.selfSw = d.selfSw || {};
    G.quests = d.quests || {};
    G.party = d.party || [];
    G.inv = d.inv || { item: {}, weapon: {}, armor: {} };
    G.party.forEach((a) => {
      sanitizeEquipment(a);
      a.hp = Math.min(a.hp, param(a, "mhp"));
      a.mp = Math.min(a.mp, param(a, "mmp"));
    });
    G.gold = d.gold || 0;
    G.steps = d.steps || 0;
    cameraZoom = clamp(Number(d.cameraZoom) || 1, 0.25, 4);
    const p = d.player || {};
    initPlayer(p.x || 0, p.y || 0, p.dir);
    G.player.transparent = !!p.transparent;
    await loadMap(d.mapId);
    scene = "map";
  }

  // ============================ shop ============================
  const Shop = {
    async run(goods) {
      const goldLine = () => "Gold: " + G.gold + " " + proj.system.currency;
      while (true) {
        const i = await showList(
          [{ label: "Buy" }, { label: "Sell" }, { label: "Leave" }],
          { title: "Shop — " + goldLine(), className: "shopwin" },
        );
        if (i < 0 || i === 2) return;
        if (i === 0) {
          while (true) {
            const entries = goods
              .map((gd) => ({ gd, e: RA.byId(dbFor(gd.kind), gd.id) }))
              .filter((x) => x.e);
            const bi = await showList(
              entries.map(({ gd, e }) => ({
                html:
                  iconEntryHtml(e) +
                  ' <span class="cnt">' +
                  e.price +
                  " " +
                  proj.system.currency +
                  " · own ×" +
                  invCount(gd.kind, gd.id) +
                  "</span>",
                disabled: G.gold < e.price || invCount(gd.kind, gd.id) >= 99,
                help:
                  e.desc ||
                  (e.params
                    ? Object.entries(e.params)
                        .map(([k, v]) => k.toUpperCase() + "+" + v)
                        .join(" ")
                    : ""),
              })),
              { title: "Buy — " + goldLine(), className: "shopwin" },
            );
            if (bi < 0) break;
            const { gd, e } = entries[bi];
            G.gold -= e.price;
            addInv(gd.kind, gd.id, 1);
            sysSe("equip");
          }
        } else {
          while (true) {
            const owned = [];
            for (const kind of ["item", "weapon", "armor"]) {
              for (const idStr of Object.keys(G.inv[kind])) {
                const e = RA.byId(dbFor(kind), +idStr);
                if (e) owned.push({ kind, e });
              }
            }
            if (!owned.length) {
              await showMessage("", "Nothing to sell.");
              break;
            }
            const si = await showList(
              owned.map(({ kind, e }) => ({
                html:
                  iconEntryHtml(e) +
                  ' <span class="cnt">×' +
                  invCount(kind, e.id) +
                  " · " +
                  Math.floor(e.price / 2) +
                  " " +
                  proj.system.currency +
                  "</span>",
              })),
              { title: "Sell — " + goldLine(), className: "shopwin" },
            );
            if (si < 0) break;
            const { kind, e } = owned[si];
            addInv(kind, e.id, -1);
            G.gold = clamp(G.gold + Math.floor(e.price / 2), 0, 9999999);
            sysSe("equip");
          }
        }
      }
    },
  };

  // ============================ battle ============================
  const Battle = {
    async run(troopId, canEscape) {
      const troop = RA.byId(proj.troops, troopId);
      if (!troop) return "win";
      const prevScene = scene,
        prevMusic = Music.current;
      scene = "battle";
      Music.play(sysBgm("battle"));

      const enemies = troop.enemies
        .map((eid) => {
          const d = RA.byId(proj.enemies, eid);
          return d ? { d, hp: d.stats.mhp, alive: true } : null;
        })
        .filter(Boolean)
        .map((en, i) => ((en.i = i), en));

      const sideView = proj.system.battleView === "side";
      const win = el("div", "battlewin" + (sideView ? " side" : ""));
      const fxLayer = el("div", "battle-fx");
      const enemyArea = el("div", "battle-enemies");
      const log = el("div", "battle-log");
      const partyArea = el("div", "battle-party");
      win.appendChild(fxLayer);
      if (sideView) {
        const fieldRow = el("div", "battle-field");
        fieldRow.appendChild(enemyArea);
        win.appendChild(fieldRow);
      } else {
        win.appendChild(enemyArea);
      }
      win.appendChild(log);
      win.appendChild(partyArea);
      uiLayer.appendChild(win);

      const sprs = enemies.map((en) => {
        const spriteClass = String(en.d.sprite || "slime").replace(
          /[^a-z0-9_-]/gi,
          "-",
        );
        const wrap = el("div", "enemy-spr enemy-" + spriteClass);
        const source = Assets.enemyCanvas(
          en.d.sprite,
          en.d.color,
          sideView ? 108 : 132,
        );
        const battlerCanvas = document.createElement("canvas");
        battlerCanvas.width = source.width;
        battlerCanvas.height = source.height;
        battlerCanvas.getContext("2d").drawImage(source, 0, 0);
        wrap.appendChild(battlerCanvas);
        wrap.appendChild(el("div", "enemy-name", esc(en.d.name)));
        wrap.appendChild(el("div", "battler-states"));
        enemyArea.appendChild(wrap);
        return wrap;
      });
      // side view: the party stands on the right, facing the enemies
      let actorSprs = [];
      if (sideView) {
        const actorArea = el("div", "battle-actors");
        win.querySelector(".battle-field").appendChild(actorArea);
        actorSprs = G.party.map((a) => {
          const wrap = el("div", "actor-spr");
          const ci = Assets.charsetIndex(a.charset);
          if (ci >= 0) {
            // copy the cached frame — the cache canvas itself must stay off-DOM
            const c = document.createElement("canvas");
            c.width = c.height = TILE;
            c.getContext("2d").drawImage(
              Assets.charFrameCanvas(ci, 1, 1),
              0,
              0,
            ); // facing left
            wrap.appendChild(c);
          }
          wrap.appendChild(el("div", "actor-name", esc(a.name)));
          wrap.appendChild(el("div", "battler-states"));
          actorArea.appendChild(wrap);
          return wrap;
        });
      }
      // Battle effects use a fixed pool so repeated multi-target skills do not
      // continually allocate and discard DOM nodes.
      const particlePool = Array.from({ length: 84 }, () => {
        const p = el("i", "fx-particle");
        p._busy = false;
        fxLayer.appendChild(p);
        return p;
      });
      function takeParticle(cls) {
        const p = particlePool.find((node) => !node._busy) || particlePool[0];
        p.getAnimations().forEach((a) => a.cancel());
        p._busy = true;
        p.className = "fx-particle " + (cls || "");
        p.style.cssText = "";
        return p;
      }
      function releaseParticle(p) {
        p._busy = false;
        p.className = "fx-particle";
        p.style.cssText = "";
        p.textContent = "";
      }
      function fxPoint(target) {
        const wr = win.getBoundingClientRect();
        if (!target) return { x: wr.width * 0.5, y: wr.height * 0.42 };
        const r = target.getBoundingClientRect();
        return {
          x: r.left - wr.left + r.width * 0.5,
          y: r.top - wr.top + r.height * 0.43,
        };
      }
      function actorElement(a) {
        const i = G.party.indexOf(a);
        return actorSprs[i] || partyArea.children[i] || partyArea;
      }
      function battlerElement(b) {
        return b && b.d ? sprs[b.i] : actorElement(b);
      }
      function burst(target, kind, opts) {
        opts = opts || {};
        const pt = fxPoint(target);
        const colors = {
          hit: ["#fff4cf", "#ffc85a", "#ef694f"],
          crit: ["#ffffff", "#ffe45c", "#ff6b45"],
          fire: ["#fff08a", "#ff9d36", "#e84931"],
          ice: ["#eaffff", "#8edcff", "#5b8cff"],
          thunder: ["#ffffff", "#fff36b", "#77dfff"],
          heal: ["#efffcf", "#79e8a2", "#42cfd0"],
          poison: ["#e5a2ff", "#9c54cf", "#5d338d"],
          status: ["#ffffff", "#d6a3ff", "#8f72e6"],
          death: ["#ffffff", "#9ea8c4", "#4c526b"],
          item: ["#ffffff", "#8edfff", "#ffd76d"],
          dust: ["#d8c39d", "#a88d67", "#73624f"],
        };
        const palette = colors[kind] || [opts.color || "#ffffff"];
        const count =
          opts.count || (kind === "crit" || kind === "death" ? 18 : 11);
        for (let i = 0; i < count; i++) {
          const p = takeParticle("fx-" + kind);
          const angle = Math.random() * Math.PI * 2;
          const distance = (opts.radius || 42) * (0.45 + Math.random() * 0.7);
          const dx = Math.cos(angle) * distance;
          const dy = Math.sin(angle) * distance - (kind === "heal" ? 20 : 0);
          const size = (opts.size || 7) * (0.65 + Math.random() * 0.7);
          p.style.left = pt.x + "px";
          p.style.top = pt.y + "px";
          p.style.width = size + "px";
          p.style.height = size + "px";
          p.style.background = opts.color || palette[i % palette.length];
          p.style.boxShadow =
            "0 0 " + Math.ceil(size * 1.8) + "px currentColor";
          const anim = p.animate(
            [
              {
                opacity: 0,
                transform: "translate(-50%,-50%) scale(0.2) rotate(0deg)",
              },
              { opacity: 1, offset: 0.18 },
              {
                opacity: 0,
                transform:
                  "translate(calc(-50% + " +
                  dx +
                  "px),calc(-50% + " +
                  dy +
                  "px)) scale(0.05) rotate(" +
                  (180 + rnd(220)) +
                  "deg)",
              },
            ],
            {
              duration: opts.duration || 470,
              easing: "cubic-bezier(.18,.75,.25,1)",
            },
          );
          anim.finished
            .then(() => releaseParticle(p))
            .catch(() => releaseParticle(p));
        }
      }
      function floatText(target, text, kind) {
        const p = takeParticle(
          "fx-number " + (kind ? "fx-number-" + kind : ""),
        );
        const pt = fxPoint(target);
        p.textContent = text;
        p.style.left = pt.x + "px";
        p.style.top = pt.y - 12 + "px";
        const anim = p.animate(
          [
            { opacity: 0, transform: "translate(-50%,0) scale(.65)" },
            {
              opacity: 1,
              transform: "translate(-50%,-12px) scale(1.12)",
              offset: 0.2,
            },
            {
              opacity: 1,
              transform: "translate(-50%,-28px) scale(1)",
              offset: 0.72,
            },
            { opacity: 0, transform: "translate(-50%,-48px) scale(.9)" },
          ],
          { duration: 720, easing: "ease-out" },
        );
        anim.finished
          .then(() => releaseParticle(p))
          .catch(() => releaseParticle(p));
      }
      function pulse(kind, color) {
        const p = takeParticle("fx-pulse fx-" + kind);
        p.style.left = "50%";
        p.style.top = "43%";
        p.style.borderColor = color || "#ffffff";
        const anim = p.animate(
          [
            { opacity: 0.8, transform: "translate(-50%,-50%) scale(.1)" },
            { opacity: 0, transform: "translate(-50%,-50%) scale(8)" },
          ],
          { duration: 440, easing: "ease-out" },
        );
        anim.finished
          .then(() => releaseParticle(p))
          .catch(() => releaseParticle(p));
      }
      function skillKind(skill) {
        if (!skill) return "hit";
        const name = String(skill.name || "").toLowerCase();
        if (skill.type === "heal") return "heal";
        if (skill.type === "phys") return "crit";
        if (name.includes("fire") || name.includes("ember")) return "fire";
        if (name.includes("ice")) return "ice";
        if (name.includes("thunder") || name.includes("static"))
          return "thunder";
        if (
          name.includes("venom") ||
          name.includes("spore") ||
          skill.stateId === 1
        )
          return "poison";
        return "status";
      }
      async function travel(source, target, skill) {
        if (!skill || skill.type === "phys" || skill.type === "heal") return;
        const from = fxPoint(source),
          to = fxPoint(target);
        const p = takeParticle("fx-projectile fx-" + skillKind(skill));
        p.style.left = from.x + "px";
        p.style.top = from.y + "px";
        p.style.background = skill.color || "#ffffff";
        const anim = p.animate(
          [
            { opacity: 0, transform: "translate(-50%,-50%) scale(.4)" },
            { opacity: 1, offset: 0.12 },
            {
              opacity: 1,
              transform:
                "translate(calc(-50% + " +
                (to.x - from.x) +
                "px),calc(-50% + " +
                (to.y - from.y) +
                "px)) scale(1.3)",
              offset: 0.88,
            },
            {
              opacity: 0,
              transform:
                "translate(calc(-50% + " +
                (to.x - from.x) +
                "px),calc(-50% + " +
                (to.y - from.y) +
                "px)) scale(2)",
            },
          ],
          { duration: 330, easing: "cubic-bezier(.2,.7,.3,1)" },
        );
        await anim.finished.catch(() => {});
        releaseParticle(p);
      }
      function castFx(source, skill, targetCount) {
        const kind = skillKind(skill);
        burst(source, kind, {
          count: 8,
          radius: 30,
          color: skill && skill.color,
        });
        if (targetCount > 1) pulse(kind, skill && skill.color);
      }
      function refreshParty() {
        partyArea.innerHTML = G.party
          .map(
            (a) =>
              '<div class="brow' +
              (a.hp <= 0 ? " dead" : "") +
              '"><b>' +
              esc(a.name) +
              "</b> " +
              "HP " +
              a.hp +
              "/" +
              param(a, "mhp") +
              " " +
              bar(a.hp, param(a, "mhp"), "#58c46a") +
              " MP " +
              a.mp +
              "/" +
              param(a, "mmp") +
              " " +
              bar(a.mp, param(a, "mmp"), "#5a8ad8") +
              stateTagsHtml(a) +
              "</div>",
          )
          .join("");
        actorSprs.forEach((w, i) => {
          const a = G.party[i];
          if (a) w.classList.toggle("dead", a.hp <= 0);
        });
      }
      function refreshEnemies() {
        enemies.forEach((en, i) => {
          sprs[i].classList.toggle("dead", !en.alive);
        });
      }
      async function say(text, ms) {
        log.textContent = text;
        await sleep(ms == null ? 650 : ms);
      }
      function flash(i) {
        sprs[i].classList.remove("flash");
        void sprs[i].offsetWidth;
        sprs[i].classList.add("flash");
      }
      const livingE = () => enemies.filter((e) => e.alive);
      const livingP = () => G.party.filter((a) => a.hp > 0);
      function variance(v) {
        return Math.max(1, Math.floor(v * (0.85 + Math.random() * 0.3)));
      }

      async function pickTarget() {
        const live = livingE();
        if (live.length === 1) return live[0];
        const i = await showList(
          live.map((en) => ({ label: en.d.name + "  (HP " + en.hp + ")" })),
          { className: "targetwin" },
        );
        return i < 0 ? null : live[i];
      }
      async function pickAlly(deadOk) {
        const pool = deadOk ? G.party : livingP();
        const i = await showList(
          pool.map((a) => ({ label: a.name + "  (HP " + a.hp + ")" })),
          { className: "targetwin" },
        );
        return i < 0 ? null : pool[i];
      }

      async function actorCommand(a) {
        while (true) {
          const items = [
            { html: Assets.iconHtml(48, "menu-icon") + "Attack" },
            {
              html: Assets.iconHtml(8, "menu-icon") + "Skills",
              disabled: !learnedSkills(a).length,
            },
            {
              html: Assets.iconHtml(24, "menu-icon") + "Items",
              disabled: !proj.items.some((it) => invCount("item", it.id) > 0),
            },
            { html: Assets.iconHtml(22, "menu-icon") + "Guard" },
            {
              html: Assets.iconHtml(7, "menu-icon") + "Escape",
              disabled: !canEscape,
            },
          ];
          const i = await showList(items, {
            title: a.name,
            className: "cmdwin",
            cancellable: false,
          });
          if (i === 0) {
            const t = await pickTarget();
            if (t) return { type: "attack", target: t };
          } else if (i === 1) {
            const skills = learnedSkills(a);
            const si = await showList(
              skills.map((s) => ({
                html:
                  iconEntryHtml(s) +
                  ' <span class="cnt">' +
                  skillMpCost(a, s) +
                  " MP</span>",
                disabled: a.mp < skillMpCost(a, s),
              })),
              { title: "Skill", className: "cmdwin" },
            );
            if (si < 0) continue;
            const s = skills[si];
            if (s.scope === "enemy") {
              const t = await pickTarget();
              if (t) return { type: "skill", skill: s, target: t };
            } else if (s.scope === "ally") {
              const t = await pickAlly(false);
              if (t) return { type: "skill", skill: s, target: t };
            } else {
              return { type: "skill", skill: s };
            }
          } else if (i === 2) {
            const list = proj.items.filter((it) => invCount("item", it.id) > 0);
            const ii = await showList(
              list.map((it) => ({
                html:
                  iconEntryHtml(it) +
                  ' <span class="cnt">×' +
                  invCount("item", it.id) +
                  "</span>",
              })),
              { title: "Item", className: "cmdwin" },
            );
            if (ii < 0) continue;
            const t = await pickAlly(false);
            if (t) return { type: "item", item: list[ii], target: t };
          } else if (i === 3) {
            return { type: "guard" };
          } else if (i === 4) {
            return { type: "escape" };
          }
        }
      }

      function enemyAction(en) {
        const acts =
          en.d.actions && en.d.actions.length
            ? en.d.actions
            : [{ skillId: 0, weight: 1 }];
        let total = acts.reduce((s, a2) => s + (a2.weight || 1), 0);
        let roll = Math.random() * total;
        let chosen = acts[0];
        for (const a2 of acts) {
          roll -= a2.weight || 1;
          if (roll <= 0) {
            chosen = a2;
            break;
          }
        }
        const skill = chosen.skillId
          ? RA.byId(proj.skills, chosen.skillId)
          : null;
        return { type: skill ? "skill" : "attack", skill, enemy: en };
      }

      async function dealToEnemy(en, dmg, idx, kind) {
        const target = sprs[idx];
        const wasAlive = en.alive;
        en.hp -= dmg;
        flash(idx);
        burst(target, kind || "hit", {
          color: kind === "poison" ? "#a050d8" : null,
        });
        floatText(target, "-" + dmg, kind === "crit" ? "crit" : "damage");
        if (en.hp <= 0) {
          en.hp = 0;
          en.alive = false;
        }
        refreshEnemies();
        if (wasAlive && !en.alive) {
          onEnemyKilled(en.d.id);
          burst(target, "death", { count: 22, radius: 62, duration: 650 });
          floatText(target, "DEFEATED", "death");
        }
      }
      function actorDef(a) {
        return param(a, "def");
      }

      // ---- states (poison / stun / regen…) ----
      const stateDef = (id) => RA.byId(proj.states || [], id);
      const statesOf = (b) => b.states || (b.states = []);
      const isEnemy = (b) => !!b.d;
      const nameOf = (b) => (isEnemy(b) ? b.d.name : b.name);
      const maxHpOf = (b) => (isEnemy(b) ? b.d.stats.mhp : param(b, "mhp"));
      const aliveB = (b) => (isEnemy(b) ? b.alive : b.hp > 0);
      function cannotAct(b) {
        return statesOf(b).some((st) => {
          const d = stateDef(st.id);
          return d && d.restrict === "act";
        });
      }
      function stateTagsHtml(b) {
        return statesOf(b)
          .map((st) => {
            const d = stateDef(st.id);
            return d
              ? ' <span class="state-tag" style="color:' +
                  esc(d.color || "#e8e8f4") +
                  '">' +
                  esc(d.name) +
                  "</span>"
              : "";
          })
          .join("");
      }
      function refreshStates() {
        enemies.forEach((en, i) => {
          const slot = sprs[i].querySelector(".battler-states");
          if (slot) slot.innerHTML = stateTagsHtml(en);
        });
        actorSprs.forEach((w, i) => {
          const a = G.party[i],
            slot = w.querySelector(".battler-states");
          if (a && slot) slot.innerHTML = stateTagsHtml(a);
        });
        refreshParty();
      }
      async function addStateTo(b, stateId) {
        const d = stateDef(stateId);
        if (!d || !aliveB(b)) return;
        const min = Math.max(1, d.minTurns || 1);
        const max = Math.max(min, d.maxTurns || min);
        const turns = min + rnd(max - min + 1);
        const list = statesOf(b);
        const ex = list.find((st) => st.id === stateId);
        if (ex) ex.turns = Math.max(ex.turns, turns);
        else list.push({ id: stateId, turns });
        burst(battlerElement(b), stateId === 1 ? "poison" : "status", {
          color: d.color,
        });
        floatText(battlerElement(b), d.name.toUpperCase(), "state");
        refreshStates();
        await say(nameOf(b) + " is afflicted by " + d.name + "!", 600);
      }
      async function removeStateFrom(b, stateId) {
        const d = stateDef(stateId);
        const list = statesOf(b);
        const i = list.findIndex((st) => st.id === stateId);
        if (i < 0) return;
        list.splice(i, 1);
        burst(battlerElement(b), "heal", { color: d && d.color, count: 8 });
        refreshStates();
        if (d) await say(nameOf(b) + " is cured of " + d.name + ".", 600);
      }
      // roll a skill's state effect against a target
      async function applySkillState(skill, target) {
        if (!skill || !skill.stateId || !aliveB(target)) return;
        if (skill.stateOp === "remove") {
          await removeStateFrom(target, skill.stateId);
          return;
        }
        let chance = skill.stateChance == null ? 100 : skill.stateChance;
        if (!isEnemy(target))
          chance *= RA.traitRate(
            actorClass(target),
            "state",
            String(skill.stateId),
            1,
          );
        if (rnd(100) < chance) await addStateTo(target, skill.stateId);
      }
      // end-of-round damage/regen ticks and turn-count expiry
      async function tickStates() {
        for (const b of [...livingP(), ...livingE()]) {
          for (const st of statesOf(b).slice()) {
            const d = stateDef(st.id);
            const list = statesOf(b);
            if (!d) {
              list.splice(list.indexOf(st), 1);
              continue;
            }
            if (d.hpTurn && aliveB(b)) {
              let amt = Math.max(
                1,
                Math.floor((maxHpOf(b) * Math.abs(d.hpTurn)) / 100),
              );
              if (d.hpTurn < 0) {
                if (isEnemy(b))
                  await dealToEnemy(b, amt, b.i, d.id === 1 ? "poison" : "hit");
                else {
                  const tickElement = d.id === 1 ? "poison" : "magic";
                  amt = Math.max(
                    1,
                    Math.floor(amt * actorIncomingRate(b, tickElement, false)),
                  );
                  b.hp = Math.max(0, b.hp - amt);
                  actorFlash(b);
                  burst(battlerElement(b), d.id === 1 ? "poison" : "hit", {
                    color: d.color,
                  });
                  floatText(battlerElement(b), "-" + amt, "damage");
                }
                await say(
                  nameOf(b) + " takes " + amt + " damage from " + d.name + "!",
                  550,
                );
                if (isEnemy(b) && !b.alive)
                  await say(b.d.name + " is defeated!", 450);
                if (!isEnemy(b) && b.hp <= 0)
                  await say(b.name + " falls!", 500);
              } else {
                b.hp = Math.min(maxHpOf(b), b.hp + amt);
                burst(battlerElement(b), "heal", { color: d.color });
                floatText(battlerElement(b), "+" + amt, "heal");
                await say(
                  nameOf(b) + " recovers " + amt + " HP from " + d.name + "!",
                  550,
                );
              }
              refreshParty();
              refreshEnemies();
            }
            st.turns--;
            if (st.turns <= 0) {
              list.splice(list.indexOf(st), 1);
              await say(nameOf(b) + "'s " + d.name + " wore off.", 500);
            }
          }
        }
        refreshStates();
      }
      // ---- side-view battler animations ----
      function actorFlash(a) {
        const w = actorSprs[G.party.indexOf(a)];
        if (!w) return;
        w.classList.remove("hurt");
        void w.offsetWidth;
        w.classList.add("hurt");
      }
      function actorStep(a) {
        const w = actorSprs[G.party.indexOf(a)];
        if (!w) return;
        w.classList.add("acting");
        burst(w, "dust", { count: 5, radius: 20, size: 5, duration: 330 });
        setTimeout(() => w.classList.remove("acting"), 380);
      }
      function enemyStep(en) {
        if (!sideView || !sprs[en.i]) return;
        sprs[en.i].classList.add("acting");
        burst(sprs[en.i], "dust", {
          count: 5,
          radius: 20,
          size: 5,
          duration: 330,
        });
        setTimeout(() => sprs[en.i].classList.remove("acting"), 380);
      }

      let result = null;
      try {
        await say("Enemies appear!", 700);
        battleLoop: while (true) {
          refreshParty();
          refreshEnemies();
          // ---- collect party commands ----
          const cmds = [];
          for (const a of livingP()) {
            refreshParty();
            if (cannotAct(a)) {
              cmds.push({ type: "stunned", actor: a });
              continue;
            }
            const c = await actorCommand(a);
            c.actor = a;
            if (c.type === "escape") {
              const pa =
                livingP().reduce((s, x) => s + param(x, "agi"), 0) /
                livingP().length;
              const ea =
                livingE().reduce((s, x) => s + x.d.stats.agi, 0) /
                livingE().length;
              const chance = clamp(0.55 + (pa - ea) * 0.03, 0.2, 0.95);
              if (Math.random() < chance) {
                sysSe("escape");
                await say("Got away safely!", 800);
                result = "escape";
                break battleLoop;
              } else {
                await say("Couldn't escape!", 700);
                cmds.length = 0;
                break; // enemies still act
              }
            }
            cmds.push(c);
          }
          const guards = new Set(
            cmds.filter((c) => c.type === "guard").map((c) => c.actor),
          );
          // ---- enemy commands ----
          for (const en of livingE()) cmds.push(enemyAction(en));
          // ---- sort by agility ----
          cmds.sort((x, y) => {
            const ax = x.actor ? param(x.actor, "agi") : x.enemy.d.stats.agi;
            const ay = y.actor ? param(y.actor, "agi") : y.enemy.d.stats.agi;
            return (
              ay * (0.8 + Math.random() * 0.4) -
              ax * (0.8 + Math.random() * 0.4)
            );
          });

          for (const c of cmds) {
            if (c.actor && c.actor.hp <= 0) continue;
            if (c.enemy && !c.enemy.alive) continue;
            if (c.actor) {
              // ---------- party side ----------
              const a = c.actor;
              if (c.type === "stunned") {
                await say(a.name + " can't move!", 500);
                continue;
              }
              if (c.type === "guard") {
                burst(actorElement(a), "status", {
                  color: "#9ab8f0",
                  count: 10,
                  radius: 30,
                });
                floatText(actorElement(a), "GUARD", "state");
                await say(a.name + " guards.", 450);
                continue;
              }
              if (c.type === "item") {
                if (invCount("item", c.item.id) <= 0) continue;
                actorStep(a);
                useItemOn(c.item, c.target);
                burst(actorElement(c.target), "item", { count: 13 });
                floatText(
                  actorElement(c.target),
                  c.item.hp ? "+" + c.item.hp : "+" + c.item.mp + " MP",
                  "heal",
                );
                refreshParty();
                await say(
                  a.name +
                    " uses " +
                    c.item.name +
                    " on " +
                    c.target.name +
                    "!",
                );
                continue;
              }
              if (
                c.type === "attack" ||
                (c.type === "skill" && c.skill.scope === "enemy") ||
                (c.type === "skill" && c.skill.scope === "enemies")
              ) {
                const skill = c.type === "skill" ? c.skill : null;
                if (skill) {
                  const cost = skillMpCost(a, skill);
                  if (a.mp < cost) continue;
                  a.mp -= cost;
                }
                const targets =
                  skill && skill.scope === "enemies"
                    ? livingE().slice()
                    : [
                        c.target && c.target.alive ? c.target : livingE()[0],
                      ].filter(Boolean);
                actorStep(a);
                if (skill) castFx(actorElement(a), skill, targets.length);
                for (const t of targets) {
                  let dmg;
                  const critical =
                    (!skill || skill.type === "phys") &&
                    rnd(100) <
                      RA.traitSum(actorClass(a), "special", "critChance", 0);
                  if (!skill) {
                    dmg = variance(param(a, "atk") * 2 - t.d.stats.def * 1.2);
                    Sfx.play(critical ? "crit" : "hit");
                  } else if (skill.type === "phys") {
                    dmg = variance(
                      (skill.power +
                        param(a, "atk") * 2 -
                        t.d.stats.def * 1.2) *
                        skillPowerRate(a, skill),
                    );
                    Sfx.play("crit");
                  } else {
                    dmg = variance(
                      (skill.power +
                        param(a, "mat") * 2 -
                        t.d.stats.mdf * 1.5) *
                        skillPowerRate(a, skill),
                    );
                    Sfx.play("magic");
                  }
                  if (critical) dmg = Math.max(1, Math.floor(dmg * 1.5));
                  await travel(actorElement(a), sprs[t.i], skill);
                  await dealToEnemy(
                    t,
                    dmg,
                    t.i,
                    critical ? "crit" : skillKind(skill),
                  );
                  await say(
                    a.name +
                      (skill ? " casts " + skill.name : " attacks") +
                      " — " +
                      t.d.name +
                      " takes " +
                      dmg +
                      "!",
                    550,
                  );
                  if (!t.alive) await say(t.d.name + " is defeated!", 450);
                  await applySkillState(skill, t);
                }
              } else if (
                c.type === "skill" &&
                (c.skill.scope === "ally" || c.skill.scope === "allies")
              ) {
                const cost = skillMpCost(a, c.skill);
                if (a.mp < cost) continue;
                a.mp -= cost;
                const targets =
                  c.skill.scope === "allies" ? livingP() : [c.target];
                Sfx.play("heal");
                actorStep(a);
                castFx(actorElement(a), c.skill, targets.length);
                for (const t of targets) {
                  const amount = variance(
                    (c.skill.power + param(a, "mat") * 1.2) *
                      skillPowerRate(a, c.skill),
                  );
                  t.hp = clamp(t.hp + amount, 0, param(t, "mhp"));
                  burst(actorElement(t), "heal", {
                    color: c.skill.color,
                    count: 14,
                  });
                  floatText(actorElement(t), "+" + amount, "heal");
                  await say(
                    a.name +
                      " casts " +
                      c.skill.name +
                      " — " +
                      t.name +
                      " recovers " +
                      amount +
                      " HP!",
                    550,
                  );
                  await applySkillState(c.skill, t);
                }
                refreshParty();
              }
            } else {
              // ---------- enemy side ----------
              const en = c.enemy;
              if (cannotAct(en)) {
                await say(en.d.name + " can't move!", 500);
                continue;
              }
              const pool = livingP();
              if (!pool.length) break;
              const t = pool[rnd(pool.length)];
              enemyStep(en);
              let dmg;
              if (c.skill && c.skill.type !== "heal") {
                const atkStat =
                  c.skill.type === "phys" ? en.d.stats.atk : en.d.stats.mat;
                const defStat =
                  c.skill.type === "phys" ? actorDef(t) : param(t, "mdf") * 1.5;
                dmg = variance(c.skill.power + atkStat * 2 - defStat);
                dmg = Math.max(
                  1,
                  Math.floor(
                    dmg *
                      actorIncomingRate(
                        t,
                        skillElement(c.skill),
                        guards.has(t),
                      ),
                  ),
                );
                Sfx.play(c.skill.type === "phys" ? "hit" : "magic");
                castFx(sprs[en.i], c.skill, 1);
                await travel(sprs[en.i], actorElement(t), c.skill);
                await say(
                  en.d.name +
                    " uses " +
                    c.skill.name +
                    " — " +
                    t.name +
                    " takes " +
                    dmg +
                    "!",
                  550,
                );
              } else {
                dmg = variance(en.d.stats.atk * 2 - actorDef(t) * 1.2);
                dmg = Math.max(
                  1,
                  Math.floor(
                    dmg * actorIncomingRate(t, "physical", guards.has(t)),
                  ),
                );
                Sfx.play("hit");
                await say(
                  en.d.name + " attacks — " + t.name + " takes " + dmg + "!",
                  550,
                );
              }
              t.hp = Math.max(0, t.hp - dmg);
              actorFlash(t);
              burst(actorElement(t), skillKind(c.skill), {
                color: c.skill && c.skill.color,
              });
              floatText(
                actorElement(t),
                "-" + dmg,
                c.skill && c.skill.type === "phys" ? "crit" : "damage",
              );
              if (t.hp <= 0) {
                burst(actorElement(t), "death", { count: 20, radius: 55 });
                floatText(actorElement(t), "FALLEN", "death");
              }
              win.classList.remove("shake");
              void win.offsetWidth;
              win.classList.add("shake");
              refreshParty();
              if (t.hp <= 0) await say(t.name + " falls!", 500);
              if (c.skill) await applySkillState(c.skill, t);
            }
            if (!livingE().length || !livingP().length) break;
          }
          if (livingE().length && livingP().length) await tickStates();
          if (!livingP().length) {
            result = "lose";
            break;
          }
          if (!livingE().length) {
            result = "win";
            break;
          }
        }

        if (result === "win") {
          const exp = enemies.reduce((s, e) => s + (e.d.exp || 0), 0);
          const gold = enemies.reduce((s, e) => s + (e.d.gold || 0), 0);
          Music.stop();
          sysSe("levelup");
          const lines = [];
          await say(
            "Victory!  +" + exp + " EXP, +" + gold + " " + proj.system.currency,
            900,
          );
          G.gold = clamp(G.gold + gold, 0, 9999999);
          for (const a of livingP()) gainExp(a, exp, (m) => lines.push(m));
          refreshParty();
          for (const m of lines) await say(m, 800);
        } else if (result === "lose") {
          noteBattleFailure(troopId, troop.enemies.map((id) => Number(id) || 0));
          await say("The party has fallen...", 1100);
        }
      } finally {
        // shed battle-only states (poison etc. configured to clear after battle)
        for (const a of G.party) {
          if (a.states)
            a.states = a.states.filter((st) => {
              const d = stateDef(st.id);
              return d && !d.removeAtEnd;
            });
        }
        win.remove();
        scene = prevScene;
        if (result !== "lose")
          Music.play(prevMusic || (map && map.music) || "none");
      }
      return result || "win";
    },
  };

  // ============================ title / gameover ============================
  // initPlayer / refreshPlayerCharset live in ./scenes/map-runtime.ts.

  async function newGame() {
    commonParallels.clear();
    G.switches = {};
    G.vars = {};
    G.selfSw = {};
    G.quests = {};
    G.gold = proj.system.startGold || 0;
    G.inv = { item: {}, weapon: {}, armor: {} };
    G.party = (proj.system.party || [])
      .slice(0, 4)
      .map(makeActor)
      .filter(Boolean);
    if (!G.party.length && proj.actors.length)
      G.party = [makeActor(proj.actors[0].id)];
    G.steps = 0;
    cameraZoom = 1;
    initPlayer(proj.system.startX, proj.system.startY, proj.system.startDir);
    G.player.transparent = !!proj.system.startTransparent;
    await loadMap(proj.system.startMapId);
    scene = "map";
  }

  async function toTitle() {
    await fadeTo(1, 350);
    scene = "title";
    // clear leftover UI
    while (UIStack.length) removeUI(UIStack[UIStack.length - 1]);
    uiLayer
      .querySelectorAll(".battlewin, .menupanel")
      .forEach((n) => n.remove());
    showTitle();
    await fadeTo(0, 350);
  }

  async function showTitle() {
    Music.play(sysBgm("title"));
    const tw = el("div", "titlewin");
    tw.appendChild(
      el("div", "title-name", esc(proj.system.title || "Untitled")),
    );
    tw.appendChild(el("div", "title-sub", "made with RPGAtlas"));
    uiLayer.appendChild(tw);
    // decorative title backdrop on the canvas
    drawTitleBackdrop();
    while (true) {
      const hasSave = [1, 2, 3].some((s) => slotInfo(s));
      const i = await showList(
        [
          { label: "New Game" },
          { label: "Continue", disabled: !hasSave },
          { label: "Options" },
        ],
        { className: "titlemenu", cancellable: false },
      );
      if (i === 0) {
        tw.remove();
        await fadeTo(1, 300);
        await newGame();
        await render();
        await fadeTo(0, 300);
        return;
      } else if (i === 1) {
        const ok2 = await saveLoadMenu("load");
        if (ok2) {
          tw.remove();
          await render();
          await fadeTo(0, 300);
          return;
        }
      } else if (i === 2) {
        await optionsMenu();
      }
    }
  }
  function drawTitleBackdrop() {
    const g = ctx;
    const grad = g.createLinearGradient(0, 0, 0, SCREEN_H);
    grad.addColorStop(0, "#1a2340");
    grad.addColorStop(1, "#2c4a3a");
    g.fillStyle = grad;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // procedural hills + trees
    g.fillStyle = "#22382c";
    g.beginPath();
    g.moveTo(0, SCREEN_H);
    for (let x = 0; x <= SCREEN_W; x += 40) {
      g.lineTo(x, SCREEN_H - 90 - 40 * Math.sin(x / 130));
    }
    g.lineTo(SCREEN_W, SCREEN_H);
    g.fill();
    for (let i = 0; i < 9; i++) {
      const x = 40 + i * 88,
        y = SCREEN_H - 60 - 30 * Math.sin(x / 130);
      Assets.drawTile(g, Assets.T.pine, x, y - 30);
    }
    g.fillStyle = "rgba(255,255,230,0.85)";
    for (let i = 0; i < 40; i++) {
      g.fillRect((i * 211) % SCREEN_W, (i * 137) % (SCREEN_H - 200), 2, 2);
    }
    // faint compass-rose watermark (the RPGAtlas motif)
    g.save();
    g.translate(SCREEN_W - 120, 130);
    g.globalAlpha = 0.16;
    g.strokeStyle = g.fillStyle = "#ffe2a0";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, 70, 0, 6.2832);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 56, 0, 6.2832);
    g.stroke();
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(0, -64);
      g.lineTo(9, 0);
      g.lineTo(0, 64);
      g.lineTo(-9, 0);
      g.closePath();
      g.fill();
      g.rotate(Math.PI / 4);
      g.globalAlpha = i % 2 === 0 ? 0.09 : 0.16; // diagonals fainter than cardinals
    }
    g.restore();
  }

  async function gameOver() {
    scene = "gameover";
    Music.stop();
    sysSe("gameover");
    const gw = el(
      "div",
      "gameoverwin",
      "<div>GAME OVER</div><div class='go-sub'>press confirm</div>",
    );
    uiLayer.appendChild(gw);
    await new Promise((resolve) => {
      const ui = {
        el: gw,
        onKey(k) {
          if (k === "ok") {
            removeUI(ui);
            resolve();
          }
        },
      };
      gw.addEventListener("click", () => {
        removeUI(ui);
        resolve();
      });
      pushUI(ui);
    });
    await toTitle();
  }

  // ============================ interpreter services ============================
  // The closure-state bridge onto the shared engine context (EC) is installed
  // near the top of this IIFE (before any extracted module's init can write
  // through it); see "closure-state bridge" above.
  // The service surface the extracted command handlers call. It bridges the
  // registry (src/engine/interpreter/) back to this closure's functions and
  // mutable scalars. Late-bound values (message-system fns; camera/shake/flash
  // scalars that are reassigned) are exposed via getters/setters so handlers
  // always see live state — identical to referencing the closure `let`s
  // directly, as the old switch did.
  const EngineServices = {
    ctx: EC,
    // message system (late-bound: reassigned during wiring)
    get showMessage() { return showMessage; },
    get richText() { return richText; },
    showList,
    // helpers
    clamp, rnd,
    // deps
    Sfx, Music,
    // state ops
    refreshAllPages, evaluateQuestFailures,
    addInv, makeActor, param,
    getProj: () => proj,
    // quests
    Quests,
    // scripting
    scriptApi,
    // waits / tweens
    waitFrames, frameWait, tickTween,
    // routing / scenes
    setRoute, transferPlayer, saveLoadMenu, gameOver, toTitle,
    // battle / shop
    Battle, Shop,
  };
  // Hand the service surface to the extracted interpreter (Interp.exec passes
  // it to every command handler), and expose Battle to the plugin runtime's
  // atlas.startBattle — both still live in this closure until their sections
  // move out.
  initInterpServices(EngineServices);
  fns.Battle = Battle;
  registerBuiltinCommands();

  // ============================ boot ============================
  function loadProject() {
    if (window.RPGATLAS_PROJECT)
      return RA.migrateProject(RA.clone(window.RPGATLAS_PROJECT));
    try {
      const raw =
        localStorage.getItem("rpgatlas_project") ||
        localStorage.getItem("driftwood_project");
      if (raw) {
        const p = JSON.parse(raw);
        if (
          p &&
          p.meta &&
          (p.meta.engine === "rpgatlas" || p.meta.engine === "driftwood")
        )
          return RA.migrateProject(p);
      }
    } catch (e) {
      console.warn("Stored project unreadable, using sample.", e);
    }
    return DataDefaults.newProject();
  }

  function fitStage() {
    const sw = window.innerWidth / SCREEN_W,
      sh = window.innerHeight / SCREEN_H;
    const maxScale = (proj && Number(proj.system.screenScale)) || 1.6;
    const sc = Math.min(sw, sh, maxScale);
    stage.style.transform = "translate(-50%,-50%) scale(" + sc + ")";
  }

  // Apply System-tab presentation settings: screen size, UI area, fonts,
  // base font size, window opacity, and window color (via CSS variables play.css reads).
  function applyScreenSettings() {
    const s = proj.system;
    SCREEN_W = clamp(Math.floor(Number(s.screenWidth) || 816), 384, 3840);
    SCREEN_H = clamp(Math.floor(Number(s.screenHeight) || 624), 288, 2160);
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    ctx.imageSmoothingEnabled = false;
    stage.style.width = SCREEN_W + "px";
    stage.style.height = SCREEN_H + "px";
    const uw = clamp(Math.floor(Number(s.uiWidth) || 0), 0, SCREEN_W);
    const uh = clamp(Math.floor(Number(s.uiHeight) || 0), 0, SCREEN_H);
    if (uw > 0 || uh > 0) {
      const w = uw || SCREEN_W,
        h2 = uh || SCREEN_H;
      uiLayer.style.inset = "auto";
      uiLayer.style.left = Math.floor((SCREEN_W - w) / 2) + "px";
      uiLayer.style.top = Math.floor((SCREEN_H - h2) / 2) + "px";
      uiLayer.style.width = w + "px";
      uiLayer.style.height = h2 + "px";
    }
    stage.style.setProperty(
      "--font-text",
      s.fontText || '"Segoe UI", system-ui, sans-serif',
    );
    stage.style.setProperty(
      "--font-menu",
      s.fontMenu || s.fontText || '"Segoe UI", system-ui, sans-serif',
    );
    stage.style.setProperty(
      "--font-size",
      clamp(Number(s.fontSize) || 15, 8, 48) + "px",
    );
    stage.style.setProperty(
      "--win-op",
      clamp(s.windowOpacity == null ? 93 : Number(s.windowOpacity), 0, 100) /
        100,
    );
    const windowPalette = RA.windowColorPalette(s.windowColor);
    stage.style.setProperty("--win-top-rgb", windowPalette.top);
    stage.style.setProperty("--win-bottom-rgb", windowPalette.bottom);
    stage.style.setProperty("--win-name-top-rgb", windowPalette.nameTop);
    stage.style.setProperty("--win-name-bottom-rgb", windowPalette.nameBottom);
  }

  async function boot() {
    stage = document.getElementById("stage");
    canvas = document.getElementById("gamecanvas");
    ctx = canvas.getContext("2d");
    uiLayer = el("div", "uilayer");
    stage.appendChild(uiLayer);
    fader = el("div", "fader");
    stage.appendChild(fader);
    fader.style.opacity = 0;
    document.title = "RPGAtlas Player";

    window.addEventListener("error", (e) => {
      const box = el(
        "div",
        "errbox",
        "<b>Error:</b> " +
          esc(e.message) +
          "<br><small>" +
          esc((e.filename || "") + ":" + e.lineno) +
          "</small>",
      );
      stage.appendChild(box);
      setTimeout(() => box.remove(), 8000);
    });

    proj = loadProject();
    // Apply author-default bindings, with the player's saved per-device overrides merged
    // on top, and restore the persisted music preference (before any Music.play()).
    playerOptions = loadOptions();
    // One-time migration: the old "Music: On/Off" toggle became the Music Volume slider, so a
    // pre-mixer save with music disabled maps to BGM volume 0 (and we drop the dead `music` key).
    // Runs before `av` is captured below — otherwise this boot would still apply BGM volume 1.
    if (
      playerOptions.music &&
      playerOptions.music.enabled === false &&
      (playerOptions.audio == null || playerOptions.audio.bgm == null)
    ) {
      playerOptions.audio = Object.assign({}, playerOptions.audio, { bgm: 0 });
      delete playerOptions.music;
      saveOptions();
    }
    Input.setBindings(RA.mergeInputBindings(proj.system.input, playerOptions.input || null));
    // Restore saved audio mix + text speed.
    const av = playerOptions.audio || {};
    Sfx.setMasterVolume(av.master == null ? 1 : av.master);
    Sfx.setBgmVolume(av.bgm == null ? 1 : av.bgm);
    Sfx.setSeVolume(av.se == null ? 1 : av.se);
    if (setMsgSpeed && playerOptions.textSpeed) setMsgSpeed(playerOptions.textSpeed);
    applyScreenSettings();
    window.addEventListener("resize", fitStage);
    fitStage();
    Assets.registerCustomChars(proj.customChars);
    await Promise.all([Assets.loadIconSet(), Assets.loadExternalAssets(proj)]);
    Plugins.runAll();
    document.title = (proj.system.title || "RPGAtlas") + " — RPGAtlas Player";
    scene = "title";
    showTitle();
    requestAnimationFrame(loop);   // kick off via rAF so loop() receives a real timestamp

    // unlock audio on first interaction
    const unlock = () => {
      Sfx.play("cursor");
      document.removeEventListener("pointerdown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
  }
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
