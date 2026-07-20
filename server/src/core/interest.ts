/* RPGAtlas — server/src/core/interest.ts
   Project Beacon MP8·A: chunked area-of-interest filtering for world zones.
   A zone divides its map into CHUNK_TILES × CHUNK_TILES chunks; a player's
   interest set is the players standing in the 3×3 chunks around their own
   (Chebyshev radius INTEREST_RADIUS). Only those players ride that member's
   deltas/presence — 200 players on one map stops being an O(n²) wire.

   Deliberate simplicities (documented, measured in the MP8 bench):
   - Interest is a PURE function of the current chunk — no hysteresis. A
     player oscillating across a chunk boundary churns roster entries that
     are ≥ 16 tiles away, comfortably off-screen (viewport half-width ≈ 13
     tiles at zoom 1), so the churn is invisible; the client roster upserts/
     drops on delta reconciliation for free (applyPlayerStates).
   - Members of the same chunk share an identical interest set, so a zone
     encodes ONE delta frame per occupied chunk, not one per member (the
     group-encode measured in bench/tick-strategy.mjs).
   - Below AOI_BYPASS_MAX players on the map, filtering is skipped entirely
     (everyone sees everyone — friend-scale occupancy behaves exactly like a
     friend room, and small worlds never pay chunk bookkeeping).
   - Looping maps (loopH/loopV) do not wrap interest across the seam; edge
     wrap is deferred with the rest of loop-edge handling (D-5-0 → stage B).

   Pure + DOM-free; used by both server targets (Node + CF DO). GPL-3.0. */

/** Chunk edge in tiles. 16 keeps the 3×3 interest window (48×48 tiles)
 *  comfortably beyond the engine viewport (~27×15 tiles at zoom 1). */
export const CHUNK_TILES = 16;

/** Interest radius in chunks (Chebyshev): 1 ⇒ the 3×3 neighborhood. */
export const INTEREST_RADIUS = 1;

/** Maps with at most this many players skip AOI entirely (send everyone). */
export const AOI_BYPASS_MAX = 32;

/** Packed chunk key for tile (x, y). Maps are well under 4096 chunks/side
 *  (65k tiles); negatives are clamped so a stray off-map coordinate can't
 *  produce a colliding key. */
export function chunkKeyOf(x: number, y: number): number {
  const cx = Math.max(0, Math.floor(x / CHUNK_TILES)) & 0xfff;
  const cy = Math.max(0, Math.floor(y / CHUNK_TILES)) & 0xfff;
  return cy * 4096 + cx;
}

/** An entity with a tile position (the zone hands its member entities in). */
export interface Positioned {
  x: number;
  y: number;
}

/** Bucket entities by chunk key. One pass, reused each broadcast tick. */
export function buildChunkIndex<T extends Positioned>(entities: Iterable<T>): Map<number, T[]> {
  const index = new Map<number, T[]>();
  for (const e of entities) {
    const key = chunkKeyOf(e.x, e.y);
    const bucket = index.get(key);
    if (bucket) bucket.push(e);
    else index.set(key, [e]);
  }
  return index;
}

/** Every entity within INTEREST_RADIUS chunks of `chunkKey` (the shared
 *  interest set for all members standing in that chunk). */
export function interestSetOf<T extends Positioned>(chunkKey: number, index: Map<number, T[]>): T[] {
  const cx = chunkKey & 0xfff;
  const cy = chunkKey >> 12;
  const out: T[] = [];
  for (let dy = -INTEREST_RADIUS; dy <= INTEREST_RADIUS; dy++) {
    const y = cy + dy;
    if (y < 0 || y > 0xfff) continue;
    for (let dx = -INTEREST_RADIUS; dx <= INTEREST_RADIUS; dx++) {
      const x = cx + dx;
      if (x < 0 || x > 0xfff) continue;
      const bucket = index.get(y * 4096 + x);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}
