/* RPGAtlas — tests-unit/terrain-kinds.test.ts
   Per-kind terrain resolvers (src/shared/terrain-kinds.ts, Phase 8 Stage C).
   Every resolver must map its neighbour situation to an in-bounds source tile
   and (for blob47/a1) four in-bounds corner minitiles, matching the RM-derived
   arrangement the Studio importer writes. Fixture-grid style, like autotile.ts.
   GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  resolveTile, edgeMask, cornerMask, pickVariant, cellHash, detectKind,
  requiredTileCount, frameTileGrid, type TerrainKind,
} from "../src/shared/terrain-kinds";

// A "same group?" predicate over a tiny fixture grid centred on (cx,cy). `1` in
// the grid means same-group; out-of-bounds counts as connected (map-edge blend),
// matching the blob47 core's convention.
function gridSame(grid: number[][], cx: number, cy: number) {
  return (dx: number, dy: number): boolean => {
    const y = cy + dy, x = cx + dx;
    if (y < 0 || y >= grid.length) return true;
    const row = grid[y];
    if (x < 0 || x >= row.length) return true;
    return row[x] === 1;
  };
}

describe("edgeMask", () => {
  it("reads only the four cardinals (N=1,E=2,S=4,W=8)", () => {
    // centre surrounded on all four sides
    const all = gridSame([[0, 1, 0], [1, 1, 1], [0, 1, 0]], 1, 1);
    expect(edgeMask(all)).toBe(1 | 2 | 4 | 8);
    // only north
    const n = gridSame([[0, 1, 0], [0, 1, 0], [0, 0, 0]], 1, 1);
    expect(edgeMask(n)).toBe(1);
    // ignores diagonals: NE present but no cardinals
    const diag = gridSame([[0, 0, 1], [0, 1, 0], [0, 0, 0]], 1, 1);
    expect(edgeMask(diag)).toBe(0);
  });
});

describe("cornerMask", () => {
  it("a corner connects only when both its edges AND its diagonal connect", () => {
    // full 3x3 → all four corners connect
    const full = gridSame([[1, 1, 1], [1, 1, 1], [1, 1, 1]], 1, 1);
    expect(cornerMask(full)).toBe(1 | 2 | 4 | 8);
    // N+W edges present but NW diagonal missing → TL does NOT connect
    const noDiag = gridSame([[0, 1, 0], [1, 1, 0], [0, 0, 0]], 1, 1);
    expect(cornerMask(noDiag) & 1).toBe(0);
    // N+W+NW all present → TL connects
    const tl = gridSame([[1, 1, 0], [1, 1, 0], [0, 0, 0]], 1, 1);
    expect(cornerMask(tl) & 1).toBe(1);
  });
});

const KINDS: TerrainKind[] = ["blob47", "edge16", "corner16", "a1", "a3", "a4"];

describe("resolveTile stays in-bounds for every kind and every neighbourhood", () => {
  for (const kind of KINDS) {
    it(`${kind}: all 256 8-neighbour situations land in-bounds`, () => {
      const grid = frameTileGrid(kind);
      for (let bits = 0; bits < 256; bits++) {
        // encode the 8 neighbours from the mask bits into a predicate
        const same = (dx: number, dy: number): boolean => {
          const map: Record<string, number> = {
            "0,-1": 1, "1,0": 2, "0,1": 4, "-1,0": 8,
            "1,-1": 16, "1,1": 32, "-1,1": 64, "-1,-1": 128,
          };
          if (dx === 0 && dy === 0) return true;
          const b = map[`${dx},${dy}`];
          return b == null ? true : (bits & b) !== 0;
        };
        const src = resolveTile(kind, same, 0);
        expect(src.tx, `${kind} tx bits=${bits}`).toBeGreaterThanOrEqual(0);
        expect(src.ty, `${kind} ty bits=${bits}`).toBeGreaterThanOrEqual(0);
        if (!src.corners) {
          // whole-tile kinds must stay inside their frame grid
          expect(src.tx).toBeLessThan(grid.cols);
          expect(src.ty).toBeLessThan(grid.rows);
        } else {
          // blob path: four corners, each an in-block minitile (frame 0)
          expect(src.corners).toHaveLength(4);
          for (const m of src.corners) {
            expect(m.cx).toBeGreaterThanOrEqual(0);
            expect(m.cx).toBeLessThanOrEqual(3);
            expect(m.cy).toBeGreaterThanOrEqual(0);
            expect(m.cy).toBeLessThanOrEqual(5);
          }
        }
      }
    });
  }
});

describe("edge16 arrangement (RM-fence order)", () => {
  it("isolated post → tile 0; four-way cross → tile 15", () => {
    const none = gridSame([[0, 0, 0], [0, 1, 0], [0, 0, 0]], 1, 1);
    expect(resolveTile("edge16", none)).toMatchObject({ tx: 0, ty: 0 });
    const cross = gridSame([[0, 1, 0], [1, 1, 1], [0, 1, 0]], 1, 1);
    expect(resolveTile("edge16", cross)).toMatchObject({ tx: 3, ty: 3 }); // idx 15
  });
});

describe("a1 animation frames shift the block right", () => {
  it("frame N offsets every corner by N*frameTileCols*2 minitiles", () => {
    const full = gridSame([[1, 1, 1], [1, 1, 1], [1, 1, 1]], 1, 1);
    const f0 = resolveTile("a1", full, 0, 2);
    const f1 = resolveTile("a1", full, 1, 2);
    expect(f0.corners).toBeDefined();
    expect(f1.corners).toBeDefined();
    for (let i = 0; i < 4; i++) {
      expect(f1.corners![i].cx - f0.corners![i].cx).toBe(1 * 2 * 2); // +4 minitiles
      expect(f1.corners![i].cy).toBe(f0.corners![i].cy);            // rows unchanged
    }
  });
});

describe("blob47 delegates to the existing corner rule", () => {
  it("fully-connected interior matches the A2 core (mask 255)", () => {
    const full = gridSame([[1, 1, 1], [1, 1, 1], [1, 1, 1]], 1, 1);
    const src = resolveTile("blob47", full);
    expect(src.corners!.map((m) => [m.cx, m.cy]))
      .toEqual([[2, 4], [1, 4], [2, 3], [1, 3]]);
  });
});

describe("pickVariant (deterministic weighted selection)", () => {
  it("empty / all-zero weights → index 0", () => {
    expect(pickVariant([], 0.9)).toBe(0);
    expect(pickVariant([0, 0], 0.9)).toBe(0);
  });
  it("respects cumulative weight boundaries", () => {
    // weights [1,3]: first quarter → index 0, rest → index 1
    expect(pickVariant([1, 3], 0.0)).toBe(0);
    expect(pickVariant([1, 3], 0.24)).toBe(0);
    expect(pickVariant([1, 3], 0.26)).toBe(1);
    expect(pickVariant([1, 3], 0.99)).toBe(1);
  });
  it("negative weights are clamped to zero", () => {
    expect(pickVariant([-5, 1], 0.0)).toBe(1);
  });
});

describe("cellHash", () => {
  it("is deterministic and stays in [0,1)", () => {
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        const a = cellHash(x, y, 7);
        const b = cellHash(x, y, 7);
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(1);
      }
    }
  });
  it("salt changes the value (so variants and completion differ)", () => {
    expect(cellHash(3, 5, 0)).not.toBe(cellHash(3, 5, 1));
  });
});

describe("detectKind (Layout auto-detection heuristic)", () => {
  const T = 48;
  it("2×3 (96×144) → blob47 (A2)", () => {
    expect(detectKind(96, 144, T).kind).toBe("blob47");
  });
  it("multi-block 3-tall → a1 animated", () => {
    expect(detectKind(96 * 3, 144, T).kind).toBe("a1"); // 3 frames wide
    expect(detectKind(96 * 3, 144, T).reason).toContain("3-frame");
  });
  it("4×4 grid → edge16", () => {
    expect(detectKind(48 * 4, 48 * 4, T).kind).toBe("edge16");
  });
  it("tall 2-wide → a4 wall", () => {
    expect(detectKind(96, 48 * 5, T).kind).toBe("a4");
  });
  it("2×2 → a3 building", () => {
    expect(detectKind(96, 96, T).kind).toBe("a3");
  });
  it("unrecognised → blob47 fallback", () => {
    expect(detectKind(123, 77, T).kind).toBe("blob47");
  });
});

describe("completeness metadata", () => {
  it("requiredTileCount matches the arrangement", () => {
    expect(requiredTileCount("edge16")).toBe(16);
    expect(requiredTileCount("corner16")).toBe(16);
    expect(requiredTileCount("a3")).toBe(4);
    expect(requiredTileCount("blob47")).toBe(6);
    expect(requiredTileCount("a1")).toBe(6);
    expect(requiredTileCount("a4")).toBe(6);
  });
  it("frameTileGrid dimensions are positive", () => {
    for (const k of KINDS) {
      const g = frameTileGrid(k);
      expect(g.cols).toBeGreaterThan(0);
      expect(g.rows).toBeGreaterThan(0);
    }
  });
});
