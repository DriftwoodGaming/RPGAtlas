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

test.describe("Project Manager — New Project flow (H2·B)", () => {
  test("live folder preview sanitizes the typed name", async ({ page }) => {
    await gotoManagerWithSeed(page);
    await page.locator(".pm-bigbtn", { hasText: "New Project" }).click();

    const preview = page.locator(".pm-preview");
    const name = page.locator(".pm-form .pm-input");
    await name.fill("Hero:Quest?"); // ":" and "?" are reserved on Windows
    await expect(preview.locator("b")).toHaveText("Hero Quest"); // reserved chars → space, trimmed
    await name.fill("   ");
    await expect(preview.locator("b")).toHaveText("Untitled Game"); // empty → fallback
    await expect(page.locator(".pm-template")).toHaveCount(3); // Blank / Starter / Atlas Quest
  });

  test("name + folder + template creates the game and boots the editor", async ({ page }) => {
    await gotoManagerWithSeed(page);
    // Queue the directory the native picker would return.
    await page.evaluate(() => window.__ATLAS_TEST_HOST__.setNextDirectory("/Games"));

    await page.locator(".pm-bigbtn", { hasText: "New Project" }).click();
    await page.locator(".pm-form .pm-input").fill("Bug Quest");
    await page.locator(".pm-template", { hasText: "Empty map" }).click(); // Blank
    await page.locator(".pm-btn", { hasText: "Choose folder…" }).click();
    await expect(page.locator(".pm-folder-path")).toHaveText("/Games");

    await page.locator(".pm-btn", { hasText: "Make my game" }).click();

    // The editor boots on the freshly scaffolded game.
    await expect(page.locator(".pm-overlay")).toHaveCount(0);
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Bug Quest — RPGAtlas");

    // The fake FS recorded the project folder + a recents entry.
    const state = await page.evaluate(() => ({
      docs: Object.keys(JSON.parse(localStorage.getItem("atlas.fakehost.docs") || "{}")),
      recents: JSON.parse(localStorage.getItem("atlas.fakehost.recents") || "[]"),
    }));
    expect(state.docs).toContain("/Games/Bug Quest");
    expect(state.recents[0]).toMatchObject({ name: "Bug Quest", path: "/Games/Bug Quest" });
  });

  test("a name that collides shows the kid-friendly 'already have a game' error", async ({ page }) => {
    // Seed a folder already taken, so project_create reports FOLDER_EXISTS.
    await gotoManagerWithSeed(page, { docs: { "/Games/Taken": "{}" } });
    await page.evaluate(() => window.__ATLAS_TEST_HOST__.setNextDirectory("/Games"));

    await page.locator(".pm-bigbtn", { hasText: "New Project" }).click();
    await page.locator(".pm-form .pm-input").fill("Taken");
    await page.locator(".pm-btn", { hasText: "Choose folder…" }).click();
    await page.locator(".pm-btn", { hasText: "Make my game" }).click();

    await expect(page.locator(".pm-error")).toContainText("already have a game with that name");
    // The child stays on the form to fix it — no boot happened.
    await expect(page.locator("#save-ind")).toBeHidden();
    await expect(page.locator(".pm-form")).toBeVisible();
  });
});

