/* RPGAtlas — src/editor/importers/mz/tile-ids.ts
   Project Compass M1·B: pure RPG Maker tile-id + flag-bit decoding — the math
   the tileset/map converters build on (matrix §11, §12b). RM packs a map cell
   into one number whose range says which sheet it came from (B–E object tiles,
   A5 plain ground, A1–A4 autotiles) and, for autotiles, which of 48 shapes; a
   parallel `Tilesets.flags[tileId]` word packs per-tile behavior (passage, star
   ★-priority, ladder/bush/counter/damage, terrain tag). Everything here is a
   pure function of a number — no DOM, no project — so it is unit-testable and
   shared by convert-tilesets.ts + convert-maps.ts. The flag BIT VALUES are the
   real rmmv/rmmz `Game_Map` constants confirmed at the M0·C gate (decision D10),
   NOT the one-low draft the matrix originally listed.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/** RM `Tilemap` tile-id bases (verified against rmmv/rmmz core). */
export const TID = {
  B: 0,
  C: 256,
  D: 512,
  E: 768,
  A5: 1536,
  A1: 2048,
  A2: 2816,
  A3: 4352,
  A4: 5888,
  MAX: 8192,
} as const;

/** The lowest autotile id: everything ≥ this is an A1–A4 autotile. */
export const AUTOTILE_MIN = TID.A1; // 2048
/** RM lays 48 shapes per autotile "kind". */
export const SHAPES_PER_KIND = 48;

export type RmTileFamily = "empty" | "B" | "C" | "D" | "E" | "A5" | "A1" | "A2" | "A3" | "A4";

export interface RmTileDecode {
  family: RmTileFamily;
  /** Autotile kind (0–127) for A1–A4; -1 for plain/empty. */
  kind: number;
  /** Autotile shape (0–47) for A1–A4; -1 for plain/empty. */
  shape: number;
  /** Index within the family's own sheet (A5/B/C/D/E: id − base). Plain only. */
  index: number;
}

/** True when a stored map cell value is an A1–A4 autotile id. */
export function isRmAutotile(id: number): boolean {
  return id >= AUTOTILE_MIN && id < TID.MAX;
}

/** The autotile "kind" (0–127) an autotile id belongs to — every shape of the
 *  same kind shares one Atlas group (Atlas re-derives shape from neighbours). */
export function autotileKind(id: number): number {
  return Math.floor((id - AUTOTILE_MIN) / SHAPES_PER_KIND);
}

/** Which A-sheet an autotile kind lives on. */
export function familyOfKind(kind: number): "A1" | "A2" | "A3" | "A4" {
  if (kind < 16) return "A1"; // kinds 0–15
  if (kind < 48) return "A2"; // kinds 16–47
  if (kind < 80) return "A3"; // kinds 48–79
  return "A4"; //               kinds 80–127
}

/** Decode a raw RM map-cell value into its family + coordinates. Cell value 0
 *  (and the A5..A1 gap 1024–1535) is treated as empty. */
export function decodeRmTileId(id: number): RmTileDecode {
  const v = Math.floor(Number(id) || 0);
  if (v <= 0) return { family: "empty", kind: -1, shape: -1, index: -1 };
  if (isRmAutotile(v)) {
    const kind = autotileKind(v);
    return { family: familyOfKind(kind), kind, shape: (v - AUTOTILE_MIN) % SHAPES_PER_KIND, index: -1 };
  }
  if (v >= TID.A5 && v < TID.A1) return { family: "A5", kind: -1, shape: -1, index: v - TID.A5 };
  if (v >= TID.E && v < TID.A5) {
    // E occupies 768–1023; 1024–1535 is an unused gap → treat as empty.
    return v < TID.E + 256
      ? { family: "E", kind: -1, shape: -1, index: v - TID.E }
      : { family: "empty", kind: -1, shape: -1, index: -1 };
  }
  if (v >= TID.D) return { family: "D", kind: -1, shape: -1, index: v - TID.D };
  if (v >= TID.C) return { family: "C", kind: -1, shape: -1, index: v - TID.C };
  return { family: "B", kind: -1, shape: -1, index: v - TID.B };
}

// ---------------------------------------------------------------------------
// Tileset flag bits (matrix §11 / decision D10 — real RM Game_Map values).
// ---------------------------------------------------------------------------

export const FLAG = {
  /** bits 0–3: 4-direction passage. A SET bit = blocked in that direction
   *  (down/left/right/up); 0x0F = fully impassable, 0 = fully open. */
  PASSAGE: 0x000f,
  /** bit 4: ★ — draw above the player (overhead). */
  STAR: 0x0010,
  /** bit 5: ladder. */
  LADDER: 0x0020,
  /** bit 6: bush (player drawn partly over the tile). */
  BUSH: 0x0040,
  /** bit 7: counter (interact across it). */
  COUNTER: 0x0080,
  /** bit 8: damage floor. */
  DAMAGE: 0x0100,
} as const;

export interface RmTileFlags {
  /** 0x0F passage nibble (bits set = blocked directions). */
  passage: number;
  /** No directions passable (0x0F). */
  blockedAll: boolean;
  /** Some — but not all — directions blocked. */
  blockedPartial: boolean;
  star: boolean;
  ladder: boolean;
  bush: boolean;
  counter: boolean;
  damage: boolean;
  /** Terrain tag 0–7 (flag >> 12). */
  terrainTag: number;
}

/** Decode one `Tilesets.flags[]` word. */
export function decodeFlags(flag: number): RmTileFlags {
  const f = Math.floor(Number(flag) || 0);
  const passage = f & FLAG.PASSAGE;
  return {
    passage,
    blockedAll: passage === FLAG.PASSAGE,
    blockedPartial: passage !== 0 && passage !== FLAG.PASSAGE,
    star: (f & FLAG.STAR) !== 0,
    ladder: (f & FLAG.LADDER) !== 0,
    bush: (f & FLAG.BUSH) !== 0,
    counter: (f & FLAG.COUNTER) !== 0,
    damage: (f & FLAG.DAMAGE) !== 0,
    terrainTag: (f >> 12) & 0x7,
  };
}

/** Atlas tileset `tileProps` special-flag byte (Database ▸ Tilesets): bit 0 bush
 *  · bit 1 ladder · bit 2 counter · bit 3 damage. */
export function atlasFlagByte(f: RmTileFlags): number {
  return (f.bush ? 1 : 0) | (f.ladder ? 2 : 0) | (f.counter ? 4 : 0) | (f.damage ? 8 : 0);
}

/** Atlas 8-direction passage byte (bit set = passable: N E S W NE SE SW NW).
 *  RM stores blocked directions in 4 dirs; Atlas passage is whole-tile, so a
 *  fully-open RM tile → all-passable (0xFF), anything blocked → all-blocked
 *  (0x00). The nuance (which directions) is lost — reported by the caller. */
export function atlasPassByte(f: RmTileFlags): number {
  return f.passage === 0 ? 0xff : 0x00;
}
