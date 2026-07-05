/* RPGAtlas — src/engine/boot.ts
   Engine boot + composition root (Phase 1 Stage B — the last piece of the
   js/engine.js monolith). This module wires everything in the SAME order the
   monolith's IIFE body did: providers for the util/ui-stack modules, quest
   runtime, message + input systems, journal view, the EngineServices surface
   handed to interpreter command handlers, built-in command registration, and
   finally the DOM-ready boot (project load, player options + audio restore,
   screen/window settings, asset load, plugin runAll, title scene, and the
   fixed-timestep loop). All mutable engine state now lives as plain fields on
   the shared engine context (src/engine/state/engine-context.ts) — the
   monolith's closure-variable bridge is gone. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, DataDefaults, Music, RA, Sfx } from "../shared/deps.js";
import { isProjectLike, validateProject } from "../shared/schema.js";
import { registerBuiltinCommands } from "./interpreter/commands/index.js";
import { initInterpServices } from "./interpreter/interp.js";
import { scriptApi } from "./script-api.js";
import { Plugins } from "./plugin-runtime.js";
import { el, esc, clamp, rnd, setSysProjectProvider } from "./util.js";
import { showList, initUiStack } from "./ui-stack.js";
import { ctx, fns } from "./state/engine-context.js";
import {
  initQuestRuntime,
  Quests,
  evaluateQuestFailures,
  addInv,
  makeActor,
  param,
  gainExp,
  expForLevel,
  sanitizeEquipment,
} from "./state/game-state.js";
import { applyWindowTone } from "./state/window-tone.js";
import {
  applyMotionClass,
  applyTextScale,
  loadOptions,
  saveOptions,
  watchMotionPreference,
} from "./state/player-options.js";
import { saveLoadMenu } from "./state/save.js";
import { initMessageSystem } from "./message.js";
import { initInputSystem } from "./input.js";
import {
  refreshAllPages,
  setRoute,
  refreshPlayerCharset,
  syncFollowers,
  locationInfo,
} from "./scenes/map-runtime.js";
import {
  transferPlayer,
  waitFrames,
  frameWait,
  tickTween,
  handleMapTap,
  armForcedEncounter,
} from "./scenes/map.js";
import { startLoop } from "./loop.js";
import { initJournalView } from "./scenes/menus.js";
import { numberInputScene, selectItemScene, nameInputScene } from "./scenes/input-scenes.js";
import { Shop } from "./scenes/shop.js";
import { Battle } from "./scenes/battle.js";
import { toTitle, showTitle, newGame } from "./scenes/title.js";
import { consumePlaytestStart, initPlaytestBridge } from "./playtest-bridge.js";
import { gameOver } from "./scenes/gameover.js";
import { playMapAnimation } from "./anim-glue.js";
import { initPerfHud } from "./perf-hud.js";
import { Renderer } from "../renderer/index.js";
import { initAssetLibrary } from "../shared/asset-library.js";
import { createDefaultAssetStore } from "../platform/default-asset-store.js";
// Side effect: registers window.AtlasAudioDeck, the seam js/sfx.js routes
// "asset:" music/sound references through (Phase 6 audio v2).
import "../shared/audio-deck.js";

const TILE = Assets.TILE;
// defaults (overridden at boot from system.screenWidth/Height)
ctx.SCREEN_W = 17 * TILE;
ctx.SCREEN_H = 13 * TILE;

setSysProjectProvider(() => ctx.proj); // util.ts sys* helpers read the live project
initUiStack(() => ctx.uiLayer); // ui-stack.ts showList appends to the live uiLayer

// Quest runtime, message system, input system, journal view — created in the
// exact order the monolith created them.
initQuestRuntime();
initMessageSystem();
initInputSystem();
initJournalView();

// ============================ interpreter services ============================
// The service surface the extracted command handlers call. Late-bound values
// (message-system fns) are exposed via getters so handlers always see live
// state — identical to the monolith's closure references.
const EngineServices: any = {
  ctx,
  // message system (late-bound: assigned during wiring)
  get showMessage() { return ctx.showMessage; },
  get richText() { return ctx.richText; },
  showList,
  // message-system input scenes (M2·B)
  numberInput: numberInputScene,
  selectItem: selectItemScene,
  nameInput: nameInputScene,
  // helpers
  clamp, rnd,
  // deps
  Sfx, Music,
  // state ops
  refreshAllPages, evaluateQuestFailures,
  addInv, makeActor, param,
  // actor-data command family (M2·C): exp/level/param math + sprite refresh
  gainExp, expForLevel, sanitizeEquipment, refreshPlayerCharset, syncFollowers,
  // system commands (M2·C): window recolour + get-location-info
  applyWindowTone, locationInfo,
  getProj: () => ctx.proj,
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
  // Change Enemy TP bridge (M3·B): live only while a battle runs.
  get battleAddEnemyTp() { return (fns as any).battleAddEnemyTp; },
  // battle animations on the map (Phase 5)
  playMapAnimation,
};
initInterpServices(EngineServices);
registerBuiltinCommands();

// The fixed-timestep game loop now lives in ./loop.ts (startLoop below).

// ============================ boot ============================
function loadProject(): any {
  if ((window as any).RPGATLAS_PROJECT)
    return validateProject(
      RA.migrateProject(RA.clone((window as any).RPGATLAS_PROJECT)),
      "load",
    );
  try {
    const raw =
      localStorage.getItem("rpgatlas_project") ||
      localStorage.getItem("driftwood_project");
    if (raw) {
      const p = JSON.parse(raw);
      if (isProjectLike(p)) return validateProject(RA.migrateProject(p), "load");
    }
  } catch (e) {
    console.warn("Stored project unreadable, using sample.", e);
  }
  return DataDefaults.newProject();
}

function fitStage(): void {
  const sw = window.innerWidth / ctx.SCREEN_W,
    sh = window.innerHeight / ctx.SCREEN_H;
  const maxScale = (ctx.proj && Number(ctx.proj.system.screenScale)) || 1.6;
  const sc = Math.min(sw, sh, maxScale);
  ctx.stage.style.transform = "translate(-50%,-50%) scale(" + sc + ")";
}

// Apply System-tab presentation settings: screen size, UI area, fonts,
// base font size, window opacity, and window color (via CSS variables play.css reads).
function applyScreenSettings(): void {
  const s = ctx.proj.system;
  ctx.SCREEN_W = clamp(Math.floor(Number(s.screenWidth) || 816), 384, 3840);
  ctx.SCREEN_H = clamp(Math.floor(Number(s.screenHeight) || 624), 288, 2160);
  ctx.canvas.width = ctx.SCREEN_W;
  ctx.canvas.height = ctx.SCREEN_H;
  ctx.g2d.imageSmoothingEnabled = false;
  ctx.stage.style.width = ctx.SCREEN_W + "px";
  ctx.stage.style.height = ctx.SCREEN_H + "px";
  const uw = clamp(Math.floor(Number(s.uiWidth) || 0), 0, ctx.SCREEN_W);
  const uh = clamp(Math.floor(Number(s.uiHeight) || 0), 0, ctx.SCREEN_H);
  if (uw > 0 || uh > 0) {
    const w = uw || ctx.SCREEN_W,
      h2 = uh || ctx.SCREEN_H;
    ctx.uiLayer.style.inset = "auto";
    ctx.uiLayer.style.left = Math.floor((ctx.SCREEN_W - w) / 2) + "px";
    ctx.uiLayer.style.top = Math.floor((ctx.SCREEN_H - h2) / 2) + "px";
    ctx.uiLayer.style.width = w + "px";
    ctx.uiLayer.style.height = h2 + "px";
  }
  ctx.stage.style.setProperty(
    "--font-text",
    s.fontText || '"Segoe UI", system-ui, sans-serif',
  );
  ctx.stage.style.setProperty(
    "--font-menu",
    s.fontMenu || s.fontText || '"Segoe UI", system-ui, sans-serif',
  );
  ctx.stage.style.setProperty(
    "--font-size",
    clamp(Number(s.fontSize) || 15, 8, 48) + "px",
  );
  ctx.stage.style.setProperty(
    "--win-op",
    clamp(s.windowOpacity == null ? 93 : Number(s.windowOpacity), 0, 100) /
      100,
  );
  const windowPalette = RA.windowColorPalette(s.windowColor);
  ctx.stage.style.setProperty("--win-top-rgb", windowPalette.top);
  ctx.stage.style.setProperty("--win-bottom-rgb", windowPalette.bottom);
  ctx.stage.style.setProperty("--win-name-top-rgb", windowPalette.nameTop);
  ctx.stage.style.setProperty("--win-name-bottom-rgb", windowPalette.nameBottom);
}

async function boot(): Promise<void> {
  ctx.stage = document.getElementById("stage");
  ctx.canvas = document.getElementById("gamecanvas");
  ctx.g2d = ctx.canvas.getContext("2d");
  ctx.uiLayer = el("div", "uilayer");
  ctx.stage.appendChild(ctx.uiLayer);
  ctx.fader = el("div", "fader");
  ctx.stage.appendChild(ctx.fader);
  ctx.fader.style.opacity = 0;
  document.title = "RPGAtlas Player";

  window.addEventListener("error", (e: any) => {
    const box = el(
      "div",
      "errbox",
      "<b>Error:</b> " +
        esc(e.message) +
        "<br><small>" +
        esc((e.filename || "") + ":" + e.lineno) +
        "</small>",
    );
    ctx.stage.appendChild(box);
    setTimeout(() => box.remove(), 8000);
  });

  ctx.proj = loadProject();
  // Apply author-default bindings, with the player's saved per-device overrides merged
  // on top, and restore the persisted music preference (before any Music.play()).
  ctx.playerOptions = loadOptions();
  // One-time migration: the old "Music: On/Off" toggle became the Music Volume slider, so a
  // pre-mixer save with music disabled maps to BGM volume 0 (and we drop the dead `music` key).
  // Runs before `av` is captured below — otherwise this boot would still apply BGM volume 1.
  if (
    ctx.playerOptions.music &&
    ctx.playerOptions.music.enabled === false &&
    (ctx.playerOptions.audio == null || ctx.playerOptions.audio.bgm == null)
  ) {
    ctx.playerOptions.audio = Object.assign({}, ctx.playerOptions.audio, { bgm: 0 });
    delete ctx.playerOptions.music;
    saveOptions();
  }
  ctx.Input.setBindings(RA.mergeInputBindings(ctx.proj.system.input, ctx.playerOptions.input || null));
  // Restore saved audio mix + text speed.
  const av = ctx.playerOptions.audio || {};
  Sfx.setMasterVolume(av.master == null ? 1 : av.master);
  Sfx.setBgmVolume(av.bgm == null ? 1 : av.bgm);
  Sfx.setBgsVolume(av.bgs == null ? 1 : av.bgs);
  Sfx.setSeVolume(av.se == null ? 1 : av.se);
  if (ctx.setMsgSpeed && ctx.playerOptions.textSpeed) ctx.setMsgSpeed(ctx.playerOptions.textSpeed);
  applyScreenSettings();
  // Accessibility (Phase 7): restore text scale + reduced-motion class, and
  // track live prefers-reduced-motion changes while the option is "auto".
  applyTextScale();
  applyMotionClass();
  watchMotionPreference();
  window.addEventListener("resize", fitStage);
  // touch/click-to-move (Phase 5): taps on the map canvas path the player
  ctx.canvas.addEventListener("pointerdown", (ev: any) => {
    if (ev.button === 0) handleMapTap(ev.clientX, ev.clientY);
  });
  fitStage();
  Assets.registerCustomChars(ctx.proj.customChars);
  // Device asset library (Phase 6): the playtest player resolves the same
  // library the editor imported into (shared IndexedDB origin in the browser,
  // shared app-data dir under Tauri). Standalone exports carry their assets
  // embedded (RPGATLAS_ASSETS) and skip the library entirely.
  if (!(window as any).RPGATLAS_ASSETS) {
    await initAssetLibrary(await createDefaultAssetStore());
  }
  await Promise.all([Assets.loadIconSet(), Assets.loadExternalAssets(ctx.proj)]);
  Plugins.runAll();
  document.title = (ctx.proj.system.title || "RPGAtlas") + " — RPGAtlas Player";
  // Editor-Console playtest link — local player only (standalone exports set
  // RPGATLAS_PROJECT and never open the channel). A pending "playtest at…"
  // handoff skips the title screen and starts on the requested map.
  const ptStart = (window as any).RPGATLAS_PROJECT ? null : consumePlaytestStart();
  if (!(window as any).RPGATLAS_PROJECT) initPlaytestBridge();
  if (ptStart) {
    await newGame(ptStart);
    // "Test Encounter in This Area" (Phase 8): arm a one-shot forced roll so the
    // first step inside the zone rolls immediately.
    if (ptStart.forceEncounter) armForcedEncounter();
  } else {
    ctx.scene = "title";
    showTitle();
  }
  startLoop(); // kick off the fixed-timestep loop (rAF, so it gets a real timestamp)
  // Perf overlay (?perf=1 / F3) + diagnostics hooks (Phase 7 Stage A): the
  // boot mark feeds the load-time budget e2e; the stats fn feeds the
  // memory-stability e2e and stays handy for manual leak hunting.
  initPerfHud();
  (window as any).RPGATLAS_BOOT_MS = performance.now();
  (window as any).RPGATLAS_RENDERER_STATS = () =>
    (Renderer as any).stats ? (Renderer as any).stats() : null;

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
