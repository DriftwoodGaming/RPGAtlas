/* RPGAtlas — src/engine/interpreter/commands/actors.ts
   The "change actor data" interpreter command family (Project Compass M2·C):
   RM codes 313 (state), 315 (exp), 316 (level), 317 (parameters), 318 (skills),
   319 (equipment), 320 (name), 321 (class), 322 (actor images), 324 (nickname),
   325 (profile). Each mutates the matching live party member(s) through the
   game-state helpers exposed on the engine service surface, so param math,
   exp curves, and skill learning stay in one place. `actorId` 0 targets the
   whole party (RM's "Entire Party"); a positive id targets that one member.
   Additive/optional schema — untouched actors keep the exact old shape.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { registerCommand, type InterpContext } from "../registry.js";

/** Run `fn` over the targeted party member(s): id 0 = the whole party. */
function forEachActor(state: any, actorId: any, fn: (a: any) => void): void {
  const party = (state && state.party) || [];
  if (Number(actorId) === 0) { for (const a of party) fn(a); return; }
  const a = party.find((m: any) => m.actorId === Number(actorId));
  if (a) fn(a);
}

/** Re-clamp current HP/MP after a stat/level/equip/class change so they never
 *  exceed the new maxima (RM keeps current values, only capping them). */
function clampVitals(a: any, services: any): void {
  a.hp = Math.min(a.hp, services.param(a, "mhp"));
  a.mp = Math.min(a.mp, services.param(a, "mmp"));
}

