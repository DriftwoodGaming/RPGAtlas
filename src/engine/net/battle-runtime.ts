/* RPGAtlas — src/engine/net/battle-runtime.ts
   Project Beacon MP9·E stage E1 (fork (a), decision D8 — the F-1 fix): the
   HEADLESS shared-battle runner. Replaces the zone event runtime's
   `Battle: { run: async () => "win" }` stub (deviation D-8-6) with the real
   thing: the turn-based battle loop from scenes/battle.ts re-implemented with
   the zone-event-runtime discipline — pure logic re-implemented with verbatim
   semantics, REAL shared helpers imported (battle-logic.ts math, formula.ts
   pipeline, game-state derivations, the coop-battle.ts broker), never the
   scene itself (battle.ts / battle-coop.ts are render/audio-coupled).

   The all-remote posture (D-9E-2): on a server EVERY participant is remote —
   there is no local G.party. So, unlike the MP6 client-co-op authority:
   - the TRIGGER contributes its loadout over a `battleJoin` directive too and
     answers `battleCmd` rounds like everyone else;
   - the trigger draws its victory drops FIRST, then the other participants in
     join order (the A-8 conservation order, with the "authority classic
     sequence" seat taken by the trigger);
   - every item spend emits `itemUsed` to its owner and never touches a host
     bag (the D-6-7 rule generalizes: the server holds no inventories at all);
   - rewards/EXP/state write-back reach every participant through their own
     end frame (`battle-coop.ts applyBattleEnd` client-side, unchanged).

   N=1 participants = the solo instanced battle, server-side: the same runner
   with a one-entry participant list — this un-stubs solo battles in
   `--engine-events` worlds (they auto-"win"-ed under D-8-6).

   E1 decisions (logged in docs/mp-9-spec.md §MP9·E):
   - D-9E-E1-1: a server battle NEVER game-overs — defeat revives every
     battler at 1 HP (the A-7 posture extended to N=1; a persistent world has
     no game-over flow) and `Battle.lastShared` reports true for every
     runner-hosted battle so the combat command's game-over branch is never
     taken server-side. Authored onLose branches still run.
   - D-9E-E1-2: a WORLD-context battle command (autorun/parallel — no acting
     player) resolves "win" without fighting: it has no subject to seat, the
     narrowed remainder of D-8-6.
   - D-9E-E1-3: troop battle-pages and skill common events run under the
     TRIGGER's interpreter origin (the scene's `new Interp(null)` binds the one
     solo player; the trigger is that player's server-side equivalent), so
     their modal directives reach a real screen.
   - Turn-based only (D-9E-2): ATB/CTB stay client-side per the deferred
     ledger; a project's battleSystem setting is ignored here like the scene's
     own co-op branch does (co-op forces "turn", D-6-6).
   - RNG: the zone world's seeded stream (world.rnd/rndf) — a NEW consumer; no
     solo-loopback stream is shared with it and the frozen goldens never run
     this path (draw conservation untouched).

   Solo / friend rooms are byte-identical: nothing here is reachable outside a
   world zone with the engine runtime attached. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

// FIRST import — idempotent headless window shim (see zone-event-runtime.ts).
import "./headless-env.js";

import { RA } from "../../shared/deps.js";
import { clamp } from "../util.js";
import {
  G,
  param,
  makeActor,
  sanitizeEquipment,
  learnedSkills,
  skillBlocked,
  skillMpCost,
  skillPowerRate,
  actorIncomingRate,
  skillElement,
  stateTraitRows,
  actorEffCarrier,
  actorFormulaFacade,
  onEnemyKilled,
  noteBattleFailure,
  currencyRewardTotals,
} from "../state/game-state.js";
import { getFormula, mzDamageValue, mzHitRoll, mzApplyVariance } from "../../shared/formula.js";
import { Interp } from "../interpreter/interp.js";
import {
  rowOf,
  rowDealtScale,
  rowTakenScale,
  applyRowScale,
  weightedTargetIndex,
  validEnemyActions,
  makeTroopPageRTs,
  troopPageShouldFire,
  buffRate,
  applyBuffOp,
  tickBuffDurations,
  MAX_TP,
  tpDamageCharge,
  lukEffectRate,
  extraActionRolls,
  mzEscapeChance,
  rollDrops,
} from "../scenes/battle-logic.js";
import {
  activeParticipants,
  closeSharedBattle,
  collectBattleCommands,
  openSharedBattle,
  queueBattleEvent,
  BATTLE_JOIN_TIMEOUT_TICKS,
  type BattleEvent,
  type CmdRequest,
  type SharedBattle,
} from "../../shared/sim/coop-battle.js";
import { emitDirectiveTimed, endBlocking, type InterpOrigin } from "../../shared/sim/directives.js";
import {
  MAX_LOADOUT_BATTLERS,
  type BattleActionCmd,
  type BattleCmdDirective,
  type BattlerLoadout,
  type PlayerId,
} from "../../shared/net/protocol.js";
import type { World } from "../../shared/sim/world.js";

/** What zone-event-runtime injects into EngineServices. `enemyOps`/`addEnemyTp`
 *  are live only while a battle runs — the fns-bridge semantics the in-troop
 *  command handlers (RM 331–340 + Change Enemy TP) already no-op on. */
export interface HeadlessBattleService {
  Battle: {
    run: (troopId: any, canEscape: any, opts?: any) => Promise<"win" | "lose" | "escape">;
    lastShared: boolean;
  };
  readonly enemyOps: any;
  readonly addEnemyTp: any;
}

/** Rebuild one contributed battler as a full actor — the exact
 *  battle-coop.ts rebuildBattler semantics (identity + level + equips from the
 *  loadout, everything derived from the SHARED project, vitals clamped). */
function rebuildBattler(lo: BattlerLoadout): any {
  const a = makeActor(lo.actorId);
  if (!a) return null;
  a.level = clamp(Number(lo.level) || 1, 1, 99);
  if (lo.weaponId != null) a.weaponId = Number(lo.weaponId) || 0;
  if (lo.weapon2Id != null) a.weapon2Id = Number(lo.weapon2Id) || 0;
  if (lo.armorId != null) a.armorId = Number(lo.armorId) || 0;
  sanitizeEquipment(a);
  a.row = lo.row === "back" ? "back" : "front";
  a.hp = clamp(Number(lo.hp) || 0, 0, param(a, "mhp"));
  a.mp = clamp(Number(lo.mp) || 0, 0, param(a, "mmp"));
  if (lo.tp != null) a.tp = clamp(Number(lo.tp) || 0, 0, 100);
  a.states = (lo.states || [])
    .filter((st) => st && Number(st.id) > 0)
    .slice(0, 32)
    .map((st) => ({ id: Number(st.id) || 0, turns: Math.max(1, Number(st.turns) || 1) }));
  return a;
}

/** currencyName without RA.typeList (absent from the headless shim): the same
 *  read for a MIGRATED project, whose currencyTypes list always exists. */
function currencyLabel(proj: any, cid: number): string {
  if (cid <= 1) return (proj.system && proj.system.currency) || "Gold";
  const types = proj.system && proj.system.types;
  const list = types && Array.isArray(types.currencyTypes) ? types.currencyTypes : [];
  const t = list.find((c: any) => c && c.id === cid);
  return t ? t.name : "?";
}

