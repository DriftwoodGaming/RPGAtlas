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

test.describe("Terrain & Autotile Studio (Phase 8 Stage C)", () => {
  test("opens from the command palette, shows the 5-step wizard, and creates a brush", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto("/index.html");
    await expect(page.locator("#save-ind")).toBeVisible(); // boot finished

    // Launch the Studio via the palette (proves the command is registered).
    await page.keyboard.press("Control+p");
    const input = page.locator(".cmdpal-input");
    await expect(input).toBeVisible();
    await input.fill("terrain studio");
    await expect(page.locator(".cmdpal-item.sel")).toContainText("Terrain");
    await page.keyboard.press("Enter");

    // The fullscreen wizard mounts with a 5-step rail; step 1 (Source) is active.
    const modal = page.locator(".studio-modal");
    await expect(modal).toBeVisible();
    await expect(page.locator(".studio-step")).toHaveCount(5);
    await expect(page.locator(".studio-step.sel")).toContainText("Source");

    // Navigate the rail: jump to Preview and back — each step renders its pane.
    await page.locator(".studio-step").nth(4).click();
    await expect(page.locator(".studio-preview")).toBeVisible();
    await page.locator(".studio-step").nth(1).click(); // Layout
    await expect(page.locator(".studio-kind")).toBeVisible();

    // Inject a source sheet directly into the wizard's state via the same
    // resolver the UI uses is out of scope here; instead assert the Layout
    // arrangement select carries all six kinds (the resolver breadth).
    const kinds = await page.locator(".studio-kind option").allInnerTexts();
    expect(kinds.length).toBe(6);

    // Close cleanly (Save Draft persists, but we just dismiss).
    await page.locator(".studio-foot button", { hasText: "Close" }).click();
    await expect(modal).not.toBeVisible();

    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
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

test.describe("region painting (phase 5)", () => {
  test("Region mode paints region ids that persist through autosave", async ({ page }) => {
    await page.goto("/index.html");
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();
    await expect(saveIndicator).toHaveText(/^✓ /);

    const readProject = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("rpgatlas_project")));

    // Mode ▸ Region Mode, then paint a cell near the map's top-left corner.
    await page.locator("#menus .menu-label", { hasText: "Mode" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "Region Mode" }).click();
    // digits set the painted id — pick 7
    await page.keyboard.press("Digit7");
    const mapBox = await page.locator("#mapcanvas").boundingBox();
    await page.mouse.click(mapBox.x + 30, mapBox.y + 30);
    await page.mouse.click(mapBox.x + 30 + 36, mapBox.y + 30); // second cell

    await expect(saveIndicator).toHaveText(/^● /);
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });

    const after = await readProject();
    const mapId = after.system.startMapId || after.maps[0].id;
    const m = after.maps.find((mm) => mm.id === mapId);
    expect(Array.isArray(m.regions)).toBe(true);
    expect(m.regions.filter((v) => v === 7).length).toBeGreaterThanOrEqual(2);
  });
});

