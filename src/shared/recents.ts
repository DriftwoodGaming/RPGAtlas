/* RPGAtlas — src/shared/recents.ts
   Recent-projects registry logic (Project Harbor, Phase H1·C). The on-disk file is
   <app-config>/projects.json (a JSON array of {name, path, lastOpened}); Rust stores
   canonicalized absolute paths, so equality here is exact string comparison. These
   rules are implemented identically in the Rust commands and this core — the spec is
   the single source of truth. Pure, env=node (trap 3). docs/harbor-1-spec.md §5.2.
   GPL-3.0-or-later (see LICENSE). */

/** One recent-project entry. `lastOpened` is epoch milliseconds. */
export interface Recent {
  name: string;
  path: string;
  lastOpened: number;
}

/** A recent tagged with whether its folder still exists (display-time, H2). */
export interface AnnotatedRecent extends Recent {
  missing: boolean;
}

/** Maximum entries kept (newest-first). */
export const RECENTS_CAP = 12;

/** Upsert `entry` to the front: drop any existing entry with the same `path`,
 *  unshift, truncate to RECENTS_CAP. Result is newest-first. */
export function touchRecent(list: Recent[], entry: Recent): Recent[] {
  const rest = list.filter((e) => e.path !== entry.path);
  return [entry, ...rest].slice(0, RECENTS_CAP);
}

/** Drop the entry with exactly `path`. */
export function removeRecent(list: Recent[], path: string): Recent[] {
  return list.filter((e) => e.path !== path);
}

/** Tag each entry `{ ...entry, missing: !exists(path) }`, preserving order.
 *  Pruning is display-time only — a vanished folder is SHOWN as a "can't find this
 *  game anymore" row (MISSING copy), never silently dropped or auto-deleted. The
 *  user removes it explicitly via the row's control (removeRecent). */
export function annotateRecents(
  list: Recent[],
  exists: (path: string) => boolean,
): AnnotatedRecent[] {
  return list.map((e) => ({ ...e, missing: !exists(e.path) }));
}

/** Parse the raw recents_list JSON string into a validated Recent[]. A corrupt or
 *  non-array payload degrades to [] (never brick — same posture as the library
 *  index); entries missing required fields are dropped. */
export function parseRecents(json: string): Recent[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter(isRecent);
}

function isRecent(x: unknown): x is Recent {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.name === "string" &&
    typeof e.path === "string" &&
    typeof e.lastOpened === "number"
  );
}
