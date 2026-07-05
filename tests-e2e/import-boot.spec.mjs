/* RPGAtlas — tests-e2e/import-boot.spec.mjs
   Project Compass M1·B: an imported RPG Maker MZ project boots. Converts the
   hand-authored "Cove Test" MZ fixture through the real intake → convert →
   assemble pipeline (see fixtures/import-fixture.mjs), seeds it into the app's
   localStorage the same way the Atlas Quest specs do, and asserts play.html
   reaches the imported game's title screen and starts a map with no console
   errors — proving the converted maps/tilesets/autotiles load in the shipping
   engine. Real tile art is sliced by the M1·D wizard; the placeholder sheets
   here render blank but must not throw. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { importedProjectJson } from "./fixtures/import-fixture.mjs";

let projectJson;
test.beforeAll(async () => {
  projectJson = await importedProjectJson("mz-project");
});

/** Seed the imported project into localStorage, then navigate. Mirrors
 *  fixtures/atlas-quest.mjs gotoWithAtlasQuest (prime origin → seed → reload). */
async function gotoWithImported(page, path) {
  await page.goto(path);
  await page.evaluate((seeded) => localStorage.setItem("rpgatlas_project", seeded), projectJson);
  await page.goto(path);
}

test.describe("MZ import boots", () => {
  test("reaches the Cove Test title screen and starts a map with no console errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      // Benign asset-discovery 404 noise (js/assets.js discoverExternalAssets),
      // same filter the Atlas Quest player boot spec uses.
      if (/Failed to load resource.*404/.test(msg.text())) return;
      errors.push(msg.text());
    });

    await gotoWithImported(page, "/play.html");

    // Title screen shows the imported game's title (System.gameTitle).
    await expect(page.locator(".titlewin .title-name")).toHaveText("Cove Test");
    await expect(page.getByText("New Game", { exact: true })).toBeVisible();

    // New Game transfers to the start map (System.startMapId=1, Harbor).
    await page.getByText("New Game", { exact: true }).click();
    await expect(page.locator("#stage")).toBeVisible();

    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
