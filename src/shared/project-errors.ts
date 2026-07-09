/* RPGAtlas — src/shared/project-errors.ts
   Kid-friendly error copy for the project-folder surface (Project Harbor, Phase
   H1·C). The typed host maps a Rust `code` → the copy below; the child never sees a
   raw OS message. The table is i18n-ready (a single map the future locale layer can
   translate). Pure, env=node (trap 3). Copy is FINAL — docs/harbor-1-spec.md §6.
   GPL-3.0-or-later (see LICENSE). */

/** The finite command-failure taxonomy (matches the Rust `ProjectErrorCode`). */
export type ProjectErrorCode =
  | "FOLDER_EXISTS"
  | "NO_PERMISSION"
  | "DISK_FULL"
  | "MISSING"
  | "NOT_A_PROJECT"
  | "UNSAFE_PATH"
  | "SECOND_INSTANCE"
  | "IO";

/** A title + body pair shown to the user (kid-friendly, no jargon). */
export interface ErrorCopy {
  title: string;
  body: string;
}

const COPY: Record<ProjectErrorCode, ErrorCopy> = {
  FOLDER_EXISTS: {
    title: "You already have a game with that name here",
    body: "Pick a different name, or open the game that's already in this folder.",
  },
  NO_PERMISSION: {
    title: "RPGAtlas can't save here",
    body: "This folder is locked. Try making your game inside your Documents folder instead.",
  },
  DISK_FULL: {
    title: "Your disk is full",
    body: "There's no room to save your game right now. Free up some space and try again — your work is still open.",
  },
  MISSING: {
    title: "We can't find this game anymore",
    body: "Its folder may have been moved, renamed, or deleted. If you find it again, use Open to bring it back.",
  },
  NOT_A_PROJECT: {
    title: "That folder isn't an RPGAtlas game",
    body: "There's no game.rpgatlas inside it. Pick the folder that holds your game.",
  },
  UNSAFE_PATH: {
    title: "That file's location wasn't safe",
    body: "RPGAtlas didn't touch it, just to be careful.",
  },
  SECOND_INSTANCE: {
    title: "RPGAtlas is already open",
    body: "We brought it to the front for you.",
  },
  IO: {
    title: "Something went wrong saving your game",
    body: "Please try again. If it keeps happening, copy your game folder somewhere safe.",
  },
};

/** Resolve a taxonomy code to its copy. An unknown code falls back to IO (the
 *  catch-all), so a UI render can never blow up on a stray code. */
export function projectErrorCopy(code: ProjectErrorCode): ErrorCopy {
  return COPY[code] ?? COPY.IO;
}

/** Gate amendment 4: the `MISSING_ASSET` copy is declared FINAL in §6 but is a
 *  per-asset STATE, not a command-error code (so it is kept out of the union
 *  above). It lives here — tested now — so H4 renders §6's final copy from tested
 *  code rather than re-authoring it. Shown inline in the Asset Browser (H4). */
export const MISSING_ASSET_COPY: ErrorCopy = {
  title: "A picture or sound is missing",
  body: "Put the file back in your assets folder to bring it home. Your game is safe in the meantime.",
};
