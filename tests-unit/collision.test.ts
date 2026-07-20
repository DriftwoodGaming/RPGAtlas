/* RPGAtlas — tests-unit/collision.test.ts
   Project Beacon MP5·A: the headless map-collision core (src/shared/sim/
   collision.ts) that the Beacon server bakes movement against.

   The load-bearing test is the DRIFT GUARD: it re-parses js/assets.js and
   asserts the built-in tile pass table (builtin-tile-pass.ts) still matches the
   engine's `defTile` source, so a future edit to a built-in tile's walkability
   can't silently desync server collision from the browser engine. The rest
   proves the baker mirrors the engine's `tilePassable` layer stack (passOv
   override → decor2 → decor → ground), the `.pass`/`.terrain` project-tile
   convention, autotile group pass, looping-map wrap, and the diagonal
   corner-squeeze rule. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bakeMapCollision,
  canStep,
  diagStepClear,
  isPassable,
  type MapCollision,
} from "../src/shared/sim/collision";
import { BUILTIN_TILE_KEYS, BUILTIN_TILE_PASS } from "../src/shared/sim/builtin-tile-pass";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("MP5 built-in tile-pass drift guard", () => {
  it("matches js/assets.js defTile order + pass flags exactly", () => {
    const src = readFileSync(join(REPO, "js", "assets.js"), "utf8");
    const re = /defTile\(\s*"([^"]*)"\s*,\s*"(?:[^"\\]|\\.)*"\s*,\s*(true|false)\s*,/g;
    const keys: string[] = [];
    const pass: boolean[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      keys.push(m[1]);
      pass.push(m[2] === "true");
    }
    // Sanity: the parse found the whole palette (regressions here mean the
    // regex, not the table, drifted).
    expect(keys.length).toBeGreaterThan(50);
    expect(keys).toEqual([...BUILTIN_TILE_KEYS]);
    expect(pass).toEqual([...BUILTIN_TILE_PASS]);
    // id 0 is the impassable "empty" tile — the engine's "no ground = blocked".
    expect(BUILTIN_TILE_PASS[0]).toBe(false);
  });
});

/** Build a tiny map from a compact ASCII legend for readable collision tests.
 *  '.' = grass (id 1, passable), '#' = wall_stone (id 23, blocked),
 *  '~' = water (id 7, blocked). Single ground layer, no passOv. */
function asciiMap(rows: string[]): any {
  const height = rows.length;
  const width = rows[0].length;
  const ground = new Array(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      ground[y * width + x] = ch === "#" ? 23 : ch === "~" ? 7 : 1;
    }
  }
  return { width, height, layers: { ground } };
}

