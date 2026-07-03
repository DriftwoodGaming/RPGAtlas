/* RPGAtlas — src/engine/state/player-options.ts
   Per-player overrides (input rebinds + audio/game settings) and their
   setters, extracted verbatim from the js/engine.js monolith (Phase 1
   Stage B). Stored separately from the project so author defaults stay intact
   and a player's remaps/preferences persist across sessions; per-game
   namespaced like saveKey(). The mutable option state itself (playerOptions,
   dash latch scalars) lives on the shared engine context — the monolith's
   closure `let`s — so the remaining engine code and these setters observe the
   same values. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Music, Sfx } from "../../shared/deps.js";
import { gaugePalette, resolveMotion, resolveTextScale } from "../../shared/a11y.js";
import { clamp } from "../util.js";
import { ctx } from "./engine-context.js";
import {
  browserSaveRepository as saves,
  optionsKey as savesOptionsKey,
} from "../../platform/browser/save-repository.js";

// Re-exported for the key-naming contract; the storage read/write now runs
// through the SaveRepository (behavior-frozen: same key, same fallbacks).
export const optionsKey = savesOptionsKey;
export function loadOptions(): any {
  return saves.readOptions();
}
export function saveOptions(): void {
  saves.writeOptions(ctx.playerOptions);
}
// ---- player-option setters (mutate playerOptions + persist) ----
export function audioVol(ch: any): number {
  const a = ctx.playerOptions.audio || {};
  return a[ch] == null ? 1 : a[ch];
}
export function setOptAudio(ch: any, v: any): void {
  v = clamp(v, 0, 1);
  ctx.playerOptions.audio = ctx.playerOptions.audio || {};
  ctx.playerOptions.audio[ch] = v;
  if (ch === "master") Sfx.setMasterVolume(v);
  else if (ch === "bgm") {
    Sfx.setBgmVolume(v);
    if (v > 0 && !Music.enabled) Music.setEnabled(true);
  } else if (ch === "bgs") Sfx.setBgsVolume(v);
  else if (ch === "se") Sfx.setSeVolume(v);
  saveOptions();
}
export function setOpt(key: any, v: any): void {
  ctx.playerOptions[key] = v;
  saveOptions();
}
export function setOptTextSpeed(v: any): void {
  ctx.playerOptions.textSpeed = v;
  saveOptions();
  if (ctx.setMsgSpeed) ctx.setMsgSpeed(v);
}
// ---- accessibility (Phase 7 Stage B) ----
// Reduced motion: playerOptions.reducedMotion "auto" | "on" | "off"; "auto"
// (the default) follows the OS/browser prefers-reduced-motion setting live.
const reducedMotionQuery =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
export function motionReduced(): boolean {
  return resolveMotion(ctx.playerOptions.reducedMotion, !!(reducedMotionQuery && reducedMotionQuery.matches));
}
/** Reflect the resolved preference as a class on #stage (play.css stills
 *  battle sprite bobbing/lunges, shake keyframes, and HUD flashes on it). */
export function applyMotionClass(): void {
  if (ctx.stage) ctx.stage.classList.toggle("reduced-motion", motionReduced());
}
export function watchMotionPreference(): void {
  if (reducedMotionQuery && reducedMotionQuery.addEventListener) {
    reducedMotionQuery.addEventListener("change", applyMotionClass);
  }
}
/** Text Size option: multiplies the author's base font size via --ui-scale
 *  (see play.css #stage font-size). */
export function textScale(): number {
  return resolveTextScale(ctx.playerOptions.textScale);
}
export function applyTextScale(): void {
  if (ctx.stage) ctx.stage.style.setProperty("--ui-scale", String(textScale()));
}
/** HP/MP gauge fills honoring the Colorblind Assist option. */
export function gaugeColors(): { hp: string; mp: string } {
  return gaugePalette(!!ctx.playerOptions.colorAssist);
}

// Dash mode (Options): Hold = held button; Toggle = tap to latch; Always On = always run.
export function wantsDash(): boolean {
  const m = ctx.playerOptions.dashMode || "hold";
  if (m === "always") return true;
  if (m === "toggle") return ctx.dashLatch;
  return ctx.Input.pressed("dash");
}
