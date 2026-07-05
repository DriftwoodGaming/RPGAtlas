/* RPGAtlas — src/editor/importers/mz/traits.ts
   Project Compass M1·A / M3·B: MZ trait rows → Atlas `Trait` rows (matrix §5,
   decisions D6/D7). Atlas trait `value` is a PERCENTAGE (RA.traitRate divides
   by 100), so MZ multipliers/probabilities convert as round(mz × 100); the two
   flat-value keys (`attackSpeed` order bonus, `attackSkill` skill id) stay raw.
   Since M3·B every matrix `+` code converts: ex-params (22) and sp-params (23)
   become `special` keys, attack element/state ride prefixed `element`/`state`
   keys, skill grant/seal ride prefixed `skill` keys, equip lock/seal ride
   prefixed `equip` keys, and the 62 special flags map by dataId. Locked skips:
   `luk` (D7, one aggregated line), collapse effect (63), dual wield (55).
   Party abilities (64) stay a todo until M3·C per the matrix bill.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import type { Trait } from "../../../shared/schema";
import type { RmTrait } from "./raw-types";
import type { ImportReport } from "./report";
import { paramKey } from "./slug";

export interface TraitConvertCtx {
  /** MZ element index → synthesized Atlas element key (index 0 = ""). */
  elementKeyByIndex: string[];
  /** MZ skill-type index → synthesized Atlas skill-type key (M3·B, codes 41/42). */
  skillTypeKeyByIndex: string[];
  report: ImportReport;
  /** Report area label ("Classes" / "Actors" / "Enemies" / "States"…). */
  area: string;
  /** Owner display name for report detail ("the Wanderer class"). */
  owner: string;
}

const pct = (v: number): number => Math.round((Number(v) || 0) * 100);

/** The single aggregated `luk` report line (D7) — every dropped Luck value (a
 *  class curve, an equip param, an enemy stat, a param trait) funnels here. */
export function bumpLuk(report: ImportReport): void {
  report.bump("luk", () => ({
    area: "Stats",
    kind: "skipped",
    what: "the Luck stat",
    detail: "Atlas has 7 battle stats and no Luck — Luck values were left out",
  }));
}

/** Ex-param (code 22) dataId → Atlas `special` key. hit/eva/cri were M3·A;
 *  cev/mev/mrf/cnt/hrg/mrg/trg joined in M3·B. */
const EX_PARAM_KEYS = [
  "hitChance", "evadeChance", "critChance", "critEvade", "magicEvade",
  "magicReflect", "counterAttack", "hpRegen", "mpRegen", "tpRegen",
];

/** Sp-param (code 23) dataId → Atlas `special` key (M3·B). `mpCost` is the
 *  pre-existing Atlas key (MZ mcr maps straight onto it). */
const SP_PARAM_KEYS = [
  "targetRate", "guardEffect", "recovery", "itemEffect", "mpCost",
  "tpCharge", "physDamage", "magicDamage", "floorDamage", "expRate",
];

/** Special-flag (code 62) dataId → Atlas `special` key. autoBattle and
 *  substitute are stored now but only act with the M3·C battle flow. */
const SPECIAL_FLAG_KEYS = ["autoBattle", "guardFlag", "substitute", "preserveTp"];

/** Convert one MZ trait row to an Atlas `Trait`, or null when the row is a
 *  locked skip (luk/collapse/dual-wield), an empty reference, or a code that
 *  lands in a later phase (64 → M3·C). Pushes report lines as needed. */
