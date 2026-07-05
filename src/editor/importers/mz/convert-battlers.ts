/* RPGAtlas — src/editor/importers/mz/convert-battlers.ts
   Project Compass M1·A: the battler DB — Classes (curve fit + traits +
   learnings), Actors (equip reduction + actor-trait merge onto class, D6),
   Enemies (stats + actions + condition kinds), States (restrict / turns /
   `hpTurn` from the hrg trait). Matrix §2/§5/§8. Copyright (C) 2026 RPGAtlas
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
  RmClass,
  RmEnemy,
  RmEnemyAction,
  RmList,
  RmState,
} from "./raw-types";
import { paramsFromArray } from "./convert-system";
import { slugKey, PARAM_KEYS } from "./slug";
import { bumpLuk, convertTraits, type TraitConvertCtx } from "./traits";

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

export function convertClasses(list: RmList<RmClass>, report: ImportReport, elementKeyByIndex: string[]): ClassDef[] {
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
    if (params.length > 7) bumpLuk(report); // luk curve dropped (D7)

    const ctx: TraitConvertCtx = {
      elementKeyByIndex,
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
    const equips = a.equips || [];
    if (equips[0]) actor.weaponId = equips[0];
    let armorId = 0;
    let extraArmors = 0;
    for (let i = 1; i < equips.length; i++) {
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
// Enemies
// ---------------------------------------------------------------------------

/** Map an MZ enemy action condition to Atlas's `EnemyActionCond` (matrix §8:
 *  always/turn/hp/state land in M1·A; switch/party-level → M3·C, reported). */
function enemyCond(a: RmEnemyAction, report: ImportReport): EnemyActionCond | undefined {
  switch (a.conditionType) {
    case 0:
      return undefined; // Always.
    case 1:
      return { kind: "turn", a: a.conditionParam1 || 0, b: a.conditionParam2 || 0 };
    case 2:
      // HP rate between p1..p2 (0..1) → fires while HP ≤ the upper bound.
      report.bump("enemy-cond", () => ({
        area: "Enemies",
        kind: "partial",
        what: "enemy action timing",
        detail: "some enemy action conditions were simplified",
      }));
      return { kind: "hpBelow", pct: Math.round((a.conditionParam2 || 1) * 100) };
    case 4:
      return { kind: "stateSelf", stateId: a.conditionParam1 || 0 };
    default:
      // 3 MP · 5 party level · 6 switch → M3·C.
      report.bump("enemy-cond-todo", () => ({
        area: "Enemies",
        kind: "todo",
        what: "advanced enemy action conditions",
        detail: "MP / party-level / switch conditions turn on in a later update",
      }));
      return undefined;
  }
}

export function convertEnemies(list: RmList<RmEnemy>, report: ImportReport): Enemy[] {
  const out: Enemy[] = [];
  for (const e of (list || []).filter(notNull)) {
    const enemy: Enemy = {
      id: e.id,
      name: e.name,
      stats: paramsFromArray(e.params, () => bumpLuk(report)),
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

    if ((e.dropItems || []).some((d) => d && d.kind && d.dataId)) {
      report.bump("enemy-drops", () => ({
        area: "Enemies",
        kind: "todo",
        what: "enemy item drops",
        detail: "loot from defeated enemies arrives in a later update",
      }));
    }
    if (e.traits && e.traits.length) {
      report.bump("enemy-traits", () => ({
        area: "Enemies",
        kind: "todo",
        what: "enemy resistances & bonuses",
        detail: "enemy element/state resistances need a later update (Atlas enemies don't store them yet)",
      }));
    }
    out.push(enemy);
  }
  return out;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function convertStates(list: RmList<RmState>, report: ImportReport): StateDef[] {
  const out: StateDef[] = [];
  for (const s of (list || []).filter(notNull)) {
    const st: StateDef = { id: s.id, name: s.name };
    if (s.iconIndex) st.icon = s.iconIndex;
    st.restrict = s.restriction ? "act" : "none";
    if (s.minTurns != null) st.minTurns = s.minTurns;
    if (s.maxTurns != null) st.maxTurns = s.maxTurns;
    if (s.autoRemovalTiming === 2) st.removeAtEnd = true;

    // Slip-damage / regen comes from the hrg ex-param trait (code 22, dataId 7).
    const hrg = (s.traits || []).find((t) => t.code === 22 && t.dataId === 7);
    if (hrg) st.hpTurn = Math.round((Number(hrg.value) || 0) * 100);

    if (s.restriction && s.restriction >= 1 && s.restriction <= 3) {
      report.bump("state-restrict", () => ({
        area: "States",
        kind: "partial",
        what: "state attack restrictions",
        detail: "'attack an ally/enemy' restrictions become a plain 'can't act' in Atlas",
      }));
    }
    if (s.removeByDamage || s.removeByWalking || s.removeByRestriction || s.removeAtBattleEnd) {
      report.bump("state-timing", () => ({
        area: "States",
        kind: "todo",
        what: "extra state removal rules",
        detail: "removing a state by damage / walking / battle-end arrives in a later update",
      }));
    }
    // Non-hrg state traits have no Atlas carrier yet.
    if ((s.traits || []).some((t) => !(t.code === 22 && t.dataId === 7))) {
      report.bump("state-traits", () => ({
        area: "States",
        kind: "todo",
        what: "state bonuses",
        detail: "extra effects attached to states need a later update",
      }));
    }
    out.push(st);
  }
  return out;
}
