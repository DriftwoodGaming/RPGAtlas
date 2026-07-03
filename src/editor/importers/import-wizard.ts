/* RPGAtlas — src/editor/importers/import-wizard.ts
   The import wizard (Phase 6 Stage C): sits between the Asset Browser's file
   intake and importAssets, turning raw files into library-ready assets:

   - tileset slicer — any source grid (16/24/32/48/custom + offset/gap) is
     sliced to the 48px pipeline, cell-by-cell selectable, with per-batch
     passability naming (.pass/.terrain suffix conventions);
   - spritesheet slicer — non-3×4 character images can import as flipbook
     sheets with named frame-tag ranges (meta.frames) for the animation
     engine;
   - Aseprite JSON — a .json + .png pair imports as a tagged flipbook sheet
     (uniform grids use the PNG as-is; non-uniform frames are repacked onto a
     uniform grid at import time);
   - everything else falls through to the direct Stage B import.

   Pure math lives in sheet-math.ts (vitest-covered); this module owns the
   modals and canvas work. Copyright (C) 2026 RPGAtlas contributors —
   GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { h } from "../dom";
import { modal } from "../modals";
import {
  importAssets,
  slugName,
  type ImportItem,
} from "../../shared/asset-library";
import type { AssetMeta } from "../../shared/services";
import { gridCells, cellName, isCharsetSheet, parseAseprite, packFrames, type AsepriteSheet } from "./sheet-math";

const TILE = 48;

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not decode image.")); };
    img.src = url;
  });
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"));
}

function sliceCell(img: HTMLImageElement, sx: number, sy: number, cell: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, sx, sy, cell, cell, 0, 0, TILE, TILE);
  return c;
}

// ---------------------------------------------------------------------------
// Tileset slicer
// ---------------------------------------------------------------------------

function tileSlicerModal(file: File, img: HTMLImageElement): Promise<ImportItem[]> {
  return new Promise((resolve) => {
    let cell = [16, 24, 32, 48].find((s) => img.width % s === 0 && img.height % s === 0) || 48;
    let offX = 0, offY = 0, gap = 0;
    let pass: "" | ".pass" | ".terrain" = ".pass";
    const deselected = new Set<string>(); // "row,col" — default = all selected
    const base = h("input", { type: "text", value: slugName(file.name), style: "width:110px" });

    const canvas = h("canvas", { class: "imp-canvas" });
    const info = h("span", { class: "dim" });
    function grid() { return gridCells(img.width, img.height, { cell, offsetX: offX, offsetY: offY, gapX: gap, gapY: gap }); }
    function redraw() {
      const { cols, rows, cells } = grid();
      const scale = Math.max(1, Math.min(4, Math.floor(480 / Math.max(img.width, 1))));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const g = canvas.getContext("2d")!;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const c of cells) {
        const on = !deselected.has(c.row + "," + c.col);
        g.strokeStyle = on ? "rgba(120,216,144,.9)" : "rgba(255,80,80,.55)";
        g.lineWidth = 1;
        g.strokeRect(c.x * scale + 0.5, c.y * scale + 0.5, cell * scale - 1, cell * scale - 1);
        if (!on) {
          g.fillStyle = "rgba(0,0,0,.55)";
          g.fillRect(c.x * scale, c.y * scale, cell * scale, cell * scale);
        }
      }
      info.textContent = cols + "×" + rows + " cells · " + (cells.length - deselected.size) + " selected → 48px tiles";
      (canvas as any)._scale = scale;
    }
    canvas.addEventListener("click", (ev: any) => {
      const scale = (canvas as any)._scale || 1;
      const r = canvas.getBoundingClientRect();
      const px = (ev.clientX - r.left) / scale;
      const py = (ev.clientY - r.top) / scale;
      for (const c of grid().cells) {
        if (px >= c.x && px < c.x + cell && py >= c.y && py < c.y + cell) {
          const k = c.row + "," + c.col;
          if (deselected.has(k)) deselected.delete(k); else deselected.add(k);
          redraw();
          return;
        }
      }
    });

    const num = (get: () => number, set: (v: number) => void, w = 54) =>
      h("input", { type: "number", min: 0, max: 512, value: get(), style: "width:" + w + "px",
        oninput(ev: any) { set(Math.max(0, Number(ev.target.value) || 0)); redraw(); } });
    const cellSel = h("select", { onchange(ev: any) { cell = Number(ev.target.value); redraw(); } });
    for (const s of [16, 24, 32, 48, 64, 96]) cellSel.appendChild(h("option", { value: s }, s + " px"));
    cellSel.value = String(cell);
    const passSel = h("select", { onchange(ev: any) { pass = ev.target.value; } });
    passSel.appendChild(h("option", { value: "" }, "Blocked"));
    passSel.appendChild(h("option", { value: ".pass" }, "Passable"));
    passSel.appendChild(h("option", { value: ".terrain" }, "Terrain (autotile-friendly)"));
    passSel.value = pass;

    let settled = false;
    const done = (items: ImportItem[]) => { if (!settled) { settled = true; resolve(items); } };

    const m = modal({
      title: "Import Tileset — " + file.name,
      wide: true,
      dismissable: false,
      content: h("div", null,
        h("div", { class: "imp-bar" },
          h("label", null, "Source cell ", cellSel),
          h("label", null, "Offset ", num(() => offX, (v) => (offX = v)), num(() => offY, (v) => (offY = v))),
          h("label", null, "Gap ", num(() => gap, (v) => (gap = v))),
          h("label", null, "Base name ", base),
          h("label", null, "Walkability ", passSel),
          info),
        h("div", { class: "imp-scroll" }, canvas),
        h("div", { class: "dim", style: "margin-top:6px" },
          "Click cells to include/exclude. Every included cell becomes one 48px tile named <base>-r<row>c<col>. " +
          "Importing an RPG-Maker A2 autotile block? Use Tools ▸ Import Autotile Sheet… instead.")),
      buttons: [
        { label: "Import Tiles", primary: true, async onClick(close: any) {
          const { cells } = grid();
          const chosen = cells.filter((c) => !deselected.has(c.row + "," + c.col));
          if (!chosen.length) { alert("No cells selected."); return; }
          const items: ImportItem[] = [];
          for (const c of chosen) {
            items.push({
              blob: await toBlob(sliceCell(img, c.x, c.y, cell)),
              name: file.name,
              exactName: cellName(slugName(base.value || file.name), c.row, c.col, pass),
              type: "tilesets",
              meta: { source: file.name, grid: { cell, offX, offY, gap }, cellPos: { row: c.row, col: c.col } },
            });
          }
          // Settle BEFORE close() — close fires onClose, whose done([]) would
          // otherwise win the race and drop the sliced items.
          done(items);
          close();
        } },
        { label: "Skip File", onClick(close: any) { done([]); close(); } },
      ],
      onClose() { done([]); },
    });
    void m;
    redraw();
  });
}

// ---------------------------------------------------------------------------
// Spritesheet slicer (charset vs tagged flipbook sheet)
// ---------------------------------------------------------------------------

function sheetModal(file: File, img: HTMLImageElement): Promise<ImportItem[]> {
  return new Promise((resolve) => {
    let cellW = img.width >= 48 && img.width % 48 === 0 ? 48 : Math.max(1, Math.round(img.width / 4));
    let cellH = img.height >= 48 && img.height % 48 === 0 ? 48 : cellW;
    const tags: { name: string; from: number; to: number; fps: number }[] = [];
    const tagBox = h("div", null);
    const info = h("span", { class: "dim" });
    const cols = () => Math.max(1, Math.floor(img.width / cellW));
    const rows = () => Math.max(1, Math.floor(img.height / cellH));
    function refreshInfo() {
      info.textContent = cols() + "×" + rows() + " cells of " + cellW + "×" + cellH + " (frames 0–" + (cols() * rows() - 1) + ")";
    }
    function tagRow(t: any) {
      const rm = h("button", { class: "mini danger", onclick() { tags.splice(tags.indexOf(t), 1); renderTags(); } }, "×");
      return h("div", { class: "imp-tagrow" },
        h("input", { type: "text", value: t.name, placeholder: "tag name", style: "width:110px", oninput(ev: any) { t.name = ev.target.value; } }),
        h("label", null, " from ", h("input", { type: "number", min: 0, value: t.from, style: "width:56px", oninput(ev: any) { t.from = Number(ev.target.value) || 0; } })),
        h("label", null, " to ", h("input", { type: "number", min: 0, value: t.to, style: "width:56px", oninput(ev: any) { t.to = Number(ev.target.value) || 0; } })),
        h("label", null, " fps ", h("input", { type: "number", min: 1, max: 60, value: t.fps, style: "width:48px", oninput(ev: any) { t.fps = Number(ev.target.value) || 10; } })),
        rm);
    }
    function renderTags() {
      tagBox.innerHTML = "";
      for (const t of tags) tagBox.appendChild(tagRow(t));
      tagBox.appendChild(h("button", { class: "mini", onclick() {
        tags.push({ name: "anim" + (tags.length + 1), from: 0, to: Math.max(0, cols() - 1), fps: 10 });
        renderTags();
      } }, "+ Add frame tag"));
    }
    const preview = h("img", { src: img.src || "", class: "imp-preview" });
    // img.src was revoked; rebuild a preview from the decoded image.
    const pc = document.createElement("canvas");
    pc.width = img.width; pc.height = img.height;
    pc.getContext("2d")!.drawImage(img, 0, 0);
    (preview as any).src = pc.toDataURL();

    const numIn = (get: () => number, set: (v: number) => void) =>
      h("input", { type: "number", min: 1, max: 1024, value: get(), style: "width:60px",
        oninput(ev: any) { set(Math.max(1, Number(ev.target.value) || 1)); refreshInfo(); } });

    let settled = false;
    const done = (items: ImportItem[]) => { if (!settled) { settled = true; resolve(items); } };

    modal({
      title: "Import Sprite Sheet — " + file.name,
      wide: true,
      dismissable: false,
      content: h("div", null,
        h("div", { class: "dim", style: "margin-bottom:6px" },
          img.width + "×" + img.height + " doesn't divide into the 3×4 walking-charset grid. Import it as a walking charset anyway, or as a flipbook sheet with frame tags for battle animations."),
        h("div", { class: "imp-bar" },
          h("label", null, "Cell W ", numIn(() => cellW, (v) => (cellW = v))),
          h("label", null, "Cell H ", numIn(() => cellH, (v) => (cellH = v))),
          info),
        tagBox,
        h("div", { class: "imp-scroll" }, preview)),
      buttons: [
        { label: "Import as Flipbook Sheet", primary: true, onClick(close: any) {
          const frames = tags
            .filter((t) => t.name.trim())
            .map((t) => ({ name: t.name.trim(), from: Math.max(0, t.from), to: Math.max(t.from, t.to), fps: t.fps }));
          // done() before close() — see the slicer note on the onClose race.
          done([{
            blob: file,
            name: file.name,
            type: "characters",
            meta: { charset: false, cols: cols(), rows: rows(), cellW, cellH, frames, source: file.name },
          }]);
          close();
        } },
        { label: "Import as Walking Charset", onClick(close: any) {
          done([{ blob: file, name: file.name, type: "characters" }]);
          close();
        } },
        { label: "Skip File", onClick(close: any) { done([]); close(); } },
      ],
      onClose() { done([]); },
    });
    refreshInfo();
    renderTags();
  });
}

// ---------------------------------------------------------------------------
// Aseprite JSON (+ companion PNG)
// ---------------------------------------------------------------------------

async function asepriteItems(jsonFile: File, pngFile: File): Promise<ImportItem[]> {
  const sheet: AsepriteSheet = parseAseprite(JSON.parse(await jsonFile.text()));
  const frames = sheet.tags.length
    ? sheet.tags
    : [{ name: "all", from: 0, to: sheet.frames.length - 1, fps: 10 }];
  if (sheet.uniform) {
    return [{
      blob: pngFile,
      name: pngFile.name,
      type: "characters",
      meta: { charset: false, cols: sheet.cols, rows: sheet.rows, cellW: sheet.cellW, cellH: sheet.cellH, frames, source: jsonFile.name },
    }];
  }
  // Non-uniform frames: repack onto a uniform grid so from/to address cells.
  const img = await loadImage(pngFile);
  const plan = packFrames(sheet.frames);
  const c = document.createElement("canvas");
  c.width = plan.cols * plan.cellW;
  c.height = plan.rows * plan.cellH;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  sheet.frames.forEach((f, i) => {
    g.drawImage(img, f.x, f.y, f.w, f.h, plan.positions[i].x, plan.positions[i].y, f.w, f.h);
  });
  return [{
    blob: await toBlob(c),
    name: pngFile.name,
    type: "characters",
    meta: { charset: false, cols: plan.cols, rows: plan.rows, cellW: plan.cellW, cellH: plan.cellH, frames, repacked: true, source: jsonFile.name },
  }];
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/** Route dropped/picked files through the right importer flow and land them
 *  in the library. `imageType` is the Asset Browser's "Images as" selector.
 *  Returns the imported metas (empty when everything was skipped). */
