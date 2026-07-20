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
import type { ZoneSnapshot } from "./store.js";
import type {
  EventNetState,
  ZoneRuntime,
  ZoneRuntimeFactory,
} from "../../../src/shared/net/zone-runtime.js";

export type { ZoneRuntime, ZoneRuntimeFactory, ZoneRuntimeContext, ZoneRuntimeOutbox, EventNetState } from "../../../src/shared/net/zone-runtime.js";

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
  /** Adopt an existing world instead of creating a fresh one. The per-zone
   *  ENGINE event runtime (D-8-0) requires this to be the engine's
   *  `defaultWorld` so the interpreter's compat shim drives THIS zone —
   *  one engine zone per process/worker (docs/mp-8-spec.md §A2). Absent ⇒ a
   *  fresh isolated world (the player-layer default; many per process). */
  world?: World;
  /** Attach an engine event runtime (NPCs/events/interpreter) to this zone. The
   *  factory is injected by the world driver (never imported by the zone), so
   *  the headless zone core stays off the engine graph. Requires `world` to be
   *  the engine default world. */
  runtimeFactory?: ZoneRuntimeFactory;
}

interface ZoneMember {
  pid: PlayerId;
  name: string;
  charset: string;
  lastSeq: number;
  pending: PendingMove | null;
}

/** The world payload shape snapshots/deltas carry (matches the MP5 room's
 *  RoomWorldPayload — the client already speaks it). `events` is additive and
 *  only present on a world zone with an engine runtime (D-8-0): server-driven
 *  NPC/event states a future world client renders (item 4). Existing clients
 *  ignore the extra field, so a runtime-less zone is byte-identical. */
interface ZoneWorldPayload {
  players: PlayerState[];
  mapId: number;
  timeOfDay: number;
  events?: EventNetState[];
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
  /** The optional engine event runtime (D-8-0). Null ⇒ a bare player-layer zone
   *  (byte-identical to MP8·A); non-null ⇒ NPCs/events/interpreter run here. */
  private readonly runtime: ZoneRuntime | null;