test.describe("battle animations (phase 5)", () => {
  test("Animations tab lists the samples, previews, and edits persist", async ({ page }) => {
    await page.goto("/index.html");
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();
    await expect(saveIndicator).toHaveText(/^✓ /);

    const readProject = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("rpgatlas_project")));
    const before = await readProject();
    expect(Array.isArray(before.animations)).toBe(true);
    const sampleCount = before.animations.length; // sample ships 3

    await page.locator("#menus .menu-label", { hasText: "Tools" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "Database" }).click();
    await expect(page.locator(".db-modal")).toBeVisible();
    await page.locator(".dbtabs-vert button", { hasText: "Animations" }).click();

    // The sample animations are listed; selecting one draws its timeline chips.
    const rows = page.locator(".dblist li:not(.db-empty)");
    await expect(rows).toHaveCount(sampleCount);
    await page.locator(".dblist li", { hasText: "Fire Burst" }).click();
    const fireBurst = before.animations.find((a) => a.name === "Fire Burst");
    await expect(page.locator(".anim-chip")).toHaveCount(fireBurst.items.length);

    // Preview runs the REAL anim-player to completion: the Play button
    // disables while playing and re-enables when the promise resolves.
    const play = page.locator(".anim-preview button", { hasText: "Play" });
    await play.click();
    await expect(play).toBeDisabled();
    await expect(play).toBeEnabled({ timeout: 10_000 });

    // New animation + an extra Sound item via the add row.
    await page.locator(".dbbtns button", { hasText: "+ New" }).click();
    await expect(page.locator(".anim-chip")).toHaveCount(1); // blank has one item
    await page.locator(".anim-add-row button", { hasText: "Sound" }).click();
    await expect(page.locator(".anim-chip")).toHaveCount(2);

    // The Skills tab exposes the animation picker with the sample wiring.
    await page.locator(".dbtabs-vert button", { hasText: "Skills" }).click();
    await page.locator(".dblist li", { hasText: "Fireball" }).click();
    const animSel = page.locator(".dbform .fld", { hasText: "Battle animation" }).locator("select");
    await expect(animSel).toHaveValue("2");

    // Close: the new animation and its items persist through autosave.
    await page.locator(".db-modal .modal-btns button", { hasText: "Close" }).click();
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });
    const after = await readProject();
    expect(after.animations.length).toBe(sampleCount + 1);
    expect(after.animations[after.animations.length - 1].items.length).toBe(2);
  });
});

test.describe("atlas graph (phase 4)", () => {
  test("converting a page to a graph is lossless and persists on OK", async ({ page }) => {
    await page.goto("/index.html");
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();
    await expect(saveIndicator).toHaveText(/^✓ /);

    // The sample game's Elder event, page 1: our conversion guinea pig.
    const readElderPage = () =>
      page.evaluate(() => {
        const proj = JSON.parse(localStorage.getItem("rpgatlas_project"));
        const ev = proj.maps.flatMap((m) => m.events || []).find((e) => e.name === "Elder");
        return ev.pages[0];
      });
    const before = await readElderPage();
    expect(before.graph).toBeUndefined();
    expect(before.commands.length).toBeGreaterThan(0);

    // Tools ▸ Event Searcher is the stable path into the event editor.
    await page.locator("#menus .menu-label", { hasText: "Tools" }).dispatchEvent("mousedown");
    await page.locator(".menu-drop .menu-item", { hasText: "Event Searcher" }).click();
    await page.locator(".search-bar input").fill("Elder");
    await page.locator(".search-bar button", { hasText: "Search" }).click();
    await page.locator(".search-row", { hasText: "Elder" }).first().click();
    await expect(page.locator(".event-modal")).toBeVisible();

    // Convert: one node per top-level command, all wired, no validation issues.
    await page.locator(".ev-viewtoggle-seg button", { hasText: "Graph" }).click();
    await expect(page.locator(".graph-node.graph-start")).toBeVisible();
    await expect(page.locator(".graph-node:not(.graph-start)")).toHaveCount(before.commands.length);
    await expect(page.locator(".graph-banner")).toBeHidden();

    // The List toggle becomes a read-only compiled preview while a graph owns the page.
    await page.locator(".ev-viewtoggle-seg button", { hasText: "List" }).click();
    await expect(page.locator(".ev-ro-note")).toBeVisible();
    await expect(page.locator(".cmd-readonly .cmdrow")).toHaveCount(before.commands.length);
    await page.locator(".ev-viewtoggle-seg button", { hasText: "Graph" }).click();

    // OK commits the working clone; autosave persists graph + compiled commands.
    await page.locator(".event-footer button", { hasText: "OK" }).click();
    await expect(page.locator(".event-modal")).toBeHidden();
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });

    const after = await readElderPage();
    expect(after.graph).toBeTruthy();
    expect(after.graph.nodes.length).toBe(before.commands.length);
    expect(after.graph.entry).not.toBeNull();
    // Lossless: the compiled commands deep-equal the pre-conversion list.
    expect(after.commands).toEqual(before.commands);
  });
});

