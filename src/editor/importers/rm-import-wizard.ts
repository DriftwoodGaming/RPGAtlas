/* RPGAtlas — src/editor/importers/rm-import-wizard.ts
   Project Compass M1·D: the "Import from RPG Maker MZ / MV" wizard — the user
   face of the whole migration. It lets a beginner point RPGAtlas at their own MV
   or MZ project (a picked folder, or a .zip of it), runs the M1·A–C conversion
   pipeline behind a progress note, loads the result as the current project, and
   shows a plain-language report of what came along, what changed, and what to do
   next — never a stack trace (locked decision 6).

   The DOM-free conversion core lives in ./mz (runRmImport / readZip); this module
   owns the file-pickers, the progress + report modals, and committing the
   imported project into the editor. Copyright (C) 2026 RPGAtlas contributors —
   GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { h } from "../dom";
import { modal } from "../modals";
import { Assets, DataDefaults, RA, editorState as S, editorHooks } from "../editor-state";
import { touch } from "../persistence";
import { validateProject, type ImportReportDoc, type ImportReportLine, type ImportReportPlugin } from "../../shared/schema";
import { consumeEmbeddedAssets, libraryImageEntries } from "../../shared/asset-library";
import { downloadBlob } from "../../../js/editor/project-io.js";
import {
  fileListSource,
  objectSource,
  readZip,
  runRmImport,
  reportDocToText,
  reimportDelta,
  PLUGIN_VERDICT_WORD,
  type MzFileSource,
  type RmImportOutcome,
  type ImportProgressFn,
} from "./mz";

// ---------------------------------------------------------------------------
// Source builders (folder pick vs .zip)
// ---------------------------------------------------------------------------

/** Strip a common leading folder so paths are project-root-relative, anchored on
 *  `data/System.json` (a real project always has one). Mirrors what
 *  `fileListSource` does for a picked folder; needed for a zip whose entries may
 *  sit under a top-level game folder. */
function stripToProjectRoot(map: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\//, "");
  let prefix = "";
  for (const k of Object.keys(map)) {
    const m = /^(.*?)data\/system\.json$/i.exec(norm(k));
    if (m) { prefix = m[1]; break; }
  }
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(map)) {
    const nk = norm(k);
    const key = prefix && nk.toLowerCase().startsWith(prefix.toLowerCase()) ? nk.slice(prefix.length) : nk;
    out[key] = v;
  }
  return out;
}

async function openZipSource(bytes: Uint8Array): Promise<MzFileSource> {
  return objectSource(stripToProjectRoot(await readZip(bytes)));
}

// ---------------------------------------------------------------------------
// Run + commit
// ---------------------------------------------------------------------------

/** Load the imported project into the editor — the same live-refresh path as a
 *  .json Open (persistence.importProject), plus the saved report. */
async function commit(outcome: RmImportOutcome): Promise<void> {
  const project = validateProject(RA.migrateProject(outcome.project), "import");
  project.importReport = outcome.report; // survive migrate (mutates in place)
  S.proj = project;
  await consumeEmbeddedAssets(S.proj);
  Assets.registerCustomChars(S.proj.customChars);
  await Assets.loadIconSet(S.proj.assets.icons);
  await Assets.registerExternalAssets(libraryImageEntries(), S.proj);
  S.curMapId = S.proj.maps[0].id;
  S.selectedEvent = null;
  S.selection = null;
  S.pasteMode = null;
  S.undoStack.length = 0;
  S.redoStack.length = 0;
  editorHooks.rebuildAll();
  touch();
}

function showError(e: any): void {
  // The modal stays kid-friendly (D11); the console gets the real stack so a
  // bug report from the field is diagnosable.
  console.error("RPG Maker import failed:", e);
  const msg = e && e.message ? String(e.message) : String(e);
  modal({
    title: "Import didn't work",
    content: h("div", { class: "helpbox" },
      h("p", null, "We couldn't bring that project in — but nothing on your computer was changed."),
      h("p", { class: "dim" }, msg),
      h("p", null, "Make sure you picked the game's project folder (the one with a ",
        h("b", null, "data"), " folder inside), or a .zip of it.")),
    buttons: [{ label: "OK", primary: true }],
  });
}

/** The shared pick → progress → convert → load → report flow. `getSource` is
 *  awaited only after the progress note is on screen, so a big project shows
 *  feedback before the CPU-heavy convert blocks the thread. The progress note
 *  updates per stage (M6·A) — `onProgress` yields to paint so each step shows
 *  before the next blocks. A report already on the project is remembered so the
 *  new one can celebrate what a re-import picked up. */
