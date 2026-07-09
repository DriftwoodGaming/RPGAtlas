/* RPGAtlas — src/shared/project-name.ts
   Project-name → folder-leaf sanitizer (Project Harbor, Phase H1·C). Turns the
   game's display name (which keeps the child's original text) into a cross-platform
   -safe folder name. Pure, no window/DOM — vitest runs env=node (trap 3). Normative
   rules: docs/harbor-1-spec.md §5.1. GPL-3.0-or-later (see LICENSE). */

/** Windows reserved device names (CON/PRN/AUX/NUL/COM1-9/LPT1-9), case-insensitive,
 *  with or without an extension (`CON.txt` is still reserved). */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Folder leaf used when a name sanitizes down to nothing. */
export const FALLBACK_FOLDER_NAME = "Untitled Game";

/** Max folder-leaf length (characters). */
export const MAX_FOLDER_NAME = 80;

/** Drop control characters (U+0000–U+001F and U+007F). Done by codepoint rather
 *  than a control-char regex so the source stays clean ASCII (no literal control
 *  bytes / no-control-regex lint). */
function stripControlChars(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x1f || c === 0x7f) continue;
    out += ch;
  }
  return out;
}

/**
 * Produce a cross-platform-safe folder leaf from a raw game name. The game's
 * *display* name (system.title, recents, window title) keeps the child's original
 * trimmed text; only the folder leaf is sanitized. Casing is preserved (RM/Godot
 * keep it). Collisions are NOT the sanitizer's concern — two same-named games in one
 * parent surface as FOLDER_EXISTS, so the child stays in control of the name.
 */
export function sanitizeFolderName(raw: string): string {
  // 1. Unicode-normalize (NFC) + trim surrounding whitespace.
  let s = (raw ?? "").normalize("NFC").trim();
  // 2. Strip control characters.
  s = stripControlChars(s);
  // 3. Replace each Windows-reserved character with a single space.
  s = s.replace(/[<>:"/\\|?*]/g, " ");
  // 4. Collapse internal whitespace runs to one space; trim again.
  s = s.replace(/\s+/g, " ").trim();
  // 5. Strip trailing dots and spaces (illegal as a Windows folder-name ending).
  s = s.replace(/[ .]+$/g, "");
  // 6. Truncate to MAX, then re-strip any trailing dot/space exposed by truncation.
  if (s.length > MAX_FOLDER_NAME) {
    s = s.slice(0, MAX_FOLDER_NAME).replace(/[ .]+$/g, "");
  }
  // 7. Empty → fallback.
  if (s.length === 0) return FALLBACK_FOLDER_NAME;
  // 8. Reserved device name → prefix with `_` (e.g. CON → _CON).
  if (RESERVED_DEVICE.test(s)) s = "_" + s;
  return s;
}
