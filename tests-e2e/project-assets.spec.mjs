/* RPGAtlas — tests-e2e/project-assets.spec.mjs
   Project Harbor H4: the per-project asset library, driven in the browser build
   through the ?fakehost test host (src/editor/project-manager/test-host.ts) whose
   H4 asset methods back a fake per-project filesystem. ADDITIVE — always ?fakehost,
   so the existing 70 specs (which never pass it) are untouched.

   H4·A here: an editor import lands IN the project's assets/ folder (not the old
   global library), and opening a game that still references global-library assets
   copies them into the folder once (the legacy bridge). GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { atlasQuestJson } from "./fixtures/atlas-quest.mjs";

// A 1×1 transparent PNG (decodes in a real browser, so domProbe sets w/h).
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function newGame(page, name) {
  await page.goto("/index.html");
  await page.goto("/index.html?fakehost");
  await page.evaluate(() => window.__ATLAS_TEST_HOST__.setNextDirectory("/Games"));
  await page.locator(".pm-bigbtn", { hasText: "New Project" }).click();
  await page.locator(".pm-form .pm-input").fill(name);
  await page.locator(".pm-template", { hasText: "Empty map" }).click();
  await page.locator(".pm-btn", { hasText: "Choose folder…" }).click();
  await page.locator(".pm-btn", { hasText: "Make my game" }).click();
  await expect(page.locator("#save-ind")).toBeVisible();
}

test.describe("Per-project assets — editor imports (H4·A)", () => {
  test("an imported file lands in the project's assets/ folder, referenced in place", async ({ page }) => {
    await newGame(page, "Art Test");
    const root = "/Games/Art Test";

    // Open the Asset Browser via the Tools menu.
    await page.locator("#menus .menu-label", { hasText: "Tools" }).click();
    await page.locator(".menu-item", { hasText: "Asset Browser" }).click();
    await expect(page.locator(".assetbrowser")).toBeVisible();

    // Import a PNG as an enemy battler (a direct import — no slicer modal).
    await page.selectOption('.assetbrowser select[title="Type images import as"]', "enemies");
    await page.setInputFiles("#assetbrowser-file", {
      name: "goblin.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_B64, "base64"),
    });

    // The per-project index now records it IN PLACE under assets/enemies/.
    await expect
      .poll(async () =>
        page.evaluate((r) => {
          const idx = window.__ATLAS_TEST_HOST__.readAssetIndex(r);
          return idx.length ? idx[0].relPath : null;
        }, root),
      )
      .toBe("assets/enemies/goblin.png");

    const state = await page.evaluate((r) => {
      const idx = window.__ATLAS_TEST_HOST__.readAssetIndex(r);
      const files = JSON.parse(localStorage.getItem("atlas.fakehost.assetfiles") || "{}");
      return { key: idx[0].key, type: idx[0].type, files: Object.keys(files[r] || {}) };
    }, root);
    expect(state.type).toBe("enemies");
    expect(state.key).toBe("asset:enemies/goblin");
    // The actual bytes live at the in-place path — the child's file, in their folder.
    expect(state.files).toContain("assets/enemies/goblin.png");
  });
});

test.describe("Per-project assets — legacy bridge (H4·A)", () => {
  test("opening a game that uses global-library assets copies them into the folder", async ({ page }) => {
    const root = "/Games/Legacy";
    // A project whose actor references a global-library charset key.
    const doc = JSON.parse(atlasQuestJson());
    doc.actors[0].charset = "asset:characters/hero";

    await page.goto("/index.html");
    await page.evaluate(
      ({ r, d }) => {
        localStorage.setItem("atlas.fakehost.docs", JSON.stringify({ [r]: d }));
        localStorage.setItem(
          "atlas.fakehost.recents",
          JSON.stringify([{ name: "Legacy", path: r, lastOpened: 1 }]),
        );
        localStorage.setItem(
          "atlas.fakehost.global",
          JSON.stringify({
            metas: [
              { key: "asset:characters/hero", type: "characters", name: "hero", hash: "h", mime: "image/png" },
            ],
            blobs: {
              "asset:characters/hero":
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            },
          }),
        );
      },
      { r: root, d: JSON.stringify(doc) },
    );
    await page.goto("/index.html?fakehost");

    await page.locator(".pm-recent", { hasText: "Legacy" }).click();

    // The bridge ran: a friendly notice, and the asset is now in the project index.
    await expect(page.locator(".modal-title", { hasText: "We tidied up your game" })).toBeVisible();
    const keys = await page.evaluate(
      (r) => window.__ATLAS_TEST_HOST__.readAssetIndex(r).map((m) => m.key),
      root,
    );
    expect(keys).toContain("asset:characters/hero");
  });
});
