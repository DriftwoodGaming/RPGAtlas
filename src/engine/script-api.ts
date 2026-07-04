/* RPGAtlas — src/engine/script-api.ts
   The frozen `game` Script API handed to plugins (new Function("atlas",
   "game", "dw", …)) and to the `script` event command, extracted verbatim
   from the js/engine.js monolith (Phase 1 Stage B). Surface and semantics are
   FROZEN: switches/vars with quest-failure re-evaluation, gold, party, the
   quest verbs, common-event calls (fresh Interp, recursion-guarded), raw
   state access, and camera zoom. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { clamp } from "./util.js";
import { ctx } from "./state/engine-context.js";
import { G, Quests, evaluateQuestFailures } from "./state/game-state.js";
import { Interp } from "./interpreter/interp.js";
import { zonesAtTile } from "../shared/zone-geom.js";

export const scriptApi: any = {
  setSwitch(id: any, v: any) {
    G.switches[id] = !!v;
    evaluateQuestFailures();
  },
  getSwitch(id: any) {
    return !!G.switches[id];
  },
  setVar(id: any, v: any) {
    G.vars[id] = v;
    evaluateQuestFailures();
  },
  getVar(id: any) {
    return G.vars[id] || 0;
  },
  addGold(n: any) {
    G.gold = clamp(G.gold + n, 0, 9999999);
  },
  party() {
    return G.party;
  },
  quest(id: any) {
    return Quests.get(id);
  },
  questStatus(id: any) {
    return Quests.status(id);
  },
  startQuest(id: any) {
    return Quests.start(id);
  },
  advanceQuestObjective(id: any, index: any, amount: any) {
    return Quests.advanceObjective(id, index, amount);
  },
  setQuestObjective(id: any, index: any, value: any) {
    return Quests.setObjective(id, index, value);
  },
  completeQuest(id: any) {
    return Quests.complete(id);
  },
  failQuest(id: any) {
    return Quests.fail(id);
  },
  abandonQuest(id: any) {
    return Quests.abandon(id);
  },
  callCommonEvent(id: any) {
    return new Interp(null).callCommonEvent(id);
  },
  state() {
    return G;
  },
  setCameraZoom(zoom: any) {
    ctx.cameraZoom = clamp(Number(zoom) || 1, 0.25, 4);
  },
  getCameraZoom() {
    return ctx.cameraZoom;
  },
  // Day/night clock (Phase 2 Stage D): hours 0–24, rendered by HD-2D maps
  // with hd2d.dayNight. Scripts/plugins own its progression (Phase 5 wires
  // gameplay schedules on top).
  setTimeOfDay(h: any) {
    G.timeOfDay = clamp(Number(h) || 0, 0, 24);
  },
  getTimeOfDay() {
    return G.timeOfDay == null ? 12 : G.timeOfDay;
  },
  // Gameplay zones (Phase 8): the zones covering tile (x, y) on the current map,
  // in author draw order — the same surface plugins get as atlas.zonesAt. Absent
  // map.zones ⇒ []. Additive (the frozen surface is extended, never changed).
  zonesAt(x: any, y: any) {
    return zonesAtTile(ctx.map && ctx.map.zones, Math.floor(x), Math.floor(y));
  },
};
