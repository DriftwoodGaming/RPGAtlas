/* RPGAtlas — tests-unit/i18n-parity.test.ts
   Phase 7 Stage C: the i18n anti-rot gate. Computes the editor-chrome key set
   from the real sources — index.html data-i18n attributes, every command
   `label:` registered in workspace.ts / dock/panels.ts, the tool/layer label
   tables, plus a curated list of status templates and dialog strings — and
   asserts every locale defines exactly that set: no missing keys (a new
   command shipped without translations) and no orphans (a renamed key left
   rotting in a dictionary). GPL-3.0-or-later. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITOR_LOCALE_MESSAGES } from "../js/editor/i18n.js";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Keys used through t() that no source regex can find mechanically:
 *  status templates, the language dialog, and status fragments. New chrome
 *  strings added via t() belong here (the test fails loudly otherwise). */
const CURATED_KEYS = [
  "Event mode (double-click = new/edit, drag = move, right-click = menu)",
  "Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)",
  "Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)",
  "Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)",
  "Click the map to set the start position",
  "selection", "brush", "passable", "blocked", "override",
  "saved", "unsaved", "save failed",
  "Interface Language", "Language", "UI Font Size",
  "Choose the language used by the editor. Project content is not translated.",
  "Apply", "Close", "Cancel", "Confirm", "OK", "Save", "Delete",
];

/** Command labels that are dynamic composites or deliberately English-only
 *  (plugin-manager status chips are diagnostics, not chrome). */
const LABEL_EXCLUDES = new Set(["duplicate id", "missing id", "missing dep"]);

function requiredKeys(): Set<string> {
  const keys = new Set<string>(CURATED_KEYS);
  // 1. Static chrome: index.html data-i18n / data-i18n-title attributes.
  for (const m of read("index.html").matchAll(/data-i18n(?:-title)?="([^"]+)"/g)) {
    keys.add(m[1]);
  }
  // 2. Registered commands + menu names (localized via actionLabel()/t()).
  for (const file of ["src/editor/workspace.ts", "src/editor/dock/panels.ts"]) {
    for (const m of read(file).matchAll(/label: "([^"]+)"/g)) {
      if (!LABEL_EXCLUDES.has(m[1])) keys.add(m[1]);
    }
  }
  // 2b. Dock panel tab captions (localized via panelTitle()).
  for (const m of read("src/editor/dock/panels.ts").matchAll(/registerDockPanel\(\{ id: [^,]+, title: "([^"]+)"/g)) {
    keys.add(m[1]);
  }
  // 3. Tool/layer label tables (menu items + status line fragments).
  // editor-state.ts is window-bound (reads RPGAtlasDeps at import), so pull
  // the two constant tables out of the source text.
  const editorState = read("src/editor/editor-state.ts");
  const tables = editorState.match(/(?:LAYER|TOOL)_LABELS[^=]*= \{[^}]+\}/g) || [];
  expect(tables.length).toBe(2);
  for (const table of tables) {
    for (const m of table.matchAll(/: "([^"]+)"/g)) keys.add(m[1]);
  }
  return keys;
}

describe("editor i18n dictionaries", () => {
  const required = requiredKeys();
  const locales = Object.entries(EDITOR_LOCALE_MESSAGES) as Array<
    [string, { label: string; messages: Record<string, string> }]
  >;

  it("collects a plausible chrome key set from the sources", () => {
    // Sanity floor so a broken regex can't silently pass an empty set.
    expect(required.size).toBeGreaterThan(80);
  });

  for (const [id, pack] of locales) {
    it(`${id}: defines every chrome key (no missing translations)`, () => {
      const missing = [...required].filter(
        (k) => !Object.prototype.hasOwnProperty.call(pack.messages, k),
      );
      expect(missing).toEqual([]);
    });
    it(`${id}: carries no orphaned keys (no stale dictionary entries)`, () => {
      const orphans = Object.keys(pack.messages).filter((k) => !required.has(k));
      expect(orphans).toEqual([]);
    });
    it(`${id}: no empty or identity placeholder values in template keys`, () => {
      for (const [k, v] of Object.entries(pack.messages) as Array<[string, string]>) {
        expect(v, `${id} → ${k}`).toBeTruthy();
        // Template keys must keep their {placeholders} intact.
        for (const ph of k.match(/\{\w+\}/g) || []) {
          expect(v).toContain(ph);
        }
      }
    });
  }
});
