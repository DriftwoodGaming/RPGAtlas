/* RPGAtlas — tests-e2e/editor.spec.mjs
   Editor smoke tests: boots cleanly and the map canvas actually paints.
   GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";

test.describe("editor boot", () => {
  test("loads index.html with menu bar and map canvas, no console errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      // js/assets.js discoverExternalAssets() optimistically probes for
      // img/assets.json and directory-listing fallbacks (img/characters/,
      // img/facesets/, img/enemies/, img/tilesets/) that don't exist for the
      // built-in tileset-only project; it catches the failures itself and
      // falls back gracefully. Chromium still logs the underlying 404
      // resource loads as console "error" messages even though the app
      // never calls console.error for this — that's expected noise, not a
      // real boot failure, so it's excluded here rather than papered over
      // in application code.
      if (/Failed to load resource.*404/.test(msg.text())) return;
      errors.push(msg.text());
    });

    await page.goto("/index.html");

    await expect(page.locator("#menubar")).toBeVisible();
    await expect(page.locator("#mapcanvas")).toBeVisible();
    // Menus are built at boot (buildMenubar) — wait for at least one to exist
    // rather than sleeping, so this is robust against boot taking longer on
    // a slow CI runner.
    await expect(page.locator("#menus > *").first()).toBeAttached();
    // Palette canvas is populated from the tileset asset once boot finishes.
    await expect(page.locator("#palette")).toBeVisible();

    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("editor painting", () => {
  test("selecting a palette tile and clicking the map canvas changes map data", async ({ page }) => {
    await page.goto("/index.html");

    // Wait for boot to finish: the autosave indicator only exists once
    // rebuildAll()/saveNow() have run.
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();

    const paletteCanvas = page.locator("#palette");
    const mapCanvas = page.locator("#mapcanvas");
    await expect(paletteCanvas).toBeVisible();
    await expect(mapCanvas).toBeVisible();

    // Read the map's serialized state (as persisted to localStorage) before
    // painting. We assert via the editor's own persistence format rather
    // than pixel-reading the canvas or reaching into JS closures (editor.js
    // exposes no debug globals) — this is the same data the app itself
    // treats as ground truth.
    const readProject = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("rpgatlas_project")));

    // boot() ends with an unconditional saveNow(), so localStorage already
    // reflects the freshly-loaded project once the indicator reads "saved".
    // (Avoid Ctrl+S here: it collides with the browser's native Save Page
    // shortcut in some Chromium configurations.)
    // NB: match anchored on the leading glyph, not just /saved/ — the
    // "unsaved" string itself contains "saved" as a substring, so a loose
    // regex here would also match the pre-save state.
    await expect(saveIndicator).toHaveText(/^✓ /);
    const before = await readProject();
    const mapId = before.system.startMapId || before.maps[0].id;
    const mapBefore = before.maps.find((m) => m.id === mapId);
    const layersBefore = JSON.stringify(mapBefore.layers);

    // Pick a palette tile (second swatch, away from 0/empty) then paint a
    // cell on the map canvas that is very likely empty at map load edges.
    const paletteBox = await paletteCanvas.boundingBox();
    await page.mouse.click(paletteBox.x + paletteBox.width * 0.5, paletteBox.y + 8);

    const mapBox = await mapCanvas.boundingBox();
    // Click near the top-left corner of the drawn map, inside its bounds.
    await page.mouse.click(mapBox.x + 10, mapBox.y + 10);

    // touch() debounces the autosave by 700ms — wait on the UI's own
    // "unsaved" -> "saved" transition instead of a fixed sleep.
    await expect(saveIndicator).toHaveText(/^● /);
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });

    const after = await readProject();
    const mapAfter = after.maps.find((m) => m.id === mapId);
    const layersAfter = JSON.stringify(mapAfter.layers);

    expect(layersAfter).not.toEqual(layersBefore);
  });
});

test.describe("command palette", () => {
  test("Ctrl+P opens it, fuzzy search + Enter runs a command, Escape closes it", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("#save-ind")).toBeVisible(); // boot finished

    // Open with the keyboard (the binding preventDefaults the browser print dialog).
    await page.keyboard.press("Control+p");
    const input = page.locator(".cmdpal-input");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    // Unfiltered list shows commands with their menu-derived category prefixes.
    await expect(page.locator(".cmdpal-item").first()).toBeVisible();

    // Escape closes without running anything.
    await page.keyboard.press("Escape");
    await expect(input).not.toBeAttached();

    // Reopen via the second chord, search, and run: "database" must select the
    // Database command (Tools menu) and Enter must open the Database modal.
    await page.keyboard.press("Control+Shift+p");
    await expect(input).toBeVisible();
    await input.fill("database");
    await expect(page.locator(".cmdpal-item.sel")).toContainText("Database");
    await page.keyboard.press("Enter");
    await expect(page.locator(".cmdpal-overlay")).not.toBeAttached();
    await expect(page.locator(".db-modal")).toBeVisible();
  });
});

test.describe("dockable workspace", () => {
  test("boots the default layout, floats a panel by dragging, and resets", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("#save-ind")).toBeVisible(); // boot finished

    // Default layout: three docked regions (Maps / Tiles / Map), each with its
    // real content mounted (the map + palette canvases live inside the dock).
    const regions = page.locator("#dock-root .dock-region");
    await expect(regions).toHaveCount(3);
    await expect(page.locator("#dock-root #mapcanvas")).toBeVisible();
    await expect(page.locator("#dock-root #palette")).toBeVisible();

    // Drag the Tiles tab up into the menubar strip (no drop region there) to
    // detach it into a floating window; the palette content travels with it.
    const tilesTab = page.locator(".dock-tab", { hasText: "Tiles" }).first();
    const box = await tilesTab.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(430, 6, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".dock-float")).toHaveCount(1);
    await expect(page.locator(".dock-float #palette")).toBeVisible();
    await expect(page.locator("#dock-root .dock-region")).toHaveCount(2);

    // The layout persists across reloads.
    await page.reload();
    await expect(page.locator("#save-ind")).toBeVisible();
    await expect(page.locator(".dock-float")).toHaveCount(1);

    // Reset Panel Layout (View menu) restores the default three-region dock.
    await page.locator("#menus .menu-label", { hasText: "View" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "Reset Panel Layout" }).click();
    await expect(page.locator(".dock-float")).toHaveCount(0);
    await expect(page.locator("#dock-root .dock-region")).toHaveCount(3);
  });
});
