/* RPGAtlas — scripts/stage-frontend.mjs
   Builds the web frontend with Vite and stages the build output into
   src-tauri/dist so Tauri can embed it, then generates img/assets.json so
   custom-art discovery works inside the desktop app (which has no HTTP
   directory listings).

   Phase 1 Stage A: the editor/player now load ES module entries bundled by
   Vite (index.html/play.html reference /src/…/main.ts in dev, rewritten to
   hashed dist chunks by `vite build`), and the standalone export inlines
   dist/player-bundle.js. So we can no longer stage the raw source tree — the
   raw HTML would point at /src/…/main.ts, which the packaged app can't serve.
   We therefore run `vite build` and stage the built dist/ (which already
   contains the rewritten HTML, hashed entry chunks, player-bundle.js, and the
   verbatim css/img/bin/js passthrough — see vite.config.mjs). The web build
   output is otherwise left untouched; this manifest only lives in the staged
   copy. GPL-3.0-or-later. */

import { execSync } from "node:child_process";
import {
  cpSync, rmSync, mkdirSync, readdirSync, writeFileSync, existsSync, statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/ sits directly under the repo root, regardless of the caller's cwd.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webDist = join(root, "dist");
const dist = join(root, "src-tauri", "dist");

// Produce the web build (rewritten HTML + hashed chunks + player-bundle.js +
// passthrough css/img/bin/js). This is the exact artifact set that ships.
console.log("[stage-frontend] building web frontend (vite build)…");
execSync("npm run build", { cwd: root, stdio: "inherit" });
if (!existsSync(webDist)) {
  console.error("[stage-frontend] vite build produced no dist/ at " + webDist);
  process.exit(1);
}

// Stage the built dist/ verbatim into the Tauri embed directory.
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(webDist, dist, { recursive: true });

// Desktop-only playtest parking page: the pre-built (hidden) playtest window
// idles here instead of play.html so the game engine — and its music — only
// runs while a playtest is actually open (see open_playtest in
// src-tauri/src/lib.rs). Like assets.json below, it exists only in the staged
// copy, never in the web build.
cpSync(join(root, "src-tauri", "playtest-idle.html"), join(dist, "playtest-idle.html"));

// Asset manifest — mirrors the img/assets.json path that js/assets.js already
// prefers over directory-listing discovery. Lists any custom art the user has
// dropped into the img/<kind>/ folders (currently the engine is fully
// procedural, so these are normally empty).
const IMG = /\.(png|webp|jpe?g)$/i;
const kinds = ["characters", "facesets", "enemies", "tilesets"];
const manifest = {};
for (const kind of kinds) {
  const dir = join(dist, "img", kind);
  manifest[kind] = existsSync(dir)
    ? readdirSync(dir).filter((f) => IMG.test(f) && statSync(join(dir, f)).isFile())
    : [];
}
writeFileSync(join(dist, "img", "assets.json"), JSON.stringify(manifest, null, 2));

console.log("[stage-frontend] staged built frontend -> " + dist);
