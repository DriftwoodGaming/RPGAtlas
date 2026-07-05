/* RPGAtlas — tests-e2e/fixtures/import-fixture.mjs
   Project Compass M1·B: build a bootable Atlas project from a hand-authored
   RPG Maker fixture, for the import-boot e2e. The MZ/MV converter is TypeScript
   under src/ with no DOM dependency (its convert/assemble paths are pure data),
   so we esbuild-bundle it once to a temp ESM module, run the intake → convert →
   assemble pipeline in Node over the fixture's text files, and hand the spec a
   ready-to-seed project JSON — the same pipeline tests-unit/mz-import-maps.test.ts
   exercises, proven here to load in the real engine. GPL-3.0-or-later. */

import { build } from "esbuild";
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");

let modPromise = null;
/** Bundle src/editor/importers/mz to a temp ESM module and import it (cached). */
function importer() {
  if (!modPromise) {
    modPromise = (async () => {
      const out = await build({
        entryPoints: [join(repo, "src", "editor", "importers", "mz", "index.ts")],
        bundle: true,
        format: "esm",
        platform: "node",
        write: false,
        logLevel: "silent",
      });
      const dir = mkdtempSync(join(tmpdir(), "rpgatlas-mzimport-"));
      const file = join(dir, "mz-import.mjs");
      writeFileSync(file, out.outputFiles[0].text);
      return import(pathToFileURL(file).href);
    })();
  }
  return modPromise;
}

/** Read a fixture tree's text files (data/*.json, Game.*, js/plugins.js) into a
 *  { path: contents } map — enough for database + tileset + map conversion
 *  (asset bytes aren't needed to convert maps). */
function textFiles(projectDir) {
  const files = {};
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      const rel = relative(projectDir, abs).replace(/\\/g, "/");
      if (/\.(json|js)$/i.test(rel) || /^Game\./i.test(rel)) files[rel] = readFileSync(abs, "utf8");
    }
  };
  walk(projectDir);
  return files;
}

/**
 * Convert `tests/fixtures/<name>/` and assemble it onto a fresh Atlas project
 * base (the shipped sample donates newProject()'s engine defaults in Node), then
 * return the seed-ready project JSON string.
 */
export async function importedProjectJson(name = "mz-project") {
  const mz = await importer();
  const files = textFiles(join(repo, "tests", "fixtures", name));
  const source = mz.objectSource(files);
  const conv = await mz.importMzProject(source);
  const base = JSON.parse(readFileSync(join(repo, "Atlas_Quest.json"), "utf8"));
  return JSON.stringify(mz.assembleProject(base, conv));
}