export function registerActorCommands(): void {
  // ---- 315 Change EXP ----
  registerCommand("changeExp", (c: any, { state, services }: InterpContext) => {
    const delta = (c.op === "sub" ? -1 : 1) * (Number(c.value) || 0);
    forEachActor(state, c.actorId, (a: any) => {
      if (delta >= 0) {
        services.gainExp(a, delta, null);
      } else {
        a.exp = Math.max(services.expForLevel(1), (a.exp || 0) + delta);
        while (a.level > 1 && a.exp < services.expForLevel(a.level)) a.level--;
        clampVitals(a, services);
      }
    });
  });

  // ---- 316 Change Level ----
  registerCommand("changeLevel", (c: any, { state, services }: InterpContext) => {
    const delta = (c.op === "sub" ? -1 : 1) * (Number(c.value) || 0);
    forEachActor(state, c.actorId, (a: any) => {
      const target = Math.max(1, (a.level || 1) + delta);
      if (target > (a.level || 1)) {
        // Grant exactly enough EXP to reach the target floor so gainExp runs the
        // usual level-up path (skill learning + level-up SE), like RM.
        services.gainExp(a, services.expForLevel(target) - (a.exp || 0), null);
      } else {
        a.level = target;
        a.exp = services.expForLevel(target);
        clampVitals(a, services);
      }
    });
  });

  // ---- 317 Change Parameters (permanent additive bonus) ----
  registerCommand("changeParam", (c: any, { state, services }: InterpContext) => {
    const key = String(c.param || "");
    if (!key) return;
    const delta = (c.op === "sub" ? -1 : 1) * (Number(c.value) || 0);
    forEachActor(state, c.actorId, (a: any) => {
      const plus = a.paramPlus || (a.paramPlus = {});
      plus[key] = (plus[key] || 0) + delta;
      clampVitals(a, services);
    });
  });

  // ---- 318 Change Skills (learn / forget) ----
  registerCommand("changeSkill", (c: any, { state }: InterpContext) => {
    const id = Number(c.skillId) || 0;
    if (!id) return;
    forEachActor(state, c.actorId, (a: any) => {
      const skills = a.skills || (a.skills = []);
      const forgot = a.forgot || (a.forgot = []);
      if (c.op === "forget") {
        if (!forgot.includes(id)) forgot.push(id);
        const si = skills.indexOf(id); if (si >= 0) skills.splice(si, 1);
      } else {
        const fi = forgot.indexOf(id); if (fi >= 0) forgot.splice(fi, 1);
        if (!skills.includes(id)) skills.push(id);
      }
    });
  });

  // ---- 319 Change Equipment (force-equip a slot; itemId 0 = unequip) ----
  registerCommand("changeEquip", (c: any, { state, services }: InterpContext) => {
    const id = Number(c.itemId) || 0;
    forEachActor(state, c.actorId, (a: any) => {
      if (c.slot === "armor") a.armorId = id; else a.weaponId = id;
      clampVitals(a, services);
    });
    services.refreshAllPages();
  });

  // ---- 320 Change Name ----
  registerCommand("changeName", (c: any, { state }: InterpContext) => {
    if (c.name == null) return;
    forEachActor(state, c.actorId, (a: any) => { a.name = String(c.name); });
  });

  // ---- 321 Change Class ----
  registerCommand("changeClass", (c: any, { state, services }: InterpContext) => {
    const cid = Number(c.classId) || 0;
    forEachActor(state, c.actorId, (a: any) => {
      a.classId = cid;
      services.sanitizeEquipment(a);
      clampVitals(a, services);
    });
    services.refreshAllPages();
  });

  // ---- 322 Change Actor Images (map/face charset; Atlas faces derive from it) ----
  registerCommand("changeActorImage", (c: any, { state, services }: InterpContext) => {
    if (c.charset == null) return;
    forEachActor(state, c.actorId, (a: any) => { a.charset = String(c.charset); });
    // Refresh the on-map sprites that derive from the actor charset.
    if (services.refreshPlayerCharset) services.refreshPlayerCharset();
    if (services.syncFollowers) services.syncFollowers(false);
  });

  // ---- 324 Change Nickname ----
  registerCommand("changeNickname", (c: any, { state }: InterpContext) => {
    forEachActor(state, c.actorId, (a: any) => { a.nickname = String(c.nickname || ""); });
  });

  // ---- 325 Change Profile ----
  registerCommand("changeProfile", (c: any, { state }: InterpContext) => {
    forEachActor(state, c.actorId, (a: any) => { a.profile = String(c.profile || ""); });
  });

  // ---- 313 Change State (out of battle) ----
  // M3·B fix: entries are the battle's {id, turns} objects (the M2·C version
  // pushed bare numbers, which the battle scene filtered out as unknown —
  // map-applied Poison never poisoned). Turns come from the state's maxTurns
  // (deterministic — no RNG draw outside battle).
  registerCommand("changeState", (c: any, { state, services }: InterpContext) => {
    const id = Number(c.stateId) || 0;
    if (!id) return;
    const def = ((services.getProj().states || []) as any[]).find((s: any) => s && s.id === id);
    forEachActor(state, c.actorId, (a: any) => {
      const states = a.states || (a.states = []);
      const idx = states.findIndex((st: any) => (st && st.id != null ? st.id : st) === id);
      if (c.op === "remove") {
        if (idx >= 0) states.splice(idx, 1);
      } else if (idx < 0) {
        states.push({ id, turns: Math.max(1, (def && def.maxTurns) || 3) });
      }
    });
  });

  // ---- 326 Change TP (Project Compass M3·B) ----
  registerCommand("changeTp", (c: any, { state }: InterpContext) => {
    const delta = (c.op === "sub" ? -1 : 1) * (Number(c.value) || 0);
    forEachActor(state, c.actorId, (a: any) => {
      a.tp = Math.max(0, Math.min(100, (Number(a.tp) || 0) + delta));
    });
  });

  // ---- 342 Change Enemy TP (M3·B) — through the battle bridge; a no-op
  // outside battle (there is no troop to change). ----
  registerCommand("changeEnemyTp", (c: any, { services }: InterpContext) => {
    if (!services.battleAddEnemyTp) return;
    const delta = (c.op === "sub" ? -1 : 1) * (Number(c.value) || 0);
    services.battleAddEnemyTp(Number(c.enemyIndex) || 0, delta);
  });
}
