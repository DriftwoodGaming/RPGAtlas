/* RPGAtlas — src/shared/sim/players.ts
   Project Beacon MP4·A: the multi-player roster + entity model. A World has
   always known ONE player (the engine's `G.player`); a Beacon room knows many.
   This module adds the world-side record of the OTHER players sharing the room —
   who they are (id + display name), which map they stand on, and the motion
   state the client renders them with. It is deliberately the SAME motion shape
   the map runtime uses for `G.player` and party followers (x/y + rx/ry render
   coords + prx/pry previous-tick coords for the loop's between-tick
   interpolation), so the renderer draws a remote player through the exact
   follower/player sprite path — a second player is a follower that answers to
   someone else's keyboard.

   Solo-inert by construction (this is what keeps the frozen pixel goldens
   byte-identical): single-player never opens a room, so `world.roster.players`
   stays EMPTY and `local` stays 0. Every reader below (and the render-glue
   remote-player pass) short-circuits on an empty roster, so a solo world
   behaves exactly as it did before MP4.

   Headless by law (sim lint wall): the world stores an appearance KEY
   (`charset`, a string) — resolving it to a spritesheet index is the client's
   job (Assets lives on the DOM side). Nothing here imports Assets, the DOM, or
   any engine module. GPL-3.0-or-later (see LICENSE). */

import type { PlayerId } from "../net/protocol.js";
import type { World } from "./world.js";

/** One OTHER player as this world knows them. The motion sextet
 *  (x/y, rx/ry, prx/pry, tx/ty, dir, moving, animT) mirrors the map runtime's
 *  entity shape exactly, so the renderer interpolates and animates a remote
 *  player identically to a party follower. `mapId` is which map they occupy —
 *  a client only draws the remote players whose `mapId` matches its own
 *  (free-roam map policy, Driftwood 2026-07-19: players roam independently;
 *  you see the ones standing on your map). */
export interface PlayerEntity {
  /** Server-assigned room player id (never the local viewer — see roster). */
  id: PlayerId;
  /** Display name (D3/D6: the ONLY personal fact on the wire besides position). */
  name: string;
  /** Charset appearance key; the client resolves it to a spritesheet index. */
  charset: string;
  /** Which map this player stands on. */
  mapId: number;
  // ---- motion (same fields the map runtime writes on G.player / followers) --
  x: number;
  y: number;
  /** Render coords (smoothly chase x/y); prev-tick coords feed interpolation. */
  rx: number;
  ry: number;
  prx: number;
  pry: number;
  /** Target tile of the current step. */
  tx: number;
  ty: number;
  /** Grid direction (0=down 1=left 2=right 3=up, then diagonals — DIRD keys). */
  dir: number;
  moving: boolean;
  animT: number;
  /** Social overlay (MP4·C fills these): a transient emote bubble / say line,
   *  each stamped with the world tick it started so the client can expire it.
   *  Null in stage A. */
  emote: { id: string; t: number } | null;
  say: { text?: string; preset?: number; t: number } | null;
}

/** Per-world multi-player roster. Runtime-only, exactly like the directive
 *  broker — never part of a save snapshot (a solo save has no roster; a room's
 *  join-sync rebuilds it from presence + the world snapshot, stage B). */
export interface RosterState {
  /** THIS client's own player id. Its entity is `G.player` (driven by local
   *  input / prediction), never an entry in `players` below — so a client
   *  renders itself once, through the existing player path. Solo: 0, unused. */
  local: PlayerId;
  /** The OTHER players in the room, keyed by id. Empty in solo. */
  players: Map<PlayerId, PlayerEntity>;
}

export function createRosterState(): RosterState {
  return { local: 0, players: new Map() };
}

/** A player's spawn placement. All fields optional — omitted ones fall back to
 *  the project's start position (MP7 adds per-map spawn points in the DB). */
export interface Spawn {
  mapId?: number;
  x?: number;
  y?: number;
  dir?: number;
  charset?: string;
}

/** Grid direction (DIRD key) for a Dir string / numeric value, defaulting to
 *  down (0). The project's `startDir` is authored as a Dir string. */
export function gridDirOf(dir: unknown): number {
  switch (dir) {
    case "left":
    case 1:
      return 1;
    case "right":
    case 2:
      return 2;
    case "up":
    case 3:
      return 3;
    case "down":
    case 0:
    default:
      return 0;
  }
}

/** Resolve a spawn against the world's project start defaults. Pure — no map
 *  load, no collision check (the caller places the entity; movement re-validates
 *  every step). A missing project (bare test world) yields origin/down. */
export function resolveSpawn(world: World, spawn: Spawn = {}): Required<Spawn> {
  const sys = (world.proj && world.proj.system) || {};
  return {
    mapId: spawn.mapId != null ? spawn.mapId : Number(sys.startMapId) || 0,
    x: spawn.x != null ? spawn.x : Number(sys.startX) || 0,
    y: spawn.y != null ? spawn.y : Number(sys.startY) || 0,
    dir: spawn.dir != null ? gridDirOf(spawn.dir) : gridDirOf(sys.startDir),
    charset: spawn.charset != null ? spawn.charset : "",
  };
}

/** Add (or re-place) a remote player, returning the entity. The motion render
 *  coords snap onto the spawn tile (no interpolation streak on join). Placing
 *  an existing id re-spawns it (idempotent join). */
export function addPlayer(world: World, id: PlayerId, name: string, spawn: Spawn = {}): PlayerEntity {
  const s = resolveSpawn(world, spawn);
  const ent: PlayerEntity = {
    id,
    name: name || "",
    charset: s.charset,
    mapId: s.mapId,
    x: s.x,
    y: s.y,
    rx: s.x,
    ry: s.y,
    prx: s.x,
    pry: s.y,
    tx: s.x,
    ty: s.y,
    dir: s.dir,
    moving: false,
    animT: 0,
    emote: null,
    say: null,
  };
  world.roster.players.set(id, ent);
  return ent;
}

/** Remove a player (leave / disconnect). Returns whether one was present. */
export function removePlayer(world: World, id: PlayerId): boolean {
  return world.roster.players.delete(id);
}

/** The remote player with this id, or undefined. */
export function getPlayer(world: World, id: PlayerId): PlayerEntity | undefined {
  return world.roster.players.get(id);
}

/** Every remote player currently standing on `mapId` (the ones a client on
 *  that map draws). Allocation-free empty result for the common solo case. */
export function playersOnMap(world: World, mapId: number): PlayerEntity[] {
  const players = world.roster.players;
  if (players.size === 0) return EMPTY;
  const out: PlayerEntity[] = [];
  for (const p of players.values()) if (p.mapId === mapId) out.push(p);
  return out;
}

const EMPTY: PlayerEntity[] = [];
