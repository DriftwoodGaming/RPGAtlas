/* RPGAtlas — src/editor/advanced/adv-stamps.ts
   Stamps (Phase 8 Stage E): a persisted clipboard entry (proj.stamps) captured
   from a tile selection and placed through the same write path as tile paste.

   A stamp is the same shape as the tile clipboard — per-core-role tile arrays
   plus shadows (schema Stamp) — so capturing is "read the selection rect into
   the four role arrays" and placing is "stamp those arrays at the click cell",
   exactly what clipboard.ts's copy/stampPaste already do for the transient
   clipboard. Library entries just persist that on proj.stamps so they survive
   save/reload and can be re-placed any time.

   Placement writes the core role arrays (m.layers[role]) so both editors see
   the tiles; it funnels through pushUndo()/touch() like every other edit.
   Random-scatter mode places the stamp at cells across the brush footprint with
   the stamp's per-placement probability, for quick foliage/rubble scattering.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { editorState as S, curMap } from "../editor-state";
import { touch } from "../persistence";
import { pushUndo } from "../map-editor/history";
import type { Stamp } from "../../shared/schema";
import { captureStampData, writeStampData } from "../../shared/stamp-ops";
import { advState } from "./adv-state";

/** The live proj.stamps array, created lazily so a project that never captures
 *  a stamp keeps NO stamps key (byte-identical). */
export function ensureStamps(): Stamp[] {
  if (!S.proj.stamps) S.proj.stamps = [];
  return S.proj.stamps;
}
export function stamps(): Stamp[] {
  return (S.proj.stamps as Stamp[]) || [];
}

function nextStampId(): number {
  return stamps().reduce((mx, s) => Math.max(mx, s.id), 0) + 1;
}

/** Capture the current tile marquee (S.selection — shared with the Standard
 *  editor) into a new stamp. Returns the stamp, or null when nothing is
 *  selected. Reads the four role arrays + shadows exactly like clipboard copy,
 *  so a captured stamp round-trips through paste identically. */
export function captureStamp(name: string): Stamp | null {
  const m = curMap();
  const r = S.selection;
  if (!m || !r) return null;
  const stamp = captureStampData(m, r, nextStampId(), name || "Stamp");
  ensureStamps().push(stamp);
  touch();
  return stamp;
}

export function deleteStamp(id: number): void {
  const list = ensureStamps();
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return;
  list.splice(i, 1);
  if (advState.placingStamp && advState.placingStamp.id === id) advState.placingStamp = null;
  touch();
}

export function renameStamp(id: number, name: string): void {
  const s = stamps().find((x) => x.id === id);
  if (!s) return;
  s.name = name;
  touch();
}

/** Deterministic-ish per-cell RNG so a random scatter doesn't reshuffle on
 *  every re-render — seeded from the cell + stamp id. Small LCG. */
function cellChance(seed: number): number {
  let v = (seed * 1103515245 + 12345) & 0x7fffffff;
  v = (v ^ (v >>> 15)) & 0x7fffffff;
  return v / 0x7fffffff;
}

/** Place the armed stamp at a clicked cell. In normal mode it drops once at the
 *  cell; in random-scatter mode it drops at cells across the current brush
 *  footprint whose per-cell roll passes the stamp's probability (props.prob,
 *  0..1, default 0.5). One pushUndo per click. */
export function placeStampAt(m: any, cell: { x: number; y: number }): void {
  const s = advState.placingStamp;
  if (!s) return;
  pushUndo(advState.stampRandom ? "Scatter stamp" : "Place stamp");
  if (!advState.stampRandom) {
    writeStampData(m, s, cell.x, cell.y);
  } else {
    const prob = stampProbability(s);
    const r = Math.floor(Math.max(1, S.brushSize) / 2);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cell.x + dx, y = cell.y + dy;
        if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
        // Vary the roll each click so repeated clicks fill in gradually.
        const seed = (x * 73856093) ^ (y * 19349663) ^ (s.id * 83492791) ^ (advState.scatterSalt | 0);
        if (cellChance(seed >>> 0) < prob) writeStampData(m, s, x, y);
      }
    }
    advState.scatterSalt = (advState.scatterSalt | 0) + 1;
  }
  touch();
}

/** A stamp's scatter probability (0..1). Stored on props.prob so it round-trips
 *  in the save file; default 0.5. */
export function stampProbability(s: Stamp): number {
  const p = (s as any).props && (s as any).props.prob;
  return typeof p === "number" && p >= 0 && p <= 1 ? p : 0.5;
}
export function setStampProbability(s: Stamp, prob: number): void {
  if (!(s as any).props) (s as any).props = {};
  (s as any).props.prob = Math.min(1, Math.max(0, prob));
  touch();
}
