/* RPGAtlas — src/editor/importers/mz/convert-battlers.ts
   Project Compass M1·A / M3·B: the battler DB — Classes (curve fit + traits +
   learnings), Actors (equip reduction + actor-trait merge onto class, D6),
   Enemies (stats + actions + condition kinds + their own trait carrier, M3·B),
   States (restrict / turns / `hpTurn` from the hrg trait, plus M3·B removal
   timing and live state traits). Weapon/armor trait rows merge onto the class
   of each initially-equipping actor (D6 (a), flipped from M1's report-only
   stance in M3·B). Matrix §2/§5/§8. Copyright (C) 2026 RPGAtlas
   contributors — GPL-3.0-or-later (see LICENSE). */

import type {
  Actor,
  ClassDef,
  Enemy,
  EnemyAction,
  EnemyActionCond,
  Learning,
  Params,
  StateDef,
} from "../../../shared/schema";
import type { ImportReport } from "./report";
import type {
  RmActor,
  RmArmor,
  RmClass,
  RmEnemy,
  RmEnemyAction,
  RmList,
  RmState,
  RmWeapon,
} from "./raw-types";
import { paramsFromArray } from "./convert-system";
import { slugKey, PARAM_KEYS } from "./slug";
import { convertTraits, type TraitConvertCtx } from "./traits";

const round2 = (x: number): number => Math.round(x * 100) / 100;
const notNull = <T>(x: T | null): x is T => x != null;

/** Fit one MZ param curve (`params[p]`, levels at indices 1..L) to Atlas
 *  base(level 1) + linear growth(per level). */
