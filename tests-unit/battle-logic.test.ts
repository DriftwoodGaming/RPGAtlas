/* RPGAtlas — tests-unit/battle-logic.test.ts
   Phase 5 Stage B: the pure battle-v2 logic — rows, condition-weighted enemy
   AI, troop battle-event pages, and the CTB scheduler.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect } from "vitest";
import {
  rowOf,
  rowDealtScale,
  rowTakenScale,
  applyRowScale,
  weightedTargetIndex,
  enemyActionValid,
  validEnemyActions,
  troopPageCondMet,
  makeTroopPageRTs,
  troopPageShouldFire,
  atbRate,
  ctbCost,
  ctbForecast,
} from "../src/engine/scenes/battle-logic";

describe("rows", () => {
  it("absent row means front (pre-Phase-5 records unchanged)", () => {
    expect(rowOf({})).toBe("front");
    expect(rowOf({ row: "back" })).toBe("back");
    expect(rowOf(null)).toBe("front");
  });
  it("front-row scales leave damage untouched (exactly, not just rounded)", () => {
    expect(applyRowScale(37, rowDealtScale("front"))).toBe(37);
    expect(applyRowScale(37, rowTakenScale("front"))).toBe(37);
  });
  it("back row deals and takes 25% less, floored, min 1", () => {
    expect(applyRowScale(40, rowDealtScale("back"))).toBe(30);
    expect(applyRowScale(1, rowTakenScale("back"))).toBe(1);
  });
  it("weighted targeting: all-front pool is uniform; back row is 3x rarer", () => {
    const front = [{}, {}, {}];
    // uniform: thirds of the roll space map to each index
    expect(weightedTargetIndex(front, 0.1)).toBe(0);
    expect(weightedTargetIndex(front, 0.5)).toBe(1);
    expect(weightedTargetIndex(front, 0.9)).toBe(2);
    // front(3) + back(1): the back member owns only the last quarter
    const mixed = [{}, { row: "back" }];
    expect(weightedTargetIndex(mixed, 0.74)).toBe(0);
    expect(weightedTargetIndex(mixed, 0.76)).toBe(1);
    expect(weightedTargetIndex([], 0.5)).toBe(-1);
  });
});

describe("enemy AI conditions", () => {
  const view = (over: any = {}) => ({ turn: 1, hpPct: 100, states: [], rng: () => 0.5, ...over });
  it("absent cond is always valid (pre-Phase-5 rows)", () => {
    expect(enemyActionValid({ skillId: 0, weight: 5 }, view())).toBe(true);
  });
  it("turn a+b·x", () => {
    const act = { cond: { kind: "turn", a: 2, b: 3 } };
    expect(enemyActionValid(act, view({ turn: 1 }))).toBe(false);
    expect(enemyActionValid(act, view({ turn: 2 }))).toBe(true);
    expect(enemyActionValid(act, view({ turn: 4 }))).toBe(false);
    expect(enemyActionValid(act, view({ turn: 5 }))).toBe(true);
    // b=0: exactly turn a
    const once = { cond: { kind: "turn", a: 3, b: 0 } };
    expect(enemyActionValid(once, view({ turn: 3 }))).toBe(true);
    expect(enemyActionValid(once, view({ turn: 6 }))).toBe(false);
  });
  it("hp thresholds and random", () => {
    expect(enemyActionValid({ cond: { kind: "hpBelow", pct: 50 } }, view({ hpPct: 49 }))).toBe(true);
    expect(enemyActionValid({ cond: { kind: "hpBelow", pct: 50 } }, view({ hpPct: 51 }))).toBe(false);
    expect(enemyActionValid({ cond: { kind: "hpAbove", pct: 50 } }, view({ hpPct: 51 }))).toBe(true);
    expect(enemyActionValid({ cond: { kind: "random", pct: 60 } }, view({ rng: () => 0.5 }))).toBe(true);
    expect(enemyActionValid({ cond: { kind: "random", pct: 40 } }, view({ rng: () => 0.5 }))).toBe(false);
  });
  it("stateSelf", () => {
    expect(enemyActionValid({ cond: { kind: "stateSelf", stateId: 2 } }, view({ states: [2] }))).toBe(true);
    expect(enemyActionValid({ cond: { kind: "stateSelf", stateId: 2 } }, view({ states: [1] }))).toBe(false);
  });
  it("validEnemyActions filters; empty means the caller basic-attacks", () => {
    const acts = [
      { skillId: 1, weight: 5, cond: { kind: "hpBelow", pct: 30 } },
      { skillId: 0, weight: 5 },
    ];
    expect(validEnemyActions(acts, view({ hpPct: 100 }))).toHaveLength(1);
    expect(validEnemyActions(acts, view({ hpPct: 20 }))).toHaveLength(2);
  });
});

describe("troop battle-event pages", () => {
  const view = (over: any = {}) => ({
    turn: 1,
    enemies: [{ hpPct: 100, alive: true }, { hpPct: 100, alive: true }],
    actors: [{ actorId: 1, hpPct: 100 }],
    switches: { 1: false, 2: true },
    ...over,
  });
  it("an empty condition never fires", () => {
    expect(troopPageCondMet({}, view())).toBe(false);
    expect(troopPageCondMet(null, view())).toBe(false);
    // zeroed blocks (the editor's backfill) count as unset
    expect(troopPageCondMet({ turn: { a: 0, b: 0 }, enemyHpBelow: { index: 0, pct: 0 }, actorHpBelow: { actorId: 0, pct: 0 }, switchId: 0 }, view())).toBe(false);
  });
  it("turn condition", () => {
    expect(troopPageCondMet({ turn: { a: 1, b: 0 } }, view({ turn: 1 }))).toBe(true);
    expect(troopPageCondMet({ turn: { a: 1, b: 0 } }, view({ turn: 2 }))).toBe(false);
    expect(troopPageCondMet({ turn: { a: 2, b: 2 } }, view({ turn: 6 }))).toBe(true);
  });
  it("enemy / actor HP thresholds and switches — ALL set blocks must hold", () => {
    const cond = { enemyHpBelow: { index: 1, pct: 50 }, switchId: 2 };
    expect(troopPageCondMet(cond, view())).toBe(false);
    expect(troopPageCondMet(cond, view({ enemies: [{ hpPct: 100, alive: true }, { hpPct: 40, alive: true }] }))).toBe(true);
    expect(troopPageCondMet(cond, view({ enemies: [{ hpPct: 100, alive: true }, { hpPct: 40, alive: false }] }))).toBe(false);
    expect(troopPageCondMet({ actorHpBelow: { actorId: 1, pct: 30 } }, view({ actors: [{ actorId: 1, hpPct: 25 }] }))).toBe(true);
    expect(troopPageCondMet({ switchId: 1 }, view())).toBe(false);
  });
  it("span battle fires once; span turn refires each turn; moment is edge-triggered", () => {
    const mk = (span: string) => makeTroopPageRTs([{ cond: { switchId: 2 }, span, commands: [] }])[0];
    const v = view();
    const once = mk("battle");
    expect(troopPageShouldFire(once, v)).toBe(true);
    expect(troopPageShouldFire(once, v)).toBe(false);
    const perTurn = mk("turn");
    expect(troopPageShouldFire(perTurn, view({ turn: 1 }))).toBe(true);
    expect(troopPageShouldFire(perTurn, view({ turn: 1 }))).toBe(false);
    expect(troopPageShouldFire(perTurn, view({ turn: 2 }))).toBe(true);
    const moment = mk("moment");
    expect(troopPageShouldFire(moment, v)).toBe(true);
    expect(troopPageShouldFire(moment, v)).toBe(false); // still true — no edge
    expect(troopPageShouldFire(moment, view({ switches: { 2: false } }))).toBe(false);
    expect(troopPageShouldFire(moment, v)).toBe(true); // became true again
  });
});

describe("ATB / CTB scheduling", () => {
  it("atbRate grows with agility and never hits zero", () => {
    expect(atbRate(10)).toBeGreaterThan(atbRate(0));
    expect(atbRate(-100)).toBeGreaterThanOrEqual(1);
  });
  it("ctbCost is lower (acts sooner) for higher agility", () => {
    expect(ctbCost(30)).toBeLessThan(ctbCost(5));
  });
  it("ctbForecast orders by remaining wait and reinserts by cost", () => {
    // fast (agi 30) vs slow (agi 5), equal counters: fast acts first and
    // twice before slow gets a second act
    const order = ctbForecast(
      [{ counter: 100, agi: 30 }, { counter: 100, agi: 5 }],
      4,
    );
    expect(order[0]).toBe(0); // tie → lower index (both at 100? no: equal counters, lower index wins)
    expect(order.filter((i) => i === 0).length).toBeGreaterThan(order.filter((i) => i === 1).length);
  });
  it("ctbForecast is deterministic and pure (inputs untouched)", () => {
    const battlers = [{ counter: 50, agi: 10 }, { counter: 20, agi: 10 }];
    const a = ctbForecast(battlers, 6);
    const b = ctbForecast(battlers, 6);
    expect(a).toEqual(b);
    expect(battlers[0].counter).toBe(50);
    expect(a[0]).toBe(1); // lower remaining wait acts first
  });
});

// ============================================================================
// Project Compass M3·B — buffs/debuffs, TP, action times, target rate.
// ============================================================================

import {
  buffRate,
  applyBuffOp,
  tickBuffDurations,
  MAX_TP,
  tpDamageCharge,
  extraActionRolls,
} from "../src/engine/scenes/battle-logic";

describe("buffs/debuffs (M3·B, MZ ±25% per level)", () => {
  it("buffRate matches MZ paramBuffRate and clamps at ±2", () => {
    expect(buffRate(0)).toBe(1);
    expect(buffRate(1)).toBe(1.25);
    expect(buffRate(2)).toBe(1.5);
    expect(buffRate(-1)).toBe(0.75);
    expect(buffRate(-2)).toBe(0.5);
    expect(buffRate(5)).toBe(1.5); // clamped
    expect(buffRate(-9)).toBe(0.5);
  });
  it("applyBuffOp stacks to ±2 and cancels through zero", () => {
    const buffs: any = {};
    expect(applyBuffOp(buffs, "atk", "buff", 3)).toBe("buff");
    expect(buffs.atk).toEqual({ level: 1, turns: 3 });
    applyBuffOp(buffs, "atk", "buff", 5);
    applyBuffOp(buffs, "atk", "buff", 2); // clamped at +2, longest turns kept
    expect(buffs.atk.level).toBe(2);
    expect(buffs.atk.turns).toBe(5);
    // one debuff steps it down; two more swing negative
    applyBuffOp(buffs, "atk", "debuff", 4);
    expect(buffs.atk.level).toBe(1);
    applyBuffOp(buffs, "atk", "debuff", 4);
    expect(buffs.atk).toBeUndefined(); // level 0 = gone
    applyBuffOp(buffs, "atk", "debuff", 4);
    expect(buffs.atk.level).toBe(-1);
  });
  it("removeBuff/removeDebuff clear only the matching sign", () => {
    const buffs: any = { atk: { level: 2, turns: 3 }, def: { level: -1, turns: 3 } };
    expect(applyBuffOp(buffs, "atk", "removeDebuff", 0)).toBe(null);
    expect(applyBuffOp(buffs, "atk", "removeBuff", 0)).toBe("removed");
    expect(buffs.atk).toBeUndefined();
    expect(applyBuffOp(buffs, "def", "removeBuff", 0)).toBe(null);
    expect(applyBuffOp(buffs, "def", "removeDebuff", 0)).toBe("removed");
  });
  it("tickBuffDurations expires at zero and reports the stat", () => {
    const buffs: any = { atk: { level: 1, turns: 2 }, agi: { level: -2, turns: 1 } };
    expect(tickBuffDurations(buffs)).toEqual(["agi"]);
    expect(buffs.atk.turns).toBe(1);
    expect(tickBuffDurations(buffs)).toEqual(["atk"]);
    expect(buffs).toEqual({});
  });
});

describe("TP (M3·B)", () => {
  it("tpDamageCharge matches MZ chargeTpByDamage (50 × dmg/mhp × tcr)", () => {
    expect(tpDamageCharge(50, 100, 1)).toBe(25);
    expect(tpDamageCharge(100, 100, 1)).toBe(50);
    expect(tpDamageCharge(100, 100, 1.5)).toBe(75); // tcr scales the charge
    expect(tpDamageCharge(10, 200, 1)).toBe(2); // floor(50 × 0.05)
    expect(tpDamageCharge(500, 100, 1)).toBe(50); // damage rate clamps at 1
    expect(tpDamageCharge(10, 0, 1)).toBe(50); // degenerate mhp guarded
    expect(MAX_TP).toBe(100);
  });
});

describe("Action Times+ (M3·B, trait 61)", () => {
  it("rolls each row independently and consumes exactly one draw per row", () => {
    let draws = 0;
    const seq = [0.1, 0.9, 0.49];
    const rng = () => seq[draws++];
    expect(extraActionRolls([50, 50, 50], rng)).toBe(2); // 0.1<0.5, 0.9≥0.5, 0.49<0.5
    expect(draws).toBe(3);
    expect(extraActionRolls([], () => { throw new Error("no draw allowed"); })).toBe(0);
  });
});

describe("target-rate weighting (M3·B, tgr)", () => {
  it("keeps the classic 3:1 row split when every rate is 1", () => {
    const pool = [{ row: "front" }, { row: "back" }];
    expect(weightedTargetIndex(pool, 0.7, () => 1)).toBe(
      weightedTargetIndex(pool, 0.7),
    );
  });
  it("a tgr of 0 makes a battler untargetable; a huge tgr draws fire", () => {
    const pool = [{ n: "a" }, { n: "b" }];
    const rate = (b: any) => (b.n === "a" ? 0 : 1);
    expect(weightedTargetIndex(pool, 0.01, rate)).toBe(1);
    const magnet = (b: any) => (b.n === "a" ? 100 : 1);
    expect(weightedTargetIndex(pool, 0.9, magnet)).toBe(0);
  });
});
