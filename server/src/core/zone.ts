/* RPGAtlas — server/src/core/zone.ts
   Project Beacon MP8·A: one ZONE of a persistent world — one map, one
   headless sim World, up to ~200 players. The roadmap's scale unit: a world
   is a set of zones behind a directory (beacon-world.ts); a zone never knows
   about sockets, passports, or other zones.

   The sharding seam: everything a zone consumes is fire-and-forget method
   calls (ZoneApi) and everything it produces goes through a fire-and-forget
   outbox (ZoneOutbox) — no return values cross the boundary, so the SAME
   class runs in-process (directory calls it directly, the stage-A default),
   behind a worker_threads MessagePort (Node scale-out), or inside its own
   Durable Object (CF, stage B) without changing a line here. Snapshots are
   PUSHED by the zone (admit/requestSnapshot → outbox.send), never returned.

   Per-zone runtime seam (D-5-0 → MP8): this zone runs the PLAYER layer
   (grid movement, wall collision, anti-stack, emote/say/custom relay,
   directive routing) exactly as the MP5 room does. The engine event runtime
   (NPCs, events, encounters) binds onto `zone.world` in stage B — one zone
   per process/worker is what makes the engine's default-world compat shim
   usable server-side (see docs/mp-8-spec.md §A2). The outbox's transferOut/
   sharedSet/recordPatch calls are the seams that runtime will drive.

   Wire economy (MP8·A measured, docs/mp-8-spec.md §A4): the sim ticks at
   60 Hz (motion constants are per-tick — cadence is not negotiable) but the
   state broadcast is decimated to every `broadcastEveryTicks` ticks, and
   filtered per chunked area-of-interest (interest.ts) once occupancy passes
   the bypass threshold. Members in one chunk share one encoded frame.
   GPL-3.0-or-later (see LICENSE). */

