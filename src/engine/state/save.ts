/* RPGAtlas — src/engine/state/save.ts
   Save/load, extracted verbatim from the js/engine.js monolith (Phase 1
   Stage B): per-game namespaced localStorage slots (with pre-rebrand
   fallback reads), the save/load slot menu, and applySave — which restores
   the game state, sanitizes equipment against the current database, clamps
   camera zoom, re-inits the player, and reloads the map. This is the
   behavior the Stage D SaveRepository interface will formalize.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { clamp, esc, sysSe } from "../util.js";
import { showList } from "../ui-stack.js";
import { ctx } from "./engine-context.js";
import { G, sanitizeEquipment, param } from "./game-state.js";
import { loadMap, initPlayer, syncFollowers } from "../scenes/map-runtime.js";
import { serializePresentation, restorePresentation } from "../scenes/presentation-runtime.js";
import { browserSaveRepository as saves } from "../../platform/browser/save-repository.js";

export function slotInfo(slot: any): any {
  return saves.readSlot(slot);
}
export async function saveLoadMenu(mode: any): Promise<boolean> {
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
      mapName: ctx.map ? ctx.map.name : "",
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
        cameraZoom: ctx.cameraZoom,
        timeOfDay: G.timeOfDay,
        vehicles: G.vehicles,
        vehicle: G.vehicle,
        // Presentation layer (Project Compass M2·A): pictures, screen tint, timer.
        presentation: serializePresentation(),
        mapId: G.mapId,
        player: {
          x: G.player.x,
          y: G.player.y,
          dir: G.player.dir,
          transparent: !!G.player.transparent,
        },
      },
    };
    if (!saves.writeSlot(slot, payload)) {
      await ctx.showMessage("", "Could not save — storage is full or unavailable.");
      return false;
    }
    sysSe("save");
    await ctx.showMessage("", "Game saved to slot " + slot + ".");
    return false;
  } else {
    const info = slotInfo(slot);
    if (!info) return false;
    try {
      await applySave(info.data);
    } catch {
      await ctx.showMessage("", "That save could not be loaded — it may be corrupted or reference content that no longer exists.");
      return false;
    }
    sysSe("save");
    return true;
  }
}
async function applySave(d: any): Promise<void> {
  ctx.commonParallels.clear();
  G.switches = d.switches || {};
  G.vars = d.vars || {};
  G.selfSw = d.selfSw || {};
  G.quests = d.quests || {};
  G.party = d.party || [];
  G.inv = d.inv || { item: {}, weapon: {}, armor: {} };
  G.party.forEach((a: any) => {
    sanitizeEquipment(a);
    a.hp = Math.min(a.hp, param(a, "mhp"));
    a.mp = Math.min(a.mp, param(a, "mmp"));
  });
  G.gold = d.gold || 0;
  G.steps = d.steps || 0;
  // vehicles (Phase 5): old saves lack the fields — start parked at System
  G.vehicles = d.vehicles || {};
  G.vehicle = d.vehicle || null;
  ctx.cameraZoom = clamp(Number(d.cameraZoom) || 1, 0.25, 4);
  // Presentation layer (Project Compass M2·A): old saves lack the field →
  // restorePresentation(undefined) resets to a clean screen.
  restorePresentation(d.presentation);
  const p = d.player || {};
  initPlayer(p.x || 0, p.y || 0, p.dir);
  G.player.transparent = !!p.transparent;
  await loadMap(d.mapId);
  syncFollowers(true);
  // After loadMap: the saved clock wins over the map's on-entry pin (the
  // player was already on this map at that time). Old saves lack the field.
  if (d.timeOfDay != null) G.timeOfDay = clamp(Number(d.timeOfDay) || 0, 0, 24);
  ctx.scene = "map";
}
