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
// ---- effective traits (Project Compass M3·B) ----
// A battler's live trait list = its class (or enemy record) traits plus the
// traits of every state currently on it (imported Silence/Blind-style states
// carry rows). Native projects: states/enemies have no traits, so every read
// below returns the exact pre-M3·B value.
/** Trait rows carried by a battler's active states (`{id,turns}` entries;
 *  stray numeric entries from pre-fix saves are read too). */
export function stateTraitRows(states: any): any[] {
  if (!states || !states.length) return [];
  const out: any[] = [];
  for (const st of states) {
    const d = RA.byId(ctx.proj.states || [], st && st.id != null ? st.id : st);
    if (d && d.traits && d.traits.length) out.push(...d.traits);
  }
  return out;
}
/** Effective trait carrier for an ACTOR (class + state traits) — a plain
 *  `{traits}` object usable with RA.traitRate/traitSum/traitsOf. */
export function actorEffCarrier(a: any): any {
  const c = actorClass(a);
  const extra = stateTraitRows(a.states);
  return extra.length ? { traits: [...(c.traits || []), ...extra] } : c;
}
export function skillMpCost(a: any, skill: any): number {
  return Math.max(
    0,
    Math.ceil(
      (skill.mp || 0) * RA.traitRate(actorEffCarrier(a), "special", "mpCost", 1),
    ),
  );
}
export function skillPowerRate(a: any, skill: any): number {
  return RA.traitRate(actorEffCarrier(a), "skill", skill.type, 1);
}
export function actorIncomingRate(
  a: any,
  element: any,
  guarding: any,
  kind?: "phys" | "magic" | null,
): number {
  const c = actorEffCarrier(a);
  let rate = RA.traitRate(c, "element", element, 1);
  rate *= RA.traitRate(c, "special", "damageTaken", 1);
  // M3·B: MZ pdr/mdr fold in when the caller knows the damage kind (absent
  // traits ⇒ ×1, byte-identical natively).
  if (kind === "phys") rate *= RA.traitRate(c, "special", "physDamage", 1);
  else if (kind === "magic") rate *= RA.traitRate(c, "special", "magicDamage", 1);
  if (guarding) {
    rate *= RA.traitRate(c, "special", "guardDamage", 0.55);
    // MZ grd (guardEffect) deepens the guard — ÷grd, default 1 (M3·B).
    const grd = RA.traitRate(c, "special", "guardEffect", 1);
    if (grd > 0 && grd !== 1) rate /= grd;
  }
  return rate;
}
/** Is this skill sealed / type-gated for the actor (M3·B trait codes
 *  41/42/44)? Reads `stype || type` so imported heal skills keep their MZ
 *  skill type for gating. Native classes carry none of these keys ⇒ false. */
export function skillBlocked(a: any, skill: any): boolean {
  const c = actorEffCarrier(a);
  if (!((c.traits || []).length)) return false;
  const gateType = String(skill.stype || skill.type || "");
  if (RA.traitsOf(c, "skill", "seal:" + skill.id).length) return true;
  if (gateType && RA.traitsOf(c, "skill", "sealType:" + gateType).length) return true;
  // Add-Skill-Type gating: once a battler has ANY granted types, project
  // skill types it wasn't granted are unusable (MZ). Types outside the
  // project's skillTypes list (Atlas natives like "heal") stay ungated.
  const grants = (c.traits || []).filter(
    (t: any) => t && t.type === "skill" && String(t.key).startsWith("addType:"),
  );
  if (grants.length && gateType) {
    const listed = RA.typeList(ctx.proj, "skillTypes").some((s: any) => s.key === gateType);
    if (listed && !grants.some((t: any) => String(t.key) === "addType:" + gateType))
      return true;
  }
  return false;
}
export function canActorEquip(a: any, kind: any, itemId: any): boolean {
  return RA.canEquip(actorClass(a), kind, itemId);
}
/** Two-weapon fighting (post-1.1): the `special`/`dualWield` trait opens a
 *  second weapon slot (`a.weapon2Id`). Native classes never carry the key. */
export function canDualWield(a: any): boolean {
  return RA.traitsOf(actorEffCarrier(a), "special", "dualWield").length > 0;
}
export function sanitizeEquipment(a: any): void {
  if (!canActorEquip(a, "weapon", a.weaponId)) a.weaponId = 0;
  if (!canActorEquip(a, "armor", a.armorId)) a.armorId = 0;
  if (a.weapon2Id && (!canDualWield(a) || !canActorEquip(a, "weapon", a.weapon2Id)))
    a.weapon2Id = 0;
}
export function param(a: any, stat: any): number {
  const c = actorClass(a);
  let v = Math.floor(
    (c.base[stat] || 0) + (c.growth[stat] || 0) * (a.level - 1),
  );
  // Permanent per-actor bonus from the Change Parameters command (Project
  // Compass M2·C). Absent on every actor that never ran it → identical value.
  if (a.paramPlus) v += a.paramPlus[stat] || 0;
  const w = RA.byId(ctx.proj.weapons, a.weaponId),
    ar = RA.byId(ctx.proj.armors, a.armorId);
  // Seal Equip (M3·B trait 54): a sealed slot contributes nothing. Native
  // classes carry no seal rows, so the check never fires for them.
  const sealed = (kind: string) =>
    (c.traits || []).length && RA.traitsOf(c, "equip", "seal:" + kind).length > 0;
  if (w && w.params && !sealed("weapon")) v += w.params[stat] || 0;
  if (ar && ar.params && !sealed("armor")) v += ar.params[stat] || 0;
  // Second weapon (post-1.1 dual wield) — the field only exists on heroes
  // whose class grants it, so untouched actors take the exact old path.
  if (a.weapon2Id) {
    const w2 = RA.byId(ctx.proj.weapons, a.weapon2Id);
    if (w2 && w2.params && !sealed("weapon")) v += w2.params[stat] || 0;
  }
  v = Math.floor(v * RA.traitRate(actorEffCarrier(a), "param", stat, 1));
  // Luck floors at 0 (a missing Luck must read as neutral 0, not 1); the
  // classic seven keep their ≥1 floor.
  return Math.max(stat === "luk" ? 0 : 1, v);
}
/** Read-only battler facade for the sandboxed damage-formula evaluator
 *  (Project Compass M3·A, decision D1) — a plain snapshot of exactly the
 *  whitelisted stats, nothing else reachable. */
