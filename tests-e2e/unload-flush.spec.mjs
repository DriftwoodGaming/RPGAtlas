/* RPGAtlas — tests-e2e/unload-flush.spec.mjs
   Leaving-the-page autosave flush (browser build): an edit whose debounced
   autosave (700ms) has not fired yet must survive a reload / tab close — the
   pagehide flush in src/editor/persistence.ts writes the localStorage mirror
   synchronously before the page dies. Without it, the child's last brush
   strokes silently vanish. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";

test.describe("leaving-the-page flush", () => {
  test("an edit made moments before a reload survives it", async ({ page }) => {
    await page.goto("/index.html");
    const saveInd = page.locator("#save-ind");
    await expect(saveInd).toBeVisible();
    // boot() ends with an unconditional saveNow(), so once the indicator reads
    // "✓ saved" the mirror holds the settled, normalized project.
    await expect(saveInd).toHaveText(/^✓ /);

    const readLayers = () =>
      page.evaluate(() => {
        const p = JSON.parse(localStorage.getItem("rpgatlas_project"));
        const map = p.maps.find((m) => m.id === (p.system.startMapId || p.maps[0].id));
        return JSON.stringify(map.layers);
      });
    const layersBefore = await readLayers();

    // Paint a tile (same proven combo as editor.spec.mjs), then reload while the
    // debounced autosave is still pending (●) — before this fix, the paint died
    // with the timer.
    const pBox = await page.locator("#palette").boundingBox();
    await page.mouse.click(pBox.x + pBox.width * 0.5, pBox.y + 8);
    const mBox = await page.locator("#mapcanvas").boundingBox();
    await page.mouse.click(mBox.x + 10, mBox.y + 10);
    await expect(saveInd).toHaveText(/^● /);
    await page.reload();

    // Boot completes on the SAVED paint: pagehide flushed the mirror before the
    // page died, so the reloaded project's layers differ from the pre-paint ones.
    await expect(saveInd).toBeVisible();
    await expect(saveInd).toHaveText(/^✓ /);
    expect(await readLayers()).not.toBe(layersBefore);
  });
});