async function importFromSource(getSource: () => Promise<MzFileSource>): Promise<void> {
  const prevReport = (S.proj as any).importReport as ImportReportDoc | undefined;

  const label = h("p", null, "Getting started…");
  const barFill = h("div", {
    style: "height:100%;width:0%;border-radius:6px;background:rgba(120,216,144,.85);transition:width .18s ease",
  });
  const bar = h("div", {
    style: "height:8px;border-radius:6px;background:rgba(255,255,255,.08);margin:8px 0 4px;overflow:hidden",
  }, barFill);
  const prog = modal({
    title: "Importing your game…",
    dismissable: false,
    buttons: [],
    content: h("div", { class: "helpbox" },
      label, bar,
      h("p", { class: "dim" }, "This can take a moment for a big game.")),
  });

  const onProgress: ImportProgressFn = async (p) => {
    label.textContent = p.label;
    (barFill as HTMLElement).style.width = Math.round((p.step / p.total) * 100) + "%";
    // Yield a macrotask so the browser paints this stage before the next one
    // (the convert stage) blocks the thread.
    await new Promise((r) => setTimeout(r, 0));
  };

  // Let the modal paint before the synchronous conversion work starts.
  await new Promise((r) => setTimeout(r, 20));
  try {
    const source = await getSource();
    const outcome = await runRmImport(source, DataDefaults.newProject(), onProgress);
    await commit(outcome);
    prog.close();
    showReport(outcome.report, prevReport);
  } catch (e) {
    prog.close();
    showError(e);
  }
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function chip(label: string, n: number): HTMLElement {
  return h("span", {
    style:
      "display:inline-block;margin:2px 4px;padding:2px 9px;border-radius:11px;" +
      "background:rgba(120,216,144,.16);border:1px solid rgba(120,216,144,.45);font-size:12px",
  }, `${n} ${label}`);
}

/** Verdict → badge (icon + tint + short verdict word). Honest, not scary: even
 *  "Atlas doesn't do this" reassures that the game still plays (M5·A, D11). Icon
 *  + word come from the shared `PLUGIN_VERDICT_WORD` table (one source of truth
 *  with the text export, M6·A); only the color tint is a UI concern here. */
const PLUGIN_TINT: Record<ImportReportPlugin["verdict"], string> = {
  builtin: "120,216,144", partial: "120,180,240", none: "200,200,210", unknown: "230,196,120",
};
const PLUGIN_BADGE: Record<ImportReportPlugin["verdict"], { icon: string; word: string; tint: string }> =
  Object.fromEntries(
    (Object.keys(PLUGIN_TINT) as ImportReportPlugin["verdict"][]).map((v) => [
      v, { ...PLUGIN_VERDICT_WORD[v], tint: PLUGIN_TINT[v] },
    ]),
  ) as Record<ImportReportPlugin["verdict"], { icon: string; word: string; tint: string }>;

/** Render the "Add-ons (plugins)" section: one card per plugin from
 *  js/plugins.js with its guidance badge, ON/OFF + settings note, and the
 *  kid-friendly advice. Nothing renders when the game had no plugins. */
function renderPluginsSection(box: HTMLElement, plugins: ImportReportPlugin[] | undefined): void {
  if (!plugins || !plugins.length) return;
  box.appendChild(h("h4", null, "🔌 Add-ons (plugins)"));
  const anyConverted = plugins.some((p) => p.converted);
  box.appendChild(h("p", { class: "dim" },
    "Your game used " + plugins.length + " add-on" + (plugins.length === 1 ? "" : "s") +
    ". RPG Maker add-on code talks to RPG Maker's insides, so it can't run here — but " +
    (anyConverted
      ? "Atlas converted each one into an Atlas add-on in Tools ▸ Plugin Manager, keeping its name, " +
        "its author's credit, and every setting. Here's what each one did and what Atlas gives you instead."
      : "here's what each one did and what Atlas gives you instead — your settings were saved either way.")));
  const list = h("div", { style: "margin:4px 0" });
  for (const pl of plugins) {
    const b = PLUGIN_BADGE[pl.verdict] || PLUGIN_BADGE.unknown;
    const meta: string[] = [];
    if (!pl.on) meta.push("was turned off");
    if (pl.paramCount > 0) meta.push("kept its " + pl.paramCount + " setting" + (pl.paramCount === 1 ? "" : "s"));
    if (pl.converted) meta.push("now in your Plugin Manager");
    const card = h("div", {
      style:
        "margin:6px 0;padding:7px 10px;border-radius:8px;border:1px solid rgba(" + b.tint + ",.45);" +
        "background:rgba(" + b.tint + ",.10)",
    },
      h("div", null,
        h("b", null, b.icon + " " + pl.name),
        pl.author ? h("span", { class: "dim", style: "font-size:12px" }, " by " + pl.author) : null,
        h("span", { class: "dim", style: "font-size:12px" }, "  " + b.word),
        meta.length ? h("span", { class: "dim", style: "font-size:12px" }, " · " + meta.join(", ")) : null),
      h("div", { style: "font-size:13px;margin-top:2px" },
        pl.advice + (pl.pointer ? " Look in " + pl.pointer + "." : "")));
    list.appendChild(card);
  }
  box.appendChild(list);
}

/** A filesystem-friendly name for the saved-as-text report. */
function reportFileName(doc: ImportReportDoc): string {
  const base = (doc.gameTitle || "rpg-maker").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (base || "import") + "-import-report.txt";
}

/** Download the report as a plain-text file (M6·A) — the pure `reportDocToText`
 *  is shared with the vitest spec so the wording can't drift. */
function saveReportText(doc: ImportReportDoc): void {
  downloadBlob(new Blob([reportDocToText(doc)], { type: "text/plain;charset=utf-8" }), reportFileName(doc));
}

/** Copy the text report to the clipboard, flashing the button label on success
 *  (best-effort — a denied clipboard just leaves the label unchanged). */
function copyReportText(doc: ImportReportDoc, btn: HTMLElement): void {
  const nav: any = navigator;
  if (!nav.clipboard || !nav.clipboard.writeText) return;
  nav.clipboard.writeText(reportDocToText(doc)).then(() => {
    const was = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = was; }, 1400);
  }).catch(() => {});
}

