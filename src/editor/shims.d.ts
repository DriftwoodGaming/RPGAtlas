/* RPGAtlas — src/editor/shims.d.ts
   Ambient module declarations for the classic js/ helpers that the typed editor
   modules import with a Vite cache-bust query (e.g. "?v=4"). The query makes
   the specifier unresolvable to tsc under moduleResolution:bundler even though
   Vite resolves it fine; this declares the shape as `any` so the verbatim
   runtime import (query preserved) typechecks. GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "*/patch-notes.js?v=21" {
  export const PATCH_NOTES: any;
}