export function actorFormulaFacade(a: any): any {
  return {
    atk: param(a, "atk"), def: param(a, "def"), mat: param(a, "mat"),
    mdf: param(a, "mdf"), agi: param(a, "agi"), mhp: param(a, "mhp"),
    mmp: param(a, "mmp"), hp: a.hp, mp: a.mp, level: a.level || 1,
    luk: param(a, "luk"),
  };
}
export function learnedSkills(a: any): any[] {
  const c = actorClass(a);
  // Class learnings by level, plus any skill taught via Change Skills, minus
  // any suppressed via forget (Project Compass M2·C). Both lists are absent on
  // untouched actors → the exact class-learning set as before.
  const ids: number[] = (c.learnings || [])
    .filter((l: any) => l.level <= a.level)
    .map((l: any) => l.skillId);
  if (a.skills) for (const id of a.skills) if (!ids.includes(id)) ids.push(id);
  // Add-Skill traits (M3·B, `skill`/`add:<id>`) grant for real — from the
  // class and from active states. M1's inert numeric-key rows never match.
  for (const t of [...(c.traits || []), ...stateTraitRows(a.states)]) {
    if (t && t.type === "skill" && String(t.key).startsWith("add:")) {
      const id = Number(String(t.key).slice(4)) || 0;
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  const forgot = a.forgot;
  return ids
    .filter((id: number) => !(forgot && forgot.includes(id)))
    .map((id: number) => RA.byId(ctx.proj.skills, id))
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
    weapon2Id: d.weapon2Id || 0,
    hp: 1,
    mp: 1,
    // battle row (Phase 5): "front" unless the actor is authored back-row
    row: d.row === "back" ? "back" : "front",
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
  const key = String(t.key || "");
  const stateName = (id: any) => {
    const s = RA.byId(ctx.proj.states || [], Number(id));
    return s ? s.name : "State " + id;
  };
  const elementName = (k: string) => {
    const e = RA.typeList(ctx.proj, "elements").find((x: any) => x.key === k);
    return e ? e.name : k;
  };
  const skillName = (id: any) => {
    const s = RA.byId(ctx.proj.skills || [], Number(id));
    return s ? s.name : "Skill " + id;
  };
  if (t.type === "param") {
    if (key.startsWith("debuff:"))
      return key.slice(7).toUpperCase() + " debuff chance " + value + "%";
    return key.toUpperCase() + " " + value + "%";
  }
  if (t.type === "element") {
    if (key.startsWith("attack:"))
      return "Attacks carry " + elementName(key.slice(7));
    return elementName(key) + " damage " + value + "%";
  }
  if (t.type === "state") {
    if (key.startsWith("resist:")) return "Immune to " + stateName(key.slice(7));
    if (key.startsWith("attack:"))
      return "Attacks inflict " + stateName(key.slice(7)) + " " + value + "%";
    return stateName(key) + " chance " + value + "%";
  }
  if (t.type === "skill") {
    if (key.startsWith("add:")) return "Grants " + skillName(key.slice(4));
    if (key.startsWith("seal:")) return "Seals " + skillName(key.slice(5));
    if (key.startsWith("addType:") || key.startsWith("sealType:")) {
      const stKey = key.slice(key.indexOf(":") + 1);
      const st = RA.typeList(ctx.proj, "skillTypes").find((x: any) => x.key === stKey);
      return (key.startsWith("addType:") ? "Grants " : "Seals ") + (st ? st.name : stKey) + " skills";
    }
    return key.replace(/^\w/, (c: string) => c.toUpperCase()) + " skill power " + value + "%";
  }
  if (t.type === "equip") {
    if (key.startsWith("lock:")) return "Locked " + key.slice(5) + " slot";
    if (key.startsWith("seal:")) return "Sealed " + key.slice(5) + " slot";
    const item = RA.byId(
      t.key === "armor" ? ctx.proj.armors : ctx.proj.weapons,
      value,
    );
    return "Can equip " + (item ? item.name : t.key + " " + value);
  }
  if (t.key === "attackSkill") return "Attack casts " + skillName(value);
  const special = RA.TRAIT_SPECIALS.find((x: any) => x.v === t.key);
  return (
    (special ? special.l.replace(/ %$/, "") : t.key) + ": " + value + "%"
  );
}
