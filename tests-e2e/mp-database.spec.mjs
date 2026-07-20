/* RPGAtlas — tests-e2e/mp-database.spec.mjs
   Project Beacon MP7·A/D: the Database ▸ Multiplayer authoring tab, end to end
   in the real editor. Opens the Database, switches to the Multiplayer tab,
   flips the enable toggle and sets capacity / chat mode / presets / a spawn
   point, then asserts they persist to the project (the localStorage document
   the editor treats as ground truth). Additive — no existing golden touched.
   GPL-3.0-or-later (see LICENSE). */

import { test, expect } from "@playwright/test";

const readProject = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("rpgatlas_project")));

test.describe("Database ▸ Multiplayer tab", () => {
  test("enables Play Together and persists capacity, chat mode, presets and a spawn point", async ({ page }) => {
    await page.goto("/index.html");
    const saveInd = page.locator("#save-ind");
    await expect(saveInd).toBeVisible(); // boot finished
    await expect(saveInd).toHaveText(/^✓ /); // initial save landed

    // A fresh project has multiplayer OFF (migrateProject backfills the inert default).
    const before = await readProject(page);
    expect(before.system.multiplayer.enabled).toBe(false);

    // Open the Database via the command palette, then the Multiplayer tab.
    await page.keyboard.press("Control+p");
    await page.locator(".cmdpal-input").fill("database");
    await page.keyboard.press("Enter");
    await expect(page.locator(".db-modal")).toBeVisible();
    await page.locator('.dbtabs-vert button', { hasText: "Multiplayer" }).click();
    await expect(page.locator(".dbbody")).toContainText("Play Together (online multiplayer)");

    // Enable + set fields.
    await page.locator('.dbbody label:has-text("Enable Play Together") input[type=checkbox]').check();
    await page.locator('.dbbody label:has-text("Max players") input[type=number]').fill("10");
    await page.locator('.dbbody label:has-text("Chat mode") select').selectOption("text");
    await expect(page.locator(".dbbody")).toContainText("Free-text chat is on"); // the D4 safety note appears
    await page.locator('.dbbody label:has-text("Phrases") textarea').fill("Follow me!\nNice one!");
    // Add a spawn point (the map dropdown defaults to the first available map).
    await page.locator('.dbbody button', { hasText: "Add spawn point" }).click();
    await expect(page.locator('.dbbody label:has-text("Facing") select')).toBeVisible();

    // Autosave debounces ~700ms; wait for the indicator to settle back to saved.
    await expect(saveInd).toHaveText(/^✓ /, { timeout: 5000 });

    const after = await readProject(page);
    const mp = after.system.multiplayer;
    expect(mp.enabled).toBe(true);
    expect(mp.maxPlayers).toBe(10);
    expect(mp.chatMode).toBe("text");
    expect(mp.presets).toEqual(["Follow me!", "Nice one!"]);
    expect(Object.keys(mp.spawns).length).toBe(1); // one spawn point authored

    // FORMAT_VERSION stays 2 — the multiplayer block is additive.
    expect(after.meta.formatVersion).toBe(2);
  });
});
