/* RPGAtlas — src/engine/scenes/battle-coop.ts
   Project Beacon MP6·A: the engine bridge between the battle scene and the
   world's shared-battle core (src/shared/sim/coop-battle.ts). The sim core
   coordinates (participants, directives, deadlines, blocking, the event
   outbox); this module does the ENGINE half on the world authority:

   - open a co-op session when the trigger is partied (loadout collection +
     rebuilding each remote battler as a full actor from the SHARED project
     via makeActor + clamped overrides, D-6-1);
   - per-participant victory draws (their own rollDrops per defeated enemy),
     run AFTER the authority's classic reward sequence (A-8 conservation
     order);
   - the per-participant end frames the clients apply to their own `G`;
   - the CLIENT side: buildLoadout (the battleJoin auto-answer) and
     applyBattleEnd (exp/level-ups/loot/gold/hp write-back — no draws).

   Solo never reaches this module: the battle scene asks isCoopHost() first,
   and openCoopBattle additionally requires a party with someone in range —
   the presence gates that keep solo battles byte-identical (draw
   conservation, THE contract). GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { BattlerLoadout, PlayerId } from "../../shared/net/protocol.js";
import { MAX_LOADOUT_BATTLERS } from "../../shared/net/protocol.js";
import {
  activeParticipants,
  closeSharedBattle,
  collectLoadouts,
  openSharedBattle,
  queueBattleEvent,
  type BattleEvent,
  type SharedBattle,
} from "../../shared/sim/coop-battle.js";
import { getPlayer } from "../../shared/sim/players.js";
import { rollDrops, rowOf } from "./battle-logic.js";
import { defaultWorld } from "../state/default-world.js";
import {
  G,
  addCurrency,
  addInv,
  gainExp,
  makeActor,
  param,
  sanitizeEquipment,
} from "../state/game-state.js";
import { ctx } from "../state/engine-context.js";
import { session } from "../net/session.js";
import { active } from "../net/active.js";
import { clamp } from "../util.js";

/** One participant's rewards, computed by the authority (win only). */
interface CoopRewards {
  exp: number;
  gold: number;
  wallet: { currencyId: number; amount: number }[];
  loot: { kind: string; id: number }[];
}

/** The battle scene's co-op session: sim battle + rebuilt remote battlers. */
export interface CoopSession {
  sb: SharedBattle;
  /** Battlers the AUTHORITY's own player fields (A-4 split). */
  localSlots: number;
  /** Every remote participant's rebuilt battlers, participant join order.
   *  Each battler is a full actor object tagged `coopPid`/`coopName`. */
  remoteBattlers: any[];
  rewards: Map<PlayerId, CoopRewards>;
}

/** True when this engine is a multiplayer authority with peers — the only
 *  posture that can host a shared battle (D-6-0). */
export function isCoopHost(): boolean {
  return session.mode === "host" && !!active.host && active.host.peerCount > 0;
}

function nameOf(pid: PlayerId): string {
  if (pid === defaultWorld.roster.local) return session.name || "Player";
  const e = getPlayer(defaultWorld, pid);
  return (e && e.name) || "Player " + pid;
}

/** Rebuild one contributed battler as a full actor: identity + level + equips
 *  from the loadout, everything derived (stats, traits, skills) from the
 *  SHARED project, hp/mp clamped to the derived maxima. Bad actor ids yield
 *  null (the entry is skipped — the wire shape was validated, but the
 *  authority's project is the truth). */
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

/** Open the shared battle for the authority's trigger (player 0): party +
 *  proximity gate, loadout collection, battler rebuild. Null = solo rules
 *  (not partied / nobody in range / everyone sat out). */
export async function openCoopBattle(troopId: number): Promise<CoopSession | null> {
  const world = defaultWorld;
  const sb = openSharedBattle(world, world.roster.local, troopId, nameOf);
  if (!sb) return null;
  await collectLoadouts(world, sb, nameOf(sb.trigger));
  const fighters = activeParticipants(sb);
  if (fighters.length <= 1) {
    closeSharedBattle(world, sb);
    return null;
  }
  const remoteBattlers: any[] = [];
  for (const p of fighters) {
    if (p.pid === sb.trigger) continue;
    for (const lo of p.loadout) {
      const b = rebuildBattler(lo);
      if (!b) continue;
      b.coopPid = p.pid;
      b.coopName = p.name;
      remoteBattlers.push(b);
    }
  }
  if (!remoteBattlers.length) {
    closeSharedBattle(world, sb);
    return null;
  }
  queueBattleEvent(
    world,
    fighters.map((p) => p.pid),
    { ev: "start", troopId, names: fighters.map((p) => p.name) },
  );
  return {
    sb,
    localSlots: sb.participants[0].slots,
    remoteBattlers,
    rewards: new Map(),
  };
}

/** Mirror a battle-log line to every remote participant (stage A's remote
 *  view of the fight; stage B adds granular HUD events). */
export function coopLog(coop: CoopSession, text: string): void {
  queueBattleEvent(
    defaultWorld,
    activeParticipants(coop.sb).map((p) => p.pid),
    { ev: "log", text },
  );
}