test.describe("Project Manager — Open flow & rewiring (H2·C)", () => {
  test("a vanished game shows a friendly 'can't find it' row with Remove", async ({ page }) => {
    // A recent whose folder isn't in the fake FS → exists() is false → missing.
    await gotoManagerWithSeed(page, { recents: [{ name: "Gone Game", path: "/Games/Gone", lastOpened: 1 }] });

    const row = page.locator(".pm-recent.missing", { hasText: "Gone Game" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("We can't find this game anymore");

    await row.locator(".pm-recent-remove").click();
    await expect(page.locator(".pm-recent.missing")).toHaveCount(0);
  });

  test("File ▸ Open routes back to the manager; Back returns to the open game", async ({ page }) => {
    const SEED = "/Games/Game A";
    await gotoManagerWithSeed(page, {
      recents: [{ name: "Game A", path: SEED, lastOpened: 1 }],
      docs: { [SEED]: atlasQuestJson() },
    });
    await page.locator(".pm-recent", { hasText: "Game A" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();

    // File ▸ Open Project → confirm → the launcher returns over the editor.
    await page.locator("#menus .menu-label", { hasText: "File" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "Open Project" }).click();
    await page.locator(".modal-btns button", { hasText: "OK" }).click();
    await expect(page.locator(".pm-overlay")).toBeVisible();
    await expect(page.locator(".pm-back-row")).toBeVisible();

    // Back to my game dismisses the manager — the editor is still there, booted.
    await page.locator(".pm-btn", { hasText: "Back to my game" }).click();
    await expect(page.locator(".pm-overlay")).toHaveCount(0);
    await expect(page.locator("#save-ind")).toBeVisible();
  });

  test("File ▸ New opens the New Project form", async ({ page }) => {
    const SEED = "/Games/Game A";
    await gotoManagerWithSeed(page, {
      recents: [{ name: "Game A", path: SEED, lastOpened: 1 }],
      docs: { [SEED]: atlasQuestJson() },
    });
    await page.locator(".pm-recent", { hasText: "Game A" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();

    await page.locator("#menus .menu-label", { hasText: "File" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "New Project" }).click();
    await page.locator(".modal-btns button", { hasText: "OK" }).click();
    await expect(page.locator(".pm-form .pm-input")).toBeVisible();
  });

  test("opening a different game from the File menu reloads cleanly into it", async ({ page }) => {
    const A = "/Games/Game A";
    const B = "/Games/Game B";
    const bDoc = (() => {
      const p = JSON.parse(atlasQuestJson());
      p.system.title = "Game Beta";
      return JSON.stringify(p);
    })();
    await gotoManagerWithSeed(page, {
      recents: [
        { name: "Game B", path: B, lastOpened: 2 },
        { name: "Game A", path: A, lastOpened: 1 },
      ],
      docs: { [A]: atlasQuestJson(), [B]: bDoc },
    });

    // Boot Game A.
    await page.locator(".pm-recent", { hasText: "Game A" }).click();
    await expect(page).toHaveTitle("Atlas Quest — RPGAtlas");

    // File ▸ Open → pick Game B from recents → the window reloads cleanly into B
    // (no double-bound listeners), title tracks B's display name.
    await page.locator("#menus .menu-label", { hasText: "File" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "Open Project" }).click();
    await page.locator(".modal-btns button", { hasText: "OK" }).click();
    await page.locator(".pm-recent", { hasText: "Game B" }).click();

    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Game Beta — RPGAtlas");
    await expect(page.locator(".pm-overlay")).toHaveCount(0);
  });
});

test.describe("Project Manager — fake-host coverage (H2·D)", () => {
  test("create → relaunch → the game is in recents and reopens", async ({ page }) => {
    await gotoManagerWithSeed(page);
    await page.evaluate(() => window.__ATLAS_TEST_HOST__.setNextDirectory("/Games"));

    // Make a game (Starter template by default).
    await page.locator(".pm-bigbtn", { hasText: "New Project" }).click();
    await page.locator(".pm-form .pm-input").fill("Reopen Me");
    await page.locator(".pm-btn", { hasText: "Choose folder…" }).click();
    await page.locator(".pm-btn", { hasText: "Make my game" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();

    // Relaunch the manager (fresh load) — the game persisted into recents.
    await page.goto("/index.html?fakehost");
    const recent = page.locator(".pm-recent", { hasText: "Reopen Me" });
    await expect(recent).toBeVisible();
    await recent.click();
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Reopen Me — RPGAtlas");
  });

  test("Open Project → Browse opens the chosen game folder", async ({ page }) => {
    const SEED = "/Games/Browsed";
    await gotoManagerWithSeed(page, { docs: { [SEED]: atlasQuestJson() } });
    await page.evaluate((p) => window.__ATLAS_TEST_HOST__.setNextFolder(p), SEED);

    await page.locator(".pm-bigbtn", { hasText: "Open Project" }).click();
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page).toHaveTitle("Atlas Quest — RPGAtlas");
  });

  test("Browse into a folder with no game shows the friendly not-a-project message", async ({ page }) => {
    await gotoManagerWithSeed(page);
    await page.evaluate(() => {
      window.__ATLAS_TEST_HOST__.seedEmptyFolder("/Games/Empty");
      window.__ATLAS_TEST_HOST__.setNextFolder("/Games/Empty");
    });

    await page.locator(".pm-bigbtn", { hasText: "Open Project" }).click();
    await expect(page.locator(".pm-toast")).toContainText("isn't an RPGAtlas game");
    await expect(page.locator("#save-ind")).toBeHidden(); // nothing booted
  });
});
