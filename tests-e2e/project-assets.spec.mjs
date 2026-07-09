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
      .poll(
        async () =>
          page.evaluate((r) => {
            const idx = window.__ATLAS_TEST_HOST__.readAssetIndex(r);
            return idx.length ? idx[0].relPath : null;
          }, root),
        { timeout: 20_000 },
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
    await expect(page.locator(".modal-title", { hasText: "We tidied up your game" })).toBeVisible({
      timeout: 20_000,
    });
    const keys = await page.evaluate(
      (r) => window.__ATLAS_TEST_HOST__.readAssetIndex(r).map((m) => m.key),
      root,
    );
    expect(keys).toContain("asset:characters/hero");
  });
});

test.describe("Per-project assets — auto-discovery (H4·B)", () => {
  test("a file copied into assets/ appears on window focus (alt-tab back)", async ({ page }) => {
    await newGame(page, "Discover");
    const root = "/Games/Discover";

    // Simulate the child pasting a battler PNG into assets/enemies/ with their file manager.
    await page.evaluate(
      ({ r, png }) => window.__ATLAS_TEST_HOST__.seedAssetFile(r, "assets/enemies/goblin.png", png),
      { r: root, png: PNG_B64 },
    );
    // Alt-tab back to the editor → the focus scan discovers and imports it in place.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));

    // Generous timeout: this spec runs alongside the ~24s renderer-perf test, so a
    // scan (hash + wizard import) can be starved of CPU; the import itself is reliable.
    await expect
      .poll(
        async () =>
          page.evaluate((r) => {
            const idx = window.__ATLAS_TEST_HOST__.readAssetIndex(r);
            const hit = idx.find((m) => m.key === "asset:enemies/goblin");
            return hit ? hit.relPath : null;
          }, root),
        { timeout: 20_000 },
      )
      .toBe("assets/enemies/goblin.png");
  });

  test("the Scan button finds a new file; deleting it shows a friendly missing state", async ({ page }) => {
    await newGame(page, "Scanned");
    const root = "/Games/Scanned";

    await page.locator("#menus .menu-label", { hasText: "Tools" }).click();
    await page.locator(".menu-item", { hasText: "Asset Browser" }).click();
    await expect(page.locator(".assetbrowser")).toBeVisible();

    // A faceset PNG appears in the folder; the Scan button pulls it in.
    await page.evaluate(
      ({ r, png }) => window.__ATLAS_TEST_HOST__.seedAssetFile(r, "assets/facesets/face.png", png),
      { r: root, png: PNG_B64 },
    );
    await page.locator(".ab-dropbtns button", { hasText: "Scan for New Files" }).click();
    // Generous timeouts: shares CPU with the ~24s renderer-perf test (see above).
    await expect(page.locator(".ab-card .ab-name", { hasText: "face" })).toBeVisible({ timeout: 20_000 });

    // The child deletes the file from disk → a re-scan degrades it to a friendly
    // "missing" card (the entry survives; putting the file back would heal it).
    await page.evaluate((r) => window.__ATLAS_TEST_HOST__.deleteAssetFile(r, "assets/facesets/face.png"), root);
    await page.locator(".ab-dropbtns button", { hasText: "Scan for New Files" }).click();
    await expect(page.locator(".ab-badge.missing")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".ab-missing-note")).toContainText("missing");
  });
});

test.describe("Per-project assets — Asset Browser integration (H4·C)", () => {
  test("Open Project Folder + per-type folder hints; the README is re-created on open", async ({ page }) => {
    await newGame(page, "Browse");
    const root = "/Games/Browse";

    // The assets/ README is re-created on project open (a best-effort boot side effect;
    // a generous poll rides out CPU starvation from other specs running in parallel).
    await expect
      .poll(
        async () =>
          page.evaluate((r) => {
            const files = JSON.parse(localStorage.getItem("atlas.fakehost.assetfiles") || "{}");
            return Object.keys(files[r] || {});
          }, root),
        { timeout: 20_000 },
      )
      .toContain("assets/READ ME — how to add assets.txt");

    await page.locator("#menus .menu-label", { hasText: "Tools" }).click();
    await page.locator(".menu-item", { hasText: "Asset Browser" }).click();
    await expect(page.locator(".assetbrowser")).toBeVisible();

    await expect(page.locator(".ab-dropbtns button", { hasText: "Open Project Folder" })).toBeVisible();
    // The empty state names the exact subfolder for the selected type.
    await page.locator(".ab-railbtn", { hasText: "Tiles" }).click();
    await expect(page.locator(".ab-grid")).toContainText("assets/tilesets/");
  });

  test("renaming an asset re-keys the index but never renames the file on disk", async ({ page }) => {
    await newGame(page, "Rename");
    const root = "/Games/Rename";

    await page.locator("#menus .menu-label", { hasText: "Tools" }).click();
    await page.locator(".menu-item", { hasText: "Asset Browser" }).click();
    await expect(page.locator(".assetbrowser")).toBeVisible();
    await page.selectOption('.assetbrowser select[title="Type images import as"]', "enemies");
    await page.setInputFiles("#assetbrowser-file", {
      name: "goblin.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_B64, "base64"),
    });
    await expect(page.locator(".ab-card .ab-name", { hasText: "goblin" })).toBeVisible({ timeout: 20_000 });

    await page.locator(".ab-card .ab-actions button", { hasText: "Rename" }).click();
    // The rename prompt stacks over the Asset Browser modal; its input is the only text box.
    await page.locator('.modal input[type="text"]').fill("orc");
    await page.locator(".modal-btns button.primary", { hasText: "OK" }).click();

    const state = await page.evaluate((r) => {
      const idx = window.__ATLAS_TEST_HOST__.readAssetIndex(r);
      const files = JSON.parse(localStorage.getItem("atlas.fakehost.assetfiles") || "{}");
      return {
        keys: idx.map((m) => m.key),
        relPaths: idx.map((m) => m.relPath),
        files: Object.keys(files[r] || {}),
      };
    }, root);
    expect(state.keys).toContain("asset:enemies/orc"); // re-keyed in the index
    expect(state.keys).not.toContain("asset:enemies/goblin");
    expect(state.relPaths).toContain("assets/enemies/goblin.png"); // relPath unchanged
    expect(state.files).toContain("assets/enemies/goblin.png"); // the file kept its name
  });
});