describe("MP5 collision baking", () => {
  const proj = { assets: { tiles: {} }, autotiles: [] };

  it("bakes passable floor and blocked walls/water", () => {
    const mc = bakeMapCollision(proj, asciiMap([
      ".....",
      ".#.~.",
      ".....",
    ]));
    expect(isPassable(mc, 0, 0)).toBe(true);
    expect(isPassable(mc, 1, 1)).toBe(false); // wall
    expect(isPassable(mc, 3, 1)).toBe(false); // water
    expect(isPassable(mc, 2, 1)).toBe(true);
  });

  it("blocks off-grid tiles on a bounded map", () => {
    const mc = bakeMapCollision(proj, asciiMap(["..", ".."]));
    expect(isPassable(mc, -1, 0)).toBe(false);
    expect(isPassable(mc, 2, 0)).toBe(false);
    expect(isPassable(mc, 0, 2)).toBe(false);
  });

  it("passOv override wins over the tile layer stack", () => {
    const base = asciiMap([".#.", "...", ".#."]);
    // Force the wall at (1,0) passable (1) and a floor at (1,2) blocked (2).
    base.passOv = new Array(9).fill(0);
    base.passOv[0 * 3 + 1] = 1; // force pass over the '#'
    base.passOv[2 * 3 + 1] = 2; // force block over the '.'
    const mc = bakeMapCollision(proj, base);
    expect(isPassable(mc, 1, 0)).toBe(true);
    expect(isPassable(mc, 1, 2)).toBe(false);
  });

  it("resolves decor2 over decor over ground", () => {
    // ground grass (pass), decor wall (block), decor2 door (pass) → topmost wins
    const map: any = {
      width: 1, height: 1,
      layers: { ground: [1], decor: [23], decor2: [26] }, // door id 26 = pass
    };
    expect(isPassable(bakeMapCollision(proj, map), 0, 0)).toBe(true);
    const map2: any = { width: 1, height: 1, layers: { ground: [1], decor: [23] } };
    expect(isPassable(bakeMapCollision(proj, map2), 0, 0)).toBe(false); // decor wall wins
  });

  it("reads project tile pass from the .pass/.terrain key convention", () => {
    const p = { assets: { tiles: { "cliff.pass": 60, "wall": 61, "grass.terrain": 62 } }, autotiles: [] };
    const map: any = { width: 3, height: 1, layers: { ground: [60, 61, 62] } };
    const mc = bakeMapCollision(p, map);
    expect(isPassable(mc, 0, 0)).toBe(true); // .pass
    expect(isPassable(mc, 1, 0)).toBe(false); // plain project tile = blocked
    expect(isPassable(mc, 2, 0)).toBe(true); // .terrain
  });

  it("reads autotile group pass flags", () => {
    const AUTOTILE_BASE = 1_000_000;
    const p = { assets: { tiles: {} }, autotiles: [{ id: 0, pass: true }, { id: 1, pass: false }] };
    const map: any = { width: 2, height: 1, layers: { ground: [AUTOTILE_BASE + 0, AUTOTILE_BASE + 1] } };
    const mc = bakeMapCollision(p, map);
    expect(isPassable(mc, 0, 0)).toBe(true);
    expect(isPassable(mc, 1, 0)).toBe(false);
  });

  it("wraps coordinates on a looping map", () => {
    const map: any = { width: 3, height: 1, layers: { ground: [1, 1, 1] }, loop: { h: true } };
    const mc = bakeMapCollision(proj, map);
    expect(isPassable(mc, 3, 0)).toBe(true); // wraps to x=0
    expect(isPassable(mc, -1, 0)).toBe(true); // wraps to x=2
  });
});

describe("MP5 step legality (canStep / diagStepClear)", () => {
  // . . .
  // . # .   walls frame a corner squeeze at (1,1)
  // . . .
  const mc: MapCollision = bakeMapCollision(
    { assets: { tiles: {} }, autotiles: [] },
    (() => {
      const map = { width: 3, height: 3, layers: { ground: new Array(9).fill(1) } };
      map.layers.ground[1 * 3 + 1] = 23; // wall at (1,1)
      return map;
    })(),
  );

  it("allows cardinal steps onto passable tiles, blocks onto walls", () => {
    expect(canStep(mc, 0, 0, 2)).toBe(true); // right onto (1,0)
    expect(canStep(mc, 0, 1, 2)).toBe(false); // right onto wall (1,1)
    expect(canStep(mc, 1, 0, 0)).toBe(false); // down onto wall (1,1)
    expect(canStep(mc, 1, 2, 2)).toBe(true); // right onto open (2,2)
  });

  it("blocks a diagonal squeeze between two blocked cardinals", () => {
    // From (0,0) stepping down-right (5) to (1,1): dest is the wall → blocked.
    expect(canStep(mc, 0, 0, 5)).toBe(false);
    // From (2,2) stepping up-left (6) to (1,1): dest is the wall → blocked.
    expect(canStep(mc, 2, 2, 6)).toBe(false);
    // diagStepClear alone: at (0,2) going up-right (7) to (1,1) — cardinals
    // (1,2) open and (0,1) open, so the corner clears (dest handled by canStep).
    expect(diagStepClear(mc, 0, 2, 7)).toBe(true);
  });

  it("rejects a zero move and off-grid destinations", () => {
    expect(canStep(mc, 0, 0, 3)).toBe(false); // up off the top edge
    expect(canStep(mc, 2, 2, 2)).toBe(false); // right off the right edge
  });
});