export function createHeadlessBattle(
  world: World,
  currentPid: () => PlayerId | null,
): HeadlessBattleService {
  let liveOps: any = null; // battleEnemyOps bridge, non-null while a battle runs
  let liveAddTp: any = null;

  const Battle: HeadlessBattleService["Battle"] = {
    lastShared: false,
    run: (troopId: any, canEscape: any) => runHeadlessBattle(troopId, canEscape !== false),
  };

  async function runHeadlessBattle(
    troopId: any,
    canEscape: boolean,
  ): Promise<"win" | "lose" | "escape"> {
    const proj = world.proj as any;
    Battle.lastShared = false;
    const trigger = currentPid();
    // D-9E-E1-2: a world-context battle (autorun/parallel) has no subject.
    if (trigger == null) return "win";
    // One battle per zone (D-6-2; blocking runs already serialize — defensive).
    if (liveOps || world.coopBattle.active) return "win";
    const troop = RA.byId(proj.troops, troopId);
    if (!troop) return "win";

    const nameOf = (pid: PlayerId): string => {
      const e = world.roster.players.get(pid) as { name?: string } | undefined;
      return (e && e.name) || "Player " + pid;
    };

    // Participants: the party/proximity gate (A-3) — partied triggers open a
    // shared battle; everyone else fights the solo instanced battle (N=1).
    let sb = openSharedBattle(world, trigger, troopId, nameOf);
    if (!sb) {
      sb = {
        id: world.coopBattle.nextId++,
        troopId: Number(troopId) || 0,
        trigger,
        round: 0,
        done: false,
        participants: [
          {
            pid: trigger,
            name: nameOf(trigger),
            slots: MAX_LOADOUT_BATTLERS,
            loadout: [],
            withdrawn: false,
          },
        ],
      };
      // Registered as the one active battle; no extra blocking — the enclosing
      // event run already blocks the trigger (never touch a bit it owns).
      world.coopBattle.active = sb;
    }

    try {
      return await fight(sb, proj, troop, canEscape, nameOf);
    } finally {
      liveOps = null;
      liveAddTp = null;
      if (world.coopBattle.active === sb) closeSharedBattle(world, sb);
    }
  }

  /** The battle itself — scenes/battle.ts's turn loop, headless. Inner helpers
   *  mirror the scene's inner functions (same names where possible) so the
   *  re-implementation reads side-by-side against the original. */
  async function fight(
    sb: SharedBattle,
    proj: any,
    troop: any,
    canEscape: boolean,
    nameOf: (pid: PlayerId) => string,
  ): Promise<"win" | "lose" | "escape"> {
    const rnd = (n: number): number => world.rnd(n);
    const rndf = (): number => world.rndf();
    const mzFlow = !!(proj.system && proj.system.mzBattleFlow);
    const TRIGGER_CTX: InterpOrigin = { playerId: sb.trigger };

    /* ── loadouts: EVERY participant answers battleJoin (all-remote) ─────── */
    const fromName = nameOf(sb.trigger);
    await Promise.all(
      sb.participants.map(async (p) => {
        const reply = await emitDirectiveTimed(
          world,
          p.pid,
          { kind: "battleJoin", troopId: sb.troopId, from: fromName || "A friend" },
          BATTLE_JOIN_TIMEOUT_TICKS,
        );
        const party = reply.kind === "battleJoin" ? reply.party : [];
        p.loadout = party.slice(0, p.slots);
      }),
    );
    for (const p of sb.participants) {
      if (p.withdrawn || p.loadout.length) continue;
      // Contributed nothing (empty party / AFK / hostile): sits the battle out.
      p.withdrawn = true;
      if (p.pid !== sb.trigger) endBlocking(world, [p.pid]);
    }

    /* ── battlers: rebuilt actors, participant join order (trigger first) ── */
    const party: any[] = [];
    for (const p of activeParticipants(sb)) {
      for (const lo of p.loadout) {
        const b = rebuildBattler(lo);
        if (!b) continue;
        b.coopPid = p.pid;
        b.coopName = p.name;
        party.push(b);
      }
    }
    if (!party.length) {
      closeSharedBattle(world, sb);
      return "win";
    }
    // D-9E-E1-1: every runner-hosted battle takes the shared posture — a world
    // battle never game-overs (defeat revives at 1 HP below).
    Battle.lastShared = true;
    const fighters = activeParticipants(sb);
    queueBattleEvent(
      world,
      fighters.map((p) => p.pid),
      { ev: "start", troopId: sb.troopId, names: fighters.map((p) => p.name) },
    );

    /* ── troop init (the battle-index invariant, verbatim semantics) ─────── */
    const enemies: any[] = troop.enemies
      .map((eid: any) => {
        const d = RA.byId(proj.enemies, eid);
        return d ? { d, hp: d.stats.mhp, alive: true } : null;
      })
      .filter(Boolean)
      .map((en: any, i: number) => ((en.i = i), en));
    for (const slot of troop.hiddenSlots || []) {
      const hid: any = enemies[Number(slot) || 0];
      if (hid) hid.hidden = true;
    }

    /* ── the say seam: every battle-log line → per-participant log events ── */
    const activePids = (): PlayerId[] => activeParticipants(sb).map((p) => p.pid);
    function log(text: string): void {
      queueBattleEvent(world, activePids(), { ev: "log", text: String(text) });
    }

    const livingE = () => enemies.filter((e: any) => e.alive && !e.hidden && !e.escaped);
    const livingP = () => party.filter((a: any) => a.hp > 0 && !a.coopGone);
    function variance(v: any): number {
      return Math.max(1, Math.floor(v * (0.85 + rndf() * 0.3)));
    }
    function enemyMp(en: any): number {
      if (en.mp == null) en.mp = Number(en.d.stats.mmp) || 0;
      return en.mp;
    }

    /* ── effective traits / buffs / TP (scenes/battle.ts M3·B, verbatim) ─── */
    function effCarrier(b: any): any {
      if (!b || !b.d) return actorEffCarrier(b);
      const extra = stateTraitRows(b.states);
      const own = b.d.traits || [];
      return extra.length ? { traits: [...own, ...extra] } : { traits: own };
    }
    const effRate = (b: any, type: string, key: any, fb: number) =>
      RA.traitRate(effCarrier(b), type, key, fb);
    const effSum = (b: any, type: string, key: any) => RA.traitSum(effCarrier(b), type, key, 0);
    const effHas = (b: any, type: string, key: any) => RA.traitsOf(effCarrier(b), type, key).length > 0;
    const buffsOf = (b: any) => b.buffs || (b.buffs = {});
    function bStat(b: any, stat: string): number {
      const base = b && b.d ? Number(b.d.stats[stat]) || 0 : param(b, stat);
      const buff = b && b.buffs && b.buffs[stat];
      return buff ? Math.max(0, Math.floor(base * buffRate(buff.level))) : base;
    }
    const lukOf = (b: any) => (b ? bStat(b, "luk") : 0);
    function clampVitalsB(b: any): void {
      b.hp = Math.min(b.hp, bStat(b, "mhp"));
      if (isEnemy(b)) {
        if (b.mp != null) b.mp = Math.min(b.mp, bStat(b, "mmp"));
      } else {
        b.mp = Math.min(b.mp, bStat(b, "mmp"));
      }
    }
    const tpActive =
      !!proj.system.displayTp ||
      (proj.skills || []).some((s: any) => s && (s.tpCost || s.gainTp)) ||
      (proj.items || []).some((it: any) => it && it.gainTp);
    const tpOf = (b: any) => Number(b.tp) || 0;
    function gainTpTo(b: any, amount: number): void {
      if (!tpActive || !amount) return;
      b.tp = clamp(tpOf(b) + Math.round(amount), 0, MAX_TP);
    }
    function isGuardingB(b: any): boolean {
      return guards.has(b) || effHas(b, "special", "guardFlag");
    }
    function battlerFacade(b: any): any {
      let f: any;
      if (!b || !b.d) f = actorFormulaFacade(b);
      else {
        const s = b.d.stats;
        f = {
          atk: s.atk || 0, def: s.def || 0, mat: s.mat || 0, mdf: s.mdf || 0,
          agi: s.agi || 0, mhp: s.mhp || 0, mmp: s.mmp || 0,
          hp: b.hp, mp: enemyMp(b), level: 0, luk: s.luk || 0,
        };
      }
      if (b && b.buffs) {
        for (const k of ["atk", "def", "mat", "mdf", "agi", "mhp", "mmp", "luk"]) {
          const buff = b.buffs[k];
          if (buff) f[k] = Math.max(0, Math.floor(f[k] * buffRate(buff.level)));
        }
      }
      return f;
    }
    function formulaBase(skill: any, attacker: any, target: any): number | null {
      const f = skill && skill.formula ? getFormula(skill.formula) : null;
      if (!f) return null;
      return f.eval({
        a: battlerFacade(attacker),
        b: battlerFacade(target),
        v: (n: any) => Number(G.vars[n]) || 0,
        randomInt: rnd,
      });
    }
    function formulaCrit(skill: any, attacker: any, target?: any): boolean {
      if (!skill || !skill.critical) return false;
      if (attacker && attacker.d && !effHas(attacker, "special", "critChance")) return false;
      const cev = target ? effSum(target, "special", "critEvade") : 0;
      return rnd(100) < effSum(attacker, "special", "critChance") * (1 - cev / 100);
    }
    function physToHit(attacker: any, target: any): "hit" | "miss" | "evade" {
      const aC = effCarrier(attacker);
      const hasHit = RA.traitsOf(aC, "special", "hitChance").length > 0;
      return mzHitRoll({
        hitPct: hasHit ? RA.traitSum(aC, "special", "hitChance", 0) : null,
        evadePct: effSum(target, "special", "evadeChance"),
        rndf,
      });
    }
    function magicEvaded(target: any): boolean {
      const pct = effSum(target, "special", "magicEvade");
      return pct > 0 && rndf() < pct / 100;
    }
    function attackElementKeys(b: any): string[] {
      const rows: any[] = RA.traitsOf(effCarrier(b), "element", null);
      return rows
        .filter((t: any) => String(t.key).startsWith("attack:"))
        .map((t: any) => String(t.key).slice(7));
    }
    function elementRateVs(attacker: any, target: any, skill: any): number {
      if (skill && !skill.attackElement)
        return effRate(target, "element", skillElement(skill), 1);
      const keys = attackElementKeys(attacker);
      if (!keys.length) return 1;
      let best = -Infinity;
      for (const k of keys) best = Math.max(best, effRate(target, "element", k, 1));
      return best;
    }
    function dmgRateVs(target: any, skill: any): number {
      const phys = !skill || skill.type === "phys";
      return effRate(target, "special", phys ? "physDamage" : "magicDamage", 1);
    }
    function guardFactorE(t: any): number {
      if (!isGuardingB(t)) return 1;
      return 1 / (2 * Math.max(0.01, effRate(t, "special", "guardEffect", 1)));
    }
    async function applyAttackStates(attacker: any, target: any): Promise<void> {
      const rows: any[] = RA.traitsOf(effCarrier(attacker), "state", null);
      for (const row of rows) {
        if (!String(row.key).startsWith("attack:")) continue;
        if (!aliveB(target)) return;
        const id = Number(String(row.key).slice(7)) || 0;
        if (!id) continue;
        const chance =
          (Number(row.value) || 0) *
          effRate(target, "state", String(id), 1) *
          lukEffectRate(lukOf(attacker), lukOf(target));
        if (rnd(100) < chance) await addStateTo(target, id);
      }
    }
    async function shedStatesOnDamage(b: any): Promise<void> {
      for (const st of statesOf(b).slice()) {
        const d = stateDef(st.id);
        if (d && d.removeByDamage && rnd(100) < d.removeByDamage) await removeStateFrom(b, st.id);
      }
    }
    async function afterHpDamage(b: any, dmg: number): Promise<void> {
      if (dmg <= 0) return;
      if (tpActive && aliveB(b))
        gainTpTo(b, tpDamageCharge(dmg, bStat(b, "mhp"), effRate(b, "special", "tpCharge", 1)));
      await shedStatesOnDamage(b);
    }
    async function applySkillExtras(eff: any, target: any, user?: any): Promise<void> {
      if (!eff || !aliveB(target)) return;
      for (const be of eff.buffs || []) {
        if (be.op === "debuff") {
          const hasRate = effHas(target, "param", "debuff:" + be.stat);
          const dr = hasRate ? effRate(target, "param", "debuff:" + be.stat, 1) : 1;
          const lr = user ? lukEffectRate(lukOf(user), lukOf(target)) : 1;
          if ((hasRate || lr !== 1) && rndf() >= dr * lr) {
            log(nameOfB(target) + " shrugs off the " + be.stat.toUpperCase() + " drop!");
            continue;
          }
        }
        const outcome = applyBuffOp(buffsOf(target), be.stat, be.op, Number(be.turns) || 1);
        if (!outcome) continue;
        clampVitalsB(target);
        log(
          nameOfB(target) +
            (outcome === "buff"
              ? "'s " + be.stat.toUpperCase() + " rises!"
              : outcome === "debuff"
                ? "'s " + be.stat.toUpperCase() + " falls!"
                : "'s " + be.stat.toUpperCase() + " returns to normal."),
        );
      }
      if (!isEnemy(target)) {
        for (const g of eff.grow || []) {
          const plus = target.paramPlus || (target.paramPlus = {});
          plus[g.stat] = (plus[g.stat] || 0) + (Number(g.amount) || 0);
          log(nameOfB(target) + "'s " + g.stat.toUpperCase() + " grew by " + g.amount + "!");
        }
        for (const id of eff.learn || []) {
          const s = RA.byId(proj.skills, Number(id) || 0);
          if (!s) continue;
          const skills = target.skills || (target.skills = []);
          const forgot = target.forgot;
          if (forgot) { const fi = forgot.indexOf(s.id); if (fi >= 0) forgot.splice(fi, 1); }
          if (!skills.includes(s.id) && !learnedSkills(target).some((k: any) => k.id === s.id))
            skills.push(s.id);
          log(nameOfB(target) + " learned " + s.name + "!");
        }
      }
      if (eff.gainTp) gainTpTo(target, Number(eff.gainTp) || 0);
    }

    /* ── states (scenes/battle.ts, headless) ─────────────────────────────── */
    const stateDef = (id: any) => RA.byId(proj.states || [], id);
    const statesOf = (b: any) => {
      const list = b.states || (b.states = []);
      for (let i = 0; i < list.length; i++) {
        if (typeof list[i] === "number") {
          const d = stateDef(list[i]);
          list[i] = { id: list[i], turns: Math.max(1, (d && d.maxTurns) || 3) };
        }
      }
      return list;
    };
    const isEnemy = (b: any) => !!b.d;
    const nameOfB = (b: any) => (isEnemy(b) ? b.d.name : b.name);
    const maxHpOf = (b: any) => bStat(b, "mhp");
    const aliveB = (b: any) => (isEnemy(b) ? b.alive : b.hp > 0);
    function cannotAct(b: any): boolean {
      return statesOf(b).some((st: any) => {
        const d = stateDef(st.id);
        return d && d.restrict === "act";
      });
    }
    async function addStateTo(b: any, stateId: any): Promise<void> {
      const d = stateDef(stateId);
      if (!d || !aliveB(b)) return;
      if (effHas(b, "state", "resist:" + stateId)) {
        log(nameOfB(b) + " resists " + d.name + "!");
        return;
      }
      const min = Math.max(1, d.minTurns || 1);
      const max = Math.max(min, d.maxTurns || min);
      const turns = min + rnd(max - min + 1);
      const list = statesOf(b);
      const ex = list.find((st: any) => st.id === stateId);
      if (ex) ex.turns = Math.max(ex.turns, turns);
      else list.push({ id: stateId, turns });
      log(nameOfB(b) + " is afflicted by " + d.name + "!");
      if (d.restrict === "act") {
        for (const st of list.slice()) {
          const sd = stateDef(st.id);
          if (sd && sd.removeByRestriction && st.id !== stateId) await removeStateFrom(b, st.id);
        }
      }
    }
    async function removeStateFrom(b: any, stateId: any): Promise<void> {
      const d = stateDef(stateId);
      const list = statesOf(b);
      const i = list.findIndex((st: any) => st.id === stateId);
      if (i < 0) return;
      list.splice(i, 1);
      if (d) log(nameOfB(b) + " is cured of " + d.name + ".");
    }
    async function applySkillState(skill: any, target: any, user?: any): Promise<void> {
      if (!skill || !skill.stateId || !aliveB(target)) return;
      if (skill.stateOp === "remove") {
        await removeStateFrom(target, skill.stateId);
        return;
      }
      let chance = skill.stateChance == null ? 100 : skill.stateChance;
      chance *= effRate(target, "state", String(skill.stateId), 1);
      if (user) chance *= lukEffectRate(lukOf(user), lukOf(target));
      if (rnd(100) < chance) await addStateTo(target, skill.stateId);
    }
    async function tickStates(): Promise<void> {
      for (const b of [...livingP(), ...livingE()]) {
        for (const st of statesOf(b).slice()) {
          const d = stateDef(st.id);
          const list = statesOf(b);
          if (!d) {
            list.splice(list.indexOf(st), 1);
            continue;
          }
          if (d.hpTurn && aliveB(b)) {
            let amt = Math.max(1, Math.floor((maxHpOf(b) * Math.abs(d.hpTurn)) / 100));
            if (d.hpTurn < 0) {
              if (isEnemy(b)) dealToEnemy(b, amt);
              else {
                const tickElement = d.id === 1 ? "poison" : "magic";
                amt = Math.max(1, Math.floor(amt * actorIncomingRate(b, tickElement, false)));
                b.hp = Math.max(0, b.hp - amt);
              }
              log(nameOfB(b) + " takes " + amt + " damage from " + d.name + "!");
              if (isEnemy(b) && !b.alive) log(b.d.name + " is defeated!");
              if (!isEnemy(b) && b.hp <= 0) log(b.name + " falls!");
            } else {
              b.hp = Math.min(maxHpOf(b), b.hp + amt);
              log(nameOfB(b) + " recovers " + amt + " HP from " + d.name + "!");
            }
          }
          st.turns--;
          if (st.turns <= 0) {
            list.splice(list.indexOf(st), 1);
            log(nameOfB(b) + "'s " + d.name + " wore off.");
          }
        }
      }
      for (const b of [...livingP(), ...livingE()]) {
        if (!aliveB(b)) continue;
        const hr = effSum(b, "special", "hpRegen");
        if (hr) {
          const amt = Math.max(1, Math.floor((maxHpOf(b) * Math.abs(hr)) / 100));
          if (hr > 0) {
            b.hp = Math.min(maxHpOf(b), b.hp + amt);
            log(nameOfB(b) + " recovers " + amt + " HP.");
          } else {
            b.hp = Math.max(0, b.hp - amt);
            if (isEnemy(b) && b.hp <= 0) {
              b.alive = false;
              if (onEnemyKilled) onEnemyKilled(b.d.id);
            }
            log(nameOfB(b) + " takes " + amt + " damage.");
          }
        }
        const mr = effSum(b, "special", "mpRegen");
        if (mr) {
          const mmp = bStat(b, "mmp");
          const amt = Math.floor((mmp * mr) / 100);
          if (amt) {
            if (isEnemy(b)) b.mp = clamp(enemyMp(b) + amt, 0, mmp);
            else b.mp = clamp(b.mp + amt, 0, mmp);
          }
        }
        if (tpActive) {
          const tr = effSum(b, "special", "tpRegen");
          if (tr) gainTpTo(b, tr);
        }
        if (b.buffs) {
          for (const stat of tickBuffDurations(b.buffs)) {
            clampVitalsB(b);
            log(nameOfB(b) + "'s " + stat.toUpperCase() + " returns to normal.");
          }
        }
      }
    }

    /* ── enemy damage sink (dealToEnemy, headless) ────────────────────────── */
    function dealToEnemy(en: any, dmg: any): void {
      const wasAlive = en.alive;
      en.hp -= dmg;
      if (en.hp <= 0) {
        en.hp = 0;
        en.alive = false;
      }
      if (wasAlive && !en.alive && onEnemyKilled) onEnemyKilled(en.d.id);
    }
    const actorDef = (a: any) => bStat(a, "def");

    /* ── battle-flow state (Phase 5 / M3·C, verbatim) ────────────────────── */
    let guards: any = new Set();
    let turnNumber = 1;
    let escapePending = false;
    let abortPending = false;
    let escapeFails = 0;
    const partyAbility = (key: string) =>
      party.some((a: any) => RA.traitsOf(actorEffCarrier(a), "special", key).length > 0);
    function substituteFor(target: any, pool: any[]): any {
      const dying = (b: any) => b.hp < bStat(b, "mhp") / 4;
      if (!aliveB(target) || !dying(target)) return null;
      for (const s of pool) {
        if (s === target || !aliveB(s) || dying(s)) continue;
        if (effHas(s, "special", "substitute")) return s;
      }
      return null;
    }
    async function tryEscape(): Promise<boolean> {
      const lp = livingP(), le = livingE();
      const pa = lp.reduce((s: any, x: any) => s + bStat(x, "agi"), 0) / Math.max(1, lp.length);
      const ea = le.reduce((s: any, x: any) => s + bStat(x, "agi"), 0) / Math.max(1, le.length);
      const chance = mzFlow
        ? mzEscapeChance(pa, ea, escapeFails)
        : clamp(0.55 + (pa - ea) * 0.03, 0.2, 0.95);
      // Server battles come from events — never preemptive (M3·C first strikes
      // belong to the client map's random-encounter path).
      if (rndf() < chance) {
        log("Got away safely!");
        return true;
      }
      escapeFails++;
      log("Couldn't escape!");
      return false;
    }

    /* ── the command round: EVERY participant answers battleCmd ──────────── */
    async function collectRound(cmds: any[]): Promise<boolean> {
      // A withdrawn participant's battlers leave the fight at the round edge.
      for (const b of party) {
        if (b.coopGone) continue;
        const part = sb.participants.find((p: any) => p.pid === b.coopPid);
        if (part && part.withdrawn) b.coopGone = true;
      }
      const enemyViews = enemies
        .filter((en: any) => !en.hidden)
        .map((en: any) => ({
          i: en.i,
          name: String(en.d.name || ""),
          hp: en.hp,
          mhp: en.d.stats.mhp,
          alive: !!en.alive && !en.escaped,
        }));
      if (!enemyViews.length) return false;
      const requests: CmdRequest[] = [];
      const perPid = new Map<number, any[]>();
      for (const p of sb.participants) {
        if (p.withdrawn) continue;
        const theirs = party.filter((b: any) => b.coopPid === p.pid && b.hp > 0 && !b.coopGone);
        if (!theirs.length) continue;
        perPid.set(p.pid, theirs);
        const view: BattleCmdDirective = {
          kind: "battleCmd",
          round: turnNumber,
          canEscape: !!canEscape,
          yours: theirs.map((a: any) => ({
            idx: party.indexOf(a),
            name: String(a.name || ""),
            hp: a.hp,
            mhp: bStat(a, "mhp"),
            mp: a.mp,
            mmp: bStat(a, "mmp"),
            tp: tpActive ? tpOf(a) : undefined,
            states: statesOf(a).map((st: any) => Number(st.id) || 0),
            skills: learnedSkills(a).map((s: any) => ({
              id: s.id,
              name: String(s.name || ""),
              mpCost: skillMpCost(a, s),
              tpCost: tpActive && s.tpCost ? Number(s.tpCost) : undefined,
              usable: !(
                a.mp < skillMpCost(a, s) ||
                (tpActive && tpOf(a) < (Number(s.tpCost) || 0)) ||
                skillBlocked(a, s)
              ),
            })),
            canAct: !cannotAct(a),
          })),
          allies: party
            .filter((b: any) => b.coopPid !== p.pid && b.hp > 0 && !b.coopGone)
            .map((b: any) => ({ name: String(b.name || ""), hp: b.hp, mhp: bStat(b, "mhp") })),
          enemies: enemyViews,
        };
        requests.push({ pid: p.pid, view });
      }
      if (!requests.length) return false;
      queueBattleEvent(
        world,
        requests.map((r) => r.pid),
        { ev: "round", n: turnNumber },
      );
      const replies = await collectBattleCommands(world, sb, requests);
      let wantEscape = false;
      for (const r of requests) {
        const theirs = perPid.get(r.pid) || [];
        const list = replies.get(r.pid) || [];
        for (let i = 0; i < theirs.length; i++) {
          const a = theirs[i];
          if (a.hp <= 0 || a.coopGone) continue;
          if (cannotAct(a)) {
            cmds.push({ type: "stunned", actor: a });
            continue;
          }
          const resolved = resolveCmd(a, list[i]);
          if (resolved === "escape") wantEscape = true;
          else cmds.push(resolved);
        }
      }
      return wantEscape;
    }

    /** One battler's reply → the command object the loop resolves (the scene's
     *  resolveCoopCmd, verbatim semantics — stale/unusable falls back to guard,
     *  never a crash, never a free hit). */
    function resolveCmd(a: any, cmd: BattleActionCmd | undefined): any {
      const guard = { type: "guard", actor: a };
      if (!cmd || cmd.type === "guard") return guard;
      if (cmd.type === "escape") return canEscape ? "escape" : guard;
      const enemyByI = (i: unknown): any => {
        const en = enemies.find((e: any) => e.i === i);
        return en && en.alive && !en.hidden && !en.escaped ? en : livingE()[0] || null;
      };
      if (cmd.type === "attack") {
        const t = enemyByI(cmd.enemy);
        return t ? { type: "attack", actor: a, target: t } : guard;
      }
      if (cmd.type === "skill") {
        const s = learnedSkills(a).find((x: any) => x.id === cmd.id);
        if (!s) return guard;
        if (
          a.mp < skillMpCost(a, s) ||
          (tpActive && tpOf(a) < (Number(s.tpCost) || 0)) ||
          skillBlocked(a, s)
        )
          return guard;
        if (s.scope === "enemy") {
          const t = enemyByI(cmd.enemy);
          return t ? { type: "skill", actor: a, skill: s, target: t } : guard;
        }
        if (s.scope === "ally") {
          const pool = s.revive ? party.filter((m: any) => m.hp <= 0 && !m.coopGone) : livingP();
          const want = cmd.ally != null ? party[cmd.ally] : a;
          const t = want && pool.includes(want) ? want : s.revive ? pool[0] : a;
          return t ? { type: "skill", actor: a, skill: s, target: t } : guard;
        }
        return { type: "skill", actor: a, skill: s };
      }
      if (cmd.type === "item") {
        const it = RA.byId(proj.items, cmd.id);
        if (!it) return guard;
        const pool = it.revive ? party.filter((m: any) => m.hp <= 0 && !m.coopGone) : livingP();
        const want = cmd.ally != null ? party[cmd.ally] : a;
        const t = want && pool.includes(want) ? want : it.revive ? pool[0] : a;
        return t && (it.revive ? t.hp <= 0 : t.hp > 0)
          ? { type: "item", actor: a, item: it, target: t }
          : guard;
      }
      return guard;
    }

    /* ── enemy AI (scenes/battle.ts enemyAction, verbatim semantics) ─────── */
    function enemyAction(en: any): any {
      const raw = en.d.actions && en.d.actions.length ? en.d.actions : [{ skillId: 0, weight: 1 }];
      const canUse = (a2: any) => {
        if (!a2.skillId) return true;
        const s = RA.byId(proj.skills, a2.skillId);
        if (!s) return true;
        if (tpActive && tpOf(en) < (Number(s.tpCost) || 0)) return false;
        const carrier = effCarrier(en);
        if (!(carrier.traits || []).length) return true;
        if (RA.traitsOf(carrier, "skill", "seal:" + s.id).length) return false;
        const gate = String(s.stype || s.type || "");
        if (gate && RA.traitsOf(carrier, "skill", "sealType:" + gate).length) return false;
        return true;
      };
      const usable = raw.filter(canUse);
      const all = usable.length ? usable : [{ skillId: 0, weight: 1 }];
      const valid = validEnemyActions(all, {
        turn: turnNumber,
        hpPct: (en.hp / Math.max(1, en.d.stats.mhp)) * 100,
        states: statesOf(en).map((st: any) => Number(st.id) || 0),
        rng: rndf,
        mpPct: (enemyMp(en) / Math.max(1, bStat(en, "mmp"))) * 100,
        partyLevel: party.reduce((m: any, a: any) => Math.max(m, a.level || 1), 1),
        switches: G.switches,
      });
      const acts = valid.length ? valid : [{ skillId: 0, weight: 1 }];
      const total = acts.reduce((s: any, a2: any) => s + (a2.weight || 1), 0);
      let roll = rndf() * total;
      let chosen = acts[0];
      for (const a2 of acts) {
        roll -= a2.weight || 1;
        if (roll <= 0) {
          chosen = a2;
          break;
        }
      }
      const skill = chosen.skillId ? RA.byId(proj.skills, chosen.skillId) : null;
      return { type: skill ? "skill" : "attack", skill, enemy: en };
    }

    /* ── item use (menus.ts useItemOn, headless pure slice; server posture:
       never a bag decrement — the owner's client spends on itemUsed) ─────── */
    function useItemHeadless(it: any, target: any): false | { hp: number; mp: number; stateRemoved?: string; stateAdded?: string } {
      const fallen = target.hp <= 0;
      let hp = Number(it.hp) || 0;
      let mp = Number(it.mp) || 0;
      if (it.hpPct) hp += Math.floor((param(target, "mhp") * it.hpPct) / 100);
      if (it.mpPct) mp += Math.floor((param(target, "mmp") * it.mpPct) / 100);
      const f = it.formula ? getFormula(it.formula) : null;
      if (f) {
        const me = actorFormulaFacade(target);
        const base = f.eval({ a: me, b: me, v: (n: any) => Number(G.vars[n]) || 0, randomInt: rnd });
        hp += Math.max(0, Math.round(mzApplyVariance(base, Number(it.variance) || 0, rnd)));
      }
      const carrier = actorEffCarrier(target);
      const recRate =
        RA.traitRate(carrier, "special", "recovery", 1) *
        RA.traitRate(carrier, "special", "itemEffect", 1);
      if (recRate !== 1) {
        hp = Math.max(0, Math.floor(hp * recRate));
        mp = Math.max(0, Math.floor(mp * recRate));
      }
      if (it.revive) {
        if (!fallen) return false;
        hp = Math.max(1, hp);
        target.hp = clamp(hp, 1, param(target, "mhp"));
        if (mp) target.mp = clamp(target.mp + mp, 0, param(target, "mmp"));
      } else {
        if (fallen) return false;
        if (hp) target.hp = clamp(target.hp + hp, 0, param(target, "mhp"));
        if (mp) target.mp = clamp(target.mp + mp, 0, param(target, "mmp"));
      }
      const out: { hp: number; mp: number; stateRemoved?: string; stateAdded?: string } = { hp, mp };
      if (it.stateId) {
        const d = RA.byId(proj.states || [], Number(it.stateId));
        const states = target.states || (target.states = []);
        const idx = states.findIndex(
          (st: any) => (st && st.id != null ? st.id : st) === Number(it.stateId),
        );
        if (it.stateOp === "remove") {
          if (idx >= 0) {
            states.splice(idx, 1);
            out.stateRemoved = d ? d.name : "the ailment";
          }
        } else if (d && target.hp > 0) {
          const chance =
            (it.stateChance == null ? 100 : it.stateChance) *
            RA.traitRate(carrier, "state", String(it.stateId), 1);
          const resist = RA.traitsOf(carrier, "state", "resist:" + it.stateId).length > 0;
          if (!resist && idx < 0 && rnd(100) < chance) {
            states.push({ id: Number(it.stateId), turns: Math.max(1, d.maxTurns || 3) });
            out.stateAdded = d.name;
          }
        }
      }
      for (const be of it.buffs || []) {
        if (be.op === "debuff" && RA.traitsOf(carrier, "param", "debuff:" + be.stat).length) {
          if (rndf() >= RA.traitRate(carrier, "param", "debuff:" + be.stat, 1)) continue;
        }
        applyBuffOp(target.buffs || (target.buffs = {}), be.stat, be.op, Number(be.turns) || 1);
      }
      for (const g of it.grow || []) {
        const plus = target.paramPlus || (target.paramPlus = {});
        plus[g.stat] = (plus[g.stat] || 0) + (Number(g.amount) || 0);
      }
      for (const id of it.learn || []) {
        const skills = target.skills || (target.skills = []);
        const forgot = target.forgot;
        if (forgot) { const fi = forgot.indexOf(Number(id)); if (fi >= 0) forgot.splice(fi, 1); }
        if (Number(id) && !skills.includes(Number(id))) skills.push(Number(id));
      }
      if (it.gainTp) target.tp = clamp((Number(target.tp) || 0) + Number(it.gainTp), 0, 100);
      return out;
    }

    /* ── troop battle-event pages (real Interp, trigger origin) ──────────── */
    const pageRTs = makeTroopPageRTs(troop.pages || []);
    function troopPageView(atTurnEnd?: boolean): any {
      return {
        turn: turnNumber,
        enemies: enemies.map((en: any) => ({
          hpPct: (en.hp / Math.max(1, en.d.stats.mhp)) * 100,
          alive: en.alive,
        })),
        actors: livingP().map((a: any) => ({
          actorId: a.actorId,
          hpPct: (a.hp / Math.max(1, param(a, "mhp"))) * 100,
        })),
        switches: G.switches,
        atTurnEnd: !!atTurnEnd,
      };
    }
    async function checkTroopPages(atTurnEnd?: boolean): Promise<void> {
      if (!pageRTs.length) return;
      for (const rt of pageRTs) {
        if (!livingE().length || !livingP().length) return;
        if (troopPageShouldFire(rt, troopPageView(atTurnEnd))) {
          await new Interp(null, undefined, undefined, TRIGGER_CTX).runList(rt.page.commands || []);
        }
      }
    }

    /* ── one command's resolution (scenes/battle.ts resolveAction, headless:
       FX/audio dropped, every say → log, all math and draw gates verbatim) ── */
    async function resolveAction(c: any): Promise<void> {
      if (c.actor && c.actor.hp <= 0) return;
      if (c.enemy && !c.enemy.alive) return;
      if (c.actor) {
        // ---------- party side ----------
        const a = c.actor;
        if (c.type === "stunned") {
          log(a.name + " can't move!");
          return;
        }
        if (c.type === "guard") {
          log(a.name + " guards.");
          return;
        }
        if (c.type === "item") {
          // All-remote posture (D-6-7 generalized): the owner's client spends
          // its own inventory on the itemUsed event; the server holds no bags.
          const revived = c.item.revive && c.target.hp <= 0;
          const used = useItemHeadless(c.item, c.target);
          if (!used) return;
          queueBattleEvent(world, [a.coopPid], { ev: "itemUsed", id: c.item.id });
          log(
            a.name +
              " uses " +
              c.item.name +
              (revived ? " — " + c.target.name + " is revived!" : " on " + c.target.name + "!"),
          );
          if (used.stateRemoved) log(c.target.name + " is cured of " + used.stateRemoved + ".");
          if (used.stateAdded) log(c.target.name + " is afflicted by " + used.stateAdded + "!");
          if (c.item.escapeBattle) escapePending = true;
          return;
        }
        if (c.type === "skill" && c.skill && c.skill.escapeBattle) {
          if (!c.forced) {
            const cost = skillMpCost(a, c.skill);
            const tcost = tpActive ? Number(c.skill.tpCost) || 0 : 0;
            if (a.mp < cost || tpOf(a) < tcost) return;
            a.mp -= cost;
            if (tcost) a.tp = tpOf(a) - tcost;
          }
          log(a.name + " uses " + c.skill.name + "!");
          escapePending = true;
          return;
        }
        if (
          c.type === "attack" ||
          (c.type === "skill" && c.skill.scope === "enemy") ||
          (c.type === "skill" && c.skill.scope === "enemies")
        ) {
          let skill = c.type === "skill" ? c.skill : null;
          if (skill) {
            if (!c.forced) {
              const cost = skillMpCost(a, skill);
              const tcost = tpActive ? Number(skill.tpCost) || 0 : 0;
              if (a.mp < cost || tpOf(a) < tcost) return;
              a.mp -= cost;
              if (tcost) a.tp = tpOf(a) - tcost;
            }
          } else {
            const rows: any[] = RA.traitsOf(effCarrier(a), "special", "attackSkill");
            if (rows.length) {
              const s = RA.byId(proj.skills, Number(rows[rows.length - 1].value) || 0);
              if (s && s.type !== "heal" && s.scope !== "ally" && s.scope !== "allies") skill = s;
            }
          }
          const targets =
            skill && skill.scope === "enemies"
              ? livingE().slice()
              : [c.target && c.target.alive ? c.target : livingE()[0]].filter(Boolean);
          let hits = Math.max(1, Math.floor(Number(skill && skill.hits) || 1));
          if (c.type === "attack")
            hits += Math.max(0, Math.floor(effSum(a, "special", "attackTimes") / 100));
          for (let t of targets) {
            const sub = substituteFor(t, livingE());
            if (sub) {
              log(sub.d.name + " covers " + t.d.name + "!");
              t = sub;
            }
            if (!skill || skill.type === "phys") {
              const cnt = effSum(t, "special", "counterAttack");
              if (cnt > 0 && rndf() < cnt / 100) {
                log(t.d.name + " counters " + a.name + "'s attack!");
                let cdmg = variance(bStat(t, "atk") * 2 - bStat(a, "def") * 1.2);
                cdmg = Math.max(
                  1,
                  Math.floor(cdmg * actorIncomingRate(a, "physical", isGuardingB(a), "phys")),
                );
                a.hp = Math.max(0, a.hp - cdmg);
                log(a.name + " takes " + cdmg + "!");
                await afterHpDamage(a, cdmg);
                if (a.hp <= 0) log(a.name + " falls!");
                continue;
              }
            } else if (skill.type !== "heal") {
              const mrf = effSum(t, "special", "magicReflect");
              if (mrf > 0 && rndf() < mrf / 100) {
                log(t.d.name + " reflects " + skill.name + "!");
                const rBase = formulaBase(skill, a, a);
                const rdmg =
                  rBase != null
                    ? mzDamageValue({
                        base: rBase,
                        elementRate: 1,
                        critical: false,
                        variance: Number(skill.variance) || 0,
                        guarding: isGuardingB(a),
                        grd: effRate(a, "special", "guardEffect", 1),
                        randomInt: rnd,
                      })
                    : variance(
                        (Number(skill.power) || 0) + bStat(a, "mat") * 2 - bStat(a, "mdf") * 1.5,
                      );
                a.hp = Math.max(0, a.hp - rdmg);
                log(a.name + " takes " + rdmg + "!");
                await afterHpDamage(a, rdmg);
                if (a.hp <= 0) log(a.name + " falls!");
                continue;
              }
            }
            let landed = false;
            for (let hit = 0; hit < hits; hit++) {
              if (!t.alive) break;
              if ((!skill || skill.type === "phys") && physToHit(a, t) !== "hit") {
                log(
                  a.name + (skill ? "'s " + skill.name : "'s attack") + " misses " + t.d.name + "!",
                );
                continue;
              }
              if (skill && skill.type !== "phys" && magicEvaded(t)) {
                log(t.d.name + " evades " + skill.name + "!");
                continue;
              }
              landed = true;
              let dmg;
              let critical;
              const fBase = skill ? formulaBase(skill, a, t) : null;
              if (fBase != null) {
                critical = formulaCrit(skill, a, t);
                dmg = mzDamageValue({
                  base: fBase,
                  elementRate: elementRateVs(a, t, skill),
                  critical,
                  variance: Number(skill.variance) || 0,
                  guarding: isGuardingB(t),
                  grd: effRate(t, "special", "guardEffect", 1),
                  dmgRate: dmgRateVs(t, skill),
                  randomInt: rnd,
                });
                if (skill.type === "phys") dmg = applyRowScale(dmg, rowDealtScale(rowOf(a)));
              } else {
                critical =
                  (!skill || skill.type === "phys") &&
                  rnd(100) <
                    effSum(a, "special", "critChance") *
                      (1 - effSum(t, "special", "critEvade") / 100);
                if (!skill) {
                  dmg = variance(bStat(a, "atk") * 2 - bStat(t, "def") * 1.2);
                } else if (skill.type === "phys") {
                  dmg = variance(
                    ((Number(skill.power) || 0) + bStat(a, "atk") * 2 - bStat(t, "def") * 1.2) *
                      skillPowerRate(a, skill),
                  );
                } else {
                  dmg = variance(
                    ((Number(skill.power) || 0) + bStat(a, "mat") * 2 - bStat(t, "mdf") * 1.5) *
                      skillPowerRate(a, skill),
                  );
                }
                if (critical) dmg = Math.max(1, Math.floor(dmg * 1.5));
                const mult = elementRateVs(a, t, skill) * dmgRateVs(t, skill) * guardFactorE(t);
                if (mult !== 1) dmg = Math.max(1, Math.floor(dmg * mult));
                if (!skill || skill.type === "phys")
                  dmg = applyRowScale(dmg, rowDealtScale(rowOf(a)));
              }
              const dtype = skill && skill.dmgType;
              if (dtype === "mp" || dtype === "mpDrain") {
                const dealt = Math.min(enemyMp(t), dmg);
                t.mp = enemyMp(t) - dealt;
                if (dtype === "mpDrain") a.mp = clamp(a.mp + dealt, 0, bStat(a, "mmp"));
                log(a.name + " casts " + skill.name + " — " + t.d.name + " loses " + dealt + " MP!");
                continue;
              }
              const drained = dtype === "hpDrain" ? Math.min(t.hp, dmg) : 0;
              dealToEnemy(t, dmg);
              log(
                a.name + (skill ? " casts " + skill.name : " attacks") + " — " + t.d.name +
                  " takes " + dmg + "!",
              );
              await afterHpDamage(t, dmg);
              if (drained > 0 && a.hp > 0) {
                a.hp = clamp(a.hp + drained, 0, bStat(a, "mhp"));
                log(a.name + " absorbs " + drained + " HP!");
              }
              if (!t.alive) log(t.d.name + " is defeated!");
            }
            if (landed) {
              await applySkillState(skill, t, a);
              if (!skill || skill.attackStates) await applyAttackStates(a, t);
              if (skill) await applySkillExtras(skill, t, a);
            }
          }
          if (skill && skill.commonEventId) {
            await new Interp(null, undefined, undefined, TRIGGER_CTX).callCommonEvent(
              Number(skill.commonEventId),
            );
          }
        } else if (
          c.type === "skill" &&
          (c.skill.scope === "ally" || c.skill.scope === "allies")
        ) {
          if (!c.forced) {
            const cost = skillMpCost(a, c.skill);
            const tcost = tpActive ? Number(c.skill.tpCost) || 0 : 0;
            if (a.mp < cost || tpOf(a) < tcost) return;
            a.mp -= cost;
            if (tcost) a.tp = tpOf(a) - tcost;
          }
          const targets =
            c.skill.scope === "allies"
              ? c.skill.revive
                ? party.filter((m: any) => m.hp <= 0 && !m.coopGone)
                : livingP()
              : [c.target];
          for (const t of targets) {
            const wasFallen = t.hp <= 0;
            if (wasFallen && !c.skill.revive) continue;
            const fBase = formulaBase(c.skill, a, t);
            let amount;
            if (fBase != null) {
              amount =
                mzDamageValue({
                  base: fBase,
                  elementRate: 1,
                  critical: formulaCrit(c.skill, a, t),
                  variance: Number(c.skill.variance) || 0,
                  guarding: false,
                  dmgRate: effRate(t, "special", "recovery", 1),
                  randomInt: rnd,
                }) + (Number(c.skill.power) || 0);
            } else {
              amount = variance(
                ((Number(c.skill.power) || 0) + bStat(a, "mat") * 1.2) * skillPowerRate(a, c.skill),
              );
              const rec = effRate(t, "special", "recovery", 1);
              if (rec !== 1) amount = Math.max(0, Math.floor(amount * rec));
            }
            if (c.skill.dmgType === "mp" && !wasFallen) {
              t.mp = clamp(t.mp + amount, 0, bStat(t, "mmp"));
              log(
                a.name + " casts " + c.skill.name + " — " + t.name + " recovers " + amount + " MP!",
              );
              await applySkillState(c.skill, t, a);
              await applySkillExtras(c.skill, t, a);
              continue;
            }
            if (c.skill.powerPct) amount += Math.floor((bStat(t, "mhp") * c.skill.powerPct) / 100);
            t.hp = clamp(t.hp + amount, 0, bStat(t, "mhp"));
            log(
              a.name + " casts " + c.skill.name + " — " + t.name +
                (wasFallen ? " is revived with " + amount + " HP!" : " recovers " + amount + " HP!"),
            );
            await applySkillState(c.skill, t, a);
            await applySkillExtras(c.skill, t, a);
          }
          if (c.skill.commonEventId) {
            await new Interp(null, undefined, undefined, TRIGGER_CTX).callCommonEvent(
              Number(c.skill.commonEventId),
            );
          }
        }
      } else {
        // ---------- enemy side ----------
        const en = c.enemy;
        if (cannotAct(en)) {
          log(en.d.name + " can't move!");
          return;
        }
        if (tpActive && c.skill && !c.forced) {
          const tc = Number(c.skill.tpCost) || 0;
          if (tc) en.tp = Math.max(0, tpOf(en) - tc);
        }
        if (c.skill && c.skill.escapeBattle) {
          en.escaped = true;
          log(en.d.name + " uses " + c.skill.name + " and slips away!");
          return;
        }
        if (c.skill && c.skill.type === "heal") {
          let ally = en;
          for (const e2 of livingE()) {
            if (e2.hp / Math.max(1, e2.d.stats.mhp) < ally.hp / Math.max(1, ally.d.stats.mhp))
              ally = e2;
          }
          const fBase = formulaBase(c.skill, en, ally);
          let amount =
            fBase != null
              ? mzDamageValue({
                  base: fBase,
                  elementRate: 1,
                  critical: formulaCrit(c.skill, en, ally),
                  variance: Number(c.skill.variance) || 0,
                  guarding: false,
                  dmgRate: effRate(ally, "special", "recovery", 1),
                  randomInt: rnd,
                }) + (Number(c.skill.power) || 0)
              : variance((Number(c.skill.power) || 0) + bStat(en, "mat") * 1.2);
          if (fBase == null) {
            const rec = effRate(ally, "special", "recovery", 1);
            if (rec !== 1) amount = Math.max(0, Math.floor(amount * rec));
          }
          if (c.skill.powerPct) amount += Math.floor((bStat(ally, "mhp") * c.skill.powerPct) / 100);
          ally.hp = Math.min(bStat(ally, "mhp"), ally.hp + amount);
          log(
            en.d.name + " casts " + c.skill.name + " — " + ally.d.name + " recovers " + amount +
              " HP!",
          );
          await applySkillState(c.skill, ally, en);
          await applySkillExtras(c.skill, ally, en);
          return;
        }
        const pool = livingP();
        if (!pool.length) return;
        let t = pool[
          weightedTargetIndex(pool, rndf(), (b: any) => effRate(b, "special", "targetRate", 1))
        ];
        const tSub = substituteFor(t, pool);
        if (tSub) {
          log(tSub.name + " covers " + t.name + "!");
          t = tSub;
        }
        if (!c.skill || c.skill.type === "phys") {
          const cnt = effSum(t, "special", "counterAttack");
          if (cnt > 0 && rndf() < cnt / 100) {
            log(t.name + " counters " + en.d.name + "'s attack!");
            let cdmg = variance(bStat(t, "atk") * 2 - bStat(en, "def") * 1.2);
            const mult =
              elementRateVs(t, en, null) *
              effRate(en, "special", "physDamage", 1) *
              guardFactorE(en);
            if (mult !== 1) cdmg = Math.max(1, Math.floor(cdmg * mult));
            dealToEnemy(en, cdmg);
            log(en.d.name + " takes " + cdmg + "!");
            await afterHpDamage(en, cdmg);
            if (!en.alive) log(en.d.name + " is defeated!");
            return;
          }
        } else if (c.skill.type !== "heal") {
          const mrf = effSum(t, "special", "magicReflect");
          if (mrf > 0 && rndf() < mrf / 100) {
            log(t.name + " reflects " + c.skill.name + "!");
            const rBase = formulaBase(c.skill, en, en);
            const rdmg =
              rBase != null
                ? mzDamageValue({
                    base: rBase,
                    elementRate: elementRateVs(en, en, c.skill),
                    critical: false,
                    variance: Number(c.skill.variance) || 0,
                    guarding: isGuardingB(en),
                    grd: effRate(en, "special", "guardEffect", 1),
                    dmgRate: dmgRateVs(en, c.skill),
                    randomInt: rnd,
                  })
                : Math.max(
                    1,
                    variance(
                      (Number(c.skill.power) || 0) + bStat(en, "mat") * 2 - bStat(en, "mdf") * 1.5,
                    ),
                  );
            dealToEnemy(en, rdmg);
            log(en.d.name + " takes " + rdmg + "!");
            await afterHpDamage(en, rdmg);
            if (!en.alive) log(en.d.name + " is defeated!");
            return;
          }
        }
        if ((!c.skill || c.skill.type === "phys") && physToHit(en, t) !== "hit") {
          log(en.d.name + (c.skill ? " uses " + c.skill.name : " attacks") + " — " + t.name + " evades!");
          return;
        }
        if (c.skill && c.skill.type !== "phys" && c.skill.type !== "heal" && magicEvaded(t)) {
          log(en.d.name + " uses " + c.skill.name + " — " + t.name + " evades!");
          return;
        }
        let dmg;
        let drainedE = 0;
        if (c.skill && c.skill.type !== "heal") {
          const fBase = formulaBase(c.skill, en, t);
          if (fBase != null) {
            dmg = mzDamageValue({
              base: fBase,
              elementRate: elementRateVs(en, t, c.skill),
              critical: formulaCrit(c.skill, en, t),
              variance: Number(c.skill.variance) || 0,
              guarding: isGuardingB(t),
              grd: effRate(t, "special", "guardEffect", 1),
              dmgRate: dmgRateVs(t, c.skill),
              randomInt: rnd,
            });
          } else {
            const atkStat = c.skill.type === "phys" ? bStat(en, "atk") : bStat(en, "mat");
            const defStat = c.skill.type === "phys" ? actorDef(t) : bStat(t, "mdf") * 1.5;
            dmg = variance((Number(c.skill.power) || 0) + atkStat * 2 - defStat);
            dmg = Math.max(
              1,
              Math.floor(
                dmg *
                  actorIncomingRate(
                    t,
                    skillElement(c.skill),
                    isGuardingB(t),
                    c.skill.type === "phys" ? "phys" : "magic",
                  ),
              ),
            );
            if (c.skill.attackElement) {
              const ae = elementRateVs(en, t, c.skill);
              if (ae !== 1) dmg = Math.max(1, Math.floor(dmg * ae));
            }
          }
          if (c.skill.type === "phys") dmg = applyRowScale(dmg, rowTakenScale(rowOf(t)));
          const dtypeE = c.skill.dmgType;
          if (dtypeE === "mp" || dtypeE === "mpDrain") {
            const dealt = Math.min(t.mp, dmg);
            t.mp -= dealt;
            if (dtypeE === "mpDrain") en.mp = Math.min(en.d.stats.mmp || 0, enemyMp(en) + dealt);
            log(en.d.name + " uses " + c.skill.name + " — " + t.name + " loses " + dealt + " MP!");
            await applySkillState(c.skill, t, en);
            return;
          }
          if (dtypeE === "hpDrain") drainedE = Math.min(t.hp, dmg);
          log(en.d.name + " uses " + c.skill.name + " — " + t.name + " takes " + dmg + "!");
        } else {
          dmg = variance(bStat(en, "atk") * 2 - actorDef(t) * 1.2);
          dmg = Math.max(
            1,
            Math.floor(dmg * actorIncomingRate(t, "physical", isGuardingB(t), "phys")),
          );
          const ae = elementRateVs(en, t, null);
          if (ae !== 1) dmg = Math.max(1, Math.floor(dmg * ae));
          dmg = applyRowScale(dmg, rowTakenScale(rowOf(t)));
          log(en.d.name + " attacks — " + t.name + " takes " + dmg + "!");
        }
        t.hp = Math.max(0, t.hp - dmg);
        if (t.hp <= 0) log(t.name + " falls!");
        await afterHpDamage(t, dmg);
        if (drainedE > 0 && en.alive) {
          en.hp = Math.min(bStat(en, "mhp"), en.hp + drainedE);
          log(en.d.name + " absorbs " + drainedE + " HP!");
        }
        if (c.skill) await applySkillState(c.skill, t, en);
        if (!c.skill || c.skill.attackStates) await applyAttackStates(en, t);
        if (c.skill) await applySkillExtras(c.skill, t, en);
      }
    }

    /* ── TP opening draws + the in-troop command bridge (RM 331–340) ─────── */
    if (tpActive) {
      for (const a of party) if (!effHas(a, "special", "preserveTp")) a.tp = rnd(25);
      for (const en of enemies) if (!effHas(en, "special", "preserveTp")) en.tp = rnd(25);
    }
    liveAddTp = (index: number, delta: number) => {
      const list = index < 0 ? enemies : [enemies[index]].filter(Boolean);
      for (const en of list) en.tp = clamp(tpOf(en) + delta, 0, MAX_TP);
    };
    const opsList = (index: number) =>
      index < 0 ? enemies.filter((e: any) => !e.escaped) : [enemies[index]].filter(Boolean);
    liveOps = {
      async hp(index: number, delta: number, allowKo: boolean) {
        for (const en of opsList(index)) {
          if (!en.alive) continue;
          if (delta < 0) {
            let dmg = -delta;
            if (!allowKo) dmg = Math.min(dmg, Math.max(0, en.hp - 1));
            if (dmg > 0) dealToEnemy(en, dmg);
          } else if (delta > 0) {
            en.hp = Math.min(bStat(en, "mhp"), en.hp + delta);
          }
        }
      },
      mp(index: number, delta: number) {
        for (const en of opsList(index)) {
          if (!en.alive) continue;
          en.mp = clamp(enemyMp(en) + delta, 0, bStat(en, "mmp"));
        }
      },
      async state(index: number, op: string, stateId: number) {
        for (const en of opsList(index)) {
          if (!en.alive) continue;
          if (op === "remove") await removeStateFrom(en, stateId);
          else await addStateTo(en, stateId);
        }
      },
      async recoverAll(index: number) {
        for (const en of opsList(index)) {
          en.alive = true;
          en.hp = bStat(en, "mhp");
          en.mp = bStat(en, "mmp");
          en.states = [];
          delete en.buffs;
        }
      },
      async appear(index: number) {
        for (const en of opsList(index)) {
          if (!en.hidden) continue;
          en.hidden = false;
          log(en.d.name + " appears!");
        }
      },
      async transform(index: number, enemyId: number) {
        const d = RA.byId(proj.enemies, Number(enemyId) || 0);
        if (!d) return;
        for (const en of opsList(index)) {
          if (!en.alive) continue;
          const oldName = en.d.name;
          en.d = d;
          en.hp = Math.min(en.hp, bStat(en, "mhp"));
          if (en.mp != null) en.mp = Math.min(en.mp, bStat(en, "mmp"));
          log(oldName + " transforms into " + d.name + "!");
        }
      },
      async showAnim() {
        // headless: a server renders no animations.
      },
      async forceAction(side: string, index: number, skillId: number, target: number) {
        const skillRec = RA.byId(proj.skills, Number(skillId) || 0);
        if (side === "enemy") {
          const en = enemies[index];
          if (!en || !en.alive || en.hidden || en.escaped) return;
          await resolveAction({ type: skillRec ? "skill" : "attack", skill: skillRec || null, enemy: en, forced: true });
        } else {
          const a =
            Number(index) === 0 ? livingP()[0] : party.find((m: any) => m.actorId === Number(index));
          if (!a || a.hp <= 0) return;
          const c: any = { actor: a, forced: true };
          if (skillRec && (skillRec.scope === "ally" || skillRec.scope === "allies")) {
            c.type = "skill";
            c.skill = skillRec;
            c.target = a;
          } else {
            const pool = livingE();
            if (!pool.length) return;
            c.target =
              target >= 0
                ? pool.find((e: any) => e.i === target) || pool[0]
                : target === -1
                  ? pool[rnd(pool.length)]
                  : pool[0];
            c.type = skillRec ? "skill" : "attack";
            if (skillRec) c.skill = skillRec.scope ? skillRec : { ...skillRec, scope: "enemy" };
          }
          await resolveAction(c);
        }
      },
      abort() {
        abortPending = true;
      },
    };

    /* ── the turn loop (scenes/battle.ts battleLoop, turn mode only) ─────── */
    let result: "win" | "lose" | "escape" | null = null;
    log("Enemies appear!");
    await checkTroopPages();
    battleLoop: while (true) {
      if (abortPending) {
        result = "escape";
        break;
      }
      const cmds: any[] = [];
      const wantEscape = await collectRound(cmds);
      if (wantEscape) {
        if (await tryEscape()) {
          result = "escape";
          break battleLoop;
        }
        cmds.length = 0; // a failed party escape voids the round for all
      }
      guards = new Set(cmds.filter((c: any) => c.type === "guard").map((c: any) => c.actor));
      for (const en of livingE()) {
        const act = enemyAction(en);
        cmds.push(act);
        if (act.type === "attack") {
          const strikes = Math.floor(effSum(en, "special", "attackTimes") / 100);
          for (let n = 0; n < strikes; n++) cmds.push({ type: "attack", enemy: en });
        }
        const rows: any[] = RA.traitsOf(effCarrier(en), "special", "actionTimes");
        const extra = rows.length
          ? extraActionRolls(rows.map((r: any) => Number(r.value) || 0), rndf)
          : 0;
        for (let n = 0; n < extra; n++) cmds.push(enemyAction(en));
      }
      cmds.sort((x: any, y: any) => {
        const sp = (cmd: any) => {
          const b = cmd.actor || cmd.enemy;
          let v = bStat(b, "agi");
          if (cmd.type === "attack") v += effSum(b, "special", "attackSpeed");
          return v;
        };
        return sp(y) * (0.8 + rndf() * 0.4) - sp(x) * (0.8 + rndf() * 0.4);
      });
      for (const c of cmds) {
        await resolveAction(c);
        await checkTroopPages();
        if (escapePending) {
          log("The party slips away!");
          result = "escape";
          break battleLoop;
        }
        if (abortPending) {
          result = "escape";
          break battleLoop;
        }
        if (!livingE().length || !livingP().length) break;
      }
      if (livingE().length && livingP().length) await tickStates();
      turnNumber++;
      await checkTroopPages(true);
      if (abortPending) {
        result = "escape";
        break;
      }
      if (!livingP().length) {
        result = "lose";
        break;
      }
      if (!livingE().length) {
        result = "win";
        break;
      }
    }

    /* ── rewards + end frames (A-8 order, all-remote: trigger draws first) ── */
    const rewards = new Map<PlayerId, { exp: number; gold: number; wallet: any[]; loot: any[] }>();
    if (result === "win") {
      const defeated = enemies.filter((e: any) => !e.alive);
      const exp = defeated.reduce((s: any, e: any) => s + (e.d.exp || 0), 0);
      const gold =
        defeated.reduce((s: any, e: any) => s + (e.d.gold || 0), 0) *
        (partyAbility("goldDouble") ? 2 : 1);
      const currencyRewards = currencyRewardTotals(defeated.map((e: any) => e.d));
      log(
        "Victory!  +" + exp + " EXP, +" + gold + " " + ((proj.system && proj.system.currency) || "Gold") +
          currencyRewards
            .map((r: any) => ", +" + r.amount + " " + currencyLabel(proj, r.currencyId))
            .join(""),
      );
      const dropRate = partyAbility("dropDouble") ? 2 : 1;
      // Participant draws in join order — the trigger sits first (A-8's
      // "authority classic sequence first" seat); downed/withdrawn draw nothing.
      for (const p of activeParticipants(sb)) {
        const theirs = party.filter((b: any) => b.coopPid === p.pid);
        if (!theirs.length || !theirs.some((b: any) => b.hp > 0)) continue;
        const loot: { kind: string; id: number }[] = [];
        for (const e of defeated) for (const l of rollDrops(e.d.drops, dropRate, rndf)) loot.push(l);
        rewards.set(p.pid, { exp, gold, wallet: currencyRewards, loot });
      }
    } else if (result === "lose") {
      if (noteBattleFailure)
        noteBattleFailure(sb.troopId, troop.enemies.map((id: any) => Number(id) || 0));
      log("The party has fallen...");
      // D-9E-E1-1 (A-7 extended): a world battle never ends the world — every
      // participant's battlers get back up with 1 HP, N=1 included.
      for (const b of party) if (b.hp <= 0 && !b.coopGone) b.hp = 1;
    }

    // Per-participant end frames (finishCoopBattle semantics, trigger included):
    // final battler state in loadout order, removeAtEnd states shed, buffs never
    // serialize; rewards from the map above. Clients apply via applyBattleEnd.
    const finalResult: "win" | "lose" | "escape" = result || "win";
    for (const p of activeParticipants(sb)) {
      const theirs = party.filter((b: any) => b.coopPid === p.pid);
      const r = rewards.get(p.pid);
      const ev: BattleEvent = {
        ev: "end",
        result: finalResult,
        exp: r ? r.exp : 0,
        gold: r ? r.gold : 0,
        wallet: r ? r.wallet : [],
        loot: r ? r.loot : [],
        battlers: theirs.map((b: any) => ({
          hp: Math.max(0, b.hp | 0),
          mp: Math.max(0, b.mp | 0),
          tp: b.tp == null ? undefined : Math.max(0, b.tp | 0),
          states: (b.states || [])
            .filter((st: any) => {
              const d = stateDef(st && st.id);
              return d && !d.removeAtEnd;
            })
            .map((st: any) => ({ id: st.id, turns: st.turns })),
        })),
      };
      queueBattleEvent(world, [p.pid], ev);
    }
    closeSharedBattle(world, sb);
    return finalResult;
  }

  return {
    Battle,
    get enemyOps() {
      return liveOps || undefined;
    },
    get addEnemyTp() {
      return liveAddTp || undefined;
    },
  };
}
