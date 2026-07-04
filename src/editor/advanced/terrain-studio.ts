/* RPGAtlas — src/editor/advanced/terrain-studio.ts
   The Terrain & Autotile Studio wizard (Phase 8 Stage C).

   A fullscreen modal (Database-modal precedent) that turns a source sheet into a
   terrain brush (proj.autotiles). Five steps down a left rail — Source, Layout,
   Terrain Types, Rules, Preview — mirroring the mockup:

     1. Source        pick / drop a sheet image; the classic "quick path" A2
                      importer is one click away for the common case.
     2. Layout        choose the arrangement (blob47 / edge16 / corner16 / a1 /
                      a3 / a4). detectKind() over the sheet dimensions pre-selects
                      the likely one; a grid overlay shows the slicing.
     3. Terrain Types name + terrain/pass + transform-completion flags
                      (flip H/V, rotate, prefer-original).
     4. Rules         animation (frames / fps) and weighted visual variations
                      (extra sheets with weights).
     5. Preview       a live scratch-map paint using the SAME resolver the engine
                      uses (resolveAutotileCell), plus completeness check-marks.

   "Save Draft" persists the wizard state to localStorage; "Create Terrain Brush"
   commits via createTerrainGroup(). Launched from the Advanced panel and the
   command palette (terrain-studio command). Everything the wizard needs is
   additive: absent it, the project is byte-identical.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { editorState as S, t, TILE } from "../editor-state";
import { h } from "../dom";
import { modal } from "../modals";
import { touch } from "../persistence";
import { flashStatus } from "../map-editor/status";
import { renderMap, renderPalette } from "../map-editor/map-render";
import { renderAutotileBar } from "../map-editor/autotile-ui";
import {
  createTerrainGroup, importAutotileSheet, type TerrainGroupConfig,
} from "../autotile-store";
import {
  registerAutotile, unregisterAutotile, resolveAutotileCell, tileIdOf,
} from "../../shared/autotile-registry";
import {
  detectKind, requiredTileCount, frameTileGrid, type TerrainKind,
} from "../../shared/terrain-kinds";

const DRAFT_KEY = "rpgatlas_terrain_studio_draft";
// A transient reserved id well above any real group, used ONLY to register the
// live-preview source into the shared registry without colliding with the
// project's groups (unregistered when the wizard closes).
const PREVIEW_GROUP_ID = 900_000;
const PREVIEW_TILE_ID = tileIdOf(PREVIEW_GROUP_ID);

type Step = 0 | 1 | 2 | 3 | 4;
const STEP_KEYS = [
  "Studio: Source", "Studio: Layout", "Studio: Terrain Types",
  "Studio: Rules", "Studio: Preview",
];

interface StudioState {
  sheet: string;           // primary source data URL ("" until chosen)
  imgW: number; imgH: number;
  kind: TerrainKind;
  name: string;
  terrain: boolean;
  pass: boolean;
  allowFlipH: boolean; allowFlipV: boolean; allowRot: boolean;
  preferOriginal: boolean;
  animOn: boolean; frames: number; fps: number;
  variants: { sheet: string; weight: number }[];
}

function freshState(): StudioState {
  return {
    sheet: "", imgW: 0, imgH: 0, kind: "blob47", name: "",
    terrain: true, pass: true,
    allowFlipH: false, allowFlipV: false, allowRot: false, preferOriginal: false,
    animOn: false, frames: 3, fps: 4, variants: [],
  };
}

const ALL_KINDS: { kind: TerrainKind; label: string }[] = [
  { kind: "blob47", label: "Terrain (A2 · 47-blob)" },
  { kind: "edge16", label: "Edge / Fence (16)" },
  { kind: "corner16", label: "Corner (16)" },
  { kind: "a1", label: "Animated (A1)" },
  { kind: "a3", label: "Building (A3)" },
  { kind: "a4", label: "Wall (A4)" },
];

// ---- module-scope live wizard (one at a time) ----
let st: StudioState = freshState();
let step: Step = 0;
let previewImg: HTMLImageElement | null = null; // decoded primary, for the grid overlay
let paneEl: HTMLElement | null = null;
let railEl: HTMLElement | null = null;
let closeFn: (() => void) | null = null;

// ============================ launch ============================
export function openTerrainStudio(): void {
  st = loadDraft() || freshState();
  step = 0;
  previewImg = null;
  railEl = h("div", { class: "studio-rail" }) as HTMLElement;
  paneEl = h("div", { class: "studio-pane" }) as HTMLElement;
  const content = h("div", { class: "studio-body" }, railEl, paneEl);
  const footer = h("div", { class: "modal-btns studio-foot" },
    h("button", { onclick: saveDraft }, t("Save Draft")),
    h("span", { class: "studio-foot-sep" }),
    h("button", { onclick: () => go(-1) }, t("Back")),
    h("button", { onclick: () => go(1) }, t("Next")),
    h("button", { class: "primary", onclick: createBrush }, t("Create Terrain Brush")),
    h("button", { onclick: () => closeFn && closeFn() }, t("Close")),
  ) as HTMLElement;
  const m = modal({
    title: "Terrain & Autotile Studio",
    class: "studio-modal",
    wide: true,
    content,
    footer,
    onClose: cleanupPreview,
  });
  closeFn = m.close;
  // decode any drafted sheet so the grid overlay / preview work immediately
  if (st.sheet) decodePrimary(st.sheet);
  render();
}

function go(dir: number): void {
  const n = Math.max(0, Math.min(4, step + dir)) as Step;
  if (n === step) return;
  step = n;
  render();
}

// ============================ render ============================
function render(): void {
  if (!railEl || !paneEl) return;
  railEl.innerHTML = "";
  STEP_KEYS.forEach((key, i) => {
    railEl!.appendChild(h("div", {
      class: "studio-step" + (i === step ? " sel" : "") + (i < step ? " done" : ""),
      onclick: () => { step = i as Step; render(); },
    }, h("span", { class: "studio-step-n" }, String(i + 1)), t(key)));
  });
  paneEl.innerHTML = "";
  paneEl.appendChild([stepSource, stepLayout, stepTypes, stepRules, stepPreview][step]());
}

// ---- Step 1: Source ----
function stepSource(): HTMLElement {
  const drop = h("div", { class: "studio-drop" },
    st.sheet
      ? h("img", { src: st.sheet, class: "studio-src-img" })
      : h("div", { class: "studio-drop-hint" },
        t("Drop a terrain sheet here, or use the buttons below.")),
  ) as HTMLElement;
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault(); drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (f) readSheet(f, true);
  });
  const fileInput = h("input", {
    type: "file", accept: "image/*", style: "display:none",
    onchange(e: any) { if (e.target.files[0]) readSheet(e.target.files[0], true); e.target.value = ""; },
  }) as HTMLInputElement;
  return h("div", { class: "studio-step-pane" },
    h("h3", null, t("Source sheet")),
    h("p", { class: "studio-help" },
      t("Pick the image that holds your terrain. RPG-Maker A1–A4 sheets work directly.")),
    drop,
    h("div", { class: "studio-row" },
      h("button", { class: "primary", onclick: () => fileInput.click() }, t("Choose Image…")),
      fileInput,
      h("button", {
        title: t("Skip the wizard and import an A2 sheet as one or more brushes"),
        onclick: quickImportA2,
      }, t("Quick A2 Import…")),
    ),
    st.sheet ? h("p", { class: "studio-dims" },
      `${st.imgW}×${st.imgH}px · ${Math.round(st.imgW / TILE)}×${Math.round(st.imgH / TILE)} tiles`) : "",
  ) as HTMLElement;
}

// ---- Step 2: Layout ----
function stepLayout(): HTMLElement {
  const guess = st.sheet ? detectKind(st.imgW, st.imgH, TILE) : null;
  const select = h("select", {
    class: "studio-kind",
    onchange(e: any) { st.kind = e.target.value; syncPreviewReg(); render(); },
  }, ...ALL_KINDS.map((k) =>
    h("option", { value: k.kind, ...(k.kind === st.kind ? { selected: "selected" } : {}) }, t(k.label)),
  )) as HTMLSelectElement;
  const overlay = h("div", { class: "studio-grid-wrap" });
  buildGridOverlay(overlay);
  return h("div", { class: "studio-step-pane" },
    h("h3", null, t("Layout")),
    h("p", { class: "studio-help" },
      t("How is the sheet arranged? We guessed from its size — change it if needed.")),
    guess ? h("div", { class: "studio-detect" },
      "🔎 ", t("Auto-detected"), ": ", h("b", null, t(labelFor(guess.kind))),
      h("span", { class: "dim" }, " — " + guess.reason),
      st.kind !== guess.kind
        ? h("button", { class: "studio-mini", onclick() { st.kind = guess.kind; syncPreviewReg(); render(); } }, t("Use this"))
        : "",
    ) : "",
    h("div", { class: "studio-row" }, h("label", null, t("Arrangement")), select),
    overlay,
  ) as HTMLElement;
}

// ---- Step 3: Terrain Types ----
function stepTypes(): HTMLElement {
  const nameIn = h("input", {
    type: "text", value: st.name, placeholder: t("e.g. Grass, Water, Stone Path"),
    oninput(e: any) { st.name = e.target.value; },
  }) as HTMLInputElement;
  const chk = (label: string, key: keyof StudioState, help?: string) =>
    h("label", { class: "studio-chk" },
      h("input", {
        type: "checkbox", ...(st[key] ? { checked: "checked" } : {}),
        onchange(e: any) { (st as any)[key] = e.target.checked; },
      }),
      t(label), help ? h("span", { class: "dim studio-chk-help" }, " " + t(help)) : "",
    );
  return h("div", { class: "studio-step-pane" },
    h("h3", null, t("Terrain")),
    h("div", { class: "studio-row" }, h("label", null, t("Name")), nameIn),
    h("div", { class: "studio-chks" },
      chk("Whole-cell terrain", "terrain", "(paints to the ground under Auto)"),
      chk("Walkable", "pass"),
    ),
    h("h4", null, t("Pattern completion")),
    h("p", { class: "studio-help" },
      t("Derive missing shapes by mirroring / rotating the tiles you drew.")),
    h("div", { class: "studio-chks" },
      chk("Allow horizontal flip", "allowFlipH"),
      chk("Allow vertical flip", "allowFlipV"),
      chk("Allow rotation", "allowRot"),
      chk("Prefer original tiles", "preferOriginal"),
    ),
  ) as HTMLElement;
}

// ---- Step 4: Rules (anim + variants) ----
function stepRules(): HTMLElement {
  const animChk = h("input", {
    type: "checkbox", ...(st.animOn ? { checked: "checked" } : {}),
    onchange(e: any) { st.animOn = e.target.checked; syncPreviewReg(); render(); },
  });
  const framesIn = h("input", {
    type: "number", min: "2", max: "16", value: String(st.frames),
    oninput(e: any) { st.frames = Math.max(2, Math.min(16, Number(e.target.value) || 2)); syncPreviewReg(); },
  });
  const fpsIn = h("input", {
    type: "number", min: "1", max: "30", value: String(st.fps),
    oninput(e: any) { st.fps = Math.max(1, Math.min(30, Number(e.target.value) || 1)); syncPreviewReg(); },
  });
  const varRows = st.variants.map((v, i) => h("div", { class: "studio-variant" },
    h("img", { src: v.sheet, class: "studio-variant-img" }),
    h("label", null, t("Weight")),
    h("input", {
      type: "number", min: "1", max: "99", value: String(v.weight),
      oninput(e: any) { v.weight = Math.max(1, Number(e.target.value) || 1); syncPreviewReg(); },
    }),
    h("button", { class: "studio-mini danger", onclick() { st.variants.splice(i, 1); syncPreviewReg(); render(); } }, "✕"),
  ));
  const addVar = h("input", {
    type: "file", accept: "image/*", style: "display:none",
    onchange(e: any) {
      const f = e.target.files[0];
      if (f) { const r = new FileReader(); r.onload = () => { st.variants.push({ sheet: String(r.result), weight: 1 }); syncPreviewReg(); render(); }; r.readAsDataURL(f); }
      e.target.value = "";
    },
  }) as HTMLInputElement;
  return h("div", { class: "studio-step-pane" },
    h("h3", null, t("Rules")),
    h("h4", null, t("Animation")),
    h("p", { class: "studio-help" }, t("Cycle through frames laid across the sheet (like RPG-Maker A1 water).")),
    h("label", { class: "studio-chk" }, animChk, t("Animate this terrain")),
    st.animOn ? h("div", { class: "studio-row" },
      h("label", null, t("Frames")), framesIn,
      h("label", null, t("FPS")), fpsIn,
    ) : "",
    h("h4", null, t("Variations")),
    h("p", { class: "studio-help" }, t("Add alternate sheets; each cell picks one at random by weight.")),
    ...varRows,
    h("div", { class: "studio-row" },
      addVar,
      h("button", { onclick: () => addVar.click() }, t("Add Variation…")),
    ),
  ) as HTMLElement;
}

// ---- Step 5: Preview + completeness ----
function stepPreview(): HTMLElement {
  syncPreviewReg();
  const cv = h("canvas", { class: "studio-preview-canvas", width: "384", height: "384" }) as HTMLCanvasElement;
  // A scratch neighbourhood: an 8x8 field of the terrain with a hole, so edges
  // and corners resolve. Rendered via the SAME resolver the engine uses.
  drawScratch(cv);
  const checks = completeness();
  return h("div", { class: "studio-step-pane studio-preview" },
    h("h3", null, t("Preview")),
    h("p", { class: "studio-help" }, t("This is exactly how the terrain paints in the map.")),
    st.sheet ? cv : h("div", { class: "studio-drop-hint" }, t("Pick a source sheet first.")),
    h("div", { class: "studio-checks" },
      ...checks.map((c) => h("div", { class: "studio-check " + (c.ok ? "ok" : "warn") },
        c.ok ? "✓ " : "⚠ ", t(c.label))),
    ),
  ) as HTMLElement;
}

function labelFor(kind: TerrainKind): string {
  return ALL_KINDS.find((k) => k.kind === kind)?.label || kind;
}

// ============================ source / decode ============================
function readSheet(file: File, primary: boolean): void {
  const r = new FileReader();
  r.onload = () => {
    const url = String(r.result);
    if (primary) {
      st.sheet = url;
      if (!st.name) st.name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
      decodePrimary(url, true);
    }
  };
  r.readAsDataURL(file);
}
function decodePrimary(url: string, autoStep = false): void {
  const img = new Image();
  img.onload = () => {
    previewImg = img;
    st.imgW = img.naturalWidth; st.imgH = img.naturalHeight;
    // First decode of a fresh sheet: auto-pick the kind, then land on Layout.
    if (autoStep) {
      st.kind = detectKind(st.imgW, st.imgH, TILE).kind;
      step = 1;
    }
    syncPreviewReg();
    render();
  };
  img.src = url;
}

// ============================ live preview registry ============================
function decodeToCanvas(url: string): HTMLCanvasElement | null {
  if (!previewImg || previewImg.src !== url) return null;
  const c = document.createElement("canvas");
  c.width = previewImg.naturalWidth; c.height = previewImg.naturalHeight;
  c.getContext("2d")!.drawImage(previewImg, 0, 0);
  return c;
}
/** (Re)register the wizard's current config under the transient preview id so
 *  the Preview step resolves cells exactly like the engine will after commit. */