import {
  encodeMessage,
  type ClientMessage,
  type JsonValue,
  type PlayerId,
  type ServerMessage,
  type ServerPresence,
} from "../../../src/shared/net/protocol.js";
import { createWorld, type World } from "../../../src/shared/sim/world.js";
import {
  addPlayer,
  entityState,
  getPlayer,
  removePlayer,
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
import { buildChunkIndex, chunkKeyOf, interestSetOf } from "./interest.js";
import type { WorldLimits } from "./config.js";
import type { Clock } from "./room.js";

/** What a zone can be asked to do. Every method is fire-and-forget (void) so
 *  the calls marshal across a worker/DO boundary unchanged. */
export interface ZoneApi {
  readonly mapId: number;
  admit(pid: PlayerId, name: string, charset: string, x: number, y: number, dir: number, snapshot: boolean): void;
  /** Remove a player. `announce` broadcasts the presence `leave` (false when
   *  the directory is moving them to another zone mid-transfer). */
  remove(pid: PlayerId, announce: boolean): void;
  frame(pid: PlayerId, msg: ClientMessage): void;
  /** Push a fresh snapshot to one member (resume/reconnect/post-transfer). */
  requestSnapshot(pid: PlayerId): void;
  /** Apply one world-shared state cell (directory-owned: switches/vars/
   *  timeOfDay — see docs/mp-8-spec.md §A5). Keys: "switch:N" | "var:N" |
   *  "timeOfDay". */
  applyShared(key: string, value: JsonValue): void;
  /** Advance one 60 Hz sim tick (in-process driver; a worker self-ticks). */
  tick(): void;
  stop(): void;
}

/** What a zone produces. All fire-and-forget; the directory (or a worker/DO
 *  adapter) wires these. */
export interface ZoneOutbox {
  /** Deliver one encoded frame to one player's connection. */
  send(pid: PlayerId, frame: string): void;
  /** Deliver one encoded frame to many players (one encode, many sends). */
  sendMany(pids: PlayerId[], frame: string): void;
  /** A zone-side cause (stage B: transfer events) moved this player to
   *  another map: the directory re-homes them into the target zone. */
  transferOut(pid: PlayerId, mapId: number, x: number, y: number, dir: number): void;
  /** A zone-side write to directory-owned shared state (stage B: events
   *  flipping world switches) — the directory rebroadcasts to every zone. */
  sharedSet(key: string, value: JsonValue): void;
  /** Durable per-player state changed zone-side (stage B: per-player
   *  switches, party/inv/gold once events run) — merged into the player's
   *  passport-keyed record by the directory. */
  recordPatch(pid: PlayerId, patch: Record<string, JsonValue>): void;
}

export interface ZoneOptions {
  limits: WorldLimits;
  clock?: Clock;
  seed?: number | null;
}

interface ZoneMember {
  pid: PlayerId;
  name: string;
  charset: string;
  lastSeq: number;
  pending: PendingMove | null;
}

/** The world payload shape snapshots/deltas carry (matches the MP5 room's
 *  RoomWorldPayload — the client already speaks it). */
interface ZoneWorldPayload {
  players: PlayerState[];
  mapId: number;
  timeOfDay: number;
}

export class Zone implements ZoneApi {
  readonly mapId: number;
  readonly world: World;
  private readonly outbox: ZoneOutbox;
  private readonly limits: WorldLimits;
  private readonly members = new Map<PlayerId, ZoneMember>();
  private readonly runFlags = new WeakMap<PlayerEntity, boolean>();
  private collision: MapCollision | null = null;
  private sinceBroadcast = 0;

  constructor(mapId: number, project: unknown, outbox: ZoneOutbox, opts: ZoneOptions) {
    this.mapId = mapId;
    this.outbox = outbox;
    this.limits = opts.limits;
    this.world = createWorld(project, { seed: opts.seed ?? null });
    this.world.g.mapId = mapId;
    // Route outbound directives to the owning player's connection (the MP5
    // seam, kept live — stage B's per-zone event runtime emits through it).
    this.world.directives.send = (pid, frame) => {
      this.outbox.send(pid, encodeMessage(frame as ServerMessage));
    };
  }

  get memberCount(): number {
    return this.members.size;
  }

  private collisionGrid(): MapCollision {
    if (!this.collision) {
      const proj = this.world.proj as { maps?: Array<{ id?: number }> } | null;
      const map = proj && proj.maps ? proj.maps.find((m) => Number(m.id) === this.mapId) : null;
      this.collision = map
        ? bakeMapCollision(this.world.proj, map)
        : { width: 0, height: 0, loopH: false, loopV: false, pass: new Uint8Array(0) };
    }
    return this.collision;
  }

  /* ── membership ──────────────────────────────────────────────────────── */

  admit(pid: PlayerId, name: string, charset: string, x: number, y: number, dir: number, snapshot: boolean): void {
    addPlayer(this.world, pid, name, { mapId: this.mapId, x, y, dir, charset });
    this.members.set(pid, { pid, name, charset, lastSeq: 0, pending: null });
    if (snapshot) this.requestSnapshot(pid);
    this.announce(
      { t: "presence", tick: this.world.tick, kind: "join", playerId: pid, name },
      pid,
    );
  }

  remove(pid: PlayerId, announce: boolean): void {
    if (!this.members.delete(pid)) return;
    removePlayer(this.world, pid);
    if (announce) {
      this.announce({ t: "presence", tick: this.world.tick, kind: "leave", playerId: pid }, pid);
    }
  }

  /** Current tile position of a member (the directory reads it through the
   *  in-process handle for record write-back; a worker adapter mirrors it via
   *  recordPatch instead — see docs/mp-8-spec.md §A5). */
  positionOf(pid: PlayerId): { x: number; y: number; dir: number } | null {
    const e = getPlayer(this.world, pid);
    return e ? { x: e.x, y: e.y, dir: e.dir } : null;
  }

  requestSnapshot(pid: PlayerId): void {
    const e = getPlayer(this.world, pid);
    this.outbox.send(
      pid,
      encodeMessage({
        t: "snapshot",
        tick: this.world.tick,
        world: this.payloadFor(e) as unknown as JsonValue,
      }),
    );
  }

  applyShared(key: string, value: JsonValue): void {
    if (key === "timeOfDay") {
      if (typeof value === "number" && Number.isFinite(value)) this.world.g.timeOfDay = value;
    } else if (key.startsWith("switch:")) {
      this.world.g.switches[key.slice(7)] = !!value;
    } else if (key.startsWith("var:")) {
      if (typeof value === "number") this.world.g.vars[key.slice(4)] = value;
    }
  }

  stop(): void {
    this.members.clear();
    this.world.roster.players.clear();
  }

  /* ── inbound frames ──────────────────────────────────────────────────── */

  frame(pid: PlayerId, msg: ClientMessage): void {
    const member = this.members.get(pid);
    if (!member) return;
    if (msg.t === "input") {
      member.lastSeq = msg.seq;
      const pm = translateIntent(msg.intent);
      if (pm) member.pending = pm; // latest move/face wins for the next tick
    } else if (msg.t === "reply") {
      deliverReply(this.world, pid, msg.id, msg.value);
    } else if (msg.t === "emote") {
      const e = getPlayer(this.world, pid);
      if (e) e.emote = { id: msg.emote, t: this.world.tick };
      this.announce(
        { t: "presence", tick: this.world.tick, kind: "emote", playerId: pid, emote: msg.emote },
        pid,
      );
    } else if (msg.t === "chat") {
      // D4 posture unchanged from MP5: presets always pass, free text is
      // rejected until the MP9 chat engine lands server-side.
      if (msg.text !== undefined) {
        this.outbox.send(pid, encodeMessage({ t: "error", code: "chat-disabled" }));
        return;
      }
      const e = getPlayer(this.world, pid);
      if (e) e.say = { preset: msg.preset, t: this.world.tick };
      this.announce(
        { t: "presence", tick: this.world.tick, kind: "say", playerId: pid, preset: msg.preset },
        pid,
      );
    } else if (msg.t === "custom") {
      // Communication tier (MP7·C): opaque relay, interest-scoped in a big
      // zone (your plugin message reaches the players who can see you).
      const frame = encodeMessage({ t: "custom", from: pid, data: msg.data });
      this.outbox.sendMany(this.audienceAround(pid, pid), frame);
    }
  }

  /* ── tick + broadcast ────────────────────────────────────────────────── */

  tick(): void {
    this.world.tick++;
    if (this.members.size === 0) return;
    for (const e of this.world.roster.players.values()) {
      e.prx = e.rx;
      e.pry = e.ry;
    }
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
    if (++this.sinceBroadcast >= this.limits.broadcastEveryTicks) {
      this.sinceBroadcast = 0;
      this.broadcast();
    }
  }

  private tryMove(e: PlayerEntity, dir: number, run: boolean): void {
    e.dir = dir;
    if (!canStep(this.collisionGrid(), e.x, e.y, dir)) return;
    const [dx, dy] = DIR_OFFSET[dir] || [0, 0];
    const nx = e.x + dx;
    const ny = e.y + dy;
    for (const other of this.world.roster.players.values()) {
      if (other === e) continue;
      const ox = other.moving ? other.tx : other.x;
      const oy = other.moving ? other.ty : other.y;
      if (ox === nx && oy === ny) return; // anti-stack
    }
    this.runFlags.set(e, run);
    startStep(e, dir);
  }

  /** Below the bypass threshold: one frame for everyone. Above it: group by
   *  chunk — members of a chunk share one interest set and one encode. */
  private broadcast(): void {
    const tick = this.world.tick;
    if (this.members.size <= this.limits.aoiBypassMax) {
      const players: PlayerState[] = [];
      for (const e of this.world.roster.players.values()) players.push(entityState(e));
      const frame = encodeMessage({
        t: "delta",
        tick,
        changes: { players, mapId: this.mapId, timeOfDay: this.world.g.timeOfDay } as unknown as JsonValue,
      });
      this.outbox.sendMany(Array.from(this.members.keys()), frame);
      return;
    }
    const index = buildChunkIndex(this.world.roster.players.values());
    for (const [chunkKey, bucket] of index) {
      const interest = interestSetOf(chunkKey, index);
      const players = interest.map(entityState);
      const frame = encodeMessage({
        t: "delta",
        tick,
        changes: { players, mapId: this.mapId, timeOfDay: this.world.g.timeOfDay } as unknown as JsonValue,
      });
      this.outbox.sendMany(bucket.map((e) => e.id), frame);
    }
  }

  /** The interest-set audience around a player (whole zone under bypass),
   *  excluding `except`. */
  private audienceAround(pid: PlayerId, except: PlayerId): PlayerId[] {
    if (this.members.size <= this.limits.aoiBypassMax) {
      const out: PlayerId[] = [];
      for (const id of this.members.keys()) if (id !== except) out.push(id);
      return out;
    }
    const e = getPlayer(this.world, pid);
    if (!e) return [];
    const index = buildChunkIndex(this.world.roster.players.values());
    return interestSetOf(chunkKeyOf(e.x, e.y), index)
      .filter((p) => p.id !== except)
      .map((p) => p.id);
  }

  /** Presence to the audience around the subject player. */
  private announce(pres: ServerPresence, around: PlayerId): void {
    const audience = this.audienceAround(around, pres.playerId);
    if (audience.length) this.outbox.sendMany(audience, encodeMessage(pres));
  }

  private payloadFor(e: PlayerEntity | undefined): ZoneWorldPayload {
    let players: PlayerState[];
    if (!e || this.members.size <= this.limits.aoiBypassMax) {
      players = [];
      for (const p of this.world.roster.players.values()) players.push(entityState(p));
    } else {
      const index = buildChunkIndex(this.world.roster.players.values());
      players = interestSetOf(chunkKeyOf(e.x, e.y), index).map(entityState);
    }
    return { players, mapId: this.mapId, timeOfDay: this.world.g.timeOfDay };
  }
}
