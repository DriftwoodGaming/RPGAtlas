/* RPGAtlas — src/editor/importers/sheet-math.ts
   Pure slicing/parsing math for the Phase 6 importers (no DOM): tileset grid
   cells, sliced-cell naming, Aseprite JSON parsing (hash and array frame
   forms, frameTags with per-tag fps from frame durations), and the uniform-
   grid repack plan for non-uniform Aseprite frames. The canvas work lives in
   import-wizard.ts; everything here is vitest-covered.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GridOpts {
  cell: number; // source cell size (square), px
  offsetX?: number;
  offsetY?: number;
  gapX?: number;
  gapY?: number;
}

export interface GridCell {
  x: number;
  y: number;
  row: number;
  col: number;
}

/** Full cells a (cell+gap) grid yields inside an image, honoring offsets.
 *  Partial edge cells are excluded — slicing never pads. */
export function gridCells(imgW: number, imgH: number, opts: GridOpts): { cols: number; rows: number; cells: GridCell[] } {
  const cell = Math.max(1, Math.floor(opts.cell));
  const offX = Math.max(0, Math.floor(opts.offsetX || 0));
  const offY = Math.max(0, Math.floor(opts.offsetY || 0));
  const gapX = Math.max(0, Math.floor(opts.gapX || 0));
  const gapY = Math.max(0, Math.floor(opts.gapY || 0));
  const stepX = cell + gapX;
  const stepY = cell + gapY;
  const cols = Math.max(0, Math.floor((imgW - offX + gapX) / stepX));
  const rows = Math.max(0, Math.floor((imgH - offY + gapY) / stepY));
  const cells: GridCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({ x: offX + col * stepX, y: offY + row * stepY, row, col });
    }
  }
  return { cols, rows, cells };
}

/** Library name for one sliced cell: "<base>-r<row>c<col>" + the tile
 *  passability suffix convention. */
export function cellName(base: string, row: number, col: number, suffix: "" | ".pass" | ".terrain" = ""): string {
  return base + "-r" + row + "c" + col + suffix;
}

/** True when an image divides exactly into the 3×4 walking-charset grid the
 *  engine expects (three frames × four directions of square-ish cells). */
export function isCharsetSheet(imgW: number, imgH: number): boolean {
  if (imgW % 3 !== 0 || imgH % 4 !== 0) return false;
  const cw = imgW / 3;
  const ch = imgH / 4;
  // Cells needn't be square, but wildly stretched cells mean "not a charset".
  return cw >= 8 && ch >= 8 && cw / ch <= 2 && ch / cw <= 2;
}

// ---------------------------------------------------------------------------
// Aseprite JSON
// ---------------------------------------------------------------------------

export interface AsepriteFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Frame duration, ms. */
  dur: number;
}

export interface FrameTag {
  name: string;
  from: number;
  to: number;
  /** Rounded from the tag's average frame duration. */
  fps: number;
}

export interface AsepriteSheet {
  frames: AsepriteFrame[];
  tags: FrameTag[];
  /** True when every frame shares one size AND sits on that exact grid —
   *  the PNG can then be used as the sheet directly. */
  uniform: boolean;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** meta.image when present (companion PNG file name). */
  image?: string;
}

function tagFps(frames: AsepriteFrame[], from: number, to: number): number {
  const slice = frames.slice(from, to + 1);
  const avg = slice.length ? slice.reduce((s, f) => s + (f.dur || 100), 0) / slice.length : 100;
  return Math.min(60, Math.max(1, Math.round(1000 / Math.max(1, avg))));
}

/** Parse an Aseprite JSON export (either the hash `{frames:{name:{...}}}` or
 *  the array `{frames:[{...}]}` flavor). Throws on shapes that aren't
 *  Aseprite-like. Frame order: array order, or hash insertion order (which
 *  Aseprite writes in frame order). */
export function parseAseprite(json: any): AsepriteSheet {
  if (!json || typeof json !== "object" || !json.frames) throw new Error("Not an Aseprite JSON export (no frames).");
  const raw: any[] = Array.isArray(json.frames) ? json.frames : Object.values(json.frames);
  if (!raw.length) throw new Error("Aseprite JSON has no frames.");
  const frames: AsepriteFrame[] = raw.map((f: any) => {
    const r = f && f.frame;
    if (!r || typeof r.x !== "number") throw new Error("Not an Aseprite JSON export (frame shape).");
    return { x: r.x, y: r.y, w: r.w, h: r.h, dur: Number(f.duration) || 100 };
  });

  const cellW = frames[0].w;
  const cellH = frames[0].h;
  const sameSize = frames.every((f) => f.w === cellW && f.h === cellH);
  const onGrid = sameSize && frames.every((f) => f.x % cellW === 0 && f.y % cellH === 0);
  const sheetW = json.meta && json.meta.size && Number(json.meta.size.w);
  const cols = onGrid && sheetW ? Math.max(1, Math.floor(sheetW / cellW)) : 0;
  const sheetH = json.meta && json.meta.size && Number(json.meta.size.h);
  const rows = onGrid && sheetH ? Math.max(1, Math.floor(sheetH / cellH)) : 0;
  // Uniform also requires each frame index to sit at its grid slot, so
  // `from`/`to` indices address cells directly.
  const uniform = onGrid && cols > 0 &&
    frames.every((f, i) => f.x === (i % cols) * cellW && f.y === Math.floor(i / cols) * cellH);

  const tags: FrameTag[] = [];
  const rawTags = (json.meta && json.meta.frameTags) || [];
  for (const t of rawTags) {
    const from = Math.max(0, Number(t.from) || 0);
    const to = Math.min(frames.length - 1, Math.max(from, Number(t.to) || from));
    tags.push({ name: String(t.name || "tag" + tags.length), from, to, fps: tagFps(frames, from, to) });
  }

  return {
    frames,
    tags,
    uniform,
    cols: uniform ? cols : 0,
    rows: uniform ? rows : 0,
    cellW,
    cellH,
    image: json.meta && json.meta.image ? String(json.meta.image) : undefined,
  };
}

/** Repack plan for non-uniform frames: one uniform grid of max-frame-size
 *  cells, near-square (cols = ceil(sqrt(n))). Frames draw centered in their
 *  cell; from/to indices then address cells 1:1. */
export function packFrames(frames: AsepriteFrame[]): {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  positions: { x: number; y: number }[];
} {
  const cellW = Math.max(...frames.map((f) => f.w), 1);
  const cellH = Math.max(...frames.map((f) => f.h), 1);
  const cols = Math.max(1, Math.ceil(Math.sqrt(frames.length)));
  const rows = Math.max(1, Math.ceil(frames.length / cols));
  const positions = frames.map((f, i) => ({
    x: (i % cols) * cellW + Math.floor((cellW - f.w) / 2),
    y: Math.floor(i / cols) * cellH + Math.floor((cellH - f.h) / 2),
  }));
  return { cols, rows, cellW, cellH, positions };
}
