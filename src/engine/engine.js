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
import { saveLoadMenu, slotInfo } from "./state/save.js";
import {
  initJournalView,
  optionsMenu,
  useItemOn,
  iconEntryHtml,
  bar,
} from "./scenes/menus.js";
import { Shop } from "./scenes/shop.js";
import { Battle } from "./scenes/battle.js";
import { toTitle, showTitle } from "./scenes/title.js";
import { gameOver } from "./scenes/gameover.js";
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
  // The fns forward-ref registry entries (refreshAllPages, openMenu, Battle,
  // Plugins, gameOver, toTitle) are all self-installed by their extracted
  // modules now; this closure no longer contributes any.
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
  // The in-game menus (pause menu, options + controls rebinding, item/skill/
  // equip/status flows, journal wiring, party-row HTML helpers) live in
  // ./scenes/menus.ts (Phase 1 Stage B), imported above. initJournalView()
  // runs here — the exact point the monolith created the journal view, after
  // the quest runtime and message system exist.
  initJournalView();

  // ---- player options (per-player overrides: input rebinds + audio/game settings) ----
  // The option store and its setters live in ./state/player-options.ts; the
  // menus live in ./scenes/menus.ts. These closure `let`s stay the bridged
  // source of truth until boot.ts owns the context fields.
  let playerOptions = {};
  let dashLatch = false;
  let dashPrev = false;

  // ---- save / load ----
  // saveKey/slotInfo/saveLoadMenu/applySave live in ./state/save.ts (Phase 1
  // Stage B), imported above.

  // ============================ shop ============================
  // The shop scene lives in ./scenes/shop.ts (Phase 1 Stage B), imported above.

  // ============================ battle ============================
  // The battle scene lives in ./scenes/battle.ts with its visual effects in
  // ./scenes/battle-fx.ts (Phase 1 Stage B), imported above; it self-installs
  // fns.Battle for the plugin runtime and the map scene's encounters.

  // ============================ title / gameover ============================
  // newGame / toTitle / showTitle / drawTitleBackdrop live in
  // ./scenes/title.ts and gameOver in ./scenes/gameover.ts (Phase 1 Stage B),
  // imported above; both scenes self-install their fns entries.

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
  // it to every command handler).
  initInterpServices(EngineServices);
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
