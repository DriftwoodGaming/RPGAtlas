/* RPGAtlas — tests-e2e/project-manager.spec.mjs
   Project Harbor H2: the desktop Project Manager launcher, driven in the browser
   build through the ?fakehost test host (src/editor/project-manager/test-host.ts).
   These specs are ADDITIVE — they always pass ?fakehost, so the manager mounts;
   the existing 70 specs never do, so they see no manager and run unchanged.

   The e2e boot gate (trap 1): while the manager is on screen the editor has NOT
   booted, so #save-ind stays hidden; it appears only after a game is chosen and
   boot() reveals it last. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { atlasQuestJson } from "./fixtures/atlas-quest.mjs";

const SEED_ROOT = "/Games/Seed Game";

/** Seed the fake host's localStorage (docs + recents) with one openable game,
 *  then navigate to the manager. Mirrors the atlas-quest seed pattern: prime the
 *  origin, write storage, then load ?fakehost so start() installs the fake host
 *  and reads the seed. */
async function gotoManagerWithSeed(page, { recents = [], docs = {} } = {}) {
  await page.goto("/index.html");
  await page.evaluate(
    ({ r, d }) => {
      localStorage.setItem("atlas.fakehost.recents", r);
      localStorage.setItem("atlas.fakehost.docs", d);
    },
    { r: JSON.stringify(recents), d: JSON.stringify(docs) },
  );
  await page.goto("/index.html?fakehost");
}

test.describe("Project Manager — surface & boot gate (H2·A)", () => {
  test("mounts on ?fakehost and keeps #save-ind hidden until a game is chosen", async ({ page }) => {
    await gotoManagerWithSeed(page);

    // The launcher is up, with both actions and the recents column.
    await expect(page.locator(".pm-overlay")).toBeVisible();
    await expect(page.locator(".pm-bigbtn", { hasText: "New Project" })).toBeVisible();
    await expect(page.locator(".pm-bigbtn", { hasText: "Open Project" })).toBeVisible();
    await expect(page.locator(".pm-recents-head")).toHaveText(/Recent games/i);

    // The gate: the editor has not booted, so its "ready" indicator is hidden.
    await expect(page.locator("#save-ind")).toBeHidden();
  });

  test("the New Project button reveals the create form", async ({ page }) => {
    await gotoManagerWithSeed(page);
    await page.locator(".pm-bigbtn", { hasText: "New Project" }).click();
    await expect(page.locator(".pm-form .pm-input")).toBeVisible();
    // Still no editor behind it.
    await expect(page.locator("#save-ind")).toBeHidden();
    // Back returns to the landing view.
    await page.locator(".pm-btn", { hasText: "Back" }).click();
    await expect(page.locator(".pm-bigbtn", { hasText: "Open Project" })).toBeVisible();
  });

  test("clicking a recent opens the game and boots the editor (title follows)", async ({ page }) => {
    await gotoManagerWithSeed(page, {
      recents: [{ name: "Seed Game", path: SEED_ROOT, lastOpened: 1 }],
      docs: { [SEED_ROOT]: atlasQuestJson() },
    });

    const recent = page.locator(".pm-recent", { hasText: "Seed Game" });
    await expect(recent).toBeVisible();
    await expect(page.locator("#save-ind")).toBeHidden(); // gate still closed

    await recent.click();

    // The editor boots: the manager is gone, the chrome is up, and #save-ind
    // finally appears (the boot gate the other 70 specs rely on).
    await expect(page.locator(".pm-overlay")).toHaveCount(0);
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page.locator("#menubar")).toBeVisible();
    await expect(page.locator("#mapcanvas")).toBeVisible();
    // Window title tracks the opened game's display name (its system.title).
    await expect(page).toHaveTitle("Atlas Quest — RPGAtlas");
  });
});
