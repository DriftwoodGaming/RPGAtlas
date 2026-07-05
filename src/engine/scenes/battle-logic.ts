/* RPGAtlas — src/engine/scenes/battle-logic.ts
   Pure battle-v2 logic (Phase 5 Stage B): row modifiers, condition-weighted
   enemy action selection, troop battle-event page conditions, and the CTB
   scheduler. No DOM, no engine state — every input is passed in (rng too),
   so the whole module runs under plain node in vitest and the battle scene
   stays the only place with side effects. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- formations / rows ----

/** A battler's row; absent = front (pre-Phase-5 records never carry one). */
export function rowOf(b: any): "front" | "back" {
  return b && b.row === "back" ? "back" : "front";
}

/** Physical damage scale for the attacker's row (back row hits softer). */
export function rowDealtScale(row: "front" | "back"): number {
  return row === "back" ? 0.75 : 1;
}

/** Physical damage scale for the target's row (back row is safer). */
export function rowTakenScale(row: "front" | "back"): number {
  return row === "back" ? 0.75 : 1;
}

/** Apply a row scale without touching the value when the scale is 1 —
 *  front-row (i.e. all pre-Phase-5) damage stays byte-identical. */
export function applyRowScale(dmg: number, scale: number): number {
  if (scale === 1) return dmg;
  return Math.max(1, Math.floor(dmg * scale));
}

/** Pick a target index from `pool`, weighting front-row members 3:1 over
 *  back row. `roll` is a 0..1 random sample (injected for tests). All-front
 *  pools (every pre-Phase-5 party) stay a uniform pick. `rateOf` (M3·B)
 *  multiplies a battler's weight by its MZ Target Rate (tgr) — absent or 1
 *  everywhere keeps the classic distribution (and the same single draw). */
export function weightedTargetIndex(
  pool: any[],
  roll: number,
  rateOf?: (b: any) => number,
): number {
  if (!pool.length) return -1;
  const weights = pool.map(
    (b) => (rowOf(b) === "back" ? 1 : 3) * Math.max(0, rateOf ? rateOf(b) : 1),
  );
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return pool.length - 1;
  let r = roll * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return pool.length - 1;
}

// ---- buffs / debuffs (Project Compass M3·B, MZ effect codes 31–34) ----
// MZ model: each battle param holds a buff level −2…+2; every level is ±25%
// (paramBuffRate). Levels tick down at round end and clear after battle.

/** Param multiplier for one buff level (MZ Game_BattlerBase.paramBuffRate). */
export function buffRate(level: number): number {
  const l = Math.max(-2, Math.min(2, Number(level) || 0));
  return 1 + l * 0.25;
}

/** Apply one buff/debuff op to a battler's `buffs` map ({stat: {level,turns}}).
 *  Returns what happened ("buff"/"debuff"/"removed"/null) for the log line.
 *  Add ops clamp at ±2 and keep the LONGER of the old/new duration (MZ
 *  overwrites turns; keeping the max is the kinder read for stacked casts). */
export function applyBuffOp(
  buffs: any,
  stat: string,
  op: "buff" | "debuff" | "removeBuff" | "removeDebuff",
  turns: number,
): "buff" | "debuff" | "removed" | null {
  const cur = buffs[stat];
  if (op === "removeBuff") {
    if (cur && cur.level > 0) { delete buffs[stat]; return "removed"; }
    return null;
  }
  if (op === "removeDebuff") {
    if (cur && cur.level < 0) { delete buffs[stat]; return "removed"; }
    return null;
  }
  const delta = op === "buff" ? 1 : -1;
  const level = Math.max(-2, Math.min(2, (cur ? cur.level : 0) + delta));
  if (level === 0) { delete buffs[stat]; return op; }
  buffs[stat] = { level, turns: Math.max(turns, cur && cur.level * delta > 0 ? cur.turns : 0) };
  return op;
}

/** Tick every buff's duration down one round; returns the stats whose buff
 *  expired (so the scene can log/clamp). */
export function tickBuffDurations(buffs: any): string[] {
  const expired: string[] = [];
  for (const stat of Object.keys(buffs || {})) {
    buffs[stat].turns--;
    if (buffs[stat].turns <= 0) {
      delete buffs[stat];
      expired.push(stat);
    }
  }
  return expired;
}

// ---- TP (Project Compass M3·B) ----

export const MAX_TP = 100;

/** TP charged by taking damage (MZ Game_Battler.chargeTpByDamage): 50 × the
 *  fraction of max HP lost, × the battler's tcr (tpCharge rate). */
export function tpDamageCharge(damage: number, mhp: number, tcr: number): number {
  const rate = Math.max(0, Math.min(1, damage / Math.max(1, mhp)));
  return Math.floor(50 * rate * Math.max(0, tcr));
}

