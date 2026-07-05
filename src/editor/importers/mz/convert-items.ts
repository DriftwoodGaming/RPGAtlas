/* RPGAtlas — src/editor/importers/mz/convert-items.ts
   Project Compass M1·A / M3·A / M3·B: Skills (type / element / scope / mp /
   effects + `formula` verbatim), Items (hp/mp/revive/desc + formula),
   Weapons/Armors (params, `luk` dropped; trait rows merge onto classes via
   convert-battlers.mergeEquipTraits since M3·B). Matrix §2/§6/§7. M3·A:
   formulas parse-validated at import (reject → kept verbatim + honest report +
   structured fallback, per D1) with the MZ companions (variance / critical /
   dmgType / powerPct / hpPct / mpPct). M3·B: tpCost/gainTp, `stype` (heal
   skills keep their type for seal gating), attackElement (elementId −1),
   attackStates (effect 21 dataId 0), buffs/debuffs (31–34), grow (42),
   learn (43), and item state add/remove (21/22 — cures at last).
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import type {
  Armor,
  BuffEffect,
  GrowEffect,
  Item,
  Skill,
  SkillScope,
  Weapon,
} from "../../../shared/schema";
import type { ImportReport } from "./report";
import type { RmArmor, RmDamage, RmEffect, RmItem, RmList, RmSkill, RmWeapon } from "./raw-types";
import { paramsFromArray } from "./convert-system";
import { bumpLuk } from "./traits";
import { paramKey } from "./slug";
import { parseFormula } from "../../../shared/formula";

const notNull = <T>(x: T | null): x is T => x != null;

/** MZ damage `type`: 3 HP-recover / 4 MP-recover are "heal" skills. */
function isHealType(dmg: RmDamage | undefined): boolean {
  return !!dmg && (dmg.type === 3 || dmg.type === 4);
}

/** MZ damage `type` → the M3·A `dmgType` variant (absent = plain HP). */
function dmgTypeOf(dmg: RmDamage | undefined): "mp" | "hpDrain" | "mpDrain" | undefined {
  switch (dmg && dmg.type) {
    case 2: case 4: return "mp"; // MP damage / MP recover
    case 5: return "hpDrain";
    case 6: return "mpDrain";
    default: return undefined;
  }
}

/** A non-trivial formula worth storing verbatim ("0"/"" are noise). */
function realFormula(dmg: RmDamage | undefined): string | undefined {
  const f = dmg && typeof dmg.formula === "string" ? dmg.formula.trim() : "";
  return f && f !== "0" ? dmg!.formula : undefined;
}

/** MZ skill/item scope (0–11) → Atlas `SkillScope` (+ revive for dead-target
 *  recover). Matrix §Skills. */
