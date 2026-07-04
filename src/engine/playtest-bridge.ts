/* RPGAtlas — src/engine/playtest-bridge.ts
   Editor ↔ playtest link for the editor Console (give / switch / var / goto
   while a playtest runs, and "playtest <map> <x> <y>" start positions).

   Two channels, both same-origin so they work in the browser AND between the
   Tauri editor/playtest windows:
   - A localStorage handoff for the start position: the editor writes
     PLAYTEST_START_KEY just before opening the play window; boot consumes it
     (read + remove) and skips the title screen, dropping the player straight
     onto the requested map. Stale entries (>30s) are ignored, so a normal
     playtest later is unaffected.
   - A BroadcastChannel for live commands: the Console posts {id, op, ...} and
     the running player answers {re: id, ok, text}. Only the local player
     participates — standalone exports (window.RPGATLAS_PROJECT) never open
     the channel, so shipped games can't be reached this way.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ctx } from "./state/engine-context.js";
import { G, addInv, invCount } from "./state/game-state.js";
import { refreshAllPages } from "./scenes/map-runtime.js";
import { transferPlayer } from "./scenes/map.js";

export const PLAYTEST_START_KEY = "rpgatlas_playtest_start";
export const PLAYTEST_CHANNEL = "rpgatlas_playtest_bridge";

export interface PlaytestStart { mapId: number; x: number; y: number; forceEncounter?: boolean; }

/** Read-and-clear the start-position handoff. Fresh entries only. */
export function consumePlaytestStart(): PlaytestStart | null {
  try {
    const raw = localStorage.getItem(PLAYTEST_START_KEY);
    if (!raw) return null;
    localStorage.removeItem(PLAYTEST_START_KEY);
    const v = JSON.parse(raw);
    if (Date.now() - (v.ts || 0) > 30000) return null;
    const mapId = Number(v.mapId);
    if (!ctx.proj.maps.some((m: any) => m.id === mapId)) return null;
    const map = ctx.proj.maps.find((m: any) => m.id === mapId);
    const x = Math.max(0, Math.min(map.width - 1, Math.floor(Number(v.x) || 0)));
    const y = Math.max(0, Math.min(map.height - 1, Math.floor(Number(v.y) || 0)));
    // "Test Encounter in This Area" (Phase 8) sets forceEncounter so the first
    // step inside an encounter zone rolls immediately.
    return { mapId, x, y, forceEncounter: v.forceEncounter === true };
  } catch {
    return null;
  }
}

function itemList(kind: string): any[] {
  return kind === "weapon" ? ctx.proj.weapons : kind === "armor" ? ctx.proj.armors : ctx.proj.items;
}

async function handle(msg: any): Promise<{ ok: boolean; text: string }> {
  switch (msg.op) {
    case "ping":
      return { ok: true, text: ctx.proj.system.title || "playtest" };
    case "give": {
      if (ctx.scene !== "map" && ctx.scene !== "battle")
        return { ok: false, text: "Start the game first (the player is on the title screen)." };
      const it = itemList(msg.kind).find((i: any) => i.id === msg.id);
      if (!it) return { ok: false, text: "No " + msg.kind + " with id " + msg.id + " in this project." };
      addInv(msg.kind, msg.id, msg.n);
      return { ok: true, text: (msg.n > 0 ? "Gave " : "Took ") + Math.abs(msg.n) + "× " + it.name + " (now ×" + invCount(msg.kind, msg.id) + ")." };
    }
    case "switch": {
      G.switches[msg.id] = !!msg.val;
      refreshAllPages();
      return { ok: true, text: "Switch " + msg.id + " is now " + (msg.val ? "ON" : "OFF") + "." };
    }
    case "var": {
      G.vars[msg.id] = Number(msg.val) || 0;
      refreshAllPages();
      return { ok: true, text: "Variable " + msg.id + " is now " + (Number(msg.val) || 0) + "." };
    }
    case "goto": {
      if (ctx.scene !== "map")
        return { ok: false, text: "Teleport only works while walking around (scene is “" + ctx.scene + "”)." };
      const map = ctx.proj.maps.find((m: any) => m.id === msg.mapId);
      if (!map) return { ok: false, text: "No map with id " + msg.mapId + " in this project." };
      const x = Math.max(0, Math.min(map.width - 1, Math.floor(msg.x)));
      const y = Math.max(0, Math.min(map.height - 1, Math.floor(msg.y)));
      await transferPlayer(msg.mapId, x, y, G.player.dir);
      return { ok: true, text: "Teleported to " + map.name + " (" + x + "," + y + ")." };
    }
    default:
      return { ok: false, text: "Unknown playtest op: " + msg.op };
  }
}

/** Open the live-command channel. Called from boot for the LOCAL player only
 *  (never for standalone exports). */
export function initPlaytestBridge(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const ch = new BroadcastChannel(PLAYTEST_CHANNEL);
  ch.onmessage = async (ev: MessageEvent) => {
    const msg = ev.data;
    // `rid` is the request correlation id — separate from domain fields like
    // a switch/item `id`. Replies carry `re` and are ignored here.
    if (!msg || typeof msg !== "object" || !msg.rid || msg.re) return;
    let out: { ok: boolean; text: string };
    try {
      out = await handle(msg);
    } catch (e: any) {
      out = { ok: false, text: (e && e.message) || String(e) };
    }
    ch.postMessage({ re: msg.rid, ok: out.ok, text: out.text });
  };
}
