/* RPGAtlas — src/editor/project-manager/pending-open.ts
   The "open this game on the next fresh load" handoff (Project Harbor). Opening a
   different game while one is already booted — via File ▸ New/Open (H2·C), or the
   H3·B "reload the newer version" choice — reboots cleanly by stashing the target
   root in sessionStorage and reloading, rather than re-running boot() in place
   (boot binds many one-time listeners, so a second in-place boot would double-bind).
   sessionStorage survives location.reload() in the same tab.

   Extracted from manager.ts so persistence.ts can request a clean reboot for external-
   change recovery without importing the manager (which would form an import cycle:
   manager → persistence → manager). docs/harbor-3-spec.md §3. GPL-3.0-or-later. */

const PENDING_KEY = "atlas.pendingOpen";

/** Queue a game to open on the next fresh load. */
export function setPendingOpen(root: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, root);
  } catch {
    /* sessionStorage may be unavailable; the caller degrades to the launcher */
  }
}

/** Read-and-clear the queued game (consumed once by launchManager on a fresh load). */
export function takePendingOpen(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_KEY);
    if (v != null) sessionStorage.removeItem(PENDING_KEY);
    return v;
  } catch {
    return null;
  }
}
