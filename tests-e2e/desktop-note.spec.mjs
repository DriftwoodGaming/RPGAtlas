/* RPGAtlas — tests-e2e/desktop-note.spec.mjs
   Project Harbor H6·B: the gentle "project folders live in the desktop app" note the
   PURE BROWSER build gains in its File menu. This spec drives the plain browser build
   (no ?fakehost), so it never mounts the Project Manager — it verifies the note appears
   only where it should (the web version) and opens a friendly explanation. ADDITIVE:
   a new file, so the existing browser specs are untouched. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";

test.describe("Browser build — File-menu folders note (H6·B)", () => {
  test("the File menu explains where the game is saved and points to the desktop app", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("#save-ind")).toBeVisible(); // boot finished (browser build)

    // Open the File menu (opens on mousedown) and find the note.
    await page.locator("#menus .menu-label", { hasText: "File" }).dispatchEvent("mousedown");
    const note = page.locator(".menu-item", { hasText: "Where's my game saved?" });
    await expect(note).toBeVisible();

    // It opens a kid-friendly modal that names the desktop app + folders.
    await note.click();
    await expect(page.locator(".modal-title", { hasText: "Where your game lives" })).toBeVisible();
    await expect(page.locator(".modal-body")).toContainText("desktop app");
    await expect(page.locator(".modal-body")).toContainText("folder");

    // "Got it" dismisses it.
    await page.locator(".modal-btns button", { hasText: "Got it" }).click();
    await expect(page.locator(".modal-title", { hasText: "Where your game lives" })).toHaveCount(0);
  });
});
