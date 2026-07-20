/* RPGAtlas — server/src/core/room-world.ts
   Project Beacon MP9·E (E2, decision D-9E-1): the engine world INSIDE a friend
   room. A friend room's connection/semantics layer stays exactly where MP5 put
   it (server.ts + room.ts own the room code, anonymous hello, TTL, resume grace,
   owner moderation, name-ban, chat gate). What E2 adds is the SIM: instead of
   the MP5 room's player-layer-only tick, an engine-backed room delegates its
   simulation to ONE of these — a self-contained mini-directory of zones that
   runs the engine event runtime, so co-op parties + shared battles (the F-1
   release-gate blocker) finally work over the relay.

   Why a mini-directory and not a single zone: a room is ONE world that ticks its
   occupied maps in one instance (the MP4 free-roam host model — roadmap D-9E-1).
   The start map is the ENGINE zone (defaultWorld + the per-zone runtime →
   NPCs/events/encounters/battles); a transfer to another map spins up a second
   zone here (player-layer for that map — the engine's one-defaultWorld-per-
   process rule means only the first zone gets the runtime, exactly like the
   in-process `--engine-events` world, engine-zone.ts). Transfers, world-shared
   switch/var fan-out, and A-2 party-follow all resolve INSIDE this instance, so
   the whole room lives in one worker (worker-per-room, not zone-per-worker).

   This module stays OFF the engine graph (like beacon-world.ts): the engine
   zone factory is INJECTED by the worker/test host (server/src/node — the one
   place that imports the engine). Ephemeral by construction: a room is anonymous
   and disappears on its empty-TTL, so there is no passport, no record, and no
   durable store here — `recordPatch` is dropped, `transferOut` re-homes in
   memory. GPL-3.0-or-later (see LICENSE). */

import { createWorld, type World } from "../../../src/shared/sim/world.js";
import { resolveSpawn } from "../../../src/shared/sim/players.js";
import { Zone, type ZoneApi, type ZoneOutbox } from "./zone.js";
import { DEFAULT_WORLD_LIMITS, type BeaconLimits, type WorldLimits } from "./config.js";
import type { Clock } from "./room.js";
import type { ClientMessage, JsonValue, PlayerId } from "../../../src/shared/net/protocol.js";

/** Where a RoomWorld sends its outbound frames — back to the room's member
 *  sockets (in-process: the room's connection map; worker: across the thread
 *  boundary to the parent). Only the two delivery ops leave the room world;
 *  transfer/shared/record are resolved internally. */
export interface RoomOutbox {
  send(pid: PlayerId, frame: string): void;
  sendMany(pids: PlayerId[], frame: string): void;
}

/** The simulation surface a BeaconRoom drives (in-process directly, or across a
 *  worker via WorkerRoomWorld). Fire-and-forget so it marshals unchanged over a
 *  MessagePort — the ZoneApi discipline, one level up. The room keeps ownership
 *  of pids, so it hands them in; spawn placement is the world's business. */
export interface RoomSim {
  /** Spawn a NEW player at the project start map. `snapshot` pushes the join
   *  snapshot (always true for a real join/resume). */
  admit(pid: PlayerId, name: string, charset: string, snapshot: boolean): void;
  remove(pid: PlayerId, announce: boolean): void;
  frame(pid: PlayerId, msg: ClientMessage): void;
  requestSnapshot(pid: PlayerId): void;
  /** Advance one 60 Hz tick (in-process driver; a worker self-ticks and no-ops). */
  tick(): void;
  stop(): void;
}

export interface RoomWorldOptions {
  limits: BeaconLimits;
  seed?: number | null;
  clock?: Clock;
  /** Build a zone. The FIRST zone created (the start map) should carry the
   *  engine runtime; the rest are player-layer. Injected by the host so this
   *  module never imports the engine. Default: bare player-layer zones (a
   *  runtime-less room — used by directory-routing tests). */
  zoneFactory?: (mapId: number, outbox: ZoneOutbox) => ZoneApi;
}

/** Friend-room zone limits: broadcast every tick (a small room needs no
 *  decimation — the MP8·A note "friend rooms keep every-tick") and never AOI-
 *  filter (a room is ≤ 16 players, always under the bypass threshold). The
 *  per-zone / per-world caps ride the room's player cap. */
export function roomWorldLimits(base: BeaconLimits): WorldLimits {
  return {
    ...DEFAULT_WORLD_LIMITS,
    ...base,
    maxPlayersPerZone: base.maxPlayersPerRoom,
    maxPlayersPerWorld: base.maxPlayersPerRoom,
    broadcastEveryTicks: 1,
    aoiBypassMax: Math.max(base.maxPlayersPerRoom, DEFAULT_WORLD_LIMITS.aoiBypassMax),
    emptyZoneTtlMs: DEFAULT_WORLD_LIMITS.emptyZoneTtlMs,
  };
}

export class RoomWorld implements RoomSim {
  private readonly project: unknown;
  private readonly limits: WorldLimits;
  private readonly seed: number | null;
  private readonly clock: Clock;
  private readonly zoneFactory: (mapId: number, outbox: ZoneOutbox) => ZoneApi;
  private readonly zones = new Map<number, ZoneApi>();
  private readonly memberMap = new Map<PlayerId, number>(); // pid → current mapId
  private readonly names = new Map<PlayerId, { name: string; charset: string }>();
  /** World-shared state (switch:N / var:N / timeOfDay) so a zone created later
   *  by a transfer inherits the room's current world flags. */
  private readonly shared = new Map<string, JsonValue>();
  private readonly outbox: ZoneOutbox;
  /** Scratch world for pure project reads (resolveSpawn) — never ticked. */
  private readonly scratch: World;
  private stopped = false;