function syncPreviewReg(): void {
  const block = st.sheet ? decodeToCanvas(st.sheet) : null;
  if (!block) { unregisterAutotile(PREVIEW_TILE_ID); return; }
  registerAutotile(PREVIEW_TILE_ID, block, {
    kind: st.kind,
    anim: st.animOn && st.frames > 1 ? { frames: st.frames, fps: st.fps } : undefined,
    // variant sheets aren't decoded into the preview (they'd need their own
    // Image loads); the primary block previews the shape. Commit decodes them.
  });
}
function cleanupPreview(): void {
  unregisterAutotile(PREVIEW_TILE_ID);
  closeFn = null;
}

// ============================ preview drawing ============================
function drawScratch(cv: HTMLCanvasElement): void {
  const g = cv.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#15151d";
  g.fillRect(0, 0, cv.width, cv.height);
  const N = 8;
  const cell = Math.floor(cv.width / N);
  // an 8x8 field of the terrain with a 2x2 hole in the middle so edges/corners show
  const field: number[] = new Array(N * N).fill(PREVIEW_TILE_ID);
  for (const [hx, hy] of [[3, 3], [4, 3], [3, 4], [4, 4]]) field[hy * N + hx] = 0;
  const draw = (frame: number) => {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!field[y * N + x]) continue;
        const same = (dx: number, dy: number) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) return true;
          return field[ny * N + nx] === PREVIEW_TILE_ID;
        };
        const c = resolveAutotileCell(PREVIEW_TILE_ID, same, cell, frame, x, y);
        if (c) g.drawImage(c, x * cell, y * cell, cell, cell);
      }
    }
  };
  draw(0);
  // If animated, spin a tiny preview loop while the canvas is on-screen.
  if (st.animOn && st.frames > 1) {
    let raf = 0;
    const spin = () => {
      if (!cv.isConnected) { cancelAnimationFrame(raf); return; }
      const f = Math.floor(performance.now() / 1000 * st.fps) % st.frames;
      g.fillStyle = "#15151d"; g.fillRect(0, 0, cv.width, cv.height);
      draw(f);
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);
  }
}

