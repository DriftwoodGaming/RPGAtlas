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

test.describe("live HD-2D viewport", () => {
  test("opens as a dock panel and a double-click drops a point light that persists", async ({ page }) => {
    await page.goto("/index.html");
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible(); // boot finished
    await expect(saveIndicator).toHaveText(/^✓ /);

    // View ▸ HD-2D Viewport docks the renderer panel (a 4th region) with its
    // canvas mounted inside the dock. It is not in the default layout, so this
    // also exercises showPanel adding a brand-new panel beside the map view.
    await page.locator("#menus .menu-label", { hasText: "View" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "HD-2D Viewport" }).click();
    const canvas = page.locator("#dock-root .hd-viewport-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".dock-tab", { hasText: "HD-2D" })).toBeVisible();

    const readProject = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("rpgatlas_project")));
    const before = await readProject();
    const mapId = before.system.startMapId || before.maps[0].id;
    const lightsBefore = (before.maps.find((m) => m.id === mapId).lights || []).length;

    // Double-click empty viewport space → a point light is placed on the ground
    // there (the first editor affordance for map.lights). The gizmo math runs
    // off the panel size, so this works without asserting on WebGL output.
    const box = await canvas.boundingBox();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

    await expect(saveIndicator).toHaveText(/^● /);
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });

    const after = await readProject();
    const mapAfter = after.maps.find((m) => m.id === mapId);
    expect(Array.isArray(mapAfter.lights)).toBe(true);
    expect(mapAfter.lights.length).toBe(lightsBefore + 1);
    const L = mapAfter.lights[mapAfter.lights.length - 1];
    expect(typeof L.rx).toBe("number");
    expect(typeof L.ry).toBe("number");
    expect(L.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(L.radius).toBeGreaterThan(0);
  });
});

test.describe("world view", () => {
  test("opens as a dock panel, draws a node per map, and dragging one persists worldPos", async ({ page }) => {
    await page.goto("/index.html");
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();
    await expect(saveIndicator).toHaveText(/^✓ /);

    const readProject = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("rpgatlas_project")));
    const before = await readProject();
    const mapCount = before.maps.length;

    // View ▸ World View docks the map-connection graph (a brand-new panel).
    await page.locator("#menus .menu-label", { hasText: "View" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "World View" }).click();
    await expect(page.locator(".dock-tab", { hasText: "World" })).toBeVisible();

    const nodes = page.locator("#dock-root .wv-node");
    await expect(nodes).toHaveCount(mapCount);

    // Drag the first map node; its position is saved to map.worldPos.
    const node = nodes.first();
    const box = await node.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 60, { steps: 6 });
    await page.mouse.up();

    await expect(saveIndicator).toHaveText(/^● /);
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });

    const after = await readProject();
    const pinned = after.maps.filter((m) => m.worldPos && typeof m.worldPos.x === "number");
    expect(pinned.length).toBeGreaterThanOrEqual(1);
  });
});

test.describe("database list upgrades", () => {
  test("search filters the list and checking a row reveals the bulk bar", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator("#save-ind")).toBeVisible();

    // Open the Database and switch to the Items list tab.
    await page.locator("#menus .menu-label", { hasText: "Tools" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "Database" }).click();
    await expect(page.locator(".db-modal")).toBeVisible();
    await page.locator(".dbtabs-vert button", { hasText: "Items" }).click();

    const rows = page.locator(".dblist li:not(.db-empty)");
    await expect(rows.first()).toBeVisible();

    // A query that matches nothing empties the list; clearing restores it.
    const search = page.locator(".dbsearch");
    await search.fill("zzzznope");
    await expect(page.locator(".dblist .db-empty")).toBeVisible();
    await search.fill("");
    await expect(rows.first()).toBeVisible();

    // Checking a row's checkbox reveals the bulk action bar.
    await expect(page.locator(".dbbulk")).toBeHidden();
    await page.locator(".dblist li .db-entry-check").first().check();
    await expect(page.locator(".dbbulk")).toBeVisible();
    await expect(page.locator(".dbbulk button", { hasText: "Bulk Edit" })).toBeVisible();
  });
});