  constructor(project: unknown, roomOut: RoomOutbox, opts: RoomWorldOptions) {
    this.project = project;
    this.limits = roomWorldLimits(opts.limits);
    this.seed = opts.seed ?? null;
    this.clock = opts.clock || Date.now;
    this.scratch = createWorld(project);
    this.zoneFactory =
      opts.zoneFactory ||
      ((mapId, outbox) => new Zone(mapId, project, outbox, { limits: this.limits, clock: this.clock, seed: this.seed }));
    // A zone reaches the rest of the room through this outbox: delivery goes to
    // the sockets; a transfer re-homes in memory; a world-shared write fans out
    // to every zone; per-player record patches are dropped (rooms are ephemeral,
    // there is nowhere durable to write them).
    this.outbox = {
      send: (pid, frame) => roomOut.send(pid, frame),
      sendMany: (pids, frame) => roomOut.sendMany(pids, frame),
      transferOut: (pid, mapId, x, y, dir) => this.transferPlayer(pid, mapId, x, y, dir),
      sharedSet: (key, value) => this.setShared(key, value),
      recordPatch: () => {},
    };
  }

  /* ── RoomSim surface (the room drives these) ─────────────────────────────── */

  admit(pid: PlayerId, name: string, charset: string, snapshot: boolean): void {
    if (this.stopped) return;
    const spawn = resolveSpawn(this.scratch, { charset });
    this.names.set(pid, { name, charset });
    this.memberMap.set(pid, spawn.mapId);
    const zone = this.zoneFor(spawn.mapId);
    zone.admit(pid, name, charset, spawn.x, spawn.y, spawn.dir, snapshot);
  }

  remove(pid: PlayerId, announce: boolean): void {
    const mapId = this.memberMap.get(pid);
    if (mapId === undefined) return;
    const zone = this.zones.get(mapId);
    if (zone) zone.remove(pid, announce);
    this.memberMap.delete(pid);
    this.names.delete(pid);
  }

  frame(pid: PlayerId, msg: ClientMessage): void {
    const mapId = this.memberMap.get(pid);
    if (mapId === undefined) return;
    const zone = this.zones.get(mapId);
    if (zone) zone.frame(pid, msg);
  }

  requestSnapshot(pid: PlayerId): void {
    const mapId = this.memberMap.get(pid);
    if (mapId === undefined) return;
    const zone = this.zones.get(mapId);
    if (zone) zone.requestSnapshot(pid);
  }

  tick(): void {
    if (this.stopped) return;
    for (const zone of this.zones.values()) zone.tick();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const zone of this.zones.values()) zone.stop();
    this.zones.clear();
    this.memberMap.clear();
    this.names.clear();
  }

  /** Live zone count (tests / logging). */
  get zoneCount(): number {
    return this.zones.size;
  }

  /* ── internals ──────────────────────────────────────────────────────────── */

  /** Move a player to another map inside this room (the engine transfer command
   *  drives it via the zone outbox). A-2 party-follow already warped the party's
   *  ENTITIES onto the arrival tile inside the engine zone; each moved player's
   *  own transferOut re-homes them here and re-snapshots so their client renders
   *  the new map (the gateway model — the socket never moves). */
  private transferPlayer(pid: PlayerId, mapId: number, x: number, y: number, dir: number): void {
    if (this.stopped) return;
    const info = this.names.get(pid);
    const cur = this.memberMap.get(pid);
    if (!info || cur === undefined) return;
    const spawn = this.spawnOn(mapId, x, y, dir);
    const from = this.zones.get(cur);
    if (from) from.remove(pid, true); // announce the leave on the old map
    const to = this.zoneFor(mapId);
    this.memberMap.set(pid, mapId);
    to.admit(pid, info.name, info.charset, spawn.x, spawn.y, spawn.dir, true);
  }

  private setShared(key: string, value: JsonValue): void {
    this.shared.set(key, value);
    for (const zone of this.zones.values()) zone.applyShared(key, value);
  }

  private zoneFor(mapId: number): ZoneApi {
    let zone = this.zones.get(mapId);
    if (!zone) {
      zone = this.zoneFactory(mapId, this.outbox);
      this.zones.set(mapId, zone);
      // Replay the room's current world-shared state into the fresh zone so a
      // transfer target sees the switches/vars the party already flipped.
      for (const [key, value] of this.shared) zone.applyShared(key, value);
    }
    return zone;
  }

  /** Spawn placement on a map: explicit coords (≥ 0) win; a transferOut passes
   *  -1 for an omitted axis, which falls back to the map's authored spawn. */
  private spawnOn(mapId: number, x: number, y: number, dir: number): { x: number; y: number; dir: number } {
    const s = resolveSpawn(this.scratch, {
      mapId,
      x: x >= 0 ? x : undefined,
      y: y >= 0 ? y : undefined,
      dir: dir >= 0 ? dir : undefined,
    });
    return { x: s.x, y: s.y, dir: s.dir };
  }
}
