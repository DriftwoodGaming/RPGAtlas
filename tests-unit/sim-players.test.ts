/* RPGAtlas — tests-unit/sim-players.test.ts
   Project Beacon MP4·A: the multi-player roster + entity model. Pure/headless —
   a bare world stands in for a Beacon room; no engine/DOM module loads. Covers
   spawn resolution (project defaults + overrides), add/remove/get idempotency,
   the per-map query, and the solo-inert invariant (an untouched world has an
   empty roster, so every remote-player path short-circuits). GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import { createWorld } from "../src/shared/sim/world";
import {
  addPlayer,
  createRosterState,
  getPlayer,
  gridDirOf,
  playersOnMap,
  removePlayer,
  resolveSpawn,
} from "../src/shared/sim/players";

const PROJ = {
  system: { startMapId: 3, startX: 7, startY: 9, startDir: "left" },
};

describe("roster state", () => {
  it("a fresh world is solo-inert: empty roster, local player 0", () => {
    const w = createWorld();
    expect(w.roster.local).toBe(0);
    expect(w.roster.players.size).toBe(0);
    // the per-map query returns a shared empty array (no per-frame allocation)
    expect(playersOnMap(w, 0)).toBe(playersOnMap(w, 5));
    expect(playersOnMap(w, 0)).toEqual([]);
  });

  it("createRosterState matches createWorld's initializer", () => {
    const r = createRosterState();
    expect(r).toEqual({ local: 0, players: new Map() });
  });
});

describe("gridDirOf", () => {
  it("maps Dir strings and numbers to DIRD keys, defaulting to down", () => {
    expect(gridDirOf("down")).toBe(0);
    expect(gridDirOf("left")).toBe(1);
    expect(gridDirOf("right")).toBe(2);
    expect(gridDirOf("up")).toBe(3);
    expect(gridDirOf(2)).toBe(2);
    expect(gridDirOf(undefined)).toBe(0);
    expect(gridDirOf("garbage")).toBe(0);
  });
});

describe("resolveSpawn", () => {
  it("falls back to the project start position", () => {
    const w = createWorld(PROJ);
    expect(resolveSpawn(w)).toEqual({ mapId: 3, x: 7, y: 9, dir: 1, charset: "" });
  });

  it("honors explicit overrides", () => {
    const w = createWorld(PROJ);
    expect(resolveSpawn(w, { mapId: 10, x: 1, y: 2, dir: "up", charset: "hero" })).toEqual({
      mapId: 10, x: 1, y: 2, dir: 3, charset: "hero",
    });
  });

  it("a project-less world spawns at origin/down", () => {
    const w = createWorld();
    expect(resolveSpawn(w)).toEqual({ mapId: 0, x: 0, y: 0, dir: 0, charset: "" });
  });

  // MP7·A: an authored per-map spawn point places joining players on that map.
  const MP_PROJ = {
    system: {
      startMapId: 3, startX: 7, startY: 9, startDir: "left",
      multiplayer: { spawns: { 3: { x: 12, y: 4, dir: "up" } } },
    },
  };

  it("uses the map's authored multiplayer spawn point when present", () => {
    const w = createWorld(MP_PROJ);
    // resolves to the start map (3) → its authored spawn overrides start x/y/dir
    expect(resolveSpawn(w)).toEqual({ mapId: 3, x: 12, y: 4, dir: 3, charset: "" });
  });

  it("falls back to the project start on maps without a spawn point", () => {
    const w = createWorld(MP_PROJ);
    expect(resolveSpawn(w, { mapId: 8 })).toEqual({ mapId: 8, x: 7, y: 9, dir: 1, charset: "" });
  });

  it("explicit x/y/dir still win over an authored spawn point", () => {
    const w = createWorld(MP_PROJ);
    expect(resolveSpawn(w, { x: 1, y: 1, dir: "down" })).toEqual({ mapId: 3, x: 1, y: 1, dir: 0, charset: "" });
  });
});

describe("addPlayer / removePlayer / getPlayer", () => {
  it("adds a fully-shaped entity snapped onto its spawn tile", () => {
    const w = createWorld(PROJ);
    const e = addPlayer(w, 2, "Robin", { mapId: 3, x: 4, y: 5, dir: "right", charset: "robin" });
    expect(e).toMatchObject({
      id: 2, name: "Robin", charset: "robin", mapId: 3,
      x: 4, y: 5, rx: 4, ry: 5, prx: 4, pry: 5, tx: 4, ty: 5,
      dir: 2, moving: false, animT: 0, emote: null, say: null,
    });
    expect(getPlayer(w, 2)).toBe(e);
    expect(w.roster.players.size).toBe(1);
  });

  it("re-adding an id re-spawns it (idempotent join)", () => {
    const w = createWorld(PROJ);
    addPlayer(w, 2, "Robin", { mapId: 3, x: 4, y: 5 });
    const again = addPlayer(w, 2, "Robin", { mapId: 3, x: 1, y: 1 });
    expect(w.roster.players.size).toBe(1);
    expect(again.x).toBe(1);
    expect(again.y).toBe(1);
  });

  it("removePlayer reports presence and clears", () => {
    const w = createWorld(PROJ);
    addPlayer(w, 2, "Robin");
    expect(removePlayer(w, 2)).toBe(true);
    expect(removePlayer(w, 2)).toBe(false);
    expect(getPlayer(w, 2)).toBeUndefined();
  });
});

describe("playersOnMap", () => {
  it("returns only the players standing on the queried map", () => {
    const w = createWorld(PROJ);
    addPlayer(w, 1, "A", { mapId: 3, x: 0, y: 0 });
    addPlayer(w, 2, "B", { mapId: 3, x: 1, y: 0 });
    addPlayer(w, 3, "C", { mapId: 8, x: 0, y: 0 });
    expect(playersOnMap(w, 3).map((p) => p.id).sort()).toEqual([1, 2]);
    expect(playersOnMap(w, 8).map((p) => p.id)).toEqual([3]);
    expect(playersOnMap(w, 99)).toEqual([]);
  });
});