// ---- Action Times+ (M3·B, trait 61) ----

/** Extra actions this round: each trait row's value (percent) is rolled
 *  independently (MZ Game_Battler.makeActionTimes). Draws exactly one rng
 *  sample per row — zero rows, zero draws (native projects). */
export function extraActionRolls(values: number[], rng: () => number): number {
  let extra = 0;
  for (const v of values) if (rng() * 100 < (Number(v) || 0)) extra++;
  return extra;
}

// ---- condition-weighted enemy AI ----

/** The state an enemy-action condition can see. The M3·C fields are optional
 *  so pre-M3·C callers/tests keep working (absent ⇒ those kinds pass). */
export interface EnemyAiView {
  turn: number;      // current battle turn (1-based)
  hpPct: number;     // this enemy's HP percentage 0..100
  states: number[];  // state ids currently on this enemy
  rng: () => number; // 0..1 (for cond kind "random")
  mpPct?: number;    // this enemy's MP percentage 0..100 (M3·C)
  partyLevel?: number; // highest party level (M3·C)
  switches?: Record<number, boolean> | boolean[]; // game switches (M3·C)
}

/** Does one action row's condition hold? Absent cond = always (pre-Phase-5
 *  rows behave exactly as before). */
export function enemyActionValid(action: any, view: EnemyAiView): boolean {
  const cond = action && action.cond;
  if (!cond || !cond.kind || cond.kind === "always") return true;
  switch (cond.kind) {
    case "turn": {
      const a = Math.max(0, Number(cond.a) || 0);
      const b = Math.max(0, Number(cond.b) || 0);
      if (b <= 0) return view.turn === a;
      return view.turn >= a && (view.turn - a) % b === 0;
    }
    case "hpBelow":
      return view.hpPct <= (Number(cond.pct) || 0);
    case "hpAbove":
      return view.hpPct >= (Number(cond.pct) || 0);
    case "random":
      return view.rng() * 100 < (Number(cond.pct) || 0);
    case "stateSelf":
      return view.states.includes(Number(cond.stateId) || 0);
    // ---- M3·C refinements (MZ condition types 3/5/6) ----
    case "mpBelow":
      return view.mpPct == null || view.mpPct <= (Number(cond.pct) || 0);
    case "partyLevel":
      return view.partyLevel == null || view.partyLevel >= (Number(cond.a) || 0);
    case "switch":
      return !view.switches || !!(view.switches as any)[Number(cond.switchId) || 0];
    default:
      return true;
  }
}

/** Filter an enemy's action rows to those whose conditions hold. Empty
 *  result = the caller falls back to a basic attack. */
export function validEnemyActions(actions: any[], view: EnemyAiView): any[] {
  return (actions || []).filter((a) => enemyActionValid(a, view));
}

// ---- troop battle-event pages ----

/** The state a troop-page condition can see. */
export interface TroopPageView {
  turn: number;                                     // 1-based
  enemies: { hpPct: number; alive: boolean }[];     // troop battle order
  actors: { actorId: number; hpPct: number }[];     // living party
  switches: Record<number, boolean> | boolean[];
  /** True only on the end-of-round boundary check (M3·C `turnEnd` pages). */
  atTurnEnd?: boolean;
}

/** Does a troop page's condition hold right now? An EMPTY cond object never
 *  fires (a fresh page is inert until the author sets something). */
export function troopPageCondMet(cond: any, view: TroopPageView): boolean {
  if (!cond) return false;
  let hasAny = false;
  // MZ "Turn End" (M3·C): the page only fires on the boundary check; other
  // set blocks must ALSO hold there (RM ANDs its condition boxes).
  if (cond.turnEnd) {
    hasAny = true;
    if (!view.atTurnEnd) return false;
  }
  if (cond.turn && (Number(cond.turn.a) || Number(cond.turn.b))) {
    hasAny = true;
    const a = Math.max(0, Number(cond.turn.a) || 0);
    const b = Math.max(0, Number(cond.turn.b) || 0);
    const met = b <= 0 ? view.turn === a : view.turn >= a && (view.turn - a) % b === 0;
    if (!met) return false;
  }
  if (cond.enemyHpBelow && Number(cond.enemyHpBelow.pct) > 0) {
    hasAny = true;
    const idx = Math.max(0, Number(cond.enemyHpBelow.index) || 0);
    const en = view.enemies[idx];
    if (!en || !en.alive || en.hpPct > Number(cond.enemyHpBelow.pct)) return false;
  }
  if (cond.actorHpBelow && Number(cond.actorHpBelow.actorId) > 0) {
    hasAny = true;
    const a = view.actors.find((x) => x.actorId === Number(cond.actorHpBelow.actorId));
    if (!a || a.hpPct > (Number(cond.actorHpBelow.pct) || 0)) return false;
  }
  if (Number(cond.switchId) > 0) {
    hasAny = true;
    if (!(view.switches as any)[Number(cond.switchId)]) return false;
  }
  return hasAny;
}

