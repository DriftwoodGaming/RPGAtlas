/* RPGAtlas — src/shared/sim/party.ts
   Project Beacon MP6·A: the player-party system — a social group of PLAYERS
   (never to be confused with `G.party`, the actor party each player owns).
   World-side runtime state exactly like the roster and the directive broker:
   never snapshotted (a room rebuilds membership live; a solo world simply
   never forms one, which is what keeps every MP6 branch presence-gated).

   The verbs ride the existing machinery end-to-end: invites arrive as
   `partyInvite` intents (§C5 pattern), the consent question reaches the
   invitee as a plain `choices` directive ("… wants to team up!"), and the
   C3.4 escape value (canceled) covers timeout/disconnect declines for free.
   Membership changes broadcast as a compact party table on the delta channel
   (`changes.party` — additive opaque JsonValue, the D-B1 precedent).

   Headless by law (sim lint wall): positions come from the roster + the
   world's own player; names come from the caller (they live client/host
   side). English strings are D-C5-2 scope (i18n is MP7).
   GPL-3.0-or-later (see LICENSE). */

import type { PlayerId } from "../net/protocol.js";
import { MAX_PARTY_MEMBERS } from "../net/protocol.js";
import { emitDirectiveTimed } from "./directives.js";
import type { World } from "./world.js";

export { MAX_PARTY_MEMBERS };

/** How long an invite waits for its answer before auto-declining. */
export const INVITE_TIMEOUT_TICKS = 30 * 60;
/** Auto-join radius for shared battles (Chebyshev tiles, same map — A-3). */
export const BATTLE_JOIN_RADIUS = 8;

/** One party: the founding inviter leads; succession = earliest joiner. */
export interface PartyRecord {
  id: number;
  leader: PlayerId;
  /** Join order (leader first while they remain). */
  members: PlayerId[];
}

/** Per-world party state. Runtime-only — never snapshotted. */
export interface PartyState {
  nextId: number;
  parties: Map<number, PartyRecord>;
  /** Membership index: pid -> party id. */
  byPid: Map<PlayerId, number>;
  /** Outstanding invites, keyed by INVITER (one at a time each). */
  invites: Map<PlayerId, { to: PlayerId }>;
  /** Set when membership changed; the room host consumes it to broadcast. */
  dirty: boolean;
}

export function createPartyState(): PartyState {
  return { nextId: 1, parties: new Map(), byPid: new Map(), invites: new Map(), dirty: false };
}

/** The party `pid` belongs to, or null. */
export function partyOf(world: World, pid: PlayerId): PartyRecord | null {
  const id = world.party.byPid.get(pid);
  return id == null ? null : (world.party.parties.get(id) ?? null);
}

/** A player's world position: the local (authority) player reads
 *  `world.g.player`; everyone else reads their roster entity. Null when the
 *  player isn't placeable (no entity, no map). */
export function positionOf(world: World, pid: PlayerId): { mapId: number; x: number; y: number } | null {
  if (pid === world.roster.local) {
    const g = world.g;
    const p = g && g.player;
    return p ? { mapId: g.mapId, x: p.x, y: p.y } : null;
  }
  const e = world.roster.players.get(pid);
  return e ? { mapId: e.mapId, x: e.x, y: e.y } : null;
}

/** Does this pid exist in the world right now (local player or roster)? */
function playerExists(world: World, pid: PlayerId): boolean {
  return pid === world.roster.local || world.roster.players.has(pid);
}

/** Ask `to` to join `from`'s party. Emits the consent `choices` directive and
 *  resolves once answered (or auto-declined by the invite deadline / C3.4).
 *  Validation is authoritative: bad targets and full parties never emit. */
export async function requestPartyInvite(
  world: World,
  from: PlayerId,
  to: PlayerId,
  fromName: string,
): Promise<"accepted" | "declined" | "invalid"> {
  const ps = world.party;
  if (from === to || !playerExists(world, to) || !playerExists(world, from)) return "invalid";
  if (ps.invites.has(from)) return "invalid"; // one outstanding invite each
  if (ps.byPid.has(to)) return "invalid"; // target already in a party
  const p = partyOf(world, from);
  if (p && p.members.length >= MAX_PARTY_MEMBERS) return "invalid";
  ps.invites.set(from, { to });
  const reply = await emitDirectiveTimed(
    world,
    to,
    {
      kind: "choices",
      prompt: (fromName || "A friend") + " wants to team up! Join their party?",
      options: ["Join!", "Not now"],
      cancelable: true,
    },
    INVITE_TIMEOUT_TICKS,
  );
  ps.invites.delete(from);
  const accepted = reply.kind === "choices" && "choice" in reply && reply.choice === 0;
  if (!accepted) return "declined";
  // Re-validate: the world moved while the invitee thought it over.
  if (ps.byPid.has(to) || !playerExists(world, to) || !playerExists(world, from))
    return "declined";
  const cur = partyOf(world, from);
  if (cur && cur.members.length >= MAX_PARTY_MEMBERS) return "declined";
  joinParty(world, from, to);
  return "accepted";
}

