/* RPGAtlas — src/editor/help.ts
   The Help menu dialogs: interface-language settings, patch notes, quick help,
   keyboard shortcuts, and About. Also owns refreshLocalizedChrome (re-localise
   the menubar/toolbar/status after a language change).
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts. ACT / build* /
   refreshToolbar come from workspace.ts; the function-only import cycle between
   the two modules is safe (these dialogs only run on user action).
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { PATCH_NOTES } from "../../js/patch-notes.js?v=46";
import { editorI18n } from "./editor-state";
import { $, h, field } from "./dom";
import { modal } from "./modals";
import { setStatus } from "./map-editor/status";
import { ACT, actionLabel, buildMenubar, buildToolbar, refreshToolbar } from "./workspace";

const t = editorI18n.t;

export function refreshLocalizedChrome() {
  editorI18n.localizeStatic();
  buildMenubar();
  buildToolbar();
  refreshToolbar();
  setStatus();
  const saveIndicator = $("save-ind");
  if (saveIndicator.textContent.startsWith("●")) saveIndicator.textContent = "● " + t("unsaved");
  else if (saveIndicator.textContent.startsWith("⚠")) saveIndicator.textContent = "⚠ " + t("save failed");
  else saveIndicator.textContent = "✓ " + t("saved");
}
// Editor UI font scale (Phase 7 Stage B): a device setting like the locale.
// Chromium (the browser target and the Tauri shell) scales the whole px-based
// chrome cleanly via zoom; unsupported engines simply ignore the property.
export const EDITOR_FONT_SCALE_KEY = "rpgatlas_editor_font_scale";
const FONT_SCALE_CHOICES: Array<[string, number]> = [
  ["90%", 0.9], ["100%", 1], ["110%", 1.1], ["125%", 1.25],
];
export function editorFontScale(): number {
  try {
    const v = Number(localStorage.getItem(EDITOR_FONT_SCALE_KEY));
    return FONT_SCALE_CHOICES.some(([, s]) => s === v) ? v : 1;
  } catch { return 1; }
}
export function applyEditorFontScale(scale?: number) {
  const v = scale == null ? editorFontScale() : scale;
  (document.documentElement.style as any).zoom = v === 1 ? "" : String(v);
}
export function openLanguageSettings() {
  let selectedLocale = editorI18n.locale;
  let selectedScale = editorFontScale();
  const languageSelect = h("select", {
    onchange(e: any) { selectedLocale = e.target.value; },
  }, ...editorI18n.locales().map((locale: any) =>
    h("option", { value: locale.id, ...(locale.id === selectedLocale ? { selected: "" } : {}) }, locale.label)));
  const scaleSelect = h("select", {
    onchange(e: any) { selectedScale = Number(e.target.value); },
  }, ...FONT_SCALE_CHOICES.map(([label, scale]) =>
    h("option", { value: String(scale), ...(scale === selectedScale ? { selected: "" } : {}) }, label)));
  modal({
    title: "Interface Language",
    content: h("div", null,
      h("p", null, t("Choose the language used by the editor. Project content is not translated.")),
      field("Language", languageSelect),
      field(t("UI Font Size"), scaleSelect)),
    buttons: [
      { label: "Apply", primary: true, onClick(close: any) {
        editorI18n.setLocale(selectedLocale);
        try { localStorage.setItem(EDITOR_FONT_SCALE_KEY, String(selectedScale)); } catch { /* device setting only */ }
        applyEditorFontScale(selectedScale);
        close();
        refreshLocalizedChrome();
      } },
      { label: "Cancel" },
    ],
  });
}
export function openPatchNotes() {
  const list = h("div", { class: "patch-notes" });
  PATCH_NOTES.forEach((note: any) => {
    const items = h("ul");
    (note.items || []).forEach((item: any) => items.appendChild(h("li", null, item)));
    list.appendChild(h("article", { class: "patch-note" },
      h("div", { class: "patch-note-head" },
        h("h3", null, note.title),
        h("time", null, note.date)),
      h("p", null, note.summary),
      items));
  });
  modal({
    title: "RPGAtlas - Patch Notes",
    wide: true,
    content: list,
    buttons: [{ label: "Close", primary: true }],
  });
}
export function openHelp() {
  modal({
    title: "RPGAtlas — Quick Help",
    wide: true,
    content: h("div", { class: "helpbox", html: `
<h3>Drawing maps</h3>
<ul>
<li><b>Tools</b>: Pen <kbd>Q</kbd>, Eraser <kbd>W</kbd>, Rectangle <kbd>E</kbd>, Circle <kbd>R</kbd>, Fill <kbd>T</kbd>, Shadow Pen <kbd>Y</kbd>. Right-click = pick tile from the map.</li>
<li><b>Layers</b>: Auto <kbd>&#96;</kbd> places terrain on Layer 1 and stacks decorations on Layers 2–3 automatically. <kbd>1</kbd>–<kbd>4</kbd> select Ground / Decor / Decor&nbsp;2 / Overhead directly (Overhead draws above the player).</li>
<li><b>Shadow Pen</b>: left-click paints a half-tile shadow quadrant, right-click erases it.</li>
<li><b>Modes</b>: press <kbd>Tab</kbd> (<kbd>Shift</kbd>+<kbd>Tab</kbd> reverse) to cycle Map → Event → Passability → Height. <b>Height Mode</b>: paint HD-2D elevation with Pen / Rectangle / Circle / Fill. Keys <kbd>0</kbd>–<kbd>9</kbd> set the value, right-click picks it up, Eraser clears. Raised tiles become 3D blocks when the map's HD-2D rendering is on.</li>
<li><b>HD-2D</b>: enable per map in Game ▸ Map Properties (camera tilt, bloom, depth of field, fog, point lights). Press <kbd>F2</kbd> for the live <b>HD-2D Viewport</b> — a dockable panel that renders the map and follows your edits (drag to pan, wheel to zoom, Shift-drag to tilt). Double-click it to drop a point light and drag the gizmo to place it; lights can also be events named “light #rrggbb radius”.</li>
<li><b>Selection</b>: Shift+drag selects an area. Cut <kbd>Ctrl+X</kbd> / Copy <kbd>Ctrl+C</kbd> / Paste <kbd>Ctrl+V</kbd>, then click to stamp (Esc cancels). Works for events too.</li>
<li>Undo <kbd>Ctrl+Z</kbd> · Redo <kbd>Ctrl+Y</kbd> · Zoom <kbd>+</kbd>/<kbd>−</kbd>, <kbd>Ctrl</kbd>+wheel, <kbd>Ctrl+0</kbd> = 100%. Press <kbd>?</kbd> for the full keyboard shortcut list.</li>
</ul>
<h3>Passability</h3>
<ul>
<li>By default the topmost decoration tile decides (○ passable / ✕ blocked); otherwise the ground tile.</li>
<li>In <b>Passability mode</b> click a tile to cycle: auto → force ✕ → force ○. Overridden tiles get a yellow corner badge.</li>
</ul>
<h3>Events</h3>
<ul>
<li>In <b>Event mode</b> double-click a cell to create/edit an event; drag to move; <kbd>Del</kbd> deletes. <b>Right-click</b> for a menu: New Event, <b>Quick Events</b> (Transfer / Sign / Chest), Cut/Copy/Paste, and Set Start Position Here. Each event has <b>pages</b> — the last page whose conditions hold is active.</li>
<li>Triggers: Action button (Z), Player touch, Autorun (blocks play), Parallel (background). Use Self-Switches for chest-like one-time events.</li>
<li><b>Event Searcher</b> (Tools menu) finds text, names, or switch/variable usage across all maps.</li>
</ul>
<h3>Tools</h3>
<ul>
<li><b>Database</b>: actors, classes, skills, items, equipment, enemies, troops, common events, states, types, switches, variables, system.</li>
<li><b>System tab</b>: screen size, UI area, screen scale, fonts &amp; font size, window opacity, system sounds &amp; music, side-view or front-view battles, start-transparent player.</li>
<li><b>States</b>: poison / stun / regen-style battle effects, inflicted or cured by skills.</li>
<li><b>Plugin Manager</b>: project-embedded JavaScript that runs at game boot, with map-load and per-frame hooks.</li>
<li><b>Character Generator</b>: build original walking sprites; they appear in every sprite picker.</li>
<li><b>Resource Manager</b>: browse every generated tile/character/battler and export PNGs.</li>
<li><b>Custom assets</b>: copy images into the shared <code>img/characters</code>, <code>facesets</code>, <code>enemies</code>, or <code>tilesets</code> folders, then reload the editor.</li>
</ul>
<h3>Coming from RPG Maker MZ / MV?</h3>
<ul>
<li><b>File ▸ Import from RPG Maker…</b> brings your own MV or MZ game in. Pick the game's project folder (the one with a <code>data</code> folder inside), or a <code>.zip</code> of it.</li>
<li>Maps, the database (heroes, skills, items, enemies, battle groups), switches/variables, common events, and event pages all come across. Anything that can't convert yet is <b>kept, never dropped</b> — it shows up as a friendly “coming in a later update” note.</li>
<li>When the import finishes you get a plain-language <b>report</b> of what came along, what changed, and what to do next. Reopen it any time from <b>File ▸ Import Report</b>.</li>
<li>Only your <b>own</b> project is supported — encrypted artwork is unlocked with the project's own key. To see your tile artwork, bring your tileset images in with the Asset Browser and Import Autotile Sheet.</li>
</ul>
<h3>Playtesting & saving</h3>
<ul>
<li><b>▶ Playtest</b> opens the player. In game: Arrows/WASD move, Shift dashes, Z/Enter confirms, X/Esc menu/cancel.</li>
<li>Your project autosaves to this browser (<kbd>Ctrl+S</kbd> forces it). Use File ▸ Export for a .json backup; Open to load one.</li>
<li><b>Export Standalone Game</b> creates a Windows .exe or cross-platform .html that runs without the editor or engine folder.</li>
</ul>
<h3>Console (for power users)</h3>
<ul>
<li>The <b>Console</b> tab (next to Map; View ▸ Console Panel if closed) is a command line over the engine — entirely optional, everything it does also has a menu.</li>
<li>Type <code>help</code> for the full list. Highlights: <code>validate</code> finds broken references, <code>stats</code> sizes up the project, <code>find</code> searches everything with clickable results, <code>build web</code> exports without dialogs.</li>
<li>While a playtest runs: <code>give potion 3</code>, <code>switch 5 on</code>, <code>var 2 100</code>, <code>goto 3 10 8</code> act on the live game. <code>playtest 2 5 7</code> starts straight on map 2 at (5,7), skipping the title screen.</li>
<li>Scripts and tools can drive it too: <code>window.AtlasConsole.run("stats --json")</code> — the foundation for future AI assistance.</li>
</ul>
<h3>License</h3>
<p>RPGAtlas is free and open source software under the <b>GNU GPLv3</b>. The content you create — maps, story, database, characters — is yours. Exported games bundle the engine runtime, which stays under the GPL (its readable source ships inside every export).</p>
` }),
  });
}
export function openKeyboardShortcuts() {
  const box = h("div", { class: "helpbox" });
  const kbd = (s: any) => h("kbd", null, s);
  const keys = (...labels: any[]) => {
    const out: any[] = [];
    labels.forEach((l, i) => { if (i) out.push(" / "); out.push(kbd(l)); });
    return out;
  };
  const line = (chips: any, desc: any) => h("li", null, ...chips, h("span", { class: "cl-desc" }, " — " + desc));
  const aKey = (id: any) => ACT[id].key;
  const aLabel = (id: any) => actionLabel(ACT[id]);
  const section = (title: any, rows: any) => {
    box.appendChild(h("h3", null, title));
    const ul = h("ul", { class: "code-legend-list" });
    rows.forEach((r: any) => ul.appendChild(r));
    box.appendChild(ul);
  };

  const toolIds = ["tool-pen", "tool-erase", "tool-rect", "tool-circle", "tool-fill", "tool-shadow"];
  const layerIds = ["layer-auto", "layer-ground", "layer-decor", "layer-decor2", "layer-over"];

  section("Modes", [
    line(keys("Tab"), "next mode  (Map → Event → Passability → Height, wraps)"),
    line(keys("Shift", "Tab"), "previous mode"),
    h("li", { class: "dim" }, "Set Start Position is reached from the Mode menu, not the Tab cycle."),
  ]);
  section("Tools  (Map or Height mode)", toolIds.map((id) => line(keys(aKey(id)), aLabel(id))));
  section("Layers  (Map mode)", layerIds.map((id) => line(keys(aKey(id)), aLabel(id))));
  section("Height mode", [line(keys("0–9"), "set the painted elevation value")]);
  section("Edit & file", [
    ...["undo", "redo", "cut", "copy", "paste", "save"].map((id) => line(keys(aKey(id)), aLabel(id))),
    h("li", { class: "dim" }, "Undo spans map painting, events, Map Properties, and Database edits — one history. Ctrl+Z / Ctrl+Y also work inside the Database and Map Properties dialogs (text boxes keep the browser's own text undo while typing)."),
  ]);
  section("View", [
    line(keys("+", "−"), "zoom in / out  (Ctrl + wheel also zooms)"),
    line(keys(aKey("zoom1")), "zoom to 100%"),
  ]);
  section("Application", ["db", "hdpreview", "play", "cmdpal"].map((id) => line(keys(aKey(id)), aLabel(id))));
  section("Advanced Map Editor", [
    line(keys(aKey("panel-advanced")), aLabel("panel-advanced")),
    ...["adv-flip-h", "adv-flip-v", "adv-rotate"].map((id) => line(keys(aKey(id)), aLabel(id))),
    h("li", { class: "dim" }, "The Advanced toolstrip has the same Shadow Pen 🌑 as the Standard editor: left-click paints a half-tile shadow quadrant, right-click erases it."),
    h("li", { class: "dim" }, "The brush transform keys work while the Advanced panel is focused; everything else (Terrain Studio, stamps, zones, Automap rules) lives on the Advanced menu and the command palette."),
  ]);
  section("Selection & events", [
    line(keys("Shift", "drag"), "select an area of tiles"),
    line(keys("Del"), "delete the selected event (Event mode)"),
    line(keys("Esc"), "clear selection / cancel paste / deselect"),
  ]);
  box.appendChild(h("div", { class: "dim", style: "margin-top:10px;font-size:12px" },
    "Tool and layer keys do nothing outside their mode — switch with Tab first. Toolbar and menu clicks switch mode automatically. F1 and F5 take over the browser's Help and Reload while the editor is focused."));

  modal({ title: "Keyboard Shortcuts", wide: true, content: box, dialogKeys: true });
}
export function openAbout() {
  modal({
    title: "About RPGAtlas",
    content: h("div", { class: "helpbox", html: `
<div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
  <img src="img/system/rpgatlas-logo.svg" alt="" width="56" height="56">
  <div>
    <div style="font-size:20px;font-weight:800">RPG<span style="font-weight:300">Atlas</span> <span style="font-weight:400;font-size:14px;color:#ffd86a">1.0.0</span></div>
    <div class="dim">Chart your world. Tell your story.</div>
  </div>
</div>
<p><b>RPGAtlas</b> — a free and open source RPG maker that runs entirely in your browser.</p>
<ul>
<li>No build step or dependencies — built-in art and audio are generated procedurally, with optional shared custom images from the <code>img</code> folder.</li>
<li>Free software under the <b>GNU GPLv3</b> — use it, study it, share it, improve it.</li>
<li>Your game's content (maps, story, data, art) is yours — sell it, remix it, no credit required. Exported games include the engine runtime, which remains GPL-licensed.</li>
</ul>
<p class="dim">Editor: index.html · Player: play.html · Data: one portable .json project file.</p>
` }),
  });
}
