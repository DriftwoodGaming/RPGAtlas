/* RPGAtlas — src/shared/folder-sync.ts
   Pure decision cores for desktop folder saving (Project Harbor, Phase H3). Two
   questions the editor must answer without touching the DOM (vitest runs env=node —
   trap 3):

   1. On boot/open of a folder game, is the localStorage mirror *newer* than the
      folder file (crash evidence), so we should offer to recover it? — decideRecovery.
   2. On window focus, did game.rpgatlas change on disk outside the editor, and do we
      have unsaved edits — so do we offer a plain reload, a reload-or-keep-mine
      choice, or nothing? — decideExternalChange.

   Both are string-in / verdict-out; the localStorage / native I/O and the friendly
   dialogs live in the editor (persistence.ts / manager.ts). The mirror is the same
   `rpgatlas_project` key the same-origin playtest bridge reads, so it is never removed
   — only demoted to a crash-recovery copy. docs/harbor-3-spec.md §2, §3.
   GPL-3.0-or-later (see LICENSE). */

/** localStorage key for the mirror's bookkeeping (a sibling of `rpgatlas_project`,
 *  which stays the untouched mirror + playtest-bridge payload). */
export const MIRROR_META_KEY = "atlas.mirror.meta";

/** What we remember about the last localStorage-mirror write, so a crash between the
 *  mirror write and the folder write is detectable on the next boot. `folderConfirmed`
 *  flips true once the matching `project_save` resolves (or is skipped because the
 *  folder already holds that content); it stays false if the process was killed first. */
export interface MirrorMeta {
  /** The project folder root this mirror belongs to (guards against recovering one
   *  game's mirror into a different game). */
  root: string;
  /** Epoch ms of the mirror write. */
  savedAt: number;
  /** True once the folder file is known to hold this (or newer) content. */
  folderConfirmed: boolean;
}

/** Parse a stored MirrorMeta string; anything malformed → null (never throw — a bad
 *  marker must degrade to "no crash evidence", same posture as a corrupt index). */
export function parseMirrorMeta(raw: string | null): MirrorMeta | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (
    typeof m.root !== "string" ||
    typeof m.savedAt !== "number" ||
    typeof m.folderConfirmed !== "boolean"
  ) {
    return null;
  }
  return { root: m.root, savedAt: m.savedAt, folderConfirmed: m.folderConfirmed };
}

/** Serialize a MirrorMeta for localStorage. */
export function stringifyMirrorMeta(meta: MirrorMeta): string {
  return JSON.stringify(meta);
}

export interface RecoveryInputs {
  /** The folder root being opened. */
  root: string;
  /** The exact bytes just read from `<root>/game.rpgatlas`. */
  folderDoc: string;
  /** The localStorage mirror (`rpgatlas_project`) contents, or null if absent. */
  mirrorDoc: string | null;
  /** The parsed mirror bookkeeping, or null if absent/corrupt. */
  mirrorMeta: MirrorMeta | null;
}

/** `use-folder` = boot the on-disk document (the normal case). `offer-mirror` = the
 *  mirror holds changes the folder never confirmed (crash evidence); offer to recover. */
export type RecoveryDecision = "use-folder" | "offer-mirror";

/** Decide whether the localStorage mirror is unsaved-crash evidence for THIS folder.
 *  Offer recovery only when every guard says the mirror is genuinely ahead of disk:
 *  a mirror exists, it belongs to this exact folder, it differs from the file, and the
 *  matching folder save was never confirmed. A confirmed (or same-content, or
 *  different-game, or absent) mirror is never offered — so an external edit made while
 *  the editor was closed is respected, not clobbered by a stale mirror. */
export function decideRecovery(i: RecoveryInputs): RecoveryDecision {
  if (i.mirrorDoc == null) return "use-folder";
  if (i.mirrorMeta == null) return "use-folder";
  if (i.mirrorMeta.root !== i.root) return "use-folder";
  if (i.mirrorDoc === i.folderDoc) return "use-folder";
  if (i.mirrorMeta.folderConfirmed) return "use-folder";
  return "offer-mirror";
}

export interface ExternalChangeInputs {
  /** The bytes currently in `<root>/game.rpgatlas` (a fresh read). */
  diskDoc: string;
  /** The bytes we last wrote to (or opened from) disk — our record of the file. Both
   *  sides are *file bytes* (we write `JSON.stringify(proj)` and read it back), so this
   *  comparison is exact and immune to load-time normalization — unlike diffing the raw
   *  file against a re-serialized in-memory project, which would misfire on a clean open. */
  lastSavedDoc: string;
  /** Whether the editor has edits not yet persisted to the folder (the `folderDirty`
   *  flag). Using the edit flag — not a content diff — keeps "do we have unsaved changes?"
   *  precise across load-time normalization. */
  hasLocalEdits: boolean;
}

/** `none` = the file is what we last wrote; do nothing. `reload` = the file changed on
 *  disk and we have no unsaved edits, so a plain reload is safe. `conflict` = the file
 *  changed AND we have unsaved edits, so offer reload-theirs-or-keep-mine. */
export type ExternalChange = "none" | "reload" | "conflict";

/** Classify an on-focus disk re-read against our baseline + dirty flag. */
export function decideExternalChange(i: ExternalChangeInputs): ExternalChange {
  if (i.diskDoc === i.lastSavedDoc) return "none";
  return i.hasLocalEdits ? "conflict" : "reload";
}