test.describe("unified undo", () => {
  test("a Database edit commits to the shared history and Ctrl+Z reverts it", async ({ page }) => {
    await page.goto("/index.html");
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();
    await expect(saveIndicator).toHaveText(/^✓ /);

    const readProject = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("rpgatlas_project")));
    const before = await readProject();
    const nameBefore = before.items[0].name;

    // Open the Database, rename the first item through its bound input.
    await page.locator("#menus .menu-label", { hasText: "Tools" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "Database" }).click();
    await expect(page.locator(".db-modal")).toBeVisible();
    await page.locator(".dbtabs-vert button", { hasText: "Items" }).click();
    const nameInput = page.locator(".dbform input[type=text]").first();
    await expect(nameInput).toHaveValue(nameBefore);
    await nameInput.fill("Renamed By Test");

    // Close: the scoped-edit window commits as one "Database edit" entry.
    await page.locator(".db-modal .modal-btns button", { hasText: "Close" }).click();
    await expect(page.locator(".db-modal")).not.toBeAttached();
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });
    expect((await readProject()).items[0].name).toBe("Renamed By Test");

    // The Edit menu labels the pending step from the tagged stack.
    await page.locator("#menus .menu-label", { hasText: "Edit" }).dispatchEvent("mousedown");
    await expect(page.locator(".menu-drop .menu-item", { hasText: "Undo — Database edit" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Ctrl+Z restores the name in place; Ctrl+Y re-applies it.
    await page.keyboard.press("Control+z");
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });
    expect((await readProject()).items[0].name).toBe(nameBefore);
    await page.keyboard.press("Control+y");
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });
    expect((await readProject()).items[0].name).toBe("Renamed By Test");
  });

  test("Ctrl+Z works inside the open Database dialog and refreshes the tab", async ({ page }) => {
    await page.goto("/index.html");
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();
    await expect(saveIndicator).toHaveText(/^✓ /);

    const readProject = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("rpgatlas_project")));
    const itemCount = (await readProject()).items.length;

    await page.locator("#menus .menu-label", { hasText: "Tools" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "Database" }).click();
    await page.locator(".dbtabs-vert button", { hasText: "Items" }).click();

    // "+ New" adds an entry (a structural edit caught by the same scope) …
    await page.locator(".dbbtns button", { hasText: "+ New" }).click();
    await expect(page.locator(".dblist li:not(.db-empty)")).toHaveCount(itemCount + 1);

    // … and Ctrl+Z with focus outside a text field (the list) undoes it live:
    // the debounced window is flushed by undo() itself, no wait needed.
    await page.locator(".dblist li").first().click();
    await page.locator(".db-modal .modal-title").click(); // blur any input
    await page.keyboard.press("Control+z");
    await expect(page.locator(".dblist li:not(.db-empty)")).toHaveCount(itemCount);
    await expect(page.locator(".db-modal")).toBeVisible(); // dialog stayed open

    await page.locator(".db-modal .modal-btns button", { hasText: "Close" }).click();
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });
    expect((await readProject()).items.length).toBe(itemCount);
  });
});

test.describe("autotiles", () => {
  test("importing an A2 sheet adds a terrain brush; painting writes autotile ids", async ({ page }) => {
    await page.goto("/index.html");
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();
    await expect(saveIndicator).toHaveText(/^✓ /);

    // Feed a synthetic RPG-Maker A2 block (96x144 = 4x6 minitiles) straight into
    // the hidden file input: build it in-page from a canvas so the test carries
    // no binary fixture, then dispatch the same change event the UI listens for.
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 96; c.height = 144;
      const g = c.getContext("2d");
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 4; x++) {
          g.fillStyle = `hsl(${(x + y * 4) * 15}, 70%, 50%)`;
          g.fillRect(x * 24, y * 24, 24, 24);
        }
      }
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const file = new File([blob], "grass.png", { type: "image/png" });
      const input = document.getElementById("autotile-file");
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // The import decodes and appends a swatch to the Tiles panel.
    const swatch = page.locator("#autotile-strip .autotile-swatch");
    await expect(swatch).toHaveCount(1);
    await swatch.first().click();

    const readProject = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("rpgatlas_project")));

    // Paint a couple of adjacent cells so the blob resolver has neighbours.
    const mapBox = await page.locator("#mapcanvas").boundingBox();
    await page.mouse.click(mapBox.x + 30, mapBox.y + 30);
    await page.mouse.click(mapBox.x + 60, mapBox.y + 30);

    await expect(saveIndicator).toHaveText(/^● /);
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });

    const after = await readProject();
    expect(Array.isArray(after.autotiles)).toBe(true);
    expect(after.autotiles.length).toBe(1);
    expect(after.autotiles[0].sheet).toMatch(/^data:image\/png/);

    // Painted cells store the reserved autotile id (AUTOTILE_BASE = 1_000_000),
    // not a plain tile index — the map format stays integer ids.
    const mapId = after.system.startMapId || after.maps[0].id;
    const ground = after.maps.find((m) => m.id === mapId).layers.ground;
    const painted = ground.filter((v) => v >= 1_000_000);
    expect(painted.length).toBeGreaterThanOrEqual(2);
  });
});