/** Per-battle firing state for one troop page. */
export interface TroopPageRT {
  page: any;
  firedBattle: boolean;
  firedTurn: number;  // last turn this page fired on (span "turn")
  wasTrue: boolean;   // edge detection for span "moment"
}

export function makeTroopPageRTs(pages: any[]): TroopPageRT[] {
  return (pages || []).map((page) => ({ page, firedBattle: false, firedTurn: 0, wasTrue: false }));
}

/** Decide whether a page fires on this check, updating its firing state.
 *  span "battle" = once per battle · "turn" = once per turn ·
 *  "moment" = every time the condition BECOMES true (edge-triggered). */
export function troopPageShouldFire(rt: TroopPageRT, view: TroopPageView): boolean {
  const met = troopPageCondMet(rt.page && rt.page.cond, view);
  const span = (rt.page && rt.page.span) || "battle";
  let fire = false;
  if (met) {
    if (span === "battle") fire = !rt.firedBattle;
    else if (span === "turn") fire = rt.firedTurn !== view.turn;
    else fire = !rt.wasTrue; // moment
  }
  if (fire) {
    rt.firedBattle = true;
    rt.firedTurn = view.turn;
  }
  rt.wasTrue = met;
  return fire;
}

// ---- MZ battle pacing (Project Compass M3·C, behind system.mzBattleFlow) ----

/** MZ escape chance (BattleManager.makeEscapeRatio + onEscapeFailure):
 *  0.5 × party avg AGI / troop avg AGI, +0.1 per failed attempt this battle.
 *  Uncapped above like MZ (a ratio ≥ 1 always escapes); never negative. */
export function mzEscapeChance(partyAgi: number, troopAgi: number, fails: number): number {
  const base = (0.5 * Math.max(0, partyAgi)) / Math.max(1, troopAgi);
  return Math.max(0, base + 0.1 * Math.max(0, fails));
}

/** MZ preemptive-strike rate (Game_Party.ratePreemptive): 5% when the party's
 *  average AGI wins, else 3%; ×4 with the Raise-Preemptive party ability. */
export function preemptiveRate(partyAgi: number, troopAgi: number, raise: boolean): number {
  return (partyAgi >= troopAgi ? 0.05 : 0.03) * (raise ? 4 : 1);
}

/** MZ surprise rate (Game_Party.rateSurprise): 3% when the party's average
 *  AGI wins, else 5%; zero with the Cancel-Surprise party ability. */
export function surpriseRate(partyAgi: number, troopAgi: number, cancel: boolean): number {
  return cancel ? 0 : partyAgi >= troopAgi ? 0.03 : 0.05;
}

// ---- victory drops (M3·C, MZ Game_Enemy.makeDropItems) ----

/** Roll one defeated enemy's drop rows: each row is kept when
 *  `rng() × denominator < rate` (rate 1, or 2 with Drop-Item-Double). Exactly
 *  one rng draw per row — no rows, no draws (native enemies). */
export function rollDrops(
  drops: any[] | undefined,
  rate: number,
  rng: () => number,
): { kind: string; id: number }[] {
  const out: { kind: string; id: number }[] = [];
  for (const d of drops || []) {
    if (!d || !d.id) continue;
    if (rng() * Math.max(1, Number(d.denominator) || 1) < rate)
      out.push({ kind: String(d.kind || "item"), id: Number(d.id) || 0 });
  }
  return out;
}

// ---- ATB / CTB scheduling ----

/** Gauge fill per tick: faster with agility, never zero. */
export function atbRate(agi: number): number {
  return Math.max(1, (Number(agi) || 0) + 20);
}

export const ATB_FULL = 6000;

/** CTB action cost: the wait accumulated after acting (lower agi = longer). */
export function ctbCost(agi: number): number {
  return Math.round(600000 / atbRate(agi));
}

/** Forecast the next `count` actors in CTB order. `battlers` carry
 *  { counter, agi } (counter = remaining wait); returns battler indexes in
 *  act order. Deterministic tie-break: lower index first. Pure — the caller
 *  applies the first entry and re-adds its cost. */
export function ctbForecast(battlers: { counter: number; agi: number }[], count: number): number[] {
  const sim = battlers.map((b) => ({ counter: b.counter, agi: b.agi }));
  const order: number[] = [];
  for (let n = 0; n < count && sim.length; n++) {
    let best = -1;
    for (let i = 0; i < sim.length; i++) {
      if (best < 0 || sim[i].counter < sim[best].counter) best = i;
    }
    const step = sim[best].counter;
    for (const b of sim) b.counter -= step;
    order.push(best);
    sim[best].counter = ctbCost(sim[best].agi);
  }
  return order;
}
