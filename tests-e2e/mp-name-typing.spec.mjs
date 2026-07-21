/* RPGAtlas — tests-e2e/mp-name-typing.spec.mjs
   Regression for the Play Together typing bug: the engine's global keydown
   handler consumed its bound keys (W/A/S/D, M, Space, arrows, Z/X, F/J, Shift)
   even while a DOM text field had focus, so typing "Mike" into the "Your name"
   box produced "ike" — and each eaten key also nav'd the title menu behind the
   modal. The relay specs never caught it because .fill() sets the value without
   per-key events; this spec types with REAL key events (pressSequentially).
   No server needed: the modal and its fields are pure client UI. The frozen
   goldens are untouched (multiplayer is enabled only in this spec's project
   copy). GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

const enableMp = (project) => {
  project.system = project.system || {};
  project.system.multiplayer = { enabled: true };
  return project;
};

test.describe("Play Together text fields receive game-bound keys", () => {
  test("typing 'Mike' (and friends) lands every letter in name + code fields", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await gotoWithAtlasQuest(page, "/play.html", { transformProject: enableMp });
    await expect(page.getByText("Play Together", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByText("Play Together", { exact: true }).click();
    await expect(page.locator(".mp-modal")).toBeVisible();

    // The name field autofocuses; replace the prefill with real keystrokes.
    // "Mike Was" covers the field-bug letters (M, W, a, s) AND Space (bound to
    // ok — the game used to eat it and confirm the title menu behind the modal).
    const nameIn = page.locator(".mp-modal input").first();
    await expect(nameIn).toBeFocused();
    await nameIn.fill("");
    await nameIn.pressSequentially("Mike Was", { delay: 15 });
    await expect(nameIn).toHaveValue("Mike Was");

    // Room-code field (revealed by Join a Room) gets the same shield — its
    // alphabet includes W/D/S/M, all game-bound.
    await page.getByRole("button", { name: "Join a Room" }).click();
    const codeIn = page.locator(".mp-code-in");
    await expect(codeIn).toBeFocused();
    await codeIn.pressSequentially("WDS-MMM-DWS", { delay: 15 });
    await expect(codeIn).toHaveValue("WDS-MMM-DWS");

    // None of those keys leaked into the game: the modal is still up, no room
    // was created/joined, and the title never started the game.
    await expect(page.locator(".mp-modal")).toBeVisible();
    await expect(page.locator(".mp-code-banner")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
