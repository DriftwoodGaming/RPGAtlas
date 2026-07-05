/* RPGAtlas — tests-unit/formula-eval.test.ts
   Project Compass M3·A: the sandboxed damage-formula evaluator (decision D1
   + gate amendments a/b) and the MZ damage pipeline. The reference vectors
   are HAND-COMPUTED from RPG Maker MZ's Game_Action math (evalDamageFormula /
   makeDamageValue / applyVariance / applyGuard) with stubbed randomInt
   sequences, so a pipeline regression cannot hide behind randomness.
   GPL-3.0-or-later (see LICENSE). */

import { describe, expect, it } from "vitest";
import {
  FORMULA_MAX_LENGTH,
  getFormula,
  mzApplyVariance,
  mzDamageValue,
  mzHitRoll,
  parseFormula,
  type FormulaEnv,
} from "../src/shared/formula";
import { mulberry32 } from "../src/shared/rng";
import { ImportReport } from "../src/editor/importers/mz/report";
import { convertItems, convertSkills } from "../src/editor/importers/mz/convert-items";
import type { RmItem, RmSkill } from "../src/editor/importers/mz/raw-types";

// The hand-computed vectors all use this attacker/target pair.
const A = { atk: 52, def: 30, mat: 25, mdf: 12, agi: 20, mhp: 300, mmp: 40, hp: 210, mp: 33, level: 7 };
const B = { atk: 14, def: 16, mat: 4, mdf: 6, agi: 10, mhp: 120, mmp: 0, hp: 120, mp: 0, level: 0 };

/** Env with a scripted randomInt sequence (fails loudly if over-drawn). */
function env(seq: number[] = [], vars: Record<number, number> = { 3: 7 }): FormulaEnv & { draws: () => number } {
  let i = 0;
  return {
    a: A,
    b: B,
    v: (n) => vars[n] || 0,
    randomInt: () => {
      if (i >= seq.length) throw new Error("randomInt over-drawn");
      return seq[i++];
    },
    draws: () => i,
  };
}

const evalSrc = (src: string, e: FormulaEnv = env()): number => {
  const f = getFormula(src);
  if (!f) throw new Error("expected " + src + " to compile");
  return f.eval(e);
};

// ---------------------------------------------------------------------------
// Grammar — what the D1 whitelist accepts
// ---------------------------------------------------------------------------

describe("formula grammar (D1 whitelist)", () => {
  it("evaluates the fixture formulas to their hand-computed bases", () => {
    // Attack: 52·4 − 16·2 = 176 · Firebolt: 25·2 − 6 + v[3]=7 → 51 ·
    // Heal: 25·2 + 50 = 100.
    expect(evalSrc("a.atk * 4 - b.def * 2")).toBe(176);
    expect(evalSrc("a.mat * 2 - b.mdf + v[3]")).toBe(51);
    expect(evalSrc("(a.mat * 2) + 50")).toBe(100);
  });

  it("reads every whitelisted stat off both facades", () => {
    expect(evalSrc("a.atk + a.def + a.mat + a.mdf + a.agi")).toBe(52 + 30 + 25 + 12 + 20);
    expect(evalSrc("a.mhp + a.mmp + a.hp + a.mp + a.level")).toBe(300 + 40 + 210 + 33 + 7);
    expect(evalSrc("b.level")).toBe(0); // enemies read level 0 (MZ would throw → 0)
  });

  it("knows arithmetic precedence, parens, modulo and unary minus", () => {
    expect(evalSrc("2 + 3 * 4")).toBe(14);
    expect(evalSrc("(2 + 3) * 4")).toBe(20);
    expect(evalSrc("a.atk % 5")).toBe(2);
    expect(evalSrc("-a.atk + 60")).toBe(8);
    expect(evalSrc("10 - -5")).toBe(15);
  });

  it("supports comparisons and ternaries (JS truthiness)", () => {
    expect(evalSrc("a.hp > 100 ? 50 : 25")).toBe(50);
    expect(evalSrc("a.level == 7 ? v[3] : 0")).toBe(7);
    expect(evalSrc("b.level === 0 ? 1 : 2")).toBe(1);
    expect(evalSrc("1 < 2 == 1")).toBe(1);
    expect(evalSrc("a.atk != 52 ? 100 : 3")).toBe(3);
  });

  it("supports the nine whitelisted Math functions", () => {
    expect(evalSrc("Math.max(a.atk - b.def, 10)")).toBe(36);
    expect(evalSrc("Math.min(3, 8, 2)")).toBe(2);
    expect(evalSrc("Math.pow(2, 5)")).toBe(32);
    expect(evalSrc("Math.sqrt(81)")).toBe(9);
    expect(evalSrc("Math.floor(7 / 2)")).toBe(3);
    expect(evalSrc("Math.ceil(7 / 2)")).toBe(4);
    expect(evalSrc("Math.round(7.4)")).toBe(7);
    expect(evalSrc("Math.abs(b.mdf - a.mdf)")).toBe(6);
  });

  it("routes Math.randomInt through the INJECTED rng (amendment a)", () => {
    const e = env([7]);
    expect(evalSrc("Math.randomInt(10) + 5", e)).toBe(12);
    expect(e.draws()).toBe(1);
  });

  it("indexes game variables with full expressions", () => {
    expect(evalSrc("v[1 + 2]")).toBe(7);
    expect(evalSrc("v[99]")).toBe(0); // unset variable reads 0, not NaN
  });

  it("clamps the MZ boundary: negatives, NaN and Infinity all → 0", () => {
    expect(evalSrc("10 - 50")).toBe(0); // Math.max(eval, 0)
    expect(evalSrc("v[99] / v[98]")).toBe(0); // 0/0 = NaN → 0
    expect(evalSrc("a.atk / 0")).toBe(0); // Infinity → 0 (kid-safe deviation)
  });
});

