/* RPGAtlas — tests-e2e/fixtures/atlas-quest.mjs
   Shared helpers for seeding the bundled sample project ("Atlas Quest") into
   the app's storage before a spec navigates to index.html/play.html.

   Both the editor and player load a project from localStorage under the
   "rpgatlas_project" key (see js/editor/project-io.js loadStoredProject and
   js/engine.js loadProject). Seeding that key before navigation is the
   supported, non-invasive way to get a real project into either page without
   touching engine/editor source. GPL-3.0-or-later. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const projectPath = join(here, "..", "..", "Atlas_Quest.json");

let cached = null;
export function atlasQuestJson() {
  if (!cached) cached = readFileSync(projectPath, "utf8");
  return cached;
}

/** The one nondeterminism a frozen Playwright clock does NOT freeze:
 * random-walk NPCs (moveType "random") roll unseeded Math.random() when their
 * step timer expires — harmless in play, fatal to any spec that compares
 * pixels across boots or against a committed baseline. Meridian Village's
 * villagers can roll a facing change inside a fixture's boot window (~25% per
 * roll). Specs that compare frames compose this into their transformProject
 * so every mover stays at its authored spot and direction — exactly the state
 * the committed baselines show. */
export function pinMovers(project) {
  for (const m of project.maps) {
    for (const e of m.events || []) {
      for (const p of e.pages || []) if (p.moveType === "random") p.moveType = "fixed";
    }
  }
  return project;
}

/**
 * Seeds localStorage with the Atlas Quest sample project, then navigates to
 * `path`. Must set localStorage before any app script runs, so we navigate
 * to the target origin first (about:blank has no localStorage bound to the
 * app's origin), seed, then navigate again to the real page.
 *
 * `installClock: true` installs Playwright's fake clock (see clock.install())
 * in between the seed and the real navigation, so it is in place before
 * js/engine.js boot() ever calls requestAnimationFrame(loop) — needed for
 * deterministic golden-image captures (see tests-e2e/renderer-golden.spec.mjs).
 */
export async function gotoWithAtlasQuest(
  page,
  path,
  { installClock = false, transformProject = null } = {},
) {
  // `transformProject` mutates (or replaces) the parsed project before seeding
  // — used by the renderer goldens to switch on per-map HD-2D settings the
  // sample project leaves off (bloom/DoF/fog post stack).
  let json = atlasQuestJson();
  if (transformProject) {
    const project = JSON.parse(json);
    json = JSON.stringify(transformProject(project) ?? project);
  }
  // Prime the origin so we can write to its localStorage before boot.
  await page.goto(path);
  await page.evaluate((seeded) => {
    localStorage.setItem("rpgatlas_project", seeded);
  }, json);
  if (installClock) {
    // Fixed epoch start so any incidental Date.now()/timestamp text in the
    // UI (e.g. save-slot listings) is also reproducible across runs.
    await page.clock.install({ time: new Date("2024-01-01T00:00:00Z") });
  }
  await page.goto(path);
}
