/* RPGAtlas — src/editor/importers/mz/traits.ts
   Project Compass M1·A: MZ trait rows → Atlas `Trait` rows (matrix §5, decision
   D6/D7). Atlas trait `value` is a PERCENTAGE (RA.traitRate divides by 100), so
   MZ multipliers/probabilities convert as round(mz × 100). Only the six
   "directly-representable" D6 codes are emitted; the three the engine reads
   (11 element / 13 state / 21 param) change gameplay, the other three
   (43 add-skill, 51/52 equip-type) are preserved-but-inert by design (Atlas
   semantics differ — see mig-1-spec A2). `luk` (param index 7) is a locked skip
   aggregated into one report line (D7). Copyright (C) 2026 RPGAtlas
   contributors — GPL-3.0-or-later (see LICENSE). */

import type { Trait } from "../../../shared/schema";
import type { RmTrait } from "./raw-types";
import type { ImportReport } from "./report";
import { paramKey } from "./slug";

export interface TraitConvertCtx {
  /** MZ element index → synthesized Atlas element key (index 0 = ""). */
  elementKeyByIndex: string[];
  report: ImportReport;
  /** Report area label ("Classes" / "Actors"). */
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

/** Convert one MZ trait row to an Atlas `Trait`, or null when it isn't one of
 *  the six representable codes (reported for M3·B) or is a `luk` param (dropped
 *  + counted). Pushes report lines as needed. */
export function convertTrait(t: RmTrait, ctx: TraitConvertCtx): Trait | null {
  switch (t.code) {
    case 11: {
      // Element Rate — the engine reads this (actorIncomingRate).
      const key = ctx.elementKeyByIndex[t.dataId];
      if (!key) return null; // dataId 0 = "(none)" element — nothing to resist.
      return { type: "element", key, value: pct(t.value) };
    }
    case 13:
      // State Rate — the engine reads this (applySkillState).
      return { type: "state", key: String(t.dataId), value: pct(t.value) };
    case 21: {
      // Parameter rate — the engine reads this (param()).
      const pk = paramKey(t.dataId);
      if (!pk) {
        bumpLuk(ctx.report);
        return null;
      }
      return { type: "param", key: pk, value: pct(t.value) };
    }
    case 43:
      // Add Skill — Atlas `skill` traits are damage-rate amps keyed by skill
      // TYPE, so an id-keyed row is a harmless no-op; preserved for M3·B.
      ctx.report.add({
        area: ctx.area,
        kind: "partial",
        what: ctx.owner + ": bonus skill",
        detail: "a granted skill is noted but not yet applied (coming in a later update)",
        code: 43,
      });
      return { type: "skill", key: String(t.dataId), value: 100 };
    case 51:
    case 52:
      // Equip Weapon/Armor Type — Atlas `canEquip` keys on "weapon"/"armor" with
      // item-id values, so a "*Type" key never matches (equipment stays free);
      // preserved for M3·B.
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
    default:
      // 12/14/22/23/31–35/41/42/44/53–55/61–64 → M3·B.
      ctx.report.bump("adv-trait", () => ({
        area: "Battlers",
        kind: "todo",
        what: "advanced battler bonuses",
        detail: "some trait effects need a later update to work (they'll turn on when you re-import)",
      }));
      return null;
  }
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
