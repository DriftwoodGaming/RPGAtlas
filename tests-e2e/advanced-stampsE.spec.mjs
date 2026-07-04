/* RPGAtlas — tests-e2e/advanced-stampsE.spec.mjs
   Phase 8 Stage E: the Advanced Map Editor's tile transforms + stamps, driven
   through the real UI and verified against the editor's own persistence format
   (localStorage), the same ground-truth pattern editor.spec.mjs uses. No WebGL
   golden here — this is an editor-only, DOM-driven spec (the renderer goldens
   are run once per branch at merge, not per parallel worktree).
   GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";

const TILE_ID_MASK = (1 << 28) - 1;
const TILE_FLAG_MASK = (1 << 28) | (1 << 29) | (1 << 30);

async function boot(page) {
  await page.goto("/index.html");
  const saveIndicator = page.locator("#save-ind");
  await expect(saveIndicator).toBeVisible();
  await expect(saveIndicator).toHaveText(/^✓ /);
  return saveIndicator;
}

const readProject = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("rpgatlas_project")));

test.describe("Advanced editor — tile transforms (Stage E)", () => {
  test("flip brush (X) then paint stores a flag-bearing tile that survives save", async ({ page }) => {
    const saveIndicator = await boot(page);

    // Open the Advanced Map Editor (F4) and focus its canvas.
    await page.keyboard.press("F4");
    const advCanvas = page.locator(".adv-canvas");
    await expect(advCanvas).toBeVisible();

    // Choose a plain tile in the Advanced right-rail palette (first swatch is a
    // real tile id >= 1). Clicking sets S.selectedTile (shared with Standard).
    const firstSwatch = page.locator(".adv-tile-swatch").first();
    await expect(firstSwatch).toBeVisible();
    await firstSwatch.click();

    // Flip the brush horizontally via the toolbar button (equivalent to X key),
    // then rotate once (R). The transform indicator should light up.
    await page.locator(".adv-toolstrip button[title*='Flip Brush Horizontal']").click();
    await page.locator(".adv-toolstrip button[title*='Rotate Brush']").click();
    await expect(page.locator(".adv-xfm-label.active")).toBeVisible();

    // Paint a cell on the Advanced canvas (top-left, inside the map).
    const box = await advCanvas.boundingBox();
    await page.mouse.click(box.x + 6, box.y + 6);

    await expect(saveIndicator).toHaveText(/^● /);
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });

    const proj = await readProject(page);
    const mapId = proj.system.startMapId || proj.maps[0].id;
    const map = proj.maps.find((m) => m.id === mapId);

    // Painting on the Advanced canvas promotes the map to a stored layersAdv
    // stack; the active layer defaults to ground (a core, so map.layers.ground).
    // Somewhere in the ground array there must now be a value with flag bits.
    const flagged = map.layers.ground.some(
      (v) => (v & TILE_FLAG_MASK) !== 0 && (v & TILE_ID_MASK) > 0,
    );
    expect(flagged, "a flag-bearing tile should be persisted on the ground layer").toBe(true);

    // And a reload keeps it (round-trips through the save format).
    await page.reload();
    await expect(page.locator("#save-ind")).toHaveText(/^✓ /);
    const proj2 = await readProject(page);
    const map2 = proj2.maps.find((m) => m.id === mapId);
    expect(map2.layers.ground.some((v) => (v & TILE_FLAG_MASK) !== 0)).toBe(true);
  });
});

test.describe("Advanced editor — stamps (Stage E)", () => {
  test("capture a selection as a stamp and place it (round-trips through save)", async ({ page }) => {
    const saveIndicator = await boot(page);

    // First paint a couple of cells in the Standard Map view so there's content
    // to capture, then select an area around them.
    const paletteCanvas = page.locator("#palette");
    const mapCanvas = page.locator("#mapcanvas");
    const palBox = await paletteCanvas.boundingBox();
    await page.mouse.click(palBox.x + palBox.width * 0.5, palBox.y + 8);
    const mapBox = await mapCanvas.boundingBox();
    await page.mouse.click(mapBox.x + 12, mapBox.y + 12);
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });

    // Shift+drag a small marquee selection over the painted area.
    await page.mouse.move(mapBox.x + 6, mapBox.y + 6);
    await page.keyboard.down("Shift");
    await page.mouse.down();
    await page.mouse.move(mapBox.x + 60, mapBox.y + 60);
    await page.mouse.up();
    await page.keyboard.up("Shift");

    // Open the Advanced editor's Stamps tab and Capture Selection (the marquee
    // in S.selection is shared across panels). A name dialog appears; Save.
    await page.keyboard.press("F4");
    await page.locator(".adv-rail-tab", { hasText: "Stamps" }).click();
    await page.locator(".adv-rail-actions button").click();
    const dialogSave = page.locator(".modal-btns button.primary");
    await expect(dialogSave).toBeVisible();
    await dialogSave.click();

    // The stamp is now in proj.stamps.
    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });
    let proj = await readProject(page);
    expect(Array.isArray(proj.stamps) && proj.stamps.length >= 1).toBe(true);
    const stamp = proj.stamps[0];
    expect(stamp.w).toBeGreaterThan(0);
    expect(stamp.h).toBeGreaterThan(0);

    // Arm placement from the stamp row and drop it on the Advanced canvas.
    await page.locator(".adv-stamp-row button[title*='Place']").first().click();
    const advCanvas = page.locator(".adv-canvas");
    const advBox = await advCanvas.boundingBox();
    await page.mouse.click(advBox.x + advBox.width * 0.6, advBox.y + advBox.height * 0.6);

    await expect(saveIndicator).toHaveText(/^✓ /, { timeout: 5000 });
    proj = await readProject(page);
    // The stamp still round-trips in the save file.
    expect(proj.stamps.length).toBeGreaterThanOrEqual(1);
    expect(proj.stamps[0].layers).toBeTruthy();
  });
});