export function convertTrait(t: RmTrait, ctx: TraitConvertCtx): Trait | null {
  switch (t.code) {
    case 11: {
      // Element Rate — the engine reads this (actorIncomingRate).
      const key = ctx.elementKeyByIndex[t.dataId];
      if (!key) return null; // dataId 0 = "(none)" element — nothing to resist.
      return { type: "element", key, value: pct(t.value) };
    }
    case 12: {
      // Debuff Rate (M3·B) — chance multiplier when an Add-Debuff effect rolls.
      const pk = paramKey(t.dataId);
      if (!pk) {
        bumpLuk(ctx.report);
        return null;
      }
      return { type: "param", key: "debuff:" + pk, value: pct(t.value) };
    }
    case 13:
      // State Rate — the engine reads this (applySkillState).
      return { type: "state", key: String(t.dataId), value: pct(t.value) };
    case 14:
      // State Resist (M3·B) — full immunity, checked inside addState.
      return { type: "state", key: "resist:" + t.dataId, value: 100 };
    case 21: {
      // Parameter rate — the engine reads this (param()).
      const pk = paramKey(t.dataId);
      if (!pk) {
        bumpLuk(ctx.report);
        return null;
      }
      return { type: "param", key: pk, value: pct(t.value) };
    }
    case 22: {
      // Ex-Param: additive special-trait percentages (hit/eva/cri since M3·A,
      // the other seven since M3·B).
      const key = EX_PARAM_KEYS[t.dataId];
      if (!key) return null; // out-of-range dataId — nothing it could mean.
      return { type: "special", key, value: pct(t.value) };
    }
    case 23: {
      // Sp-Param: multiplicative special-trait rates (M3·B).
      const key = SP_PARAM_KEYS[t.dataId];
      if (!key) return null;
      return { type: "special", key, value: pct(t.value) };
    }
    case 31: {
      // Attack Element (M3·B) — basic attacks carry this element.
      const key = ctx.elementKeyByIndex[t.dataId];
      if (!key) return null;
      return { type: "element", key: "attack:" + key, value: 100 };
    }
    case 32:
      // Attack State (M3·B) — rolled per landing basic-attack hit.
      return { type: "state", key: "attack:" + t.dataId, value: pct(t.value) };
    case 33:
      // Attack Speed (M3·B) — flat turn-order bonus when basic-attacking.
      return { type: "special", key: "attackSpeed", value: Number(t.value) || 0 };
    case 34:
      // Attack Times+ (M3·B) — 100 = one extra basic-attack hit (MZ sums
      // decimals and floors, so the percent convention carries fractions).
      return { type: "special", key: "attackTimes", value: pct(t.value) };
    case 35:
      // Attack Skill (M3·B) — the Attack command casts this skill instead.
      return { type: "special", key: "attackSkill", value: Number(t.dataId) || 0 };
    case 41: {
      // Add Skill Type (M3·B) — grants a skill-type command.
      const key = ctx.skillTypeKeyByIndex[t.dataId];
      if (!key) return null;
      return { type: "skill", key: "addType:" + key, value: 100 };
    }
    case 42: {
      // Seal Skill Type (M3·B) — Silence-style: the whole type is unusable.
      const key = ctx.skillTypeKeyByIndex[t.dataId];
      if (!key) return null;
      return { type: "skill", key: "sealType:" + key, value: 100 };
    }
    case 43:
      // Add Skill — since M3·B the engine grants it for real (learnedSkills),
      // so the key gained the explicit `add:` prefix (old numeric-key rows
      // from M1 imports were inert by design and stay inert).
      return { type: "skill", key: "add:" + t.dataId, value: 100 };
    case 44:
      // Seal Skill (M3·B) — that one skill is unusable.
      return { type: "skill", key: "seal:" + t.dataId, value: 100 };
    case 51:
    case 52:
      // Equip Weapon/Armor Type — Atlas `canEquip` keys on "weapon"/"armor" with
      // item-id values, so a "*Type" key never matches (equipment stays free);
      // preserved for a later phase.
      ctx.report.add({
        area: ctx.area,
        kind: "partial",
        what: ctx.owner + ": equip restriction",
        detail: "an equip-by-type rule was kept but isn't enforced yet",
        code: t.code,
      });
      return {
        type: "equip",
        key: t.code === 51 ? "weaponType" : "armorType",
        value: t.dataId,
      };
    case 53:
    case 54: {
      // Lock/Seal Equip (M3·B). MZ equip-type dataId 1 is the weapon slot;
      // everything else folds into Atlas's single armor slot.
      const slot = t.dataId === 1 ? "weapon" : "armor";
      const op = t.code === 53 ? "lock:" : "seal:";
      return { type: "equip", key: op + slot, value: 100 };
    }
    case 55:
      // Slot Type — dual wield has no home (Atlas heroes hold one weapon).
      if (t.dataId === 1) {
        ctx.report.bump("dual-wield", () => ({
          area: "Battlers",
          kind: "skipped",
          what: "two-weapon fighting",
          detail: "Atlas heroes hold one weapon — dual wield was left out",
        }));
      }
      return null;
    case 61:
      // Action Times+ (M3·B) — value% chance of an extra action each round.
      return { type: "special", key: "actionTimes", value: pct(t.value) };
    case 62: {
      // Special Flag (M3·B). Guard and Preserve-TP act now; auto-battle and
      // substitute are stored but wait for the M3·C battle flow.
      const key = SPECIAL_FLAG_KEYS[t.dataId];
      if (!key) return null;
      if (key === "autoBattle" || key === "substitute") {
        ctx.report.bump("battle-flow-trait", () => ({
          area: "Battlers",
          kind: "todo",
          what: "auto-battle & cover-ally effects",
          detail: "fighting automatically and protecting allies turn on in a later update",
        }));
      }
      return { type: "special", key, value: 100 };
    }
    case 63:
      // Collapse Effect — locked skip (Atlas uses its own defeat effect).
      ctx.report.bump("collapse", () => ({
        area: "Battlers",
        kind: "skipped",
        what: "custom defeat animations",
        detail: "Atlas plays its own defeat effect",
      }));
      return null;
    default:
      // 64 (party abilities) → M3·C; anything unknown keeps the honest line.
      bumpAdvTrait(ctx.report);
      return null;
  }
}

/** The aggregated "advanced battler bonuses" line — since M3·B only party
 *  abilities (code 64, an M3·C feature) and unknown codes land here. */
function bumpAdvTrait(report: ImportReport): void {
  report.bump("adv-trait", () => ({
    area: "Battlers",
    kind: "todo",
    what: "advanced battler bonuses",
    detail: "some trait effects need a later update to work (they'll turn on when you re-import)",
  }));
}

/** Convert a list of MZ trait rows, returning the representable Atlas rows. */
export function convertTraits(list: RmTrait[] | undefined, ctx: TraitConvertCtx): Trait[] {
  const out: Trait[] = [];
  for (const t of list || []) {
    const row = convertTrait(t, ctx);
    if (row) out.push(row);
  }
  return out;
}
