/* RPGAtlas — server/src/core/room.ts
   Project Beacon MP5·A: one authoritative friend-room world on the Beacon
   server. This is the server-side analogue of MP4's browser RoomHost, but
   HEADLESS — it owns a `createWorld(project)` instance and advances it itself,
   with NO engine/DOM (the browser host's tick body, scenes/map.ts, cannot run
   here). It is the D1 "one simulation on the server": clients send input
   intents, the room applies authoritative grid movement (with static wall
   collision, collision.ts), and broadcasts player-state deltas + presence.

   SCOPE (roadmap D-0, and Driftwood 2026-07-19 "minimal wall collision now"):
   the room simulates the PLAYER layer — join/leave, position, wall collision,
   emotes/say, directive routing, late-join snapshot, resume. It does NOT run
   autonomous NPC/event motion, encounters, or event execution — that is MP8·A's
   per-zone runtime. So no directive ORIGINATES here yet (nothing runs events),
   but the routing is wired + tested so MP8 drops the runtime in behind it.

   Every player on the server is a roster PlayerEntity (there is no local
   `G.player` — that is a per-client notion; each client treats its OWN id's
   entity as its player and the rest as its roster, applyPlayerStates). GPL-3.0. */

import {
  MAX_NAME_LEN,
  PROTOCOL_VERSION,
  encodeMessage,
  type ClientMessage,
  type ClientMod,
  type JsonValue,
  type PlayerId,
  type ServerMessage,
  type ServerPresence,
} from "../../../src/shared/net/protocol.js";
import { resolveSay, newSocialBucket, spendSocial, type SocialBucket } from "./chat.js";
import { createWorld, type World } from "../../../src/shared/sim/world.js";
import {
  addPlayer,
  entityState,
  getPlayer,
  removePlayer,
  resolveSpawn,
  type PlayerEntity,
  type PlayerState,
} from "../../../src/shared/sim/players.js";
import { deliverReply } from "../../../src/shared/sim/directives.js";
import {
  bakeMapCollision,
  canStep,
  DIR_OFFSET,
  type MapCollision,
} from "../../../src/shared/sim/collision.js";
import { advanceStep, startStep, translateIntent, type PendingMove } from "./motion.js";
import { randomResumeToken } from "./tokens.js";
import type { BeaconLimits } from "./config.js";
import type { ServerConnection } from "./connection.js";
import type { RoomOutbox, RoomSim } from "./room-world.js";

/** A `() => number` millisecond clock (injectable so expiry/resume windows are
 *  testable without real time). Defaults to Date.now. */
export type Clock = () => number;

/** One member of a room. `conn` is null while the player is disconnected but
 *  still inside their resume-grace window (their entity stays in the world). */
export interface RoomMember {
  pid: PlayerId;
  conn: ServerConnection | null;
  name: string;
  charset: string;
  resumeToken: string;
  /** Highest input seq processed (delta.ack seam; prediction lands post-MP5). */
  lastSeq: number;
  /** A queued move/face awaiting the next tick (only one; a client sends ≤ 1
   *  meaningful move per 60 Hz tick). Null when nothing is pending. */
  pending: PendingMove | null;
  /** ms timestamp of disconnect, or 0 while connected. */
  disconnectedAt: number;
  /** Say/emote spam bucket (MP9·A, tick-based). */
  social: SocialBucket;
}

export interface RoomOptions {
  limits: BeaconLimits;
  clock?: Clock;
  /** Seed the room's RNG stream (determinism/tests). */
  seed?: number | null;
  /** MP9·E (E2, D-9E-1): make this an ENGINE room. When present, the room's
   *  simulation is delegated to a RoomWorld (in-process here or across a worker)
   *  that runs the engine event runtime — so co-op parties + shared battles work
   *  over the relay. The room keeps every semantic (code, TTL, resume, owner,
   *  name-ban, chat gate); only the world tick moves into the sim. Absent ⇒ the
   *  MP5 player-layer room, byte-identical. The factory is injected by the server
   *  host so this module never touches the engine. */
  simFactory?: (project: unknown, outbox: RoomOutbox) => RoomSim;
}

/** The snapshot/delta payload the room and the engine client agree on (the
 *  protocol carries it as opaque JsonValue). Matches RoomSnapshot in the client
 *  (src/engine/net/room-client.ts). */
interface RoomWorldPayload {
  players: PlayerState[];
  mapId: number;
  timeOfDay: number;
}