/** Victory draws for the remote participants (A-8): the authority's OWN
 *  reward block has already run byte-identically to solo; now, presence-
 *  gated, each remote participant draws their own loot in join order — one
 *  `rollDrops` per defeated enemy per participant, from the same world
 *  stream. Downed (all battlers KO) and withdrawn participants draw nothing.
 *  `exp`/`gold`/`wallet` are the authority-computed amounts (full to each —
 *  co-op never punishes playing together). */
export function coopVictoryRewards(
  coop: CoopSession,
  defeated: any[],
  exp: number,
  gold: number,
  wallet: { currencyId: number; amount: number }[],
  dropRate: number,
  rndf: () => number,
): void {
  for (const p of activeParticipants(coop.sb)) {
    if (p.pid === coop.sb.trigger) continue;
    const theirs = coop.remoteBattlers.filter((b) => b.coopPid === p.pid);
    if (!theirs.length || !theirs.some((b) => b.hp > 0)) continue; // downed: no draws
    const loot: { kind: string; id: number }[] = [];
    for (const e of defeated) for (const l of rollDrops(e.d.drops, dropRate, rndf)) loot.push(l);
    coop.rewards.set(p.pid, { exp, gold, wallet, loot });
  }
}

/** Build + queue every remote participant's end frame and release the shared
 *  battle (blocking, active slot). Called from the battle scene's teardown,
 *  after defeat-revive (A-7) already wrote the final hp. Battle-scoped
 *  states shed here exactly as the scene sheds the authority's own
 *  (removeAtEnd states drop; buffs never serialize). */
export function finishCoopBattle(coop: CoopSession, result: "win" | "lose" | "escape"): void {
  const world = defaultWorld;
  const stateDef = (id: any): any => {
    const list = (ctx.proj && ctx.proj.states) || [];
    for (const s of list) if (s && s.id === id) return s;
    return null;
  };
  for (const p of activeParticipants(coop.sb)) {
    if (p.pid === coop.sb.trigger) continue;
    const theirs = coop.remoteBattlers.filter((b) => b.coopPid === p.pid);
    const r = coop.rewards.get(p.pid);
    const ev: BattleEvent = {
      ev: "end",
      result,
      exp: r ? r.exp : 0,
      gold: r ? r.gold : 0,
      wallet: r ? r.wallet : [],
      loot: r ? r.loot : [],
      battlers: theirs.map((b) => ({
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
  closeSharedBattle(world, coop.sb);
}

/* ── Client side (the participant's own engine) ────────────────────────── */

/** The battleJoin auto-answer: this client's own party as a wire loadout
 *  (being partied is the consent, A-3/A-4). */
export function buildLoadout(): BattlerLoadout[] {
  return (G.party || []).slice(0, MAX_LOADOUT_BATTLERS).map((a: any) => ({
    actorId: Number(a.actorId) || 0,
    level: clamp(Number(a.level) || 1, 1, 99),
    hp: Math.max(0, a.hp | 0),
    mp: Math.max(0, a.mp | 0),
    tp: a.tp == null ? undefined : Math.max(0, a.tp | 0),
    weaponId: Number(a.weaponId) || 0,
    weapon2Id: Number(a.weapon2Id) || 0,
    armorId: Number(a.armorId) || 0,
    row: rowOf(a),
    states: (a.states || [])
      .filter((st: any) => st && Number(st.id) > 0)
      .slice(0, 32)
      .map((st: any) => ({ id: Number(st.id) || 0, turns: Math.max(1, Number(st.turns) || 1) })),
  }));
}

/** Apply a shared battle's end frame to this client's own `G` (D-6-1):
 *  battler hp/mp/states write back in loadout order (= the front of
 *  `G.party`), EXP/level-ups apply through the ordinary gainExp, loot and
 *  gold land in this player's own bags. No draws — the authority rolled. */
export function applyBattleEnd(ev: Extract<BattleEvent, { ev: "end" }>): string[] {
  const lines: string[] = [];
  const mine = (G.party || []).slice(0, (ev.battlers || []).length);
  (ev.battlers || []).forEach((st, i) => {
    const a = mine[i];
    if (!a) return;
    a.hp = clamp(Number(st.hp) || 0, 0, param(a, "mhp"));
    a.mp = clamp(Number(st.mp) || 0, 0, param(a, "mmp"));
    if (st.tp != null) a.tp = clamp(Number(st.tp) || 0, 0, 100);
    a.states = (st.states || []).map((s) => ({ id: s.id, turns: s.turns }));
    delete a.buffs;
  });
  if (ev.result === "win") {
    for (const a of mine) if (a.hp > 0 && ev.exp) gainExp(a, ev.exp, (m: string) => lines.push(m));
    if (ev.gold) G.gold = clamp(G.gold + ev.gold, 0, 9999999);
    for (const w of ev.wallet || []) addCurrency(w.currencyId, w.amount);
    for (const l of ev.loot || []) addInv(l.kind, l.id, 1);
  }
  return lines;
}
