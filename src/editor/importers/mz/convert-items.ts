/* RPGAtlas — src/editor/importers/mz/convert-items.ts
   Project Compass M1·A: Skills (type / element / scope / mp / effects +
   `formula` verbatim), Items (hp/mp/revive/desc + formula), Weapons/Armors
   (params, `luk` dropped; trait rows reported). Matrix §2/§6/§7, decision
   A5 (formula field) / A3 (equip traits reported). Copyright (C) 2026 RPGAtlas
   contributors — GPL-3.0-or-later (see LICENSE). */

import type {
  Armor,
  Item,
  Skill,
  SkillScope,
  Weapon,
} from "../../../shared/schema";
import type { ImportReport } from "./report";
import type { RmArmor, RmDamage, RmItem, RmList, RmSkill, RmWeapon } from "./raw-types";
import { paramsFromArray } from "./convert-system";
import { bumpLuk } from "./traits";

const notNull = <T>(x: T | null): x is T => x != null;

/** MZ damage `type`: 3 HP-recover / 4 MP-recover are "heal" skills. */
function isHealType(dmg: RmDamage | undefined): boolean {
  return !!dmg && (dmg.type === 3 || dmg.type === 4);
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
    if (s.repeats && s.repeats !== 1) skill.hits = s.repeats;
    if (s.animationId && s.animationId > 0) skill.animationId = s.animationId;

    // Element: −1 = attacker's attack element (leave unset), 0 = none, n = key.
    const elId = s.damage ? s.damage.elementId : 0;
    if (elId && elId > 0) {
      const key = elementKeyByIndex[elId];
      if (key) skill.element = key;
    }

    const { scope, revive } = mapScope(s.scope, report);
    if (scope) skill.scope = scope;
    if (revive) skill.revive = true;

    // Damage formula stored verbatim for the M3·A evaluator (A5/D1).
    const formula = realFormula(s.damage);
    if (formula) {
      skill.formula = formula;
      if (!heal) {
        report.bump("formula", () => ({
          area: "Skills",
          kind: "todo",
          what: "damage formulas",
          detail: "custom damage formulas are saved and turn on in a later update",
        }));
      }
    }

    applyEffects(s.effects, skill, report, "Skills");
    out.push(skill);
  }
  return out;
}

/** Map recover/state/common-event effects onto Skill fields (matrix §6). Buffs,
 *  TP, learn, grow, %-recover → M3·A/B (reported). */
function applyEffects(
  effects: RmSkill["effects"],
  skill: Skill,
  report: ImportReport,
  area: string,
): void {
  let stateSet = false;
  for (const e of effects || []) {
    switch (e.code) {
      case 11: // Recover HP — flat part → power (heal amount).
        if (e.value2) skill.power = (skill.power || 0) + e.value2;
        break;
      case 21: // Add State.
        if (!stateSet) {
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
      default: // 13 TP · 31–34 buffs · 42 grow · 43 learn · 41 escape → M3·A/B.
        report.bump("skill-effect", () => ({
          area,
          kind: "todo",
          what: "extra skill effects",
          detail: "buffs, TP and other effects need a later update",
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

    for (const e of it.effects || []) {
      if (e.code === 11 && e.value2) item.hp = (item.hp || 0) + e.value2;
      else if (e.code === 12 && e.value2) item.mp = (item.mp || 0) + e.value2;
      else if (e.code === 22) {
        report.bump("item-cure", () => ({
          area: "Items",
          kind: "todo",
          what: "status-curing items",
          detail: "items that cure Poison/Sleep etc. arrive in a later update",
        }));
      } else if (e.code !== 11 && e.code !== 12) {
        report.bump("item-effect", () => ({
          area: "Items",
          kind: "todo",
          what: "extra item effects",
          detail: "some item effects need a later update",
        }));
      }
    }

    // Dead-target recover items revive (matrix §Items).
    if ((it.scope === 9 || it.scope === 10) && item.hp) item.revive = true;

    const formula = realFormula(it.damage);
    if (formula) item.formula = formula;

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
    reportEquipTraits(w.traits, report);
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
    reportEquipTraits(a.traits, report);
    out.push(armor);
  }
  return out;
}

/** Weapon/armor trait rows have no Atlas carrier (A3) — the stat block converts,
 *  the trait rows are reported for M3·B. */
function reportEquipTraits(traits: { code: number }[] | undefined, report: ImportReport): void {
  if (traits && traits.length) {
    report.bump("equip-traits", () => ({
      area: "Equipment",
      kind: "todo",
      what: "special equipment effects",
      detail: "bonuses like 'adds fire to attacks' need a later update (base stats still work)",
    }));
  }
}
