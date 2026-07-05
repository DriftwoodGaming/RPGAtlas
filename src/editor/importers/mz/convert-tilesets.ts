/* RPGAtlas — src/editor/importers/mz/convert-tilesets.ts
   Project Compass M1·B: RPG Maker tilesets → Atlas `Autotile[]` groups + a
   `Tileset` (per-tile passage/flag/terrain in `tileProps`) + the RM-tile-id →
   Atlas-tile-id resolver the map converter paints with (matrix §11, §12b).

   What is pure here vs. deferred to the M1·D wizard: this module owns the
   STRUCTURE — which RM autotile "kinds" the maps use become which Atlas groups,
   which plain (A5/B–E) tile ids get which stable Atlas ids, what passability /
   ★-priority / ladder-bush-counter-damage / terrain-tag each tile carries. It
   does NOT slice pixels (the fixtures ship 1×1 placeholder sheets; real slicing
   needs the DOM canvas the wizard has). So every autotile group ships a decodable
   1×1 placeholder `sheet`, and every referenced plain tile is registered under a
   deterministic `asset:tilesets/<slug>_<fam>-t<index>` key in `project.assets.tiles`
   with a pre-assigned numeric id. M1·D slices the project's real tileset images
   into those SAME keys; `js/assets.js bindExternalAssets` reuses the pre-assigned
   ids, so the map layers this step paints resolve to the real art with no
   re-numbering. Unmapped/blocked passability lands in the map's `passOv` +
   the group `pass` flag; ladder/bush/counter/damage/terrain live in the engine
   since M4·A (tileProps + autotile `props.flag`/`props.terrainTag` feed the
   tile-behavior cache). Copyright (C) 2026 RPGAtlas contributors —
   GPL-3.0-or-later (see LICENSE). */

import type { Autotile, Tileset } from "../../../shared/schema";
import { assetKeyOf, slugName } from "../../../shared/asset-library";
import { tileIdOf } from "../../../shared/autotile-registry";
import type { ImportReport } from "./report";
import type { RmList, RmTileset } from "./raw-types";
import {
  TID,
  atlasFlagByte,
  atlasPassByte,
  decodeFlags,
  decodeRmTileId,
  familyOfKind,
} from "./tile-ids";

/** First Atlas id handed to an imported plain tile. Sits above the built-in
 *  tile palette (js/assets.js defines ~59) with headroom, and far below the
 *  autotile reserved base (AUTOTILE_BASE = 1,000,000) — so imported plain ids,
 *  built-ins, and autotile ids never collide. Ids are pre-seeded into
 *  `project.assets.tiles`, so `bindExternalAssets` respects them (its
 *  `nextTileId` maxes over the map) and M1·D's real slice reuses them by key. */
export const IMPORT_TILE_BASE = 100;

/** Atlas autotile `kind` for an RM A-sheet family (matrix §12b). */
const KIND_BY_FAMILY: Record<"A1" | "A2" | "A3" | "A4", Autotile["kind"]> = {
  A1: "a1", // animated water/waterfall
  A2: "blob47", // the native 47-blob ground case
  A3: "a3", // building roofs/walls (2×2 repeat)
  A4: "a4", // wall autotiles (top blob + wall face)
};

/** First map-cell tile id of an autotile kind (its shape-0), where its flags
 *  word lives in `Tilesets.flags`. */
function kindBaseTileId(kind: number): number {
  return TID.A1 + kind * 48;
}

/** Per-tileset conversion state, keyed by RM tileset id. */
interface OneTileset {
  tileset: Tileset;
  /** RM autotile kind → Atlas reserved tile id (AUTOTILE_BASE + group id). */
  autotileByKind: Map<number, number>;
  /** RM plain tile id → Atlas plain tile id. */
  plainById: Map<number, number>;
  /** RM tile id (plain or autotile-kind-base) → whole-tile blocked. */
  blockedById: Map<number, boolean>;
  /** RM tile id → ★ (renders above the player). */
  starById: Set<number>;
}

export interface TilesetsConversion {
  tilesets: Tileset[];
  autotiles: Autotile[];
  /** `project.assets.tiles` seed: stable `asset:tilesets/…` key → Atlas id. */
  assetTiles: Record<string, number>;
  /** Raw RM cell value (for a map on `tilesetId`) → Atlas stored tile id.
   *  Autotiles → reserved id; plain → pre-assigned id; empty/unmapped → 0. */
  resolve(tilesetId: number, rmId: number): number;
  /** passOv contribution for a GROUND cell painted with `rmId`: 2 (block) when
   *  the tile's RM passage is fully/partly blocked, else 0 (auto). */
  passOvOf(tilesetId: number, rmId: number): number;
  /** True when `rmId` is ★-flagged and should route to the `over` layer. */
  isStar(tilesetId: number, rmId: number): boolean;
}

/** The used autotile kinds + plain tile ids a map scan found, per RM tileset id. */
export interface TilesetUsage {
  autotileKinds: Set<number>;
  plainIds: Set<number>;
}

// 1×1 transparent PNG — a decodable placeholder every imported autotile group
// ships until M1·D slices the project's real A-sheet block into its key. Byte-
// identical to the fixtures' PNG_1x1 swatch.
const PLACEHOLDER_SHEET =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

const notNull = <T>(x: T | null): x is T => x != null;

/**
 * Convert every RM tileset a map actually uses. Group ids + plain tile ids are
 * allocated globally (across all tilesets) so nothing collides. `usage` comes
 * from the map scan (`collectTilesetUsage`) — only referenced kinds/tiles are
 * materialized, keeping the palette tight.
 */