function fitCurve(row: number[] | undefined): { base: number; growth: number } {
  const r = Array.isArray(row) ? row : [];
  const base = Number(r[1]) || 0;
  const last = r.length - 1;
  const growth = last > 1 ? round2((Number(r[last]) - base) / (last - 1)) : 0;
  return { base, growth };
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export function convertClasses(
  list: RmList<RmClass>,
  report: ImportReport,
  elementKeyByIndex: string[],
  skillTypeKeyByIndex: string[],
): ClassDef[] {
  const out: ClassDef[] = [];
  for (const c of (list || []).filter(notNull)) {
    const base: Params = {};
    const growth: Params = {};
    const params = c.params || [];
    for (let p = 0; p < 7; p++) {
      const key = PARAM_KEYS[p] as keyof Params;
      const fit = fitCurve(params[p]);
      base[key] = fit.base;
      growth[key] = fit.growth;
    }
    // Post-1.1: the luk curve (index 7) fits like the rest — Atlas grew a
    // Luck param. Only set when RM provided one, so the classic seven-key
    // shape is unchanged for hand-fed short arrays.
    if (params.length > 7) {
      const fit = fitCurve(params[7]);
      base.luk = fit.base;
      growth.luk = fit.growth;
    }

    const ctx: TraitConvertCtx = {
      elementKeyByIndex,
      skillTypeKeyByIndex,
      report,
      area: "Classes",
      owner: "the " + c.name + " class",
    };
    const traits = convertTraits(c.traits, ctx);
    const learnings: Learning[] = (c.learnings || [])
      .filter((l) => l && l.skillId)
      .map((l) => ({ level: l.level, skillId: l.skillId }));

    if (params.length) {
      report.bump("curve", () => ({
        area: "Classes",
        kind: "partial",
        what: "class stat curves",
        detail: "detailed level-by-level stat tables were simplified to a base value + steady growth",
      }));
    }

    const cls: ClassDef = { id: c.id, name: c.name, base, growth, traits };
    if (learnings.length) cls.learnings = learnings;
    out.push(cls);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Actors (equip reduction + actor-trait merge onto class)
// ---------------------------------------------------------------------------

export function convertActors(
  list: RmList<RmActor>,
  classes: ClassDef[],
  report: ImportReport,
  elementKeyByIndex: string[],
  skillTypeKeyByIndex: string[],
): Actor[] {
  const byClassId = new Map(classes.map((c) => [c.id, c]));
  const out: Actor[] = [];
  for (const a of (list || []).filter(notNull)) {
    const actor: Actor = {
      id: a.id,
      name: a.name,
      classId: a.classId,
      level: a.initialLevel || 1,
    };
    const charset = slugKey(a.characterName || "") + (a.characterIndex ? "-" + a.characterIndex : "");
    if (charset) actor.charset = charset;

    // equips[] → first weapon + first armor; the rest are reported (matrix §2).
    // Post-1.1: a dual-wield hero's slot 2 holds a WEAPON id in RM — it lands
    // on the new second weapon slot instead of being misread as armor.
    const cls0 = byClassId.get(a.classId);
    const dualWield =
      (!!cls0 && cls0.traits.some((t) => t.type === "special" && t.key === "dualWield")) ||
      // The trait may also sit on the actor record (merged onto the class below).
      (a.traits || []).some((t) => t && t.code === 55 && t.dataId === 1);
    const equips = a.equips || [];
    if (equips[0]) actor.weaponId = equips[0];
    let armorStart = 1;
    if (dualWield) {
      if (equips[1]) actor.weapon2Id = equips[1];
      armorStart = 2;
    }
    let armorId = 0;
    let extraArmors = 0;
    for (let i = armorStart; i < equips.length; i++) {
      if (!equips[i]) continue;
      if (!armorId) armorId = equips[i];
      else extraArmors++;
    }
    if (armorId) actor.armorId = armorId;
    if (extraArmors) {
      report.add({
        area: "Actors",
        kind: "partial",
        what: a.name + "'s extra equipment",
        detail: extraArmors + " more equipment slot(s) — Atlas heroes wear one weapon and one armor",
      });
    }

    // Actor-level traits merge onto the actor's class (D6 (a)).
    if (a.traits && a.traits.length) {
      const cls = byClassId.get(a.classId);
      if (cls) {
        const ctx: TraitConvertCtx = {
          elementKeyByIndex,
          skillTypeKeyByIndex,
          report,
          area: "Actors",
          owner: a.name,
        };
        const merged = convertTraits(a.traits, ctx);
        if (merged.length) {
          cls.traits.push(...merged);
          report.add({
            area: "Actors",
            kind: "partial",
            what: a.name + "'s personal bonuses",
            detail: "moved onto the " + cls.name + " class (Atlas keeps bonuses on classes)",
          });
        }
      }
    }

    if (a.nickname || a.profile) {
      report.add({
        area: "Actors",
        kind: "skipped",
        what: a.name + "'s nickname/profile",
        detail: "Atlas heroes don't have a nickname or profile field",
      });
    }
    if (a.maxLevel && a.maxLevel < 99) {
      report.add({
        area: "Actors",
        kind: "skipped",
        what: a.name + "'s level cap",
        detail: "a custom max level (" + a.maxLevel + ") — Atlas caps levels its own way",
      });
    }
    if (a.battlerName) {
      report.bump("sv-battler", () => ({
        area: "Actors",
        kind: "skipped",
        what: "side-view battler art",
        detail: "Atlas uses its own battle effects instead of side-view battler sheets",
      }));
    }
    out.push(actor);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weapon/armor trait merge (D6 (a), flipped in M3·B)
// ---------------------------------------------------------------------------

/** Merge weapon/armor trait rows onto the class of each actor who starts with
 *  that equip (Atlas has no per-equip trait carrier — D6). One report line per
 *  merged source (required by D6); a trait-bearing equip nobody starts with is
 *  reported honestly instead. Deduped per (class, item) so two same-class
 *  actors sharing a sword don't double its bonuses. */
export function mergeEquipTraits(
  actors: Actor[],
  classes: ClassDef[],
  weapons: RmList<RmWeapon>,
  armors: RmList<RmArmor>,
  report: ImportReport,
  elementKeyByIndex: string[],
  skillTypeKeyByIndex: string[],
): void {
  const byClassId = new Map(classes.map((c) => [c.id, c]));
  const rawWeapons = new Map((weapons || []).filter(notNull).map((w) => [w.id, w]));
  const rawArmors = new Map((armors || []).filter(notNull).map((a) => [a.id, a]));
  const merged = new Set<string>();
  const worn = new Set<string>();

  const mergeOne = (kind: "weapon" | "armor", id: number | undefined, cls: ClassDef | undefined): void => {
    const src = kind === "weapon" ? rawWeapons.get(id || 0) : rawArmors.get(id || 0);
    if (!src || !src.traits || !src.traits.length) return;
    worn.add(kind + ":" + src.id);
    if (!cls || merged.has(cls.id + "/" + kind + ":" + src.id)) return;
    merged.add(cls.id + "/" + kind + ":" + src.id);
    const rows = convertTraits(src.traits, {
      elementKeyByIndex,
      skillTypeKeyByIndex,
      report,
      area: "Equipment",
      owner: src.name,
    });
    if (!rows.length) return;
    cls.traits.push(...rows);
    report.add({
      area: "Equipment",
      kind: "partial",
      what: src.name + "'s special effects",
      detail: "moved onto the " + cls.name + " class (Atlas keeps bonuses on classes, so they apply even when re-equipped)",
    });
  };

  for (const a of actors) {
    const cls = byClassId.get(a.classId);
    mergeOne("weapon", a.weaponId, cls);
    mergeOne("armor", a.armorId, cls);
  }
  // Trait-bearing equips nobody starts with: their rows have nowhere to live.
  for (const [kind, map] of [["weapon", rawWeapons], ["armor", rawArmors]] as const) {
    for (const src of map.values()) {
      if (src.traits && src.traits.length && !worn.has(kind + ":" + src.id)) {
        report.add({
          area: "Equipment",
          kind: "partial",
          what: src.name + "'s special effects",
          detail: "no hero starts with it, so its bonuses couldn't move onto a class (base stats still work)",
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

/** Map an MZ enemy action condition to Atlas's `EnemyActionCond` (matrix §8:
 *  always/turn/hp/state landed in M1·A; MP/party-level/switch in M3·C). The
 *  HP/MP range conditions keep only their upper bound — one partial line. */
function enemyCond(a: RmEnemyAction, report: ImportReport): EnemyActionCond | undefined {
  const rangeSimplified = () =>
    report.bump("enemy-cond", () => ({
      area: "Enemies",
      kind: "partial",
      what: "enemy action timing",
      detail: "some enemy action conditions were simplified",
    }));
  switch (a.conditionType) {
    case 0:
      return undefined; // Always.
    case 1:
      return { kind: "turn", a: a.conditionParam1 || 0, b: a.conditionParam2 || 0 };
    case 2:
      // HP rate between p1..p2 (0..1) → fires while HP ≤ the upper bound.
      rangeSimplified();
      return { kind: "hpBelow", pct: Math.round((a.conditionParam2 || 1) * 100) };
    case 3:
      // MP rate between p1..p2 → the same upper-bound simplification (M3·C).
      rangeSimplified();
      return { kind: "mpBelow", pct: Math.round((a.conditionParam2 || 1) * 100) };
    case 4:
      return { kind: "stateSelf", stateId: a.conditionParam1 || 0 };
    case 5:
      // Party level ≥ p1 (M3·C).
      return { kind: "partyLevel", a: a.conditionParam1 || 0 };
    case 6:
      // Switch p1 is ON (M3·C).
      return { kind: "switch", switchId: a.conditionParam1 || 0 };
    default:
      return undefined; // unknown condition type — the row always fires
  }
}

export function convertEnemies(
  list: RmList<RmEnemy>,
  report: ImportReport,
  elementKeyByIndex: string[],
  skillTypeKeyByIndex: string[],
): Enemy[] {
  const out: Enemy[] = [];
  for (const e of (list || []).filter(notNull)) {
    const enemy: Enemy = {
      id: e.id,
      name: e.name,
      stats: paramsFromArray(e.params),
    };
    if (e.battlerName) enemy.sprite = slugKey(e.battlerName);
    if (e.exp) enemy.exp = e.exp;
    if (e.gold) enemy.gold = e.gold;
    if (e.battlerHue) {
      report.bump("enemy-hue", () => ({
        area: "Enemies",
        kind: "partial",
        what: "enemy color tints",
        detail: "recolored enemies keep their base art (Atlas doesn't hue-shift battlers)",
      }));
    }

    const actions: EnemyAction[] = (e.actions || [])
      .filter((a) => a && a.skillId)
      .map((a) => {
        const cond = enemyCond(a, report);
        const act: EnemyAction = { skillId: a.skillId, weight: a.rating || 1 };
        if (cond) act.cond = cond;
        return act;
      });
    if (actions.length) enemy.actions = actions;

    // M3·C: dropItems → the optional `drops` carrier (kind 0 rows = "none").
    const DROP_KIND: Record<number, "item" | "weapon" | "armor"> = { 1: "item", 2: "weapon", 3: "armor" };
    const drops = (e.dropItems || [])
      .filter((d) => d && DROP_KIND[d.kind] && d.dataId)
      .map((d) => ({
        kind: DROP_KIND[d.kind],
        id: d.dataId,
        denominator: Math.max(1, Number(d.denominator) || 1),
      }));
    if (drops.length) enemy.drops = drops;
    // M3·B: enemies carry their own traits (D6 — the enemy IS its effective
    // battler). Element/state rates, counters, and combat specials all ride.
    if (e.traits && e.traits.length) {
      const rows = convertTraits(e.traits, {
        elementKeyByIndex,
        skillTypeKeyByIndex,
        report,
        area: "Enemies",
        owner: e.name,
      });
      if (rows.length) enemy.traits = rows;
    }
    out.push(enemy);
  }
  return out;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function convertStates(
  list: RmList<RmState>,
  report: ImportReport,
  elementKeyByIndex: string[],
  skillTypeKeyByIndex: string[],
): StateDef[] {
  const out: StateDef[] = [];
  for (const s of (list || []).filter(notNull)) {
    const st: StateDef = { id: s.id, name: s.name };
    if (s.iconIndex) st.icon = s.iconIndex;
    st.restrict = s.restriction ? "act" : "none";
    if (s.minTurns != null) st.minTurns = s.minTurns;
    if (s.maxTurns != null) st.maxTurns = s.maxTurns;
    // M3·B: the MZ removeAtBattleEnd field joins auto-removal timing 2 on the
    // Atlas "removed after battle" flag.
    if (s.autoRemovalTiming === 2 || s.removeAtBattleEnd) st.removeAtEnd = true;

    // Slip-damage / regen comes from the hrg ex-param trait (code 22, dataId 7)
    // — kept on the dedicated hpTurn field, NOT duplicated as an hpRegen trait.
    const hrg = (s.traits || []).find((t) => t.code === 22 && t.dataId === 7);
    if (hrg) st.hpTurn = Math.round((Number(hrg.value) || 0) * 100);

    // M3·B: removal timing set (walk-off / damage / restriction).
    if (s.removeByWalking && s.stepsToRemove) st.stepsToRemove = s.stepsToRemove;
    if (s.removeByDamage) st.removeByDamage = Math.max(0, Math.min(100, Number(s.chanceByDamage) || 100));
    if (s.removeByRestriction) st.removeByRestriction = true;

    // M3·B: the remaining state traits ride the state itself and join the
    // battler's effective traits while afflicted (Silence/Blind-style).
    const rest = (s.traits || []).filter((t) => !(t.code === 22 && t.dataId === 7));
    if (rest.length) {
      const rows = convertTraits(rest, {
        elementKeyByIndex,
        skillTypeKeyByIndex,
        report,
        area: "States",
        owner: s.name,
      });
      if (rows.length) st.traits = rows;
    }

    if (s.restriction && s.restriction >= 1 && s.restriction <= 3) {
      report.bump("state-restrict", () => ({
        area: "States",
        kind: "partial",
        what: "state attack restrictions",
        detail: "'attack an ally/enemy' restrictions become a plain 'can't act' in Atlas",
      }));
    }
    out.push(st);
  }
  return out;
}