/** Put `to` into `from`'s party, founding one if needed. */
function joinParty(world: World, from: PlayerId, to: PlayerId): void {
  const ps = world.party;
  let p = partyOf(world, from);
  if (!p) {
    p = { id: ps.nextId++, leader: from, members: [from] };
    ps.parties.set(p.id, p);
    ps.byPid.set(from, p.id);
  }
  p.members.push(to);
  ps.byPid.set(to, p.id);
  ps.dirty = true;
}

/** Leave (or be disconnected from) the current party. Leadership passes to
 *  the earliest remaining joiner; a party of one dissolves. */
export function leaveParty(world: World, pid: PlayerId): boolean {
  const ps = world.party;
  const p = partyOf(world, pid);
  if (!p) return false;
  p.members = p.members.filter((m) => m !== pid);
  ps.byPid.delete(pid);
  if (p.leader === pid && p.members.length) p.leader = p.members[0];
  if (p.members.length <= 1) {
    for (const m of p.members) ps.byPid.delete(m);
    ps.parties.delete(p.id);
  }
  ps.dirty = true;
  return true;
}

/** The pids eligible for `trigger`'s shared battle: the trigger first, then
 *  partied members standing on the same map within BATTLE_JOIN_RADIUS, in
 *  party join order (A-3). Non-partied triggers get themselves alone. */
export function battleParticipantsFor(world: World, trigger: PlayerId): PlayerId[] {
  const p = partyOf(world, trigger);
  const pos = positionOf(world, trigger);
  if (!p || !pos) return [trigger];
  const out: PlayerId[] = [trigger];
  for (const m of p.members) {
    if (m === trigger) continue;
    const mp = positionOf(world, m);
    if (!mp || mp.mapId !== pos.mapId) continue;
    if (Math.max(Math.abs(mp.x - pos.x), Math.abs(mp.y - pos.y)) > BATTLE_JOIN_RADIUS) continue;
    out.push(m);
  }
  return out;
}

/** Warp every partied member's entity onto the leader's tile (A-2 — the party
 *  follows its leader through transfers; name tags disambiguate the pile).
 *  Only the party LEADER pulls the group. Returns how many moved. */
export function warpPartyToLeader(world: World, leaderPid: PlayerId): number {
  const p = partyOf(world, leaderPid);
  if (!p || p.leader !== leaderPid) return 0;
  const pos = positionOf(world, leaderPid);
  if (!pos) return 0;
  let n = 0;
  for (const m of p.members) {
    if (m === leaderPid) continue;
    const e = world.roster.players.get(m);
    if (!e) continue;
    e.mapId = pos.mapId;
    e.x = e.tx = pos.x;
    e.y = e.ty = pos.y;
    e.rx = e.prx = pos.x;
    e.ry = e.pry = pos.y;
    e.moving = false;
    n++;
  }
  return n;
}

/* ── Wire table (delta.changes.party) + the client mirror ─────────────── */

export interface PartyTableEntry {
  id: number;
  leader: PlayerId;
  members: PlayerId[];
}

/** The whole party table (what `changes.party` carries). */
export function partyTable(world: World): PartyTableEntry[] {
  const out: PartyTableEntry[] = [];
  for (const p of world.party.parties.values())
    out.push({ id: p.id, leader: p.leader, members: p.members.slice() });
  return out;
}

/** Consume the membership-changed flag (the room host broadcasts on true). */
export function consumePartyDirty(world: World): boolean {
  const d = world.party.dirty;
  world.party.dirty = false;
  return d;
}

/** What changed for ME between my old and new membership (client toasts). */
export interface PartyChange {
  joined: boolean;
  left: boolean;
  /** Pids newly in my party (excluding me), when I'm in one. */
  newMates: PlayerId[];
}

/** Mirror a received party table into a client's world, reporting what
 *  changed for the local player so the engine can toast it. */
export function applyPartyTable(world: World, table: PartyTableEntry[]): PartyChange {
  const me = world.roster.local;
  const before = partyOf(world, me);
  const beforeMates = new Set(before ? before.members.filter((m) => m !== me) : []);
  const ps = world.party;
  ps.parties.clear();
  ps.byPid.clear();
  for (const row of table || []) {
    if (!row || !Array.isArray(row.members)) continue;
    const rec: PartyRecord = {
      id: Number(row.id) || 0,
      leader: Number(row.leader) || 0,
      members: row.members.map((m) => Number(m) || 0),
    };
    ps.parties.set(rec.id, rec);
    for (const m of rec.members) ps.byPid.set(m, rec.id);
    if (rec.id >= ps.nextId) ps.nextId = rec.id + 1;
  }
  const after = partyOf(world, me);
  const newMates = after ? after.members.filter((m) => m !== me && !beforeMates.has(m)) : [];
  return { joined: !before && !!after, left: !!before && !after, newMates };
}
