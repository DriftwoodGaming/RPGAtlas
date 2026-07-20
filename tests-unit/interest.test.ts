/* RPGAtlas — tests-unit/interest.test.ts
   Project Beacon MP8·A: chunked area-of-interest math (server/src/core/
   interest.ts). Pure functions — chunk keys, the chunk index, and the 3×3
   interest neighborhood, including map-edge clamping. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  CHUNK_TILES,
  INTEREST_RADIUS,
  buildChunkIndex,
  chunkKeyOf,
  interestSetOf,
} from "../server/src/core/interest";

const P = (id: number, x: number, y: number) => ({ id, x, y });

describe("MP8·A chunked interest", () => {
  it("chunk keys bucket by CHUNK_TILES and clamp negatives", () => {
    expect(chunkKeyOf(0, 0)).toBe(chunkKeyOf(CHUNK_TILES - 1, CHUNK_TILES - 1)); // same chunk
    expect(chunkKeyOf(CHUNK_TILES, 0)).not.toBe(chunkKeyOf(0, 0)); // next chunk over
    expect(chunkKeyOf(-3, -9)).toBe(chunkKeyOf(0, 0)); // stray off-map coords clamp, never collide elsewhere
  });

  it("interest is the 3×3 chunk neighborhood, nothing further", () => {
    const players = [
      P(1, 1, 1), // chunk (0,0)
      P(2, CHUNK_TILES + 2, 2), // chunk (1,0) — neighbor
      P(3, CHUNK_TILES * 2 + 2, 2), // chunk (2,0) — outside radius 1 of (0,0)
      P(4, CHUNK_TILES * 5, CHUNK_TILES * 5), // far corner
    ];
    const index = buildChunkIndex(players);
    const near = interestSetOf(chunkKeyOf(1, 1), index).map((p) => p.id);
    expect(near).toContain(1);
    expect(near).toContain(2);
    expect(near).not.toContain(3);
    expect(near).not.toContain(4);
    // From chunk (1,0), BOTH sides are neighbors (radius 1 each way).
    const mid = interestSetOf(chunkKeyOf(CHUNK_TILES + 2, 2), index).map((p) => p.id);
    expect(mid).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(mid).not.toContain(4);
  });

  it("map corner (0,0) clamps the neighborhood without wrapping", () => {
    const players = [P(1, 0, 0), P(2, 4095 * 16, 0)]; // id 2 sits at the far x edge
    const index = buildChunkIndex(players);
    const corner = interestSetOf(chunkKeyOf(0, 0), index).map((p) => p.id);
    expect(corner).toEqual([1]); // no wraparound into the far column
    expect(INTEREST_RADIUS).toBe(1); // the 3×3 contract the zone encodes by
  });

  it("members of one chunk share one interest set (the group-encode key)", () => {
    const players = [P(1, 2, 2), P(2, 3, 3), P(3, CHUNK_TILES + 1, 1)];
    const index = buildChunkIndex(players);
    const a = interestSetOf(chunkKeyOf(2, 2), index);
    const b = interestSetOf(chunkKeyOf(3, 3), index);
    expect(a).toEqual(b); // identical arrays → one encode serves both members
  });
});
