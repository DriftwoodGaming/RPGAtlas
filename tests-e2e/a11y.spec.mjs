/* RPGAtlas — tests-e2e/a11y.spec.mjs
   Phase 7 Stage B: the accessibility options land end-to-end — persisted
   player options (Reduced Motion / Text Size / Colorblind Assist) are applied
   at boot (stage class + --ui-scale + gauge palette), and the Options menu
   exposes the new rows. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

/** Seed persisted player options (the playtest player's un-namespaced key)
 *  the same way gotoWithAtlasQuest seeds the project: prime, write, reload. */
async function gotoWithOptions(page, options) {
  await gotoWithAtlasQuest(page, "/play.html");
  await page.evaluate((opts) => {
    localStorage.setItem("rpgatlas_options", JSON.stringify(opts));
  }, options);
  await page.reload();
}

test.describe("accessibility options", () => {
  test("persisted options apply at boot: reduced-motion class, text scale, gauge palette", async ({ page }) => {
    await gotoWithOptions(page, { reducedMotion: "on", textScale: 1.3, colorAssist: true });
    await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 20_000 });

    // Reduced motion: the resolved preference is mirrored onto #stage.
    await expect(page.locator("#stage")).toHaveClass(/reduced-motion/);

    // Text scale: --ui-scale multiplies the author font size (15px → 19.5px).
    const fontSize = await page
      .locator("#stage")
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe("19.5px");

    // Colorblind assist: gauges render the Okabe–Ito palette in-game.
    await page.getByText("New Game", { exact: true }).click();
    await expect(page.locator(".titlewin")).toHaveCount(0, { timeout: 20_000 });
    await expect
      .poll(() => page.evaluate(() => window.Atlas.atlas.scene === "map" && !!window.Atlas.atlas.player))
      .toBe(true);
    await page.keyboard.press("Escape"); // pause menu (party rows carry HP/MP bars)
    await expect(page.locator(".bar-fill").first()).toBeVisible({ timeout: 10_000 });
    const fills = await page
      .locator(".bar-fill")
      .evaluateAll((els) => els.map((el) => el.style.background));
    expect(fills.join(",")).toContain("rgb(230, 159, 0)"); // #e69f00 HP
    expect(fills.join(",")).toContain("rgb(86, 180, 233)"); // #56b4e9 MP
  });

  test("defaults stay authored: no class, 1x scale, classic palette; Options menu lists the new rows", async ({ page }) => {
    await gotoWithAtlasQuest(page, "/play.html");
    await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#stage")).not.toHaveClass(/reduced-motion/);
    const fontSize = await page
      .locator("#stage")
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe("15px");

    // The Options menu exposes the three new accessibility rows.
    await page.getByText("Options", { exact: true }).click();
    await expect(page.getByText("Reduced Motion")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Text Size")).toBeVisible();
    await expect(page.getByText("Colorblind Assist")).toBeVisible();
  });
});
