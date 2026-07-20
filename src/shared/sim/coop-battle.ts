/* RPGAtlas — src/shared/sim/coop-battle.ts
   Project Beacon MP6·A: the shared-battle coordination core — the world half
   of co-op battles (D5). The battle MATH still runs in the engine battle
   scene on the world authority (D-6-0: in MP6 that is the local co-op host
   browser; MP8's per-zone runtime becomes the server home); this module owns
   everything multiplayer about it, headlessly:

   - who fights: partied, proximate players auto-join (A-3), participants
     fixed at start, battler budget split trigger-first (A-4);
   - loadouts: each participant contributes their OWN party over a
     `battleJoin` directive (D-6-1), auto-answered client-side;
   - turn coordination: one `battleCmd` directive per remote participant per
     round, raced against the world-tick AFK deadline (A-5);
   - the participants-only pause: remote participants are blocked players for
     the battle's duration (A-10);
   - disconnect withdrawal (D-6-4) and the per-player battle-event outbox the
   room host drains into `delta.changes.battle` (A-9).

   Presence gate #1 lives here: `openSharedBattle` returns null unless the
   trigger is partied with someone in range — a solo world has no party, so
   the entire MP6 battle surface is unreachable and solo battles keep the
   exact pre-MP6 RNG stream (draw conservation, THE contract).
   GPL-3.0-or-later (see LICENSE). */

import type {
  BattleActionCmd,
  BattleCmdDirective,
  BattlerLoadout,
  PlayerId,
} from "../net/protocol.js";
import { MAX_BATTLE_BATTLERS, MAX_PARTY_MEMBERS } from "../net/protocol.js";
import { autoResolveDirectivesFor, beginBlocking, emitDirectiveTimed, endBlocking } from "./directives.js";
import { battleParticipantsFor } from "./party.js";
import type { World } from "./world.js";

/** Participants a single shared battle can seat (= the party cap). */
export const MAX_BATTLE_PARTICIPANTS = MAX_PARTY_MEMBERS;
/** How long a battleJoin waits for the (auto-answering) client. */
export const BATTLE_JOIN_TIMEOUT_TICKS = 5 * 60;
/** The per-round AFK command deadline (A-5). */
export const BATTLE_CMD_TIMEOUT_TICKS = 30 * 60;

export interface CoopParticipant {
  pid: PlayerId;
  name: string;
  /** Battlers this participant may field (the A-4 split). */
  slots: number;
  /** Their contributed loadout (validated wire shape; empty = sits out). */
  loadout: BattlerLoadout[];
  /** True once disconnect-withdrawn (D-6-4): battlers leave, no rewards. */
  withdrawn: boolean;
}

export interface SharedBattle {
  id: number;
  troopId: number;
  trigger: PlayerId;
  /** Trigger first, then party join order (the draw-conservation order). */
  participants: CoopParticipant[];
  round: number;
  done: boolean;
}

/** One battle happening, as remote participants' clients hear about it.
 *  Stage A ships start/log/end; stage B adds granular HUD events (additive
 *  JsonValue content — extending this union is not a wire change). */
export type BattleEvent =
  | { ev: "start"; troopId: number; names: string[] }
  | { ev: "round"; n: number }
  | { ev: "log"; text: string }
  | {
      ev: "end";
      result: "win" | "lose" | "escape";
      exp?: number;
      gold?: number;
      wallet?: { currencyId: number; amount: number }[];
      loot?: { kind: string; id: number }[];
      /** Final state of THIS participant's battlers, loadout order. */
      battlers?: { hp: number; mp: number; tp?: number; states?: { id: number; turns: number }[] }[];
    };

/** Per-world co-op battle state. Runtime-only — never snapshotted. */
export interface CoopBattleState {
  nextId: number;
  /** The one shared battle the authority can host at a time (D-6-2), or null. */
  active: SharedBattle | null;
  /** Per-player battle events awaiting the room host's delta drain (A-9). */
  outbox: { pid: PlayerId; ev: BattleEvent }[];
}

export function createCoopBattleState(): CoopBattleState {
  return { nextId: 1, active: null, outbox: [] };
}

/** Open a shared battle for `trigger`, or null when solo rules apply (not
 *  partied, nobody in range, or one already running — the branch answer:
 *  everyone else gets their own solo-instanced battle). Blocks the REMOTE
 *  participants only: the trigger's own pause is governed by its scene/event
 *  exactly as today (never touch a blocking bit an enclosing event owns). */
