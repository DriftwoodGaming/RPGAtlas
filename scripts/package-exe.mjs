/* RPGAtlas — scripts/package-exe.mjs
   Builds the self-contained desktop executable and drops it at the project
   root as RPGAtlas-Desktop.exe (alongside the browser launcher RPGAtlas.exe).
   Re-run this after changing engine code, since the desktop exe embeds the
   editor at build time. GPL-3.0-or-later. */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const win = process.platform === "win32";
const builtName = win ? "rpgatlas.exe" : "rpgatlas";
const outName = win ? "RPGAtlas-Desktop.exe" : "RPGAtlas-Desktop";

const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });

run("node scripts/stage-frontend.mjs");
run("cargo build --release --manifest-path src-tauri/Cargo.toml");

const src = join(root, "src-tauri", "target", "release", builtName);
if (!existsSync(src)) {
  console.error("[package-exe] build output not found: " + src);
  process.exit(1);
}
const dst = join(root, outName);
copyFileSync(src, dst);
console.log("[package-exe] wrote " + dst);