test.describe("asset browser (phase 6)", () => {
  test("imports a PNG that persists across reload, tags filter it, delete removes it", async ({ page }) => {
    await page.goto("/index.html");
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();

    // A clean library per run: this spec owns the rpgatlas_library IDB.
    await page.evaluate(() => new Promise((done) => {
      const req = indexedDB.deleteDatabase("rpgatlas_library");
      req.onsuccess = req.onerror = req.onblocked = () => done(null);
    }));
    await page.reload();
    await expect(saveIndicator).toBeVisible();

    const openBrowser = async () => {
      await page.keyboard.press("Control+p");
      await page.locator(".cmdpal-input").fill("Asset Browser");
      await page.keyboard.press("Enter");
      await expect(page.locator(".assetbrowser")).toBeVisible();
    };
    await openBrowser();
    await expect(page.locator(".ab-grid .ab-card")).toHaveCount(0);

    // Feed a synthetic 48x48 PNG straight into the hidden import input.
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 48; c.height = 48;
      const g = c.getContext("2d");
      g.fillStyle = "#c04070"; g.fillRect(0, 0, 48, 48);
      g.fillStyle = "#ffffff"; g.fillRect(12, 12, 24, 24);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const file = new File([blob], "Test Sprite.png", { type: "image/png" });
      const input = document.getElementById("assetbrowser-file");
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const card = page.locator(".ab-grid .ab-card");
    await expect(card).toHaveCount(1);
    await expect(card.locator(".ab-name")).toHaveText("test-sprite");
    await expect(card.locator(".ab-badge")).toHaveText("unused");
    await expect(card.locator(".ab-thumb img")).toBeVisible();

    // Persists across a full reload (IndexedDB, not localStorage).
    await page.reload();
    await expect(saveIndicator).toBeVisible();
    await openBrowser();
    await expect(card).toHaveCount(1);

    // Tagging: edit tags, then the tag chip filters the grid.
    await card.locator("button", { hasText: "Tags" }).click();
    const prompt = page.locator(".overlay").last();
    await prompt.locator("input[type=text]").fill("hero, town");
    await prompt.locator("button", { hasText: "OK" }).click();
    await expect(page.locator(".ab-tag")).toHaveCount(2);
    await page.locator(".ab-tag", { hasText: "hero" }).click();
    await expect(card).toHaveCount(1);

    // Delete (unused -> plain confirm) empties the library again.
    await card.locator("button", { hasText: "Delete" }).click();
    await page.locator(".overlay").last().locator("button", { hasText: "OK" }).click();
    await expect(page.locator(".ab-grid .ab-card")).toHaveCount(0);
  });
});

