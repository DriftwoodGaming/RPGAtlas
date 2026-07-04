/* RPGAtlas — src/shared/tile-categories.ts
   Tile-palette categorization (Phase 8 Stage E), pure so the Advanced panel's
   categorized/searchable palette and (where it fits) the Standard editor's
   palette share one derivation. Categories come from tile metadata already on
   every tile def — its `key` and the `terrain` flag Assets derives — grouped
   into a small, kid-legible set. No new schema: a tile's category is computed,
   not stored. Unit-tested in tests-unit/tile-categories.test.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/** The minimal tile-def shape this module reads (a subset of Assets.tiles[i]). */
export interface TileMeta {
  key?: string;
  name?: string;
  terrain?: boolean;
  pass?: boolean;
}

export type TileCategory =
  | "terrain" | "water" | "floor" | "wall" | "nature" | "object" | "other";

/** Substring buckets, checked in order; first hit wins. Kept broad and
 *  forgiving so imported/custom tiles still land somewhere sensible. */
const KEY_RULES: Array<[TileCategory, RegExp]> = [
  ["water", /water|sea|ocean|river|lake|swamp|ice|lily/],
  ["floor", /floor|path|road|brick|cobble|checker|carpet|rug|tile|pave/],
  ["wall", /wall|fence|cliff|rock|stone(?!floor)|brickwall|roof|door|window|stair/],
  ["nature", /grass|flower|tree|bush|leaf|leaves|forest|plant|vine|reed|moss|mushroom|crystal/],
  ["object", /chest|barrel|crate|sign|table|chair|bed|lamp|torch|statue|well|pot|jar|book|fountain/],
];

/** The category a tile falls into, from its metadata. Terrain tiles (the
 *  Assets-derived `terrain` flag: grass/dirt/sand/… ground) default to
 *  "terrain" unless their key matches a more specific bucket (water, floor). */
export function categoryOf(meta: TileMeta | null | undefined): TileCategory {
  if (!meta) return "other";
  const key = (meta.key || "").toLowerCase();
  for (const [cat, re] of KEY_RULES) {
    if (re.test(key)) return cat;
  }
  if (meta.terrain) return "terrain";
  return "object";
}

/** Display order for the category chips (bottom-of-palette filter). */
export const CATEGORY_ORDER: TileCategory[] = [
  "terrain", "water", "floor", "wall", "nature", "object", "other",
];

/** i18n keys for the category labels (added to every locale + the parity gate).
 *  Plus "all" for the show-everything chip. */
export const CATEGORY_LABEL_KEY: Record<TileCategory | "all", string> = {
  all: "All Tiles",
  terrain: "Terrain",
  water: "Water",
  floor: "Floor",
  wall: "Walls",
  nature: "Nature",
  object: "Objects",
  other: "Other",
};

/** True when a tile matches a free-text search over its name + key (case-
 *  insensitive). Empty query matches everything. */
export function matchesSearch(meta: TileMeta | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (!meta) return false;
  return (
    (meta.name || "").toLowerCase().includes(q) ||
    (meta.key || "").toLowerCase().includes(q)
  );
}

/** Filter a tile-id list (1..n, id 0 = empty is excluded by the caller) to the
 *  ids whose def passes both the category and search filters. `getMeta` maps an
 *  id to its def. `category` "all" disables the category filter. */
export function filterTileIds(
  ids: number[],
  getMeta: (id: number) => TileMeta | null | undefined,
  category: TileCategory | "all",
  search: string,
): number[] {
  return ids.filter((id) => {
    const meta = getMeta(id);
    if (!meta) return false;
    if (category !== "all" && categoryOf(meta) !== category) return false;
    return matchesSearch(meta, search);
  });
}
