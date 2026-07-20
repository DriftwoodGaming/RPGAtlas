/* RPGAtlas — src/shared/net/zone-runtime.ts
   Project Beacon MP8·B (item 1, D-8-0): the SEAM between a world zone
   (server/src/core/zone.ts — headless player layer) and the per-zone ENGINE
   event runtime (src/engine/net/zone-event-runtime.ts — interpreter, NPCs,
   events). Both trees import only these DOM-free TYPES, so the zone never
   imports the engine and the engine never imports the server core: the engine
   runtime is injected as a `ZoneRuntimeFactory`.

   Type-only module (interfaces + a factory alias). Lives under src/shared/net
   so the root program and the server program both resolve it; the engine's
   `createZoneEventRuntime` conforms to it and the server's `ZoneOutbox`
   structurally satisfies `ZoneRuntimeOutbox`. GPL-3.0-or-later (see LICENSE). */

import type { JsonValue, PlayerId } from "./protocol.js";
import type { World } from "../sim/world.js";
import type { MapCollision } from "../sim/collision.js";

/** The subset of the zone outbox the engine runtime drives (the server's
 *  ZoneOutbox is a superset — send/sendMany are the zone's own concern). */
export interface ZoneRuntimeOutbox {
  /** An event moved this player to another map (transfer command / door). */
  transferOut(pid: PlayerId, mapId: number, x: number, y: number, dir: number): void;
  /** An event wrote directory-owned shared state (world switch/var/timeOfDay). */
  sharedSet(key: string, value: JsonValue): void;
  /** An event wrote durable per-player state (per-player switches now). */
  recordPatch(pid: PlayerId, patch: Record<string, JsonValue>): void;
}

/** What the zone hands the engine runtime at construction. `world` MUST be the
 *  engine's `defaultWorld` (the interpreter reads through the MP1 compat shim,
 *  which only points there — one engine zone per process/worker, §A2). */
export interface ZoneRuntimeContext {
  world: World;
  mapId: number;
  collision: MapCollision;
  outbox: ZoneRuntimeOutbox;
}

/** One event's networked state (for the world-zone delta, so a future client
 *  renders server-driven NPCs — item 4). Positions in tile units; rx/ry are the
 *  interpolation coords, dir is a DIRD key, page is the active page index. */
export interface EventNetState {
  id: number;
  x: number;
  y: number;
  rx: number;
  ry: number;
  dir: number;
  moving: boolean;
  page: number;
}

/** The engine runtime the zone drives. Every method is fire-and-forget (the
 *  zone never blocks on it), mirroring the ZoneApi discipline. */
export interface ZoneRuntime {
  /** Resolve events + bind the world to this map (called once, at attach). */
  start(): void;
  /** Advance the engine layer one 60 Hz tick (after the zone moved players,
   *  before it broadcasts) and propagate world effects through the outbox. */
  tick(): void;
  /** A player pressed the action button facing (x,y)+dir — trigger the faced
   *  action event, if any. */
  onAct(pid: PlayerId, x: number, y: number, dir: number): void;
  /** A player finished a step onto (x,y) — fire a touch event on that tile. */
  onArrive(pid: PlayerId, x: number, y: number): void;
  /** Live event states for the world-zone broadcast. */
  eventStates(): EventNetState[];
  /** The event-runtime state for the ZoneSnapshot data bag (§A5 D-8-0). */
  snapshotData(): Record<string, JsonValue>;
  /** Re-apply a snapshotted event-runtime state after an eviction/restart. */
  restoreData(data: Record<string, JsonValue>): void;
  /** External world-shared write the directory applied (so the runtime does not
   *  re-emit it through the outbox as its own change). */
  noteExternalShared(key: string, value: JsonValue): void;
  stop(): void;
}

/** A factory the world driver injects into a zone. The engine's
 *  `createZoneEventRuntime` is the one implementation. */
export type ZoneRuntimeFactory = (ctx: ZoneRuntimeContext) => ZoneRuntime;