// ============================ completeness ============================
function completeness(): { ok: boolean; label: string }[] {
  const out: { ok: boolean; label: string }[] = [];
  const grid = frameTileGrid(st.kind);
  const okSheet = !!st.sheet && st.imgW > 0 && st.imgH > 0;
  out.push({ ok: okSheet, label: okSheet ? "Source sheet loaded" : "No source sheet" });
  if (okSheet) {
    const cols = Math.round(st.imgW / TILE), rows = Math.round(st.imgH / TILE);
    const needCols = st.kind === "a1" ? grid.cols * (st.animOn ? st.frames : 1) : grid.cols;
    const fits = cols >= needCols && rows >= grid.rows;
    out.push({ ok: fits, label: fits
      ? `Sheet covers the ${st.kind} layout (${requiredTileCount(st.kind)} tiles)`
      : `Sheet is smaller than the ${st.kind} layout needs` });
    if (st.animOn) {
      const animFits = cols >= grid.cols * st.frames;
      out.push({ ok: animFits, label: animFits
        ? `${st.frames} animation frames fit across the sheet`
        : `Sheet is too narrow for ${st.frames} frames` });
    }
  }
  out.push({ ok: !!st.name.trim(), label: st.name.trim() ? "Named" : "Give the terrain a name" });
  return out;
}

