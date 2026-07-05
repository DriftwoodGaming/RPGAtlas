/* RPGAtlas — tests-e2e/import-boot.spec.mjs
   Project Compass M1·B/M1·D: an imported RPG Maker project boots AND plays.
   Converts the hand-authored "Cove Test" MV + MZ fixtures through the real
   intake → convert → assemble pipeline (see fixtures/import-fixture.mjs), seeds
   each into the app's localStorage the same way the Atlas Quest specs do, and
   proves: both boot to their title screen and start a map with no console errors
   (M1·B), and the imported MZ project runs a battle to a result and round-trips a
   save (M1·D — the "playtest, battle, save/load" leg of the phase-exit proof).
   Real tile art is sliced by the user later; the placeholder sheets here render
   blank but must not throw. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { importedProjectJson } from "./fixtures/import-fixture.mjs";

const projectJson = {};
test.beforeAll(async () => {
  projectJson.mz = await importedProjectJson("mz-project");
  projectJson.mv = await importedProjectJson("mv-project");
});

/** Seed an imported project into localStorage, then navigate. Mirrors
 *  fixtures/atlas-quest.mjs gotoWithAtlasQuest (prime origin → seed → reload). */
async function gotoWithImported(page, path, which) {
  await page.goto(path);
  await page.evaluate((seeded) => localStorage.setItem("rpgatlas_project", seeded), projectJson[which]);
  await page.goto(path);
}

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource.*404/.test(msg.text())) return;
    errors.push(msg.text());
  });
  return errors;
}

test.describe("MZ/MV import boots", () => {
  for (const [which, label] of [["mz", "MZ"], ["mv", "MV"]]) {
    test(`${label}: reaches the Cove Test title screen and starts a map with no console errors`, async ({ page }) => {
      const errors = watchErrors(page);
      await gotoWithImported(page, "/play.html", which);

      await expect(page.locator(".titlewin .title-name")).toHaveText("Cove Test");
      await expect(page.getByText("New Game", { exact: true })).toBeVisible();

      await page.getByText("New Game", { exact: true }).click();
      await expect(page.locator("#stage")).toBeVisible();
      // Prove the imported map actually LOADS (not just that #stage exists):
      // newGame() only sets scene "map" after loadMap resolves.
      await expect
        .poll(() => page.evaluate(() => window.Atlas && window.Atlas.atlas.scene), { timeout: 10_000 })
        .toBe("map");

      expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
    });
  }
});

test.describe("imported projects — playtest, battle, save/load", () => {
  // M3·C: the FULL battle runs on BOTH fixtures (the phase-exit proof). The
  // troop now exercises battle parity live: a hidden Crab revealed by an
  // Enemy Appear page (at a turn-end check), Show Battle Animation + Change
  // Enemy HP page commands, MZ escape odds, and the Crab's Slip Away escape
  // effect — the battle must still reach a clean result.
  for (const [which, label] of [["mz", "MZ"], ["mv", "MV"]]) {
    test(`${label}: runs a full battle to a result through the shared battle core`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page);
      await gotoWithImported(page, "/play.html", which);

      await page.getByText("New Game", { exact: true }).click();
      await expect(page.locator(".titlewin")).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => window.Atlas && window.Atlas.atlas.scene), { timeout: 10_000 })
        .toBe("map");

      // Troop 1 = the imported "Slimes" group. Drive it the same way player.spec does.
      await page.evaluate(() => {
        window.__battleResult = null;
        window.__battleError = null;
        window.Atlas.atlas
          .startBattle(1, true)
          .then((r) => { window.__battleResult = r; })
          .catch((e) => { window.__battleError = String((e && e.stack) || e); });
      });
      await expect(page.locator(".battlewin")).toBeVisible();

      await expect
        .poll(
          async () => {
            const done = await page.evaluate(() => window.__battleResult || window.__battleError);
            if (done) return done;
            // M3·A: the imported battle plays honestly, so the troop-page
            // message ("The slimes wobble…") really opens — dismiss it like
            // a player. The same Enter driver walks the command menus.
            if (await page.locator(".cmdwin, .targetwin, .msgwin").count()) await page.keyboard.press("Enter");
            return null;
          },
          { timeout: 90_000, intervals: [250] },
        )
        .not.toBeNull();

      const outcome = await page.evaluate(() => ({ result: window.__battleResult, error: window.__battleError }));
      expect(outcome.error).toBeNull();
      expect(["win", "lose", "escape"]).toContain(outcome.result);
      await expect(page.locator(".battlewin")).toHaveCount(0);
      expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
    });
  }

  test("round-trips a save through the engine's save-slot UI", async ({ page }) => {
    await gotoWithImported(page, "/play.html", "mz");

    await page.getByText("New Game", { exact: true }).click();
    await expect(page.locator(".titlewin")).toHaveCount(0);

    // Retry Escape until the pause menu opens (boot fade timing; see player.spec).
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(page.locator(".mainmenu")).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
    await page.getByText("Save", { exact: false }).click();
    await expect(page.locator(".savewin")).toBeVisible();
    await page.getByText("Slot 1", { exact: false }).click();

    const slotSaved = await page.evaluate(() =>
      Object.keys(localStorage).some((k) => /^rpgatlas(_.+)?_save_1$/.test(k) || /^driftwood_save_1$/.test(k)));
    expect(slotSaved).toBe(true);

    // Dismiss the "Game saved" confirmation, then load the slot back.
    const confirmMsg = page.locator(".msgwin");
    await expect(confirmMsg).toBeVisible();
    await expect(async () => {
      await confirmMsg.click();
      await expect(confirmMsg).toHaveCount(0, { timeout: 300 });
    }).toPass({ timeout: 5_000 });

    await expect(page.locator(".mainmenu")).toBeVisible();
    await page.getByText("To Title", { exact: false }).click();
    await page.getByText("Return to title", { exact: true }).click();
    await expect(page.locator(".titlewin")).toBeVisible();

    await page.getByText("Continue", { exact: true }).click();
    await expect(page.locator(".savewin")).toBeVisible();
    await page.getByText("Slot 1", { exact: false }).click();

    await expect(page.locator(".titlewin")).toHaveCount(0);
    await expect(page.locator("#gamecanvas")).toBeVisible();
  });
});