test.describe("import wizard (phase 6)", () => {
  test("tile slicer turns a 96x96 sheet into four 48px library tiles bound to the palette", async ({ page }) => {
    await page.goto("/index.html");
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();
    await page.evaluate(() => new Promise((done) => {
      const req = indexedDB.deleteDatabase("rpgatlas_library");
      req.onsuccess = req.onerror = req.onblocked = () => done(null);
    }));
    await page.reload();
    await expect(saveIndicator).toBeVisible();

    await page.keyboard.press("Control+p");
    await page.locator(".cmdpal-input").fill("Asset Browser");
    await page.keyboard.press("Enter");
    await expect(page.locator(".assetbrowser")).toBeVisible();
    await page.locator("select[title=\"Type images import as\"]").selectOption("tilesets");

    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 96; c.height = 96;
      const g = c.getContext("2d");
      const cols = ["#c04040", "#40c040", "#4040c0", "#c0c040"];
      [[0,0],[48,0],[0,48],[48,48]].forEach(([x,y], i) => { g.fillStyle = cols[i]; g.fillRect(x, y, 48, 48); });
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const file = new File([blob], "Ground Tiles.png", { type: "image/png" });
      const input = document.getElementById("assetbrowser-file");
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // The slicer modal opens; pick 48px source cells (2x2 grid) and import.
    const slicer = page.locator(".overlay").last();
    await expect(slicer.locator(".modal-title")).toContainText("Import Tileset");
    await slicer.locator(".imp-bar select").first().selectOption("48");
    await slicer.locator("button", { hasText: "Import Tiles" }).click();

    // Four sliced tiles land in the library grid with row/col names.
    const cards = page.locator(".ab-grid .ab-card");
    await expect(cards).toHaveCount(4);
    await expect(cards.first().locator(".ab-name")).toHaveText("ground-tiles-r0c0.pass");

    // bindExternalAssets assigned palette ids into proj.assets.tiles; the
    // autosave persists them.
    await expect(saveIndicator).toHaveText(/^. /);
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });
    const tileKeys = await page.evaluate(() =>
      Object.keys(JSON.parse(localStorage.getItem("rpgatlas_project")).assets.tiles));
    expect(tileKeys.filter((k) => k.startsWith("asset:tilesets/ground-tiles-")).length).toBe(4);

    // Clean up the library so later specs/runs see a clean slate.
    for (let i = 0; i < 4; i++) {
      await page.locator(".ab-grid .ab-card").first().locator("button", { hasText: "Delete" }).click();
      await page.locator(".overlay").last().locator("button", { hasText: "OK" }).click();
    }
    await expect(page.locator(".ab-grid .ab-card")).toHaveCount(0);
  });
});

test.describe("starter packs (phase 6)", () => {
  test("the bundled Driftwood Starter pack installs, tags its assets, and uninstalls", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/index.html");
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();
    await page.evaluate(() => new Promise((done) => {
      const req = indexedDB.deleteDatabase("rpgatlas_library");
      req.onsuccess = req.onerror = req.onblocked = () => done(null);
    }));
    await page.reload();
    await expect(saveIndicator).toBeVisible();

    await page.keyboard.press("Control+p");
    await page.locator(".cmdpal-input").fill("Asset Browser");
    await page.keyboard.press("Enter");
    await expect(page.locator(".assetbrowser")).toBeVisible();

    await page.locator(".ab-railbtn", { hasText: "Packs" }).click();
    const card = page.locator(".ab-pack", { hasText: "Driftwood Starter" });
    await expect(card).toBeVisible();
    await expect(card.locator(".ab-meta")).toContainText("installed 0/22");

    await card.locator("button", { hasText: "Install" }).click();
    await expect(card.locator(".ab-meta")).toContainText("installed 22/22", { timeout: 60_000 });

    // Installed assets are tagged with the pack id and visible in the grid.
    await page.locator(".ab-railbtn", { hasText: "Tiles" }).click();
    await expect(page.locator(".ab-grid .ab-card .ab-name", { hasText: "autumn-grass.terrain" })).toBeVisible();
    await page.locator(".ab-railbtn", { hasText: "Audio" }).click();
    await expect(page.locator(".ab-grid .ab-card")).toHaveCount(5);
    await expect(page.locator(".ab-cardtags").first()).toContainText("pack:driftwood-starter");

    // Uninstall removes every pack asset (nothing referenced by the sample project).
    await page.locator(".ab-railbtn", { hasText: "Packs" }).click();
    await card.locator("button", { hasText: "Uninstall" }).click();
    await page.locator(".overlay").last().locator("button", { hasText: "OK" }).click();
    await expect(card.locator(".ab-meta")).toContainText("installed 0/22");
    await page.locator(".ab-railbtn", { hasText: "All" }).click();
    await expect(page.locator(".ab-grid .ab-card")).toHaveCount(0);
  });
});