  constructor(mapId: number, project: unknown, outbox: ZoneOutbox, opts: ZoneOptions) {
    this.mapId = mapId;
    this.outbox = outbox;
    this.limits = opts.limits;
    // Adopt the engine default world (engine-runtime zones) or create a fresh
    // isolated one (the player-layer default).
    if (opts.world) {
      this.world = opts.world;
      this.world.proj = project;
      if (opts.seed != null) this.world.seedRnd(opts.seed);
    } else {
      this.world = createWorld(project, { seed: opts.seed ?? null });
    }
    this.world.g.mapId = mapId;
    // Route outbound directives to the owning player's connection (the MP5
    // seam, kept live — the per-zone event runtime emits through it).
    this.world.directives.send = (pid, frame) => {
      this.outbox.send(pid, encodeMessage(frame as ServerMessage));
    };
    // Attach the engine event runtime (D-8-0). It shares this.world, drives
    // NPCs/events, and pushes world effects through the outbox. Built after the
    // directive send is wired so its presentation port reaches players.
    if (opts.runtimeFactory) {
      this.runtime = opts.runtimeFactory({
        world: this.world,
        mapId,
        collision: this.collisionGrid(),
        outbox: this.outbox,
      });
      this.runtime.start();
    } else {
      this.runtime = null;
    }
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

  /** Live server-driven event states (empty without an engine runtime). The
   *  directory reads this on an in-process zone like positionOf; the broadcast
   *  path carries it in the delta for a future world client (item 4). */
  eventStates(): EventNetState[] {
    return this.runtime ? this.runtime.eventStates() : [];
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
    // Tell the engine runtime this was an EXTERNAL write (directory fan-out), so
    // its world-effect diff does not echo it straight back out through sharedSet.
    if (this.runtime) this.runtime.noteExternalShared(key, value);
  }

  stop(): void {
    if (this.runtime) this.runtime.stop();
    this.members.clear();
    this.world.roster.players.clear();
  }

  /* ── persistence (in-process zones; §A5 ZoneSnapshot) ────────────────────
     Snapshot/restore capture the ZONE-LOCAL state (map-scoped self-switches
     now; the per-zone event runtime widens `data` with event positions/pages
     in D-8-0). The directory reads these directly on an in-process Zone (like
     positionOf) — a worker/DO zone pushes its snapshot through the outbox
     instead (stage-B CF work). Shared state (switches/vars/timeOfDay) is the
     directory's WorldSnapshot, not the zone's. */

  snapshot(): ZoneSnapshot {
    // selfSw is zone-local (map-scoped self-switches); `data` carries the engine
    // runtime's event positions/pages when one is attached (D-8-0).
    return {
      selfSw: { ...this.world.g.selfSw },
      data: this.runtime ? this.runtime.snapshotData() : {},
    };
  }

  restore(snap: ZoneSnapshot): void {
    if (snap.selfSw) Object.assign(this.world.g.selfSw, snap.selfSw);
    // Restore event runtime state AFTER selfSw (pages resolve against selfSw).
    if (this.runtime && snap.data) {
      this.runtime.restoreData(snap.data);
    }
  }

  /* ── inbound frames ──────────────────────────────────────────────────── */

  frame(pid: PlayerId, msg: ClientMessage): void {
    const member = this.members.get(pid);
    if (!member) return;
    if (msg.t === "input") {
      member.lastSeq = msg.seq;
      const pm = translateIntent(msg.intent);
      if (pm) member.pending = pm; // latest move/face wins for the next tick
      else if (this.runtime && msg.intent.k === "act") {
        // Action-button interaction (talk to an NPC / open a door) — only a
        // world zone with an engine runtime acts on it; the player must be
        // standing still and not mid-cutscene.
        const e = getPlayer(this.world, pid);
        if (e && !e.moving && !this.world.blocking.has(pid)) {
          this.runtime.onAct(pid, e.x, e.y, e.dir);
        }
      }
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
    // With an engine runtime attached, events/NPCs must keep ticking even with
    // no players present (autorun cutscenes, parallel clocks, respawn timers);
    // a bare player-layer zone has nothing to do when empty.
    if (this.members.size === 0 && !this.runtime) return;
    for (const e of this.world.roster.players.values()) {
      e.prx = e.rx;
      e.pry = e.ry;
    }
    for (const member of this.members.values()) {
      const e = getPlayer(this.world, member.pid);
      if (!e) continue;
      // A player participating in a blocking event (participants-only pause,
      // MP3/D-8-0) does not move — inert without a runtime (blocking is empty).
      if (!e.moving && member.pending && !this.world.blocking.has(member.pid)) {
        const p = member.pending;
        member.pending = null;
        if (p.kind === "face") e.dir = p.dir;
        else this.tryMove(e, p.dir, p.run);
      }
      if (e.moving) {
        const arrived = advanceStep(e, this.runFlags.get(e) === true);
        // A completed step onto a tile can trigger a touch event (world zones).
        if (arrived && this.runtime) this.runtime.onArrive(member.pid, e.x, e.y);
      }
    }
    // Advance the engine layer (NPCs/events/interpreter) after player motion,
    // before the broadcast — so event positions + world effects are current.
    if (this.runtime) this.runtime.tick();
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
    const events = this.eventsPayload();
    if (this.members.size <= this.limits.aoiBypassMax) {
      const players: PlayerState[] = [];
      for (const e of this.world.roster.players.values()) players.push(entityState(e));
      const frame = encodeMessage({
        t: "delta",
        tick,
        changes: this.payload(players, events) as unknown as JsonValue,
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
        changes: this.payload(players, events) as unknown as JsonValue,
      });
      this.outbox.sendMany(bucket.map((e) => e.id), frame);
    }
  }

  /** Compose a delta/snapshot payload, attaching event states only when the
   *  engine runtime produced any (additive — a runtime-less zone omits the
   *  field, byte-identical to MP8·A). */
  private payload(players: PlayerState[], events: EventNetState[] | undefined): ZoneWorldPayload {
    const p: ZoneWorldPayload = { players, mapId: this.mapId, timeOfDay: this.world.g.timeOfDay };
    if (events && events.length) p.events = events;
    return p;
  }

  private eventsPayload(): EventNetState[] | undefined {
    return this.runtime ? this.runtime.eventStates() : undefined;
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
    return this.payload(players, this.eventsPayload());
  }
}
