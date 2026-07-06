/* RPGAtlas — tests-e2e/import-wizard.spec.mjs
   Project Compass M1·D: the import wizard end-to-end, driven through the real
   editor UI. Sets the hand-authored MV/MZ fixture directories on the wizard's
   hidden folder picker (the supported way to feed a <input webkitdirectory>
   without a native dialog), then asserts the kid-friendly Import Report renders,
   the converted project becomes the live project, the report can be reopened from
   the File menu, and — for MZ — the freshly imported project boots in the player.
   Battle + save/load on an imported project live in import-boot.spec.mjs.
   GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const fixtureDir = (name) => join(repo, "tests", "fixtures", name);

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // Same benign asset-discovery 404 noise the editor/player boot specs filter.
    if (/Failed to load resource.*404/.test(msg.text())) return;
    errors.push(msg.text());
  });
  return errors;
}

/** Open the editor, feed a fixture directory to the wizard's folder picker, and
 *  wait for the Import Report to appear. */
async function importFolder(page, name) {
  await page.goto("/index.html");
  await expect(page.locator("#toolbar")).toBeVisible();
  await page.setInputFiles("#rm-import-folder", fixtureDir(name));
  await expect(page.locator(".modal-title", { hasText: "Import Report" })).toBeVisible({ timeout: 20_000 });
}

async function loadedProject(page) {
  // The editor autosaves the imported project (debounced) — poll until written.
  await expect
    .poll(async () => page.evaluate(() => {
      const raw = localStorage.getItem("rpgatlas_project");
      return raw ? JSON.parse(raw).system.title : null;
    }))
    .toBe("Cove Test");
  return page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("rpgatlas_project"));
    return { title: p.system.title, maps: p.maps.map((m) => m.name), report: p.importReport || null };
  });
}

test.describe("RPG Maker import wizard", () => {
  test("MZ: imports through the UI, shows a friendly report, loads it, and reopens", async ({ page }) => {
    const errors = watchErrors(page);
    await importFolder(page, "mz-project");

    // The report leads with the game title + honest caveats (never a stack trace).
    const body = page.locator(".modal-body").first();
    await expect(body).toContainText("Cove Test");
    await expect(body).toContainText("Saved for a later update");
    await expect(body).toContainText("Left out on purpose");
    // Post-1.1: Luck converts for real — the old "left out" line is gone,
    // and the key items + item-category options land as converted lines.
    await expect(body).not.toContainText(/Luck/i);
    await expect(body).toContainText(/key items/i);
    await expect(body).toContainText(/item menu categories/i);

    // The converted project is now the live project.
    const info = await loadedProject(page);
    expect(info.maps).toEqual(["Harbor", "Cave"]);
    expect(info.report && info.report.source).toBe("mz");

    // Close, then reopen the saved report from File ▸ Import Report.
    await page.getByRole("button", { name: "Start Editing" }).click();
    await expect(page.locator(".modal-title", { hasText: "Import Report" })).toHaveCount(0);
    await page.locator(".menu-label", { hasText: "File" }).click();
    await page.locator(".menu-drop .menu-item", { hasText: "Import Report" }).click();
    await expect(page.locator(".modal-title", { hasText: "Import Report" })).toBeVisible();

    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("MV: imports through the UI and shows a friendly report", async ({ page }) => {
    const errors = watchErrors(page);
    await importFolder(page, "mv-project");

    const body = page.locator(".modal-body").first();
    await expect(body).toContainText("Cove Test");

    const info = await loadedProject(page);
    expect(info.maps).toEqual(["Harbor", "Cave"]);
    expect(info.report && info.report.source).toBe("mv");

    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("MZ: the freshly imported project boots in the player", async ({ page }) => {
    const errors = watchErrors(page);
    await importFolder(page, "mz-project");
    await loadedProject(page); // ensure the autosave landed

    // Same origin, so the imported project in localStorage is what play.html boots.
    await page.goto("/play.html");
    await expect(page.locator(".titlewin .title-name")).toHaveText("Cove Test");
    await page.getByText("New Game", { exact: true }).click();
    await expect(page.locator("#stage")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.Atlas && window.Atlas.atlas.scene), { timeout: 10_000 })
      .toBe("map");

    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
