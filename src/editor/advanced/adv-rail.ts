/* RPGAtlas — src/editor/advanced/adv-rail.ts
   The Advanced Map Editor's right rail (Phase 8 Stage E): a categorized,
   searchable tile palette and a stamp library, as two tabs. Mockup 1's right
   rail. Tile categories come from tile metadata via the shared, pure
   tile-categories module (also usable by the Standard palette). Selecting a
   swatch sets S.selectedTile (shared with the Standard editor); the current
   brush transform (X/Y/R) is previewed on the selected swatch. The Stamps tab
   lists proj.stamps with capture / place / random-scatter / rename / delete,
   placement flowing through adv-stamps → the shared paste write path.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, TILE, editorState as S, t } from "../editor-state";
import { h } from "../dom";
import { renderPalette } from "../map-editor/map-render";
import { setStatus } from "../map-editor/status";
import { isAutotileId } from "../../shared/autotile-registry";
import { flagTransform } from "../../shared/tile-flags";
import {
  CATEGORY_ORDER, CATEGORY_LABEL_KEY, filterTileIds, type TileCategory,
} from "../../shared/tile-categories";
import { advState, advHooks } from "./adv-state";
import {
  stamps, deleteStamp, renameStamp, captureStamp,
  stampProbability, setStampProbability,
} from "./adv-stamps";
import { nameDialog } from "./adv-dialogs";

const SWATCH = 40;

// ---- tile palette ----
function tileSwatch(id: number): HTMLElement {
  const c = h("canvas", { width: SWATCH, height: SWATCH, class: "adv-tile-swatch-c" }) as HTMLCanvasElement;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  const sel = id === S.selectedTile && !advState.placingStamp;
  const f = advState.brushFlags;
  // Preview the brush transform on the selected swatch only, so the palette
  // stays readable but the active brush shows its flip/rotate.
  if (sel && (f.h || f.v || f.r) && !isAutotileId(id)) {
    const mat = flagTransform(f, SWATCH);
    g.save();
    g.setTransform(mat[0], mat[1], mat[2], mat[3], mat[4], mat[5]);
    g.drawImage(scaledTile(id), 0, 0);
    g.restore();
  } else {
    g.drawImage(scaledTile(id), 0, 0);
  }
  const cell = h("div", {
    class: "adv-tile-swatch" + (sel ? " sel" : ""),
    title: (Assets.tiles[id] && Assets.tiles[id].name) || String(id),
    onclick: () => {
      advState.placingStamp = null; // choosing a tile disarms stamp placement
      S.selectedTile = id;
      renderPalette();
      advHooks.rebuildRail?.();
      advHooks.render();
      setStatus();
    },
  }, c) as HTMLElement;
  return cell;
}

// Cache a TILE-rendered tile scaled into SWATCH once per id.
const swCache = new Map<number, HTMLCanvasElement>();
function scaledTile(id: number): HTMLCanvasElement {
  const cached = swCache.get(id);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = SWATCH; c.height = SWATCH;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  const tmp = document.createElement("canvas");
  tmp.width = TILE; tmp.height = TILE;
  Assets.drawTile(tmp.getContext("2d"), id, 0, 0);
  g.drawImage(tmp, 0, 0, TILE, TILE, 0, 0, SWATCH, SWATCH);
  swCache.set(id, c);
  return c;
}

function paletteTab(): HTMLElement {
  const wrap = h("div", { class: "adv-rail-tiles" });
  // search box
  const search = h("input", {
    type: "search", class: "adv-rail-search", placeholder: t("Search tiles…"),
    value: advState.paletteSearch, spellcheck: "false",
    oninput: (e: any) => { advState.paletteSearch = e.target.value; advHooks.rebuildRail?.(); },
  }) as HTMLInputElement;
  wrap.appendChild(search);

  // category chips
  const chips = h("div", { class: "adv-rail-cats" });
  const chip = (cat: TileCategory | "all", label: string) =>
    h("button", {
      class: "adv-cat-chip" + (advState.paletteCategory === cat ? " sel" : ""),
      onclick: () => { advState.paletteCategory = cat; advHooks.rebuildRail?.(); },
    }, label);
  chips.appendChild(chip("all", t(CATEGORY_LABEL_KEY.all)));
  for (const c of CATEGORY_ORDER) chips.appendChild(chip(c, t(CATEGORY_LABEL_KEY[c])));
  wrap.appendChild(chips);

  // swatch grid — plain tile ids 1..n, filtered by category + search
  const ids: number[] = [];
  for (let i = 1; i < Assets.tiles.length; i++) if (Assets.tiles[i]) ids.push(i);
  const shown = filterTileIds(
    ids, (id) => Assets.tiles[id], advState.paletteCategory as any, advState.paletteSearch,
  );
  const grid = h("div", { class: "adv-tile-grid" });
  if (!shown.length) {
    grid.appendChild(h("div", { class: "dim adv-rail-empty" }, t("No tiles match your search.")));
  } else {
    for (const id of shown) grid.appendChild(tileSwatch(id));
  }
  wrap.appendChild(grid);
  return wrap as HTMLElement;
}

// ---- stamps ----
function stampThumb(s: any): HTMLElement {
  const size = 56;
  const c = h("canvas", { width: size, height: size, class: "adv-stamp-thumb-c" }) as HTMLCanvasElement;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#15151d"; g.fillRect(0, 0, size, size);
  const scale = Math.min(size / (s.w * TILE), size / (s.h * TILE));
  g.save();
  g.translate((size - s.w * TILE * scale) / 2, (size - s.h * TILE * scale) / 2);
  g.scale(scale, scale);
  const roles = ["ground", "decor", "decor2", "over"];
  for (const role of roles) {
    const arr = s.layers[role];
    if (!arr) continue;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const raw = arr[y * s.w + x];
        if (!raw) continue;
        // Autotiles preview as their base blob is heavy; draw plain tiles, and
        // for autotile ids fall back to a marker — the thumbnail is indicative.
        const id = raw & ((1 << 28) - 1);
        if (isAutotileId(id)) { g.fillStyle = "#3a6ea5"; g.fillRect(x * TILE, y * TILE, TILE, TILE); }
        else Assets.drawTile(g, id, x * TILE, y * TILE);
      }
    }
  }
  g.restore();
  return c as HTMLElement;
}

function stampRow(s: any): HTMLElement {
  const armed = advState.placingStamp && advState.placingStamp.id === s.id;
  const prob = Math.round(stampProbability(s) * 100);
  const row = h("div", { class: "adv-stamp-row" + (armed ? " sel" : "") },
    stampThumb(s),
    h("div", { class: "adv-stamp-info" },
      h("div", {
        class: "adv-stamp-name",
        title: t("Rename…"),
        ondblclick: () => nameDialog(t("Rename…"), s.name, (name) => { renameStamp(s.id, name); advHooks.rebuildRail?.(); }),
      }, s.name + "  " + s.w + "×" + s.h),
      h("div", { class: "adv-stamp-btns" },
        h("button", {
          class: "adv-mini-btn" + (armed ? " sel" : ""),
          title: t("Place Stamp"),
          onclick: () => {
            advState.placingStamp = armed ? null : s;
            advHooks.rebuildRail?.();
            setStatus();
          },
        }, "📌"),
        h("button", {
          class: "adv-mini-btn" + (advState.stampRandom ? " sel" : ""),
          title: t("Random Stamp Scatter"),
          onclick: () => {
            advState.placingStamp = s;
            advState.stampRandom = !advState.stampRandom;
            advHooks.rebuildRail?.();
          },
        }, "🎲"),
        h("button", { class: "adv-mini-btn", title: t("Delete"),
          onclick: () => { deleteStamp(s.id); advHooks.rebuildRail?.(); } }, "✕"),
      ),
      h("label", { class: "adv-stamp-prob" },
        t("Scatter %"),
        h("input", {
          type: "range", min: "0", max: "100", value: String(prob), class: "adv-prop-range",
          oninput: (e: any) => setStampProbability(s, Number(e.target.value) / 100),
        }),
      ),
    ),
  ) as HTMLElement;
  return row;
}

function stampsTab(): HTMLElement {
  const wrap = h("div", { class: "adv-rail-stamps" });
  wrap.appendChild(h("div", { class: "adv-rail-actions" },
    h("button", {
      class: "adv-mini-btn wide", title: t("Save Selection as Stamp…"),
      onclick: () => {
        if (!S.selection) { setStatus(); return; }
        nameDialog(t("Save Selection as Stamp…"), t("Stamp"), (name) => {
          captureStamp(name);
          advState.railTab = "stamps";
          advHooks.rebuildRail?.();
        });
      },
    }, "＋ " + t("Capture Selection")),
  ));
  const list = stamps();
  if (!list.length) {
    wrap.appendChild(h("div", { class: "dim adv-rail-empty" },
      t("No stamps yet — select an area in the Map editor, then Capture Selection.")));
  } else {
    for (const s of list) wrap.appendChild(stampRow(s));
  }
  return wrap as HTMLElement;
}

// ---- rail shell ----
export function renderRail(railEl: HTMLElement) {
  railEl.innerHTML = "";
  const tabBtn = (id: "tiles" | "stamps", label: string) =>
    h("button", {
      class: "adv-rail-tab" + (advState.railTab === id ? " sel" : ""),
      onclick: () => { advState.railTab = id; advHooks.rebuildRail?.(); },
    }, label);
  railEl.appendChild(h("div", { class: "adv-rail-tabs" },
    tabBtn("tiles", t("Tiles")),
    tabBtn("stamps", t("Stamps")),
  ));
  railEl.appendChild(advState.railTab === "stamps" ? stampsTab() : paletteTab());
}
