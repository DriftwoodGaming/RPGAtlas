/* RPGAtlas — tests-e2e/project-launch.spec.mjs
   Project Harbor H5: launch from the project folder, driven in the browser build
   through the ?fakehost test host (src/editor/project-manager/test-host.ts). These
   specs are ADDITIVE — they always pass ?fakehost, so the manager machinery mounts;
   the existing 70 specs never do and run unchanged.

   H5·A — the "exe" is launched with a project path (a double-clicked .rpgatlas or
   `RPGAtlas.exe <path>`): the fake host's `atlas.fakehost.launch` key stands in for the
   native `take_launch_path`, so we can drive "boot straight into a game" and "bad path →
   manager + friendly note" in the browser.
   H5·B — a SECOND launch while the app is open: `emitOpenProject(path)` stands in for the
   single-instance callback's `atlas://open-project` event.
   GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { atlasQuestJson } from "./fixtures/atlas-quest.mjs";

/** An Atlas Quest document with its display title overridden (to tell games apart). */
function docTitled(title) {
  const p = JSON.parse(atlasQuestJson());
  p.system.title = title;
  return JSON.stringify(p);
}

/** Seed the fake host's localStorage (docs + recents + a launch path), then navigate to
 *  ?fakehost so start() installs the fake host and launchManager() reads the seed. */
async function gotoWithLaunch(page, { docs = {}, recents = [], launch = null } = {}) {
  await page.goto("/index.html");
  await page.evaluate(
    ({ d, r, l }) => {
      localStorage.setItem("atlas.fakehost.docs", d);
      localStorage.setItem("atlas.fakehost.recents", r);
      if (l != null) localStorage.setItem("atlas.fakehost.launch", l);
    },
    { d: JSON.stringify(docs), r: JSON.stringify(recents), l: launch },
  );
  await page.goto("/index.html?fakehost");
}

test.describe("Launch from a project — argv / double-click (H5·A)", () => {
  const ROOT = "/Games/Launched Game";

  test("a launch path boots straight into that game, skipping the launcher", async ({ page }) => {
    await gotoWithLaunch(page, {
      docs: { [ROOT]: docTitled("Launched Game") },
      launch: ROOT,
    });

    // No launcher — the editor booted directly on the launched game (the gate opens).
    await expect(page.locator(".pm-overlay")).toHaveCount(0);
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page.locator("#mapcanvas")).toBeVisible();
    await expect(page).toHaveTitle("Launched Game — RPGAtlas");

    // The launch path is consumed once: it recorded a recents entry, and a plain
    // relaunch (no launch key) shows the manager with that game in recents.
    await page.goto("/index.html?fakehost");
    await expect(page.locator(".pm-overlay")).toBeVisible();
    await expect(page.locator(".pm-recent", { hasText: "Launched Game" })).toBeVisible();
    await expect(page.locator("#save-ind")).toBeHidden();
  });

  test("a bad launch path falls back to the launcher with a friendly note", async ({ page }) => {
    // A launch path with no game behind it (nothing seeded at that root).
    await gotoWithLaunch(page, { launch: "/Games/Not Here" });

    // The launcher is shown (not the editor), with the kid-friendly can't-find-it copy.
    await expect(page.locator(".pm-overlay")).toBeVisible();
    await expect(page.locator(".pm-toast")).toContainText("can't find this game");
    await expect(page.locator("#save-ind")).toBeHidden();

    // A folder that exists but has no game.rpgatlas → the not-a-project copy instead.
    await page.goto("/index.html");
    await page.evaluate(() => {
      localStorage.setItem("atlas.fakehost.empty", JSON.stringify(["/Games/Empty"]));
      localStorage.setItem("atlas.fakehost.launch", "/Games/Empty");
    });
    await page.goto("/index.html?fakehost");
    await expect(page.locator(".pm-toast")).toContainText("isn't an RPGAtlas game");
    await expect(page.locator("#save-ind")).toBeHidden();
  });

  test("no launch path shows the launcher as usual", async ({ page }) => {
    await gotoWithLaunch(page, { recents: [] });
    await expect(page.locator(".pm-overlay")).toBeVisible();
    await expect(page.locator(".pm-bigbtn", { hasText: "New Project" })).toBeVisible();
    await expect(page.locator("#save-ind")).toBeHidden();
  });
});