function mapScope(mz: number | undefined, report: ImportReport): { scope?: SkillScope; revive?: boolean } {
  switch (mz) {
    case 1:
      return { scope: "enemy" };
    case 2:
      return { scope: "enemies" };
    case 3:
    case 4:
    case 5:
    case 6:
      report.bump("scope-random", () => ({
        area: "Skills",
        kind: "partial",
        what: "random-target skills",
        detail: "random-target skills now hit all enemies",
      }));
      return { scope: "enemies" };
    case 7:
      return { scope: "ally" };
    case 8:
      return { scope: "allies" };
    case 9:
      return { scope: "ally", revive: true };
    case 10:
      return { scope: "allies", revive: true };
    case 11:
      report.bump("scope-user", () => ({
        area: "Skills",
        kind: "partial",
        what: "self-target skills",
        detail: "a 'user only' skill now targets an ally",
      }));
      return { scope: "ally" };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export function convertSkills(
  list: RmList<RmSkill>,
  report: ImportReport,
  elementKeyByIndex: string[],
  skillTypeKeyByIndex: string[],
): Skill[] {
  const out: Skill[] = [];
  for (const s of (list || []).filter(notNull)) {
    const heal = isHealType(s.damage);
    const type = heal ? "heal" : skillTypeKeyByIndex[s.stypeId || 0] || "phys";
    const skill: Skill = { id: s.id, name: s.name, type };
    if (s.iconIndex) skill.icon = s.iconIndex;
    if (s.mpCost) skill.mp = s.mpCost;
    if (s.tpCost) skill.tpCost = s.tpCost; // M3·B — honored while TP is active.
    if (s.repeats && s.repeats !== 1) skill.hits = s.repeats;
    if (s.animationId && s.animationId > 0) skill.animationId = s.animationId;
    // M3·B: heal skills lose their MZ skill type to Atlas's "heal", so the
    // original key rides `stype` — add/seal-type traits must still gate them
    // (a sealed "Magic" silences magic heals too).
    if (heal) {
      const stype = skillTypeKeyByIndex[s.stypeId || 0];
      if (stype) skill.stype = stype;
    }

    // Element: −1 = attacker's attack-element traits (M3·B `attackElement`),
    // 0 = none, n = key.
    const elId = s.damage ? s.damage.elementId : 0;
    if (elId && elId > 0) {
      const key = elementKeyByIndex[elId];
      if (key) skill.element = key;
    } else if (elId === -1 && s.damage && [1, 2, 5, 6].includes(s.damage.type)) {
      skill.attackElement = true;
    }

    const { scope, revive } = mapScope(s.scope, report);
    if (scope) skill.scope = scope;
    if (revive) skill.revive = true;

    // Damage formula (D1): stored verbatim, and since M3·A parsed at import —
    // a compilable formula just WORKS in battle; a rejected one is kept (a
    // later re-import can upgrade it) and honestly reported, and the skill
    // falls back to its structured power curve (never silently zero).
    const formula = realFormula(s.damage);
    if (formula) {
      skill.formula = formula;
      const parsed = parseFormula(formula);
      if (!parsed.ok) {
        report.bump("formula-reject", () => ({
          area: "Skills",
          kind: "partial",
          what: "damage formulas Atlas can't run yet",
          detail: "a formula used tricks outside Atlas's safe list — the skill uses simple damage instead",
        }));
      }
      // MZ pipeline companions travel with the formula.
      if (s.damage!.variance) skill.variance = s.damage!.variance;
      if (s.damage!.critical) skill.critical = true;
    }
    const dt = dmgTypeOf(s.damage);
    if (dt) skill.dmgType = dt;

    applyEffects(s.effects, skill, report, "Skills");
    out.push(skill);
  }
  return out;
}

/** MZ Add/Remove Buff effect (31–34) → one Atlas `BuffEffect` row, or null
 *  for a `luk` row (dropped + counted, D7). */
function buffEffectOf(e: RmEffect, report: ImportReport): BuffEffect | null {
  const stat = paramKey(e.dataId);
  if (!stat) {
    bumpLuk(report);
    return null;
  }
  const op: BuffEffect["op"] =
    e.code === 31 ? "buff" : e.code === 32 ? "debuff" : e.code === 33 ? "removeBuff" : "removeDebuff";
  const row: BuffEffect = { stat, op };
  if (e.code === 31 || e.code === 32) row.turns = Math.max(1, Number(e.value1) || 1);
  return row;
}

/** MZ Grow effect (42) → `GrowEffect`, or null for `luk`. */
function growEffectOf(e: RmEffect, report: ImportReport): GrowEffect | null {
  const stat = paramKey(e.dataId);
  if (!stat) {
    bumpLuk(report);
    return null;
  }
  return { stat, amount: Number(e.value1) || 0 };
}

/** Map recover/state/common-event effects onto Skill fields (matrix §6).
 *  %-recover converts since M3·A (`powerPct`); TP, buffs/debuffs, grow, learn,
 *  and the "normal attack" state (21 dataId 0) convert since M3·B — only the
 *  escape effect (41) still waits for M3·C. */
function applyEffects(
  effects: RmSkill["effects"],
  skill: Skill,
  report: ImportReport,
  area: string,
): void {
  let stateSet = false;
  for (const e of effects || []) {
    switch (e.code) {
      case 11: // Recover HP — flat part → power, %-of-max part → powerPct (M3·A).
        if (e.value2) skill.power = (skill.power || 0) + e.value2;
        if (e.value1)
          skill.powerPct = (skill.powerPct || 0) + Math.round((Number(e.value1) || 0) * 100);
        break;
      case 13: // Gain TP (M3·B).
        if (e.value1) skill.gainTp = (skill.gainTp || 0) + (Number(e.value1) || 0);
        break;
      case 21: // Add State. dataId 0 = "normal attack" → the attacker's
        // on-attack state traits roll on each landing hit (M3·B).
        if (e.dataId === 0) {
          skill.attackStates = true;
        } else if (!stateSet) {
          skill.stateId = e.dataId;
          skill.stateChance = Math.round((Number(e.value1) || 0) * 100) || 100;
          skill.stateOp = "add";
          stateSet = true;
        }
        break;
      case 22: // Remove State.
        if (!stateSet) {
          skill.stateId = e.dataId;
          skill.stateOp = "remove";
          stateSet = true;
        }
        break;
      case 31: case 32: case 33: case 34: { // Buffs/debuffs (M3·B).
        const row = buffEffectOf(e, report);
        if (row) (skill.buffs || (skill.buffs = [])).push(row);
        break;
      }
      case 42: { // Grow (M3·B) — permanent stat bonus on the target.
        const row = growEffectOf(e, report);
        if (row) (skill.grow || (skill.grow = [])).push(row);
        break;
      }
      case 43: // Learn Skill (M3·B).
        if (e.dataId) (skill.learn || (skill.learn = [])).push(e.dataId);
        break;
      case 44: // Common Event.
        skill.commonEventId = e.dataId;
        break;
      case 12: // Recover MP (skills have no MP-restore field).
        report.bump("skill-mp-recover", () => ({
          area,
          kind: "todo",
          what: "MP-restoring skills",
          detail: "skills that restore MP arrive in a later update",
        }));
        break;
      case 41: // Special Effect: escape — battle flow, M3·C.
        report.bump("skill-escape", () => ({
          area,
          kind: "todo",
          what: "escape-from-battle skills",
          detail: "skills that let you flee the battle arrive in a later update",
        }));
        break;
      default:
        report.bump("skill-effect", () => ({
          area,
          kind: "todo",
          what: "extra skill effects",
          detail: "some skill effects need a later update",
        }));
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export function convertItems(list: RmList<RmItem>, report: ImportReport): Item[] {
  const out: Item[] = [];
  for (const it of (list || []).filter(notNull)) {
    const item: Item = { id: it.id, name: it.name };
    if (it.iconIndex) item.icon = it.iconIndex;
    if (it.price) item.price = it.price;
    if (it.description) item.desc = it.description;

    let stateSet = false;
    for (const e of it.effects || []) {
      switch (e.code) {
        case 11: case 12: {
          // Recover HP/MP — flat part → hp/mp, %-of-max part → hpPct/mpPct (M3·A).
          const flat: "hp" | "mp" = e.code === 11 ? "hp" : "mp";
          const pctKey: "hpPct" | "mpPct" = e.code === 11 ? "hpPct" : "mpPct";
          if (e.value2) item[flat] = (item[flat] || 0) + e.value2;
          if (e.value1)
            item[pctKey] = (item[pctKey] || 0) + Math.round((Number(e.value1) || 0) * 100);
          break;
        }
        case 13: // Gain TP (M3·B).
          if (e.value1) item.gainTp = (item.gainTp || 0) + (Number(e.value1) || 0);
          break;
        case 21: // Add State (M3·B — items can inflict too). dataId 0 needs an
          // attacker's attack states, which item use has no carrier for.
          if (e.dataId && !stateSet) {
            item.stateId = e.dataId;
            item.stateChance = Math.round((Number(e.value1) || 0) * 100) || 100;
            item.stateOp = "add";
            stateSet = true;
          }
          break;
        case 22: // Remove State (M3·B) — the Antidote finally cures.
          if (!stateSet) {
            item.stateId = e.dataId;
            item.stateOp = "remove";
            stateSet = true;
          }
          break;
        case 31: case 32: case 33: case 34: { // Buffs/debuffs (M3·B).
          const row = buffEffectOf(e, report);
          if (row) (item.buffs || (item.buffs = [])).push(row);
          break;
        }
        case 42: { // Grow (M3·B).
          const row = growEffectOf(e, report);
          if (row) (item.grow || (item.grow = [])).push(row);
          break;
        }
        case 43: // Learn Skill (M3·B).
          if (e.dataId) (item.learn || (item.learn = [])).push(e.dataId);
          break;
        default:
          report.bump("item-effect", () => ({
            area: "Items",
            kind: "todo",
            what: "extra item effects",
            detail: "some item effects need a later update",
          }));
          break;
      }
    }

    // Dead-target recover items revive (matrix §Items).
    if ((it.scope === 9 || it.scope === 10) && item.hp) item.revive = true;

    // Item formulas (M3·A): a recover-type formula (damage.type 3/4) adds to
    // the item's healing (useItemOn evaluates it with a = b = target). An
    // OFFENSIVE formula has no home — Atlas's battle has no use-item-on-enemy
    // flow — so it is reported, not stored (storing it would heal instead).
    const formula = realFormula(it.damage);
    if (formula && it.damage) {
      if (it.damage.type === 4) {
        // MP-recover formulas have no Item carrier yet (Item.formula heals HP).
        report.bump("item-mp-formula", () => ({
          area: "Items",
          kind: "todo",
          what: "MP-restoring item formulas",
          detail: "an item that restores MP by formula needs a later update — its flat amount still works",
        }));
      } else if (it.damage.type === 3) {
        item.formula = formula;
        if (!parseFormula(formula).ok) {
          report.bump("formula-reject", () => ({
            area: "Items",
            kind: "partial",
            what: "recovery formulas Atlas can't run yet",
            detail: "a formula used tricks outside Atlas's safe list — the item uses its flat amount instead",
          }));
        }
        if (it.damage.variance) item.variance = it.damage.variance;
      } else {
        report.bump("item-attack", () => ({
          area: "Items",
          kind: "todo",
          what: "items that damage enemies",
          detail: "battle items that attack need a later update — they heal-only for now",
        }));
      }
    }

    if (it.itypeId === 2) {
      report.add({
        area: "Items",
        kind: "skipped",
        what: item.name + " (key item)",
        detail: "Atlas keeps all items in one bag — this becomes a normal item",
      });
    }
    if (it.consumable === false) {
      report.add({
        area: "Items",
        kind: "skipped",
        what: item.name + " (reusable)",
        detail: "Atlas items are used up when used",
      });
    }
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weapons & Armors
// ---------------------------------------------------------------------------

export function convertWeapons(list: RmList<RmWeapon>, report: ImportReport): Weapon[] {
  const out: Weapon[] = [];
  for (const w of (list || []).filter(notNull)) {
    const weapon: Weapon = { id: w.id, name: w.name };
    if (w.iconIndex) weapon.icon = w.iconIndex;
    if (w.price) weapon.price = w.price;
    if (w.wtypeId) weapon.wtypeId = w.wtypeId;
    if (w.animationId && w.animationId > 0) weapon.animationId = w.animationId;
    const params = paramsFromArray(w.params, () => bumpLuk(report));
    if (Object.keys(params).length) weapon.params = params;
    // Trait rows merge onto the wearers' classes (M3·B, D6) — see
    // convert-battlers.mergeEquipTraits.
    out.push(weapon);
  }
  return out;
}

export function convertArmors(list: RmList<RmArmor>, report: ImportReport): Armor[] {
  const out: Armor[] = [];
  for (const a of (list || []).filter(notNull)) {
    const armor: Armor = { id: a.id, name: a.name };
    if (a.iconIndex) armor.icon = a.iconIndex;
    if (a.price) armor.price = a.price;
    if (a.atypeId) armor.atypeId = a.atypeId;
    if (a.etypeId) armor.etypeId = a.etypeId;
    const params = paramsFromArray(a.params, () => bumpLuk(report));
    if (Object.keys(params).length) armor.params = params;
    out.push(armor);
  }
  return out;
}
