/* RPGAtlas — src/editor/map-editor/autotile-ui.ts
   The Tiles-panel autotile strip + brush-size control (Phase 3 Stage D).

   Lives under the tile palette in #panel-tiles: a row of brush-size buttons and
   a strip of autotile-group swatches with an Import button. Selecting a group
   sets S.selectedTile to the group's reserved id (so the existing paint / fill /
   rect / copy-paste code just works); the blob shape resolves at draw time.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { editorState as S } from "../editor-state";
import { h } from "../dom";
import { confirmBox } from "../modals";
import { touch } from "../persistence";
import { renderMap, renderPalette } from "./map-render";
import { setStatus } from "./status";
import { pushUndo } from "./history";
import {
  ensureAutotiles, importAutotileSheet, deleteAutotile, autotileSwatch,
} from "../autotile-store";
import { tileIdOf, isAutotileId, groupIdOf } from "../../shared/autotile-registry";

export const BRUSH_SIZES = [1, 3, 5];
const SWATCH = 40;

function selectGroup(id: number) {
  S.selectedTile = tileIdOf(id);
  renderPalette(); renderAutotileBar(); setStatus();
}

/** Rebuild the swatch strip from proj.autotiles. Called after import/delete and
 *  whenever the tile selection changes (to move the highlight). */
export function renderAutotileBar() {
  const strip = document.getElementById("autotile-strip");
  if (!strip) return;
  strip.innerHTML = "";
  const list = ensureAutotiles(S.proj);
  if (!list.length) {
    strip.appendChild(h("div", { class: "dim autotile-empty" },
      "No autotiles yet — Import an RPG-Maker A2 sheet to add terrain brushes."));
    return;
  }
  const selId = isAutotileId(S.selectedTile) ? groupIdOf(S.selectedTile) : -1;
  for (const g of list) {
    const cell = h("div", {
      class: "autotile-swatch" + (g.id === selId ? " sel" : ""),
      title: g.name + " — click to paint, right-click to delete",
      onclick: () => selectGroup(g.id),
      oncontextmenu(e: any) {
        e.preventDefault();
        confirmBox(`Delete autotile "${g.name}"? Painted cells will render blank.`, () => {
          pushUndo("Delete autotile");
          if (isAutotileId(S.selectedTile) && groupIdOf(S.selectedTile) === g.id) S.selectedTile = 1;
          deleteAutotile(S.proj, g.id);
          touch(); renderAutotileBar(); renderPalette(); renderMap(); setStatus();
        });
      },
    });
    const sw = autotileSwatch(g.id, SWATCH);
    if (sw) cell.appendChild(sw);
    strip.appendChild(cell);
  }
}

function refreshBrushButtons() {
  for (const n of BRUSH_SIZES) {
    const b = document.getElementById("brush-" + n);
    if (b) b.classList.toggle("sel", S.brushSize === n);
  }
}

export function setBrushSize(n: number) {
  S.brushSize = n;
  refreshBrushButtons(); setStatus();
}

/** Prompt for an image file and import it as one or more autotile groups. */
export function importAutotile() {
  const input = document.getElementById("autotile-file") as HTMLInputElement | null;
  if (input) input.click();
}

function onFileChosen(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const base = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Autotile";
    importAutotileSheet(S.proj, String(reader.result), base).then((added) => {
      touch();
      if (added.length) selectGroup(added[0].id);
      renderAutotileBar(); renderMap();
    }).catch(() => setStatus());
  };
  reader.readAsDataURL(file);
}

/** Wire the brush buttons + hidden file input. Called once at boot. */
export function initAutotileUI() {
  ensureAutotiles(S.proj);
  for (const n of BRUSH_SIZES) {
    const b = document.getElementById("brush-" + n);
    if (b) b.addEventListener("click", () => setBrushSize(n));
  }
  const imp = document.getElementById("autotile-import");
  if (imp) imp.addEventListener("click", importAutotile);
  const input = document.getElementById("autotile-file") as HTMLInputElement | null;
  if (input) input.addEventListener("change", (e: any) => {
    if (e.target.files[0]) onFileChosen(e.target.files[0]);
    e.target.value = "";
  });
  refreshBrushButtons();
  renderAutotileBar();
}

/** Cycle brush size up/down through BRUSH_SIZES (keyboard [ and ]). */
export function stepBrush(dir: number) {
  const i = BRUSH_SIZES.indexOf(S.brushSize);
  const j = Math.max(0, Math.min(BRUSH_SIZES.length - 1, (i < 0 ? 0 : i) + dir));
  setBrushSize(BRUSH_SIZES[j]);
}
