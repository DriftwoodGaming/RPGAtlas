/* RPGAtlas — src/shared/folder-migration.ts
   The pure decision core for the legacy → folder migration (Project Harbor, Phase
   H6·A). Before Harbor, a desktop game lived only in the localStorage mirror
   (`rpgatlas_project`) — no folder on disk. After Harbor the desktop app boots to the
   Project Manager, so that old game is now behind the launcher; H6·A offers a one-click
   "let's put your game in a folder" wizard so the old path never strands anyone.

   The signal that a game needs migrating: a mirror exists but there is NO folder
   bookkeeping (`atlas.mirror.meta`). A folder game always writes that meta on save
   (persistence.ts, H3·A), so "mirror present && meta absent" uniquely identifies a
   pre-Harbor localStorage-only game. Once migrated + booted, the folder game writes
   meta, so the signal clears — the offer is self-extinguishing (idempotent).

   Pure (vitest runs env=node — trap 3): no window / DOM / schema import. The
   `isProjectLike` predicate is injected so this stays a plain string-in / plan-out
   function; the localStorage reads and the friendly wizard UI live in manager.ts.
   docs/harbor-6-spec.md §1. GPL-3.0-or-later (see LICENSE). */

/** A migration plan: the folder name to prefill (from the game's title) and the exact
 *  document bytes to scaffold the folder from (the mirror verbatim — blob-free, since
 *  pre-Harbor desktop assets were referenced from the global library, which the H4
 *  bridge copies into the new folder on boot). */
export interface FolderMigrationPlan {
  /** Prefilled game name for the wizard (the sanitizer turns it into the folder leaf). */
  title: string;
  /** The stored document, handed straight to project_create as the new game.rpgatlas. */
  documentJson: string;
}

/** The default game name when a legacy document carries no usable title. */
export const DEFAULT_MIGRATION_TITLE = "My Game";

/** Decide whether the desktop launcher should offer to move a pre-Harbor localStorage
 *  game into a folder, and if so with what name + document. Returns null when there is
 *  nothing to migrate: no mirror, a mirror that already belongs to a folder game (meta
 *  present), or a mirror that isn't a recognizable project (junk / cleared storage).
 *
 *  `isProjectLike` is injected (src/shared/schema.ts on the real path) so this core has
 *  no DOM/schema dependency and stays env=node testable. */
export function planFolderMigration(
  mirror: string | null,
  hasMeta: boolean,
  isProjectLike: (value: unknown) => boolean,
): FolderMigrationPlan | null {
  if (mirror == null || hasMeta) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(mirror);
  } catch {
    return null;
  }
  if (!isProjectLike(doc)) return null;
  return { title: migrationTitle(doc), documentJson: mirror };
}

/** The game name to prefill from a stored document — its `system.title`, trimmed, with a
 *  friendly fallback so the wizard's name field is never blank. */
export function migrationTitle(doc: unknown): string {
  const system = doc && typeof doc === "object" ? (doc as { system?: unknown }).system : null;
  const title =
    system && typeof system === "object" && typeof (system as { title?: unknown }).title === "string"
      ? (system as { title: string }).title.trim()
      : "";
  return title || DEFAULT_MIGRATION_TITLE;
}
