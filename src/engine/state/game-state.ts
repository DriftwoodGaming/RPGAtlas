/* RPGAtlas — src/engine/state/game-state.ts
   The live game state `G` and the actor/param/exp/inventory helpers, extracted
   verbatim from the js/engine.js monolith's "game state" section (Phase 1
   Stage B), plus the quest-runtime wiring. Logic unchanged: only the closure
   references were converted — the live project is read through ctx.proj and
   refreshAllPages (which lives with the map runtime) is reached through the
   fns forward-ref registry. The quest runtime is created by initQuestRuntime(),
   called from the engine body at the same point the monolith created it; the
   quest exports are live `let` bindings assigned there.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA, RPGAtlasQuests } from "../../shared/deps.js";
import { clamp, sysSe } from "../util.js";
import { ctx, fns } from "./engine-context.js";

export const G: any = {
  switches: {},
  vars: {},
  selfSw: {},
  quests: {},
  party: [],
  inv: { item: {}, weapon: {}, armor: {} },
  gold: 0,
  mapId: 0,
  steps: 0,
  encSteps: 0,
  // In-game clock (hours 0–24) for the HD-2D day/night cycle. Lives in game
  // state so saves round-trip it; maps can pin it (hd2d.timeOfDay) and
  // scripts drive it (game.setTimeOfDay) — nothing advances it implicitly.
  timeOfDay: 12,
  player: null,
};

export function expForLevel(lv: any): number {
  let t = 0;
  for (let l = 2; l <= lv; l++)
    t += Math.floor(20 * Math.pow(l - 1, 1.75) + 30);
  return t;
}
export function actorClass(a: any): any {
  return RA.byId(ctx.proj.classes, a.classId) || ctx.proj.classes[0];
}
export function skillElement(skill: any): any {
  return RA.elementOfSkill(skill);
}
export function skillMpCost(a: any, skill: any): number {
  return Math.max(
    0,
    Math.ceil(
      (skill.mp || 0) * RA.traitRate(actorClass(a), "special", "mpCost", 1),
    ),
  );
}
export function skillPowerRate(a: any, skill: any): number {
  return RA.traitRate(actorClass(a), "skill", skill.type, 1);
}
export function actorIncomingRate(a: any, element: any, guarding: any): number {
  const c = actorClass(a);
  let rate = RA.traitRate(c, "element", element, 1);
  rate *= RA.traitRate(c, "special", "damageTaken", 1);
  if (guarding) rate *= RA.traitRate(c, "special", "guardDamage", 0.55);
  return rate;
}
export function canActorEquip(a: any, kind: any, itemId: any): boolean {
  return RA.canEquip(actorClass(a), kind, itemId);
}
export function sanitizeEquipment(a: any): void {
  if (!canActorEquip(a, "weapon", a.weaponId)) a.weaponId = 0;
  if (!canActorEquip(a, "armor", a.armorId)) a.armorId = 0;
}
export function param(a: any, stat: any): number {
  const c = actorClass(a);
  let v = Math.floor(
    (c.base[stat] || 0) + (c.growth[stat] || 0) * (a.level - 1),
  );
  const w = RA.byId(ctx.proj.weapons, a.weaponId),
    ar = RA.byId(ctx.proj.armors, a.armorId);
  if (w && w.params) v += w.params[stat] || 0;
  if (ar && ar.params) v += ar.params[stat] || 0;
  v = Math.floor(v * RA.traitRate(c, "param", stat, 1));
  return Math.max(1, v);
}
export function learnedSkills(a: any): any[] {
  const c = actorClass(a);
  return (c.learnings || [])
    .filter((l: any) => l.level <= a.level)
    .map((l: any) => RA.byId(ctx.proj.skills, l.skillId))
    .filter(Boolean);
}
export function makeActor(actorId: any): any {
  const d = RA.byId(ctx.proj.actors, actorId);
  if (!d) return null;
  const a: any = {
    actorId,
    name: d.name,
    classId: d.classId,
    charset: d.charset,
    level: d.level || 1,
    exp: expForLevel(d.level || 1),
    weaponId: d.weaponId || 0,
    armorId: d.armorId || 0,
    hp: 1,
    mp: 1,
  };
  sanitizeEquipment(a);
  a.hp = param(a, "mhp");
  a.mp = param(a, "mmp");
  return a;
}
export function gainExp(a: any, amount: any, log: any): void {
  a.exp += amount;
  while (a.exp >= expForLevel(a.level + 1)) {
    const before = learnedSkills(a).map((s: any) => s.id);
    a.level++;
    a.hp = Math.min(a.hp + 10, param(a, "mhp"));
    if (log) log(a.name + " reached level " + a.level + "!");
    sysSe("levelup");
    for (const s of learnedSkills(a)) {
      if (!before.includes(s.id) && log)
        log(a.name + " learned " + s.name + "!");
    }
  }
}
export function addInv(kind: any, id: any, n: any): void {
  const bag = G.inv[kind];
  bag[id] = clamp((bag[id] || 0) + n, 0, 99);
  if (!bag[id]) delete bag[id];
}
export function invCount(kind: any, id: any): number {
  return G.inv[kind][id] || 0;
}
export function dbFor(kind: any): any {
  return kind === "item"
    ? ctx.proj.items
    : kind === "weapon"
      ? ctx.proj.weapons
      : ctx.proj.armors;
}

// Quest runtime (js/quests.js): created by the engine body at the same point
// the monolith created it, so timing is identical. The destructured pieces are
// live exports — import sites always see the assigned values.
export let questRuntime: any;
export let Quests: any;
export let questState: any;
export let objectiveDone: any;
export let evaluateQuestFailures: any;
export let noteBattleFailure: any;
export let onEnemyKilled: any;

export function initQuestRuntime(): void {
  questRuntime = RPGAtlasQuests.create({
    G,
    RA,
    clamp,
    gainExp,
    addInv,
    invCount,
    dbFor,
    refreshAllPages: (...args: any[]) => fns.refreshAllPages(...args),
    getProj: () => ctx.proj,
    now: () => Date.now(),
  });
  ({
    Quests,
    questState,
    objectiveDone,
    evaluateQuestFailures,
    noteBattleFailure,
    onEnemyKilled,
  } = questRuntime);
}

export function traitDescription(t: any): string {
  const value = Number(t.value) || 0;
  if (t.type === "param")
    return String(t.key).toUpperCase() + " " + value + "%";
  if (t.type === "element") {
    const e = RA.typeList(ctx.proj, "elements").find((x: any) => x.key === t.key);
    return (e ? e.name : t.key) + " damage " + value + "%";
  }
  if (t.type === "state") {
    const state = RA.byId(ctx.proj.states || [], Number(t.key));
    return (state ? state.name : "State " + t.key) + " chance " + value + "%";
  }
  if (t.type === "skill")
    return (
      String(t.key).replace(/^\w/, (c: string) => c.toUpperCase()) +
      " skill power " +
      value +
      "%"
    );
  if (t.type === "equip") {
    const item = RA.byId(
      t.key === "armor" ? ctx.proj.armors : ctx.proj.weapons,
      value,
    );
    return "Can equip " + (item ? item.name : t.key + " " + value);
  }
  const special = RA.TRAIT_SPECIALS.find((x: any) => x.v === t.key);
  return (
    (special ? special.l.replace(/ %$/, "") : t.key) + ": " + value + "%"
  );
}