export function convertTilesets(
  rmTilesets: RmList<RmTileset>,
  usage: Map<number, TilesetUsage>,
  report: ImportReport,
): TilesetsConversion {
  const tilesets: Tileset[] = [];
  const autotiles: Autotile[] = [];
  const assetTiles: Record<string, number> = {};
  const byId = new Map<number, OneTileset>();

  let nextGroupId = 1;
  let nextPlainId = IMPORT_TILE_BASE;

  const bumpFlag = (key: string, what: string, detail: string): void =>
    report.bump(key, () => ({ area: "Tilesets", kind: "todo", what, detail }));

  for (const rm of (rmTilesets || []).filter(notNull)) {
    const use = usage.get(rm.id);
    if (!use) continue; // tileset defined but no map uses it → nothing to do
    const flags = Array.isArray(rm.flags) ? rm.flags : [];
    const slug = slugName(rm.name || "tileset-" + rm.id);
    const tileset: Tileset = { id: rm.id, name: rm.name || "Tileset " + rm.id, tileProps: {} };
    const one: OneTileset = {
      tileset,
      autotileByKind: new Map(),
      plainById: new Map(),
      blockedById: new Map(),
      starById: new Set(),
    };

    const flagOf = (tileId: number): number => Number(flags[tileId]) || 0;

    // --- Autotile groups (A1–A4), one per used kind, low kinds first. ---
    for (const kind of [...use.autotileKinds].sort((a, b) => a - b)) {
      const family = familyOfKind(kind);
      const base = kindBaseTileId(kind);
      const f = decodeFlags(flagOf(base)); // base shape = the group's representative
      const groupId = nextGroupId++;
      const local = kind - (family === "A1" ? 0 : family === "A2" ? 16 : family === "A3" ? 48 : 80);
      const group: Autotile = {
        id: groupId,
        name: `${tileset.name} ${family} #${local}`,
        sheet: PLACEHOLDER_SHEET,
        kind: KIND_BY_FAMILY[family],
        terrain: true,
        pass: !f.blockedAll,
      };
      if (family === "A1") group.anim = { frames: 3, fps: 8 }; // RM water/waterfall
      // M4·A: behavior flags (bush grass! ladders!) + terrain ride the group
      // props — the engine's tile-behavior cache consumes both.
      const gflag = atlasFlagByte(f);
      if (f.terrainTag || gflag) {
        group.props = {
          ...(f.terrainTag ? { terrainTag: f.terrainTag } : {}),
          ...(gflag ? { flag: gflag } : {}),
        } as Autotile["props"];
      }
      autotiles.push(group);
      one.autotileByKind.set(kind, tileIdOf(groupId));
      one.blockedById.set(base, f.blockedAll || f.blockedPartial);

      // A kind's 48 shape ids can carry their own flags (a partial-passage
      // water edge): Atlas keeps ONE flag set per group (the base shape's), so
      // shape-level oddities still get their honest line.
      for (let shape = 0; shape < 48; shape++) {
        const sf = decodeFlags(flagOf(base + shape));
        if (sf.blockedPartial) bumpFlag("part-pass", "one-way tile passage",
          "some tiles let you pass only certain directions — Atlas blocks the whole tile for now");
      }
    }

    // --- Plain tiles (A5, B–E), one Atlas id per used tile id. ---
    for (const rmId of [...use.plainIds].sort((a, b) => a - b)) {
      const d = decodeRmTileId(rmId);
      if (d.family === "empty") continue;
      const famLower = d.family.toLowerCase();
      const key = assetKeyOf("tilesets", `${slug}_${famLower}-t${d.index}`);
      let id = assetTiles[key];
      if (id == null) {
        id = nextPlainId++;
        assetTiles[key] = id;
      }
      one.plainById.set(rmId, id);

      const f = decodeFlags(flagOf(rmId));
      one.blockedById.set(rmId, f.blockedAll || f.blockedPartial);
      if (f.star) one.starById.add(rmId);

      // Per-tile passage / behavior flags → Atlas tileProps (Database ▸ Tilesets
      // schema: 8-dir pass byte, flag byte bush0/ladder1/counter2/damage3, terrain
      // 0–7). Live in the engine since M4·A (tile-behavior cache) — no report
      // line needed anymore; only partial passage keeps its honest line.
      const flagByte = atlasFlagByte(f);
      if (f.passage !== 0 || flagByte || f.terrainTag) {
        tileset.tileProps[key] = { pass: atlasPassByte(f), flag: flagByte, terrain: f.terrainTag };
      }
      if (f.blockedPartial) bumpFlag("part-pass", "one-way tile passage",
        "some tiles let you pass only certain directions — Atlas blocks the whole tile for now");
    }

    tilesets.push(tileset);
    byId.set(rm.id, one);
  }

  const pick = (tilesetId: number): OneTileset | undefined =>
    byId.get(tilesetId) ?? (byId.size === 1 ? [...byId.values()][0] : undefined);

  return {
    tilesets,
    autotiles,
    assetTiles,
    resolve(tilesetId, rmId) {
      const one = pick(tilesetId);
      if (!one) return 0;
      const d = decodeRmTileId(rmId);
      if (d.family === "empty") return 0;
      if (d.kind >= 0) return one.autotileByKind.get(d.kind) ?? 0;
      return one.plainById.get(rmId) ?? 0;
    },
    passOvOf(tilesetId, rmId) {
      const one = pick(tilesetId);
      if (!one) return 0;
      const d = decodeRmTileId(rmId);
      // Autotile passability rides the group `pass` flag; only plain-tile blocks
      // bake into passOv (the group would otherwise be doubly-blocked).
      if (d.kind >= 0) return 0;
      return one.blockedById.get(rmId) ? 2 : 0;
    },
    isStar(tilesetId, rmId) {
      const one = pick(tilesetId);
      return !!one && one.starById.has(rmId);
    },
  };
}