/** Build the report modal's custom footer: Save-as-Text + Copy (M6·A, which
 *  must NOT dismiss the modal, so they're their own buttons rather than the
 *  standard button row) plus a primary close. The close handler is late-bound
 *  via `setClose` because `modal()` returns it only after the footer is built.
 *  `primaryLabel` differs post-import ("Start Editing") vs a reopen ("Close"). */
function reportFooter(doc: ImportReportDoc, primaryLabel: string): { footer: HTMLElement; setClose: (c: () => void) => void } {
  let close = (): void => {};
  const copyBtn = h("button", { onclick() { copyReportText(doc, copyBtn); } }, "📋 Copy");
  const footer = h("div", { class: "modal-btns" },
    h("button", { onclick() { saveReportText(doc); } }, "💾 Save as Text…"),
    copyBtn,
    h("button", { class: "primary", onclick() { close(); } }, primaryLabel));
  return { footer, setClose: (c) => { close = c; } };
}

/** Render the saved import report as kid-friendly HTML (locked decision 6):
 *  good news first, then honest notes on what changed / is coming / was left
 *  out, then next steps. Reused by the post-import modal and File ▸ Import
 *  Report. `prev` (the report the project already carried, if any) drives the
 *  re-import "here's what's new" banner (M6·A). */
export function renderReportDoc(doc: ImportReportDoc, prev?: ImportReportDoc): HTMLElement {
  const srcName = doc.source === "mz" ? "RPG Maker MZ" : "RPG Maker MV";
  const s = doc.summary;
  const chips = h("div", { style: "margin:6px 0 4px" });
  const add = (label: string, n: number) => { if (n > 0) chips.appendChild(chip(label, n)); };
  add("maps", s.maps); add("heroes", s.actors); add("skills", s.skills);
  add("items", s.items); add("weapons", s.weapons); add("armor pieces", s.armors);
  add("enemies", s.enemies); add("battle groups", s.troops);
  add("common events", s.commonEvents); add("switches", s.switches); add("variables", s.variables);

  // Re-import banner (M6·A): only when a previous report existed and there's
  // something worth saying — a green "look what's new" when Atlas has learned to
  // convert more since last time, or a neutral "nothing new here yet".
  const delta = reimportDelta(prev, doc);
  const banner = delta.headline
    ? h("div", {
        style:
          "margin:2px 0 8px;padding:8px 12px;border-radius:8px;font-size:13.5px;" +
          (delta.improved
            ? "border:1px solid rgba(120,216,144,.55);background:rgba(120,216,144,.12)"
            : "border:1px solid rgba(200,200,210,.4);background:rgba(200,200,210,.08)"),
      }, "🔁 " + delta.headline)
    : null;

  const box = h("div", { class: "helpbox" },
    banner,
    h("h3", null, `🎉 Your ${srcName} game is in RPGAtlas!`),
    doc.gameTitle ? h("p", null, h("b", null, doc.gameTitle)) : null,
    h("p", null, "Here's everything that came along:"),
    chips);

  const byKind = (k: ImportReportLine["kind"]) => doc.lines.filter((l) => l.kind === k);
  const section = (title: string, lines: ImportReportLine[]) => {
    if (!lines.length) return;
    const ul = h("ul");
    for (const l of lines) {
      const suffix = l.count && l.count > 1 ? ` (seen ${l.count} times)` : "";
      ul.appendChild(h("li", null,
        h("b", null, l.what),
        h("span", null, (l.detail ? " — " + l.detail : "") + suffix)));
    }
    box.appendChild(h("h4", null, title));
    box.appendChild(ul);
  };

  const partial = byKind("partial"), todo = byKind("todo"), skipped = byKind("skipped"), notes = byKind("converted");
  if (!partial.length && !todo.length && !skipped.length) {
    box.appendChild(h("p", null, "Everything came across cleanly — nothing was left behind. 🎉"));
  } else {
    box.appendChild(h("p", { class: "dim" }, "A few things need a note — nothing was thrown away:"));
  }
  section("✏️ Came in a little differently", partial);
  section("⏳ Saved for a later update", todo);
  section("📦 Left out on purpose", skipped);
  section("ℹ️ Notes", notes);

  renderPluginsSection(box, doc.plugins);

  box.appendChild(h("h4", null, "What next?"));
  box.appendChild(h("ul", null,
    h("li", null, "Press ▶ Playtest (F5) to try your game right away."),
    h("li", null, "Your maps kept their shapes, layout, and events. To bring in your own " +
      "tile artwork, use the Asset Browser (Tools ▸ Asset Browser) and Import Autotile Sheet."),
    h("li", null, "You can reopen this report any time from File ▸ Import Report.")));
  return box;
}