export function openSharedBattle(
  world: World,
  trigger: PlayerId,
  troopId: number,
  nameOf: (pid: PlayerId) => string,
): SharedBattle | null {
  if (world.coopBattle.active) return null;
  const pids = battleParticipantsFor(world, trigger).slice(0, MAX_BATTLE_PARTICIPANTS);
  if (pids.length <= 1) return null;
  const slots = Math.max(1, Math.floor(MAX_BATTLE_BATTLERS / pids.length));
  const sb: SharedBattle = {
    id: world.coopBattle.nextId++,
    troopId,
    trigger,
    round: 0,
    done: false,
    participants: pids.map((pid) => ({
      pid,
      name: nameOf(pid),
      slots,
      loadout: [],
      withdrawn: false,
    })),
  };
  world.coopBattle.active = sb;
  beginBlocking(world, remotePids(sb));
  return sb;
}

function remotePids(sb: SharedBattle): PlayerId[] {
  return sb.participants.filter((p) => p.pid !== sb.trigger && !p.withdrawn).map((p) => p.pid);
}

/** Everyone still fighting (not withdrawn). */
export function activeParticipants(sb: SharedBattle): CoopParticipant[] {
  return sb.participants.filter((p) => !p.withdrawn);
}

/** Collect every remote participant's loadout (battleJoin directives,
 *  auto-answered; the deadline sits silent clients out). The trigger's own
 *  loadout never rides a directive — the authority reads it live. A remote
 *  that contributes nothing is withdrawn before the fight starts. */
export async function collectLoadouts(world: World, sb: SharedBattle, fromName: string): Promise<void> {
  await Promise.all(
    sb.participants
      .filter((p) => p.pid !== sb.trigger)
      .map(async (p) => {
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
    if (p.pid === sb.trigger || p.withdrawn || p.loadout.length) continue;
    p.withdrawn = true;
    endBlocking(world, [p.pid]);
  }
}

/** One participant's command-round request (view built by the battle). */
export interface CmdRequest {
  pid: PlayerId;
  view: BattleCmdDirective;
}

/** Ask every requested participant for this round's commands, all raced
 *  against the AFK deadline; withdrawn participants answer empty (guard). */
export async function collectBattleCommands(
  world: World,
  sb: SharedBattle,
  requests: CmdRequest[],
): Promise<Map<PlayerId, BattleActionCmd[]>> {
  const out = new Map<PlayerId, BattleActionCmd[]>();
  await Promise.all(
    requests.map(async (r) => {
      const part = sb.participants.find((p) => p.pid === r.pid);
      if (!part || part.withdrawn) {
        out.set(r.pid, []);
        return;
      }
      const reply = await emitDirectiveTimed(world, r.pid, r.view, BATTLE_CMD_TIMEOUT_TICKS);
      out.set(
        r.pid,
        reply.kind === "battleCmd" ? reply.cmds.slice(0, r.view.yours.length) : [],
      );
    }),
  );
  return out;
}

/** Queue one event for these players (skipping the authority's own local
 *  player — it IS the battle scene). The room host drains per tick. */
export function queueBattleEvent(world: World, pids: PlayerId[], ev: BattleEvent): void {
  for (const pid of pids) {
    if (pid === world.roster.local) continue;
    world.coopBattle.outbox.push({ pid, ev });
  }
}

/** Take and clear the queued events (the room host's per-tick drain). */
export function drainBattleOutbox(world: World): { pid: PlayerId; ev: BattleEvent }[] {
  if (!world.coopBattle.outbox.length) return EMPTY_OUTBOX;
  const out = world.coopBattle.outbox;
  world.coopBattle.outbox = [];
  return out;
}
const EMPTY_OUTBOX: { pid: PlayerId; ev: BattleEvent }[] = [];

/** Disconnect-withdraw a participant (D-6-4): their pendings auto-resolve
 *  (C3.4), their block lifts, their battlers leave the fight (the battle
 *  reads `withdrawn` each round), and they draw no rewards. */
export function withdrawParticipant(world: World, pid: PlayerId): boolean {
  const sb = world.coopBattle.active;
  if (!sb) return false;
  const p = sb.participants.find((x) => x.pid === pid && !x.withdrawn);
  if (!p || pid === sb.trigger) return false;
  p.withdrawn = true;
  endBlocking(world, [pid]);
  autoResolveDirectivesFor(world, pid);
  return true;
}

/** Close the shared battle: release every remaining remote block and clear
 *  the active slot. The battle scene calls this from its teardown. */
export function closeSharedBattle(world: World, sb: SharedBattle): void {
  sb.done = true;
  endBlocking(world, remotePids(sb));
  if (world.coopBattle.active === sb) world.coopBattle.active = null;
}
