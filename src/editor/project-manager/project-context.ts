/* RPGAtlas — src/editor/project-manager/project-context.ts
   The currently-open project's identity (Project Harbor, Phase H2). Holds the
   folder root + display name of the game the editor is booted on, drives the
   window title ("<Game Name> — RPGAtlas"), and records whether the editor has
   finished booting (H2·C uses that to decide whether File ▸ New/Open reboots via
   the manager or boots in place). Deliberately dependency-light — imported by
   boot.ts — with no editor/DOM-heavy imports and nothing pulling it back into a
   cycle. H3 will read the root to rebind autosave to the folder.
   docs/harbor-2-spec.md §1, §3. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The open game's on-disk identity. `name` is the human display name (the
 *  document's `system.title`), `root` is the canonical project folder. */
export interface OpenProjectContext {
  root: string;
  name: string;
}

let current: OpenProjectContext | null = null;
let booted = false;

/** The game the editor is currently booted on, or null (browser / not chosen). */
export function openProjectContext(): OpenProjectContext | null {
  return current;
}

/** True once `bootWithProject` has finished (the editor is interactive). */
export function isEditorBooted(): boolean {
  return booted;
}

/** Called by boot.ts at the true end of boot. */
export function markEditorBooted(): void {
  booted = true;
}

/** Record (or clear) the open project and update the window title. */
export function setOpenProjectContext(ctx: OpenProjectContext | null): void {
  current = ctx;
  applyWindowTitle(ctx ? ctx.name : null);
}

/** Window title = "<Game Name> — RPGAtlas". Sets `document.title` (what the
 *  browser specs assert) and best-effort the native window title on desktop — a
 *  missing set-title permission or API must never throw. */
function applyWindowTitle(name: string | null): void {
  const title = name ? `${name} — RPGAtlas` : "RPGAtlas — Editor";
  try {
    document.title = title;
  } catch {
    /* document may be unavailable in odd embeds */
  }
  try {
    const w: any = (window as any).__TAURI__ && (window as any).__TAURI__.window;
    const cur =
      w && typeof w.getCurrentWindow === "function"
        ? w.getCurrentWindow()
        : w && typeof w.getCurrent === "function"
          ? w.getCurrent()
          : null;
    if (cur && typeof cur.setTitle === "function") void cur.setTitle(title);
  } catch {
    /* best-effort: no native title without the permission (added for H6) */
  }
}