function showReport(doc: ImportReportDoc, prev?: ImportReportDoc): void {
  const { footer, setClose } = reportFooter(doc, "Start Editing");
  const m = modal({
    title: "Import Report",
    wide: true,
    content: renderReportDoc(doc, prev),
    footer,
  });
  setClose(m.close);
}

// ---------------------------------------------------------------------------
// Entry points (wired from workspace.ts actions + boot.ts)
// ---------------------------------------------------------------------------

/** Open the "which one" launcher: pick a folder or a .zip. The hidden inputs'
 *  change handlers (wired by initRmImport) do the actual work. */
export function openRmImportWizard(): void {
  const pick = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.click();
  };
  const alreadyImported = hasImportReport();
  modal({
    title: "Import from RPG Maker MZ / MV",
    content: h("div", { class: "helpbox" },
      h("p", null, "Bring your own RPG Maker MV or MZ game into RPGAtlas. Pick the game's project " +
        "folder (the one with a ", h("b", null, "data"), " folder inside), or a ", h("b", null, ".zip"), " of it."),
      // Re-import nudge (M6·A): a project that already came from an import can be
      // re-run to pick up anything Atlas has newly learned to convert.
      alreadyImported
        ? h("p", null, "🔁 ", h("b", null, "Re-importing?"), " Pick the same folder again — RPGAtlas keeps " +
          "learning to convert more, and a fresh import picks up whatever's newly supported. The report " +
          "will tell you what's new.")
        : null,
      h("p", { class: "dim" }, "Only your own project works — encrypted artwork is unlocked with the " +
        "project's own key. Your current project will be replaced, so use File ▸ Export first if you want to keep it.")),
    buttons: [
      { label: "Choose Folder…", primary: true, onClick(close: any) { close(); pick("rm-import-folder"); } },
      { label: "Choose .zip File…", onClick(close: any) { close(); pick("rm-import-zip"); } },
      { label: "Cancel" },
    ],
  });
}

/** Reopen the report saved on the current project (File ▸ Import Report). */
export function openSavedImportReport(): void {
  const doc = (S.proj as any).importReport as ImportReportDoc | undefined;
  if (!doc) return; // the action is disabled when there's no report
  const { footer, setClose } = reportFooter(doc, "Close");
  const m = modal({
    title: "Import Report",
    wide: true,
    content: renderReportDoc(doc),
    footer,
  });
  setClose(m.close);
}

/** True when the current project carries a saved import report. */
export function hasImportReport(): boolean {
  return !!(S.proj as any).importReport;
}

/** Wire the hidden folder/zip inputs to the import flow. Called once at boot. */
export function initRmImport(): void {
  const folder = document.getElementById("rm-import-folder") as HTMLInputElement | null;
  if (folder) folder.addEventListener("change", (e: any) => {
    const files = Array.from(e.target.files || []) as File[];
    e.target.value = "";
    if (files.length) void importFromSource(async () => fileListSource(files));
  });
  const zip = document.getElementById("rm-import-zip") as HTMLInputElement | null;
  if (zip) zip.addEventListener("change", (e: any) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) void importFromSource(async () => openZipSource(new Uint8Array(await f.arrayBuffer())));
  });
}