// ---------------------------------------------------------------------------
// Rejects — the sandbox stays shut
// ---------------------------------------------------------------------------

describe("formula rejects (parsed, never executed)", () => {
  const rejects = [
    ["a.atk = 5", "assignment"],
    ["a.atk += 1", "compound assignment"],
    ["window.alert(1)", "ambient global"],
    ["alert(1)", "bare function call"],
    ["a['atk']", "bracket access on a facade"],
    ["a.constructor", "constructor escape"],
    ["a.__proto__ + 1", "__proto__ escape"],
    ["a.luk", "luk is a locked skip (D7)"],
    ["Math.random()", "unseeded randomness"],
    ["Math.imul(1, 2)", "non-whitelisted Math fn"],
    ["Math.pow(2)", "wrong arity (too few)"],
    ["Math.floor(1, 2)", "wrong arity (too many)"],
    ["v.length", "property access on v"],
    ["'fire'", "string literal"],
    ['"fire"', "double-quoted string"],
    ["`fire`", "template literal"],
    ["a.atk && 1", "logical and (outside D1)"],
    ["a.atk || 1", "logical or (outside D1)"],
    ["!a.atk", "logical not (outside D1)"],
    ["1; 2", "statement separator"],
    ["function() { return 1 }", "function keyword"],
    ["new Function('x')", "Function constructor"],
    ["(() => 1)()", "arrow IIFE"],
    ["a.atk,", "trailing token"],
    ["", "empty formula"],
    ["b", "facade without a stat"],
  ] as const;
  for (const [src, why] of rejects) {
    it(`rejects ${why}: ${JSON.stringify(src)}`, () => {
      const res = parseFormula(src);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
    });
  }

  it("enforces the amendment-(b) input limits (512 chars / 32 depth)", () => {
    const long = "1" + " + 1".repeat(Math.ceil(FORMULA_MAX_LENGTH / 4));
    expect(long.length).toBeGreaterThan(FORMULA_MAX_LENGTH);
    expect(parseFormula(long).ok).toBe(false);
    const deep = "(".repeat(40) + "1" + ")".repeat(40);
    expect(parseFormula(deep).ok).toBe(false);
    // …while a legal formula parses fine at moderate depth.
    expect(parseFormula("((((((((1))))))))").ok).toBe(true);
  });

  it("getFormula treats rejects and '0' noise as null (fallback path)", () => {
    expect(getFormula("a.luk * 2")).toBeNull();
    expect(getFormula("0")).toBeNull();
    expect(getFormula("")).toBeNull();
    expect(getFormula(undefined)).toBeNull();
    expect(getFormula("a.atk * 4 - b.def * 2")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The MZ pipeline — hand-computed reference vectors
// ---------------------------------------------------------------------------

describe("MZ damage pipeline (hand-computed vectors)", () => {
  const seq = (nums: number[]) => {
    let i = 0;
    return () => nums[i++];
  };

  it("applyVariance matches Game_Action.applyVariance", () => {
    // damage 176, variance 20: amp = floor(35.2) = 35; v = 10+20−35 = −5.
    expect(mzApplyVariance(176, 20, seq([10, 20]))).toBe(171);
    // amp bounds: both draws max (35) → +35; both 0 → −35.
    expect(mzApplyVariance(176, 20, seq([35, 35]))).toBe(211);
    expect(mzApplyVariance(176, 20, seq([0, 0]))).toBe(141);
    // negative damage (MZ-internal heal sign) mirrors: −100 − (3+4−20) = −87.
    expect(mzApplyVariance(-100, 20, seq([3, 4]))).toBe(-87);
    // variance 0 still draws twice (amp 0 → ±0), like MZ.
    expect(mzApplyVariance(176, 0, seq([0, 0]))).toBe(176);
  });

  it("vector A1 — fixture Attack, variance 20, no crit/guard → 171", () => {
    // base 176 · element 1 · amp 35 · draws 10,20 → 176 − 5.
    const base = evalSrc("a.atk * 4 - b.def * 2");
    expect(base).toBe(176);
    expect(
      mzDamageValue({ base, elementRate: 1, critical: false, variance: 20, guarding: false, randomInt: seq([10, 20]) }),
    ).toBe(171);
  });

  it("vector A2 — crit ×3 BEFORE variance (MZ order) → 423", () => {
    // 176 ×3 = 528 · amp = floor(105.6) = 105 · draws 0,0 → 528 − 105.
    expect(
      mzDamageValue({ base: 176, elementRate: 1, critical: true, variance: 20, guarding: false, randomInt: seq([0, 0]) }),
    ).toBe(423);
  });

  it("vector A3 — guard halves AFTER variance (grd = 1) → 88", () => {
    expect(
      mzDamageValue({ base: 176, elementRate: 1, critical: false, variance: 0, guarding: true, randomInt: seq([0, 0]) }),
    ).toBe(88);
  });

  it("vector A4 — element rate multiplies the base first → 264", () => {
    expect(
      mzDamageValue({ base: 176, elementRate: 1.5, critical: false, variance: 0, guarding: false, randomInt: seq([0, 0]) }),
    ).toBe(264);
  });

  it("vector A5 — element ×0.5, crit, variance 20, guard → 158", () => {
    // 176·0.5 = 88 → ×3 = 264 → amp = floor(52.8) = 52, draws 52,52 → +52 →
    // 316 → guard ÷2 = 158.
    expect(
      mzDamageValue({ base: 176, elementRate: 0.5, critical: true, variance: 20, guarding: true, randomInt: seq([52, 52]) }),
    ).toBe(158);
  });

  it("vector B — half-rate rounding goes through Math.round → 77", () => {
    // Firebolt base 51 · element 1.5 → 76.5 → round 77.
    expect(
      mzDamageValue({ base: 51, elementRate: 1.5, critical: false, variance: 0, guarding: false, randomInt: seq([0, 0]) }),
    ).toBe(77);
  });

  it("vector C — a 0 base stays a 0-damage hit (MZ shows 0)", () => {
    expect(
      mzDamageValue({ base: 0, elementRate: 1, critical: true, variance: 20, guarding: true, randomInt: seq([0, 0]) }),
    ).toBe(0);
  });

  it("is deterministic from a mulberry32 seed (amendment a)", () => {
    const roll = () => {
      const r = mulberry32(0xa3a3);
      const randomInt = (n: number) => Math.floor(r() * n);
      const e = { a: A, b: B, v: () => 0, randomInt };
      const base = getFormula("a.atk * 4 - b.def * 2 + Math.randomInt(10)")!.eval(e);
      return mzDamageValue({ base, elementRate: 1, critical: false, variance: 20, guarding: false, randomInt });
    };
    const first = roll();
    expect(roll()).toBe(first);
    expect(first).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// To-hit — draw conservation is the native-compat contract
// ---------------------------------------------------------------------------

describe("mzHitRoll (hit/eva ex-params)", () => {
  const counting = (vals: number[]) => {
    let i = 0;
    const fn = () => vals[i++];
    return { fn, count: () => i };
  };

  it("consumes ZERO draws when no hit/evade traits exist (Atlas-native)", () => {
    const c = counting([]);
    expect(mzHitRoll({ hitPct: null, evadePct: 0, rndf: c.fn })).toBe("hit");
    expect(c.count()).toBe(0);
  });

  it("misses when the draw beats the hit sum (MZ: random >= hit)", () => {
    const c = counting([0.99]);
    expect(mzHitRoll({ hitPct: 95, evadePct: 0, rndf: c.fn })).toBe("miss");
    expect(c.count()).toBe(1);
  });

  it("evades on the second draw (MZ order: miss roll, then evade roll)", () => {
    const c = counting([0.5, 0.01]);
    expect(mzHitRoll({ hitPct: 95, evadePct: 5, rndf: c.fn })).toBe("evade");
    expect(c.count()).toBe(2);
  });

  it("hits through both rolls", () => {
    const c = counting([0.5, 0.5]);
    expect(mzHitRoll({ hitPct: 95, evadePct: 5, rndf: c.fn })).toBe("hit");
    expect(c.count()).toBe(2);
  });

  it("evade-only defenders roll exactly once", () => {
    const c = counting([0.04]);
    expect(mzHitRoll({ hitPct: null, evadePct: 5, rndf: c.fn })).toBe("evade");
    expect(c.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Importer companions — variance/critical/dmgType/powerPct + reject report
// ---------------------------------------------------------------------------

const rawSkill = (over: Partial<RmSkill>): RmSkill =>
  ({
    id: 1, name: "T", iconIndex: 0, stypeId: 1, mpCost: 0, scope: 1,
    damage: { type: 1, elementId: 0, formula: "a.atk * 2", variance: 20, critical: false },
    effects: [], repeats: 1,
    ...over,
  }) as RmSkill;

describe("importer: the MZ companions travel with the formula", () => {
  const convert = (skills: (RmSkill | null)[]) => {
    const report = new ImportReport();
    const out = convertSkills(skills, report, ["", "physical", "fire"], ["", "magic"]);
    return { out, report };
  };

  it("stores variance/critical alongside a compilable formula", () => {
    const { out, report } = convert([null, rawSkill({ damage: { type: 1, elementId: 0, formula: "a.atk * 2", variance: 20, critical: true } })]);
    expect(out[0].formula).toBe("a.atk * 2");
    expect(out[0].variance).toBe(20);
    expect(out[0].critical).toBe(true);
    expect(report.lines.filter((l) => /can't run/.test(l.what))).toHaveLength(0);
  });

  it("maps MZ damage types: 2→mp · 4→heal+mp · 5→hpDrain · 6→mpDrain", () => {
    const dmg = (type: number) => rawSkill({ damage: { type, elementId: 0, formula: "a.mat", variance: 0, critical: false } });
    const { out } = convert([null, dmg(2), dmg(4), dmg(5), dmg(6), dmg(1)]);
    expect(out[0].dmgType).toBe("mp");
    expect(out[1].dmgType).toBe("mp");
    expect(out[1].type).toBe("heal"); // MP recover is a heal-type skill
    expect(out[2].dmgType).toBe("hpDrain");
    expect(out[3].dmgType).toBe("mpDrain");
    expect(out[4].dmgType).toBeUndefined();
  });

  it("converts the Recover-HP %-part to powerPct (effect 11 value1)", () => {
    const s = rawSkill({
      scope: 7,
      damage: { type: 3, elementId: 0, formula: "0", variance: 0, critical: false },
      effects: [{ code: 11, dataId: 0, value1: 0.25, value2: 40 }],
    });
    const { out } = convert([null, s]);
    expect(out[0].power).toBe(40);
    expect(out[0].powerPct).toBe(25);
  });

  it("keeps a rejected formula verbatim + one honest partial line (D1)", () => {
    const s = rawSkill({ damage: { type: 1, elementId: 0, formula: "a.luk * 10", variance: 20, critical: false } });
    const { out, report } = convert([null, s]);
    expect(out[0].formula).toBe("a.luk * 10"); // re-import can upgrade it
    const line = report.lines.find((l) => /can't run/.test(l.what));
    expect(line).toBeTruthy();
    expect(line!.kind).toBe("partial");
  });

  it("items: %-recover → hpPct/mpPct; recover formulas store; attack formulas report", () => {
    const base = { id: 1, name: "T", iconIndex: 0, itypeId: 1, price: 0, consumable: true, scope: 7, effects: [] };
    const report = new ImportReport();
    const out = convertItems(
      [
        null,
        { ...base, id: 1, effects: [{ code: 11, dataId: 0, value1: 0.5, value2: 20 }, { code: 12, dataId: 0, value1: 0.1, value2: 0 }] },
        { ...base, id: 2, damage: { type: 3, elementId: 0, formula: "b.mhp / 4", variance: 10, critical: false } },
        { ...base, id: 3, scope: 1, damage: { type: 1, elementId: 0, formula: "a.atk * 3", variance: 20, critical: false } },
      ] as unknown as (RmItem | null)[],
      report,
    );
    expect(out[0].hp).toBe(20);
    expect(out[0].hpPct).toBe(50);
    expect(out[0].mpPct).toBe(10);
    expect(out[1].formula).toBe("b.mhp / 4");
    expect(out[1].variance).toBe(10);
    expect(out[2].formula).toBeUndefined(); // offensive → reported, not stored
    expect(report.lines.some((l) => /damage enemies/.test(l.what))).toBe(true);
  });
});

// ============================================================================
// Project Compass M3·B — the sp-param pipeline args (pdr/mdr/rec via dmgRate,
// grd deepening the guard divisor). Absent args must keep every M3·A vector.
// ============================================================================
describe("MZ pipeline sp-params (M3·B: dmgRate + grd)", () => {
  const seq = (nums: number[]) => {
    let i = 0;
    return () => nums[i++];
  };

  it("vector B1 — pdr 0.5 applies after element, before crit → 132", () => {
    // 176 × 1 × 0.5 = 88 → crit ×3 = 264 → variance 0 → guard ÷2 = 132.
    expect(
      mzDamageValue({
        base: 176, elementRate: 1, dmgRate: 0.5, critical: true,
        variance: 0, guarding: true, randomInt: seq([0, 0]),
      }),
    ).toBe(132);
  });

  it("vector B2 — element 2 × mdr 0.75 stack multiplicatively → 264", () => {
    // 176 × 2 × 0.75 = 264 (no crit, variance 0, no guard).
    expect(
      mzDamageValue({
        base: 176, elementRate: 2, dmgRate: 0.75, critical: false,
        variance: 0, guarding: false, randomInt: seq([0, 0]),
      }),
    ).toBe(264);
  });

  it("vector B3 — grd 2 deepens the guard divisor: ÷(2·2) → 44", () => {
    expect(
      mzDamageValue({
        base: 176, elementRate: 1, critical: false, variance: 0,
        guarding: true, grd: 2, randomInt: seq([0, 0]),
      }),
    ).toBe(44);
  });

  it("vector B4 — rec on a heal rides the same dmgRate slot → 150", () => {
    // heal base 100 × rec 1.5 = 150 (heals pass rec as dmgRate, MZ order).
    expect(
      mzDamageValue({
        base: 100, elementRate: 1, dmgRate: 1.5, critical: false,
        variance: 0, guarding: false, randomInt: seq([0, 0]),
      }),
    ).toBe(150);
  });

  it("absent dmgRate/grd keep the M3·A behavior byte-identical", () => {
    const args = { base: 176, elementRate: 1, critical: false, variance: 20, guarding: true } as const;
    expect(mzDamageValue({ ...args, randomInt: seq([10, 20]) })).toBe(
      mzDamageValue({ ...args, dmgRate: 1, grd: 1, randomInt: seq([10, 20]) }),
    );
  });
});