export class BeaconRoom {
  readonly code: string;
  readonly world: World;
  private readonly limits: BeaconLimits;
  private readonly clock: Clock;
  private readonly members = new Map<PlayerId, RoomMember>();
  private readonly collisionCache = new Map<number, MapCollision>();
  /** Per-entity run flag for its in-progress step (kept off the wire — speed is
   *  a server detail; the client interpolates whatever positions arrive). */
  private readonly runFlags = new WeakMap<PlayerEntity, boolean>();
  private nextPid = 1;
  private lastEmptyAt: number;
  /** The room owner (the first player to enter). Owner-only moderation
   *  (kick/ban); promoted to the earliest remaining member if the owner leaves
   *  (MP9·A). -1 while the room has never held a member. */
  private ownerPid: PlayerId = -1;
  /** Lowercased display names the owner banned. A friend room is anonymous
   *  (D3) so a ban is name-based and thus evadable by renaming — this is
   *  documented honestly; durable identity bans require a WORLD (passport). */
  private readonly bannedNames = new Set<string>();
  /** MP9·E (E2): the engine world sim, or null for a player-layer room. When
   *  set, admit/frame/tick/resume/remove delegate to it and `this.world` is a
   *  scratch used only for `proj`/`capacity` reads (the real world lives in the
   *  sim, possibly on a worker thread). */
  private readonly sim: RoomSim | null;

  constructor(code: string, project: unknown, opts: RoomOptions) {
    this.code = code;
    this.limits = opts.limits;
    this.clock = opts.clock || Date.now;
    this.world = createWorld(project, { seed: opts.seed ?? null });
    this.lastEmptyAt = this.clock();
    // Route outbound directives per player to that member's socket. Nothing
    // triggers events on the MP5 server yet (D-0), but the seam is live +
    // tested (a directive emitted at pid N reaches member N and its reply
    // resumes the world — room.test.ts), so MP8's runtime plugs in unchanged.
    // (In an engine room this scratch world is inert; the sim routes directives
    // through its own zone outbox → the RoomOutbox below.)
    this.world.directives.send = (pid, frame) => {
      const m = this.members.get(pid);
      if (m && m.conn) m.conn.send(encodeMessage(frame as ServerMessage));
    };
    // MP9·E: an engine room delegates its whole simulation to a RoomWorld. Its
    // outbox delivers encoded frames straight to the addressed member's socket.
    if (opts.simFactory) {
      const outbox: RoomOutbox = {
        send: (pid, frame) => {
          const m = this.members.get(pid);
          if (m && m.conn) m.conn.send(frame);
        },
        sendMany: (pids, frame) => {
          for (const pid of pids) {
            const m = this.members.get(pid);
            if (m && m.conn) m.conn.send(frame);
          }
        },
      };
      this.sim = opts.simFactory(project, outbox);
    } else {
      this.sim = null;
    }
  }