// ============================ commit / draft / quick path ============================
function createBrush(): void {
  if (!st.sheet) { flashStatus(t("Pick a source sheet first.")); step = 0; render(); return; }
  if (!st.name.trim()) { flashStatus(t("Give the terrain a name.")); step = 2; render(); return; }
  const cfg: TerrainGroupConfig = {
    name: st.name.trim(),
    sheet: st.sheet,
    kind: st.kind,
    terrain: st.terrain,
    pass: st.pass,
    variants: st.variants.length ? st.variants : undefined,
    allowFlipH: st.allowFlipH, allowFlipV: st.allowFlipV, allowRot: st.allowRot,
    preferOriginal: st.preferOriginal,
    anim: st.animOn && st.frames > 1 ? { frames: st.frames, fps: st.fps } : undefined,
  };
  createTerrainGroup(S.proj, cfg).then((g) => {
    S.selectedTile = tileIdOf(g.id);
    touch();
    renderAutotileBar(); renderPalette(); renderMap();
    flashStatus(t("Terrain brush created") + `: ${g.name}`);
    clearDraft();
    if (closeFn) closeFn();
  });
}

function saveDraft(): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(st));
    flashStatus(t("Draft saved"));
  } catch { flashStatus(t("Could not save draft")); }
}
function loadDraft(): StudioState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { ...freshState(), ...d };
  } catch { return null; }
}
function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