export async function wizardImport(files: File[], imageType: AssetMeta["type"]): Promise<AssetMeta[]> {
  const items: ImportItem[] = [];
  const jsons = files.filter((f) => /\.json$/i.test(f.name));
  const rest = files.filter((f) => !/\.json$/i.test(f.name));
  const claimed = new Set<File>();

  // Aseprite pairs: match by meta.image name or same base name in the batch.
  for (const jf of jsons) {
    let png: File | undefined;
    try {
      const parsed = JSON.parse(await jf.text());
      const imageName = parsed && parsed.meta && parsed.meta.image ? String(parsed.meta.image) : null;
      png = rest.find((f) => !claimed.has(f) && f.type.startsWith("image/") &&
        (imageName ? f.name === imageName : slugName(f.name) === slugName(jf.name)));
      if (!png) { alert("Aseprite import: no matching PNG for " + jf.name + " in this batch."); continue; }
      claimed.add(png);
      items.push(...await asepriteItems(jf, png));
    } catch (e: any) {
      alert("Aseprite import failed for " + jf.name + ": " + ((e && e.message) || e));
    }
  }

  for (const f of rest) {
    if (claimed.has(f)) continue;
    const isImage = f.type.startsWith("image/");
    if (!isImage) { items.push({ blob: f, name: f.name }); continue; } // audio → direct
    if (imageType === "tilesets") {
      const img = await loadImage(f);
      if (img.width > TILE || img.height > TILE) {
        items.push(...await tileSlicerModal(f, img));
        continue;
      }
      items.push({ blob: f, name: f.name, type: "tilesets" });
    } else if (imageType === "characters") {
      const img = await loadImage(f);
      if (!isCharsetSheet(img.width, img.height)) {
        items.push(...await sheetModal(f, img));
        continue;
      }
      items.push({ blob: f, name: f.name, type: "characters" });
    } else {
      items.push({ blob: f, name: f.name, type: imageType });
    }
  }

  return items.length ? importAssets(items) : [];
}