  /** Connected-member count. */
  get connectedCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.conn) n++;
    return n;
  }

  /** True when the room holds no players at all (connected or resumable). */
  get isVacant(): boolean {
    return this.members.size === 0;
  }

  /** Effective room capacity (MP7·A). The project may author a smaller cap
   *  (`system.multiplayer.maxPlayers`); it can only ever LOWER the ceiling, so
   *  the operator's `maxPlayersPerRoom` stays the authoritative maximum (a
   *  hostile project can't inflate capacity). Absent/invalid ⇒ the operator
   *  limit, byte-identical to MP5. */
  get capacity(): number {
    const cap = this.limits.maxPlayersPerRoom;
    const sys = (this.world.proj as { system?: { multiplayer?: { maxPlayers?: number } } } | null)?.system;
    const authored = sys && sys.multiplayer ? Number(sys.multiplayer.maxPlayers) : 0;
    return authored >= 2 ? Math.min(cap, Math.floor(authored)) : cap;
  }

  /** Room is full for a NEW player (resumes don't count against this). */
  get isFull(): boolean {
    return this.members.size >= this.capacity;
  }

  /** The current room owner's player id (-1 if the room is empty). */
  get owner(): PlayerId {
    return this.ownerPid;
  }

  /** True when this display name was banned by the owner (checked by the server
   *  before admitting a NEW player — a banned name can't rejoin, MP9·A). */
  isNameBanned(name: string): boolean {
    return this.bannedNames.has(String(name || "").trim().toLowerCase());
  }

  /** The member whose slot this connection currently drives, if any. */
  memberOf(conn: ServerConnection): RoomMember | undefined {
    for (const m of this.members.values()) if (m.conn === conn) return m;
    return undefined;
  }

  /** Lazily bake + cache a map's static collision grid. Unknown map → an empty
   *  (all-blocked) grid, so an off-project mapId can't crash movement. */
  private collisionFor(mapId: number): MapCollision {
    let mc = this.collisionCache.get(mapId);
    if (!mc) {
      const proj = this.world.proj as { maps?: Array<{ id?: number }> } | null;
      const map = proj && proj.maps ? proj.maps.find((m) => Number(m.id) === mapId) : null;
      mc = map
        ? bakeMapCollision(this.world.proj, map)
        : { width: 0, height: 0, loopH: false, loopV: false, pass: new Uint8Array(0) };
      this.collisionCache.set(mapId, mc);
    }
    return mc;
  }

  /** All current players as wire state (there is no local player 0 server-side;
   *  every player is a roster entity). */
  private states(): PlayerState[] {
    const out: PlayerState[] = [];
    for (const e of this.world.roster.players.values()) out.push(entityState(e));
    return out;
  }

  private worldPayload(mapId: number): RoomWorldPayload {
    return { players: this.states(), mapId, timeOfDay: this.world.g ? this.world.g.timeOfDay : 12 };
  }

  /** Admit a NEW player on a connection that already sent a valid `hello`.
   *  Returns the member, or null when the room is full (the caller answers
   *  `room-full`). Spawns at the project start, sends welcome + snapshot, and
   *  announces the join to everyone else. */
  admit(conn: ServerConnection, name: string, charset: string): RoomMember | null {
    if (this.isFull) return null;
    const pid = this.nextPid++;
    const cleanName = String(name || "").slice(0, MAX_NAME_LEN) || "Player " + pid;
    const member: RoomMember = {
      pid, conn, name: cleanName, charset,
      resumeToken: randomResumeToken(), lastSeq: 0, pending: null, disconnectedAt: 0,
      social: newSocialBucket(this.world.tick),
    };
    this.members.set(pid, member); // must precede sim.admit (its outbox routes here)
    if (this.ownerPid < 0) this.ownerPid = pid; // first player in = room owner
    conn.send(encodeMessage({
      t: "welcome", proto: PROTOCOL_VERSION, playerId: pid,
      roomCode: this.code, resumeToken: member.resumeToken, tick: this.world.tick,
    }));
    if (this.sim) {
      // Engine room: the world sim spawns the entity at the start map, pushes
      // the join snapshot, and announces the join to the others via its outbox.
      this.sim.admit(pid, cleanName, charset, true);
    } else {
      const spawn = resolveSpawn(this.world, { charset });
      addPlayer(this.world, pid, cleanName, spawn);
      conn.send(encodeMessage({
        t: "snapshot", tick: this.world.tick,
        world: this.worldPayload(spawn.mapId) as unknown as JsonValue,
      }));
      this.broadcastPresence(
        { t: "presence", tick: this.world.tick, kind: "join", playerId: pid, name: cleanName },
        pid,
      );
    }
    return member;
  }

  /** Re-attach `conn` to the disconnected member holding `token`, if still in
   *  its grace window. Returns the member (re-welcomed + re-snapshotted) or null
   *  (the caller answers with a fresh join or a friendly error). */
  resume(conn: ServerConnection, token: string): RoomMember | null {
    for (const m of this.members.values()) {
      if (m.conn === null && m.resumeToken === token) {
        m.conn = conn;
        m.disconnectedAt = 0;
        m.pending = null;
        m.resumeToken = randomResumeToken(); // rotate: a replayed old token is dead
        conn.send(encodeMessage({
          t: "welcome", proto: PROTOCOL_VERSION, playerId: m.pid,
          roomCode: this.code, resumeToken: m.resumeToken, tick: this.world.tick,
        }));
        if (this.sim) {
          this.sim.requestSnapshot(m.pid); // the sim re-pushes the current map
        } else {
          const e = getPlayer(this.world, m.pid);
          conn.send(encodeMessage({
            t: "snapshot", tick: this.world.tick,
            world: this.worldPayload(e ? e.mapId : 0) as unknown as JsonValue,
          }));
        }
        return m;
      }
    }
    return null;
  }

  /** Handle one decoded, in-room client frame from `member`. Movement intents
   *  are BUFFERED and applied by the tick (never on arrival, so message delivery
   *  never re-enters the sim); reply/emote/chat act now. */
  handleFrame(member: RoomMember, msg: ClientMessage): void {
    if (this.sim) {
      // Engine room: moderation stays a room concern (owner/ban/report over the
      // member table); everything world-facing — movement, action/party intents,
      // replies, emote/say (chat gate + spam bucket enforced in the zone), and
      // plugin custom relay — goes to the sim.
      if (msg.t === "mod") { this.handleMod(member, msg); return; }
      if (msg.t === "input" || msg.t === "reply" || msg.t === "emote" || msg.t === "chat" || msg.t === "custom") {
        this.sim.frame(member.pid, msg);
      }
      return;
    }
    if (msg.t === "input") {
      member.lastSeq = msg.seq;
      const pm = translateIntent(msg.intent);
      if (pm) member.pending = pm; // latest move/face wins for the next tick
    } else if (msg.t === "reply") {
      deliverReply(this.world, member.pid, msg.id, msg.value);
    } else if (msg.t === "emote") {
      if (!spendSocial(member.social, this.world.tick)) return; // drop bubble spam
      const e = getPlayer(this.world, member.pid);
      if (e) e.emote = { id: msg.emote, t: this.world.tick };
      this.broadcastPresence(
        { t: "presence", tick: this.world.tick, kind: "emote", playerId: member.pid, emote: msg.emote },
        member.pid, // the emoter already knows; others see the bubble
      );
    } else if (msg.t === "chat") {
      // Preset-say is always allowed; free-text passes only under the game's
      // opted-in chatMode:"text" (MP7 DB toggle, D4) and is then run through the
      // authoritative profanity filter. Everything else stays default-off.
      const r = resolveSay(this.world.proj, msg);
      if (!r.ok) {
        if (member.conn) member.conn.send(encodeMessage({ t: "error", code: r.error }));
        return;
      }
      if (!spendSocial(member.social, this.world.tick)) return; // drop say spam
      const e = getPlayer(this.world, member.pid);
      if (e) e.say = { text: r.say.text, preset: r.say.preset, t: this.world.tick };
      this.broadcastPresence(
        { t: "presence", tick: this.world.tick, kind: "say", playerId: member.pid, text: r.say.text, preset: r.say.preset },
        member.pid,
      );
    } else if (msg.t === "mod") {
      this.handleMod(member, msg);
    } else if (msg.t === "custom") {
      // Beacon MP7·C: relay the plugin's opaque payload to everyone else in the
      // room. The engine NEVER interprets `data` — only the game's plugins do.
      // Communication tier (like emote/chat), no world sim; size + rate are
      // already capped by the frame byte limit and the message token bucket.
      const frame = encodeMessage({ t: "custom", from: member.pid, data: msg.data });
      for (const m of this.members.values()) if (m.conn && m.pid !== member.pid) m.conn.send(frame);
    }
  }

  /** Moderation (MP9·A). `report` (any player → the owner's inbox); `kick`/`ban`
   *  (owner-only — a non-owner gets `not-allowed`). A friend room is anonymous
   *  (D3), so `ban` is name-based (blocks the display name from rejoining until
   *  the room ends; evadable by renaming — documented). */
  private handleMod(member: RoomMember, msg: ClientMod): void {
    if (msg.action === "report") {
      if (msg.target === member.pid) return; // no self-reports
      const owner = this.ownerPid >= 0 ? this.members.get(this.ownerPid) : undefined;
      if (!owner || !owner.conn) return; // nowhere to deliver it
      const target = this.members.get(msg.target);
      owner.conn.send(encodeMessage({
        t: "report", from: member.pid, target: msg.target,
        name: target ? target.name : undefined, reason: msg.reason,
      }));
      return;
    }
    // kick / ban are owner-only.
    if (member.pid !== this.ownerPid) {
      if (member.conn) member.conn.send(encodeMessage({ t: "error", code: "not-allowed" }));
      return;
    }
    if (msg.target === member.pid) return; // the owner can't remove themselves
    const target = this.members.get(msg.target);
    if (!target) return; // already gone
    if (msg.action === "ban") this.bannedNames.add(target.name.trim().toLowerCase());
    this.removeMember(target, msg.action === "ban" ? "banned" : "kicked");
  }

  /** Remove a member immediately (owner kick/ban): kick frame, close, drop the
   *  entity, announce the leave, promote a new owner if this was the owner. */
  private removeMember(m: RoomMember, code: "kicked" | "banned"): void {
    if (m.conn) { m.conn.send(encodeMessage({ t: "kick", code })); m.conn.close(); }
    this.members.delete(m.pid); // before sim.remove so the leave-presence skips them
    if (this.sim) {
      this.sim.remove(m.pid, true);
    } else {
      removePlayer(this.world, m.pid);
      this.broadcastPresence({ t: "presence", tick: this.world.tick, kind: "leave", playerId: m.pid });
    }
    if (m.pid === this.ownerPid) this.promoteOwner();
  }

  /** After the owner leaves, the earliest-joined remaining member inherits it
   *  (lowest pid; -1 when the room is now empty). */
  private promoteOwner(): void {
    let next = -1;
    for (const pid of this.members.keys()) if (next < 0 || pid < next) next = pid;
    this.ownerPid = next;
  }

  /** Advance the room one 60 Hz tick: snapshot prev-tick coords, apply each
   *  player's buffered move (grid step + wall collision + player anti-stack),
   *  advance in-progress steps, then broadcast one delta of every player. */
  tick(): void {
    if (this.sim) {
      // The engine sim owns the world tick (in-process here; a worker self-ticks
      // and no-ops). It must advance even with no players — autorun/parallel
      // events, respawn timers, and shared-battle deadlines keep running.
      this.sim.tick();
      return;
    }
    this.world.tick++;
    if (this.members.size === 0) return;
    // prev-tick render coords for the clients' between-tick interpolation.
    for (const e of this.world.roster.players.values()) { e.prx = e.rx; e.pry = e.ry; }
    for (const member of this.members.values()) {
      const e = getPlayer(this.world, member.pid);
      if (!e) continue;
      if (!e.moving && member.pending) {
        const p = member.pending;
        member.pending = null;
        if (p.kind === "face") e.dir = p.dir;
        else this.tryMove(e, p.dir, p.run);
      }
      if (e.moving) advanceStep(e, this.runFlags.get(e) === true);
    }
    this.broadcastDelta();
  }

  /** Start a grid step if the destination clears static collision AND no other
   *  same-map player already stands (or is stepping) there. */
  private tryMove(e: PlayerEntity, dir: number, run: boolean): void {
    e.dir = dir;
    const mc = this.collisionFor(e.mapId);
    if (!canStep(mc, e.x, e.y, dir)) return;
    const [dx, dy] = DIR_OFFSET[dir] || [0, 0];
    const nx = e.x + dx;
    const ny = e.y + dy;
    for (const other of this.world.roster.players.values()) {
      if (other === e || other.mapId !== e.mapId) continue;
      const ox = other.moving ? other.tx : other.x;
      const oy = other.moving ? other.ty : other.y;
      if (ox === nx && oy === ny) return; // don't stack two players on one tile
    }
    this.runFlags.set(e, run);
    startStep(e, dir);
  }

  private broadcastDelta(): void {
    const frame = encodeMessage({
      t: "delta", tick: this.world.tick,
      changes: { players: this.states() } as unknown as JsonValue,
    });
    for (const m of this.members.values()) if (m.conn) m.conn.send(frame);
  }

  private broadcastPresence(pres: ServerPresence, except: PlayerId = -1): void {
    const frame = encodeMessage(pres);
    for (const m of this.members.values()) if (m.conn && m.pid !== except) m.conn.send(frame);
  }

  /** Mark a member disconnected (its socket dropped). Its entity stays for the
   *  resume-grace window; `sweep` reaps it if no resume arrives. */
  detach(member: RoomMember): void {
    member.conn = null;
    member.disconnectedAt = this.clock();
    if (this.connectedCount === 0) this.lastEmptyAt = this.clock();
  }

  /** Reap members past their resume grace (presence `leave` + remove entity).
   *  Returns true when the room is now expired (vacant past its empty TTL) and
   *  the manager should drop it. */
  sweep(now: number): boolean {
    for (const m of Array.from(this.members.values())) {
      if (m.conn === null && now - m.disconnectedAt >= this.limits.resumeGraceMs) {
        this.members.delete(m.pid);
        if (this.sim) {
          this.sim.remove(m.pid, true);
        } else {
          removePlayer(this.world, m.pid);
          this.broadcastPresence({ t: "presence", tick: this.world.tick, kind: "leave", playerId: m.pid });
        }
        if (m.pid === this.ownerPid) this.promoteOwner();
      }
    }
    if (this.members.size === 0) return now - this.lastEmptyAt >= this.limits.emptyRoomTtlMs;
    return false;
  }

  /** Force-close the room: kick every connected member, drop all state. */
  close(reason: "room-closed" = "room-closed"): void {
    for (const m of this.members.values()) {
      if (m.conn) {
        m.conn.send(encodeMessage({ t: "kick", code: reason }));
        m.conn.close();
      }
    }
    this.members.clear();
    if (this.sim) this.sim.stop(); // tear down the engine world (terminates its worker)
  }
}