/** Quick path: fold the classic A2 importer in — bypass the wizard for a plain
 *  RPG-Maker A2 sheet (the common case). */
function quickImportA2(): void {
  const input = h("input", {
    type: "file", accept: "image/*", style: "display:none",
    onchange(e: any) {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        const base = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Autotile";
        importAutotileSheet(S.proj, String(r.result), base).then((added) => {
          touch();
          if (added.length) S.selectedTile = tileIdOf(added[0].id);
          renderAutotileBar(); renderPalette(); renderMap();
          flashStatus(t("Imported") + ` ${added.length} ` + t("terrain brush(es)"));
          if (closeFn) closeFn();
        });
      };
      r.readAsDataURL(f);
      e.target.value = "";
    },
  }) as HTMLInputElement;
  input.click();
}

// ============================ grid overlay ============================
function buildGridOverlay(wrap: HTMLElement): void {
  wrap.innerHTML = "";
  if (!st.sheet) { wrap.appendChild(h("div", { class: "studio-drop-hint" }, t("Pick a source sheet first."))); return; }
  const box = h("div", { class: "studio-grid-box" });
  box.appendChild(h("img", { src: st.sheet, class: "studio-grid-img" }));
  const grid = frameTileGrid(st.kind);
  const cols = Math.max(grid.cols, Math.round(st.imgW / TILE));
  const rows = Math.max(grid.rows, Math.round(st.imgH / TILE));
  const lines = h("div", { class: "studio-grid-lines" }) as HTMLElement;
  lines.style.setProperty("--cols", String(cols));
  lines.style.setProperty("--rows", String(rows));
  box.appendChild(lines);
  wrap.appendChild(box);
}
