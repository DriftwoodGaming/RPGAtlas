/* RPGAtlas — scripts/stage-frontend.mjs
   Copies the static editor/player into src-tauri/dist so Tauri can embed it,
   and generates img/assets.json so custom-art discovery works inside the
   desktop app (which has no HTTP directory listings). The web build is left
   untouched — this manifest only lives in the staged copy. GPL-3.0-or-later. */

import {
  cpSync, rmSync, mkdirSync, readdirSync, writeFileSync, existsSync, statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/ sits directly under the repo root, regardless of the caller's cwd.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "src-tauri", "dist");

// Everything the editor and player need at runtime. bin/ ships the launcher
// used by the "Windows EXE" game-export feature.
const include = ["index.html", "play.html", "css", "js", "img", "bin"];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const name of include) {
  const src = join(root, name);
  if (!existsSync(src)) {
    console.warn("[stage-frontend] skipping missing " + name);
    continue;
  }
  cpSync(src, join(dist, name), { recursive: true });
}

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

console.log("[stage-frontend] staged frontend -> " + dist);
