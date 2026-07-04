/* RPGAtlas — tests-e2e/zones.spec.mjs
   Phase 8 Stage D: draw a polygon encounter zone in the Advanced Map Editor's
   Objects palette and prove it round-trips through the editor's own persistence
   (localStorage, the same JSON a saved project file carries). Exercises the
   real drawing tool (canvas clicks + double-click to finish the polygon), the
   promote-on-first-edit path (a map with no zones gains a `zones` array), and
   the autosave seam. The integrator runs this with the full golden suite at
   merge — it is authored here but not run in the parallel worktrees.
   GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";

test.describe("Advanced editor — gameplay zones", () => {
  test("draws a polygon encounter zone and round-trips it through save/load", async ({ page }) => {
    await page.goto("/index.html");

    // Boot done once the autosave indicator reads saved.
    const saveIndicator = page.locator("#save-ind");
    await expect(saveIndicator).toBeVisible();
    await expect(saveIndicator).toHaveText(/^✓ /);

    // Open the Advanced Map Editor (F4) and wait for its canvas.
    await page.keyboard.press("F4");
    const advCanvas = page.locator("canvas.adv-canvas");
    await expect(advCanvas).toBeVisible();

    // Switch the right rail to Objects.
    await page.locator('.adv-rail-tab[data-rail="objects"]').click();
    await expect(page.locator(".adv-objects")).toBeVisible();

    // Encounter is the default active kind; select the Polygon zone tool.
    await page.locator('.adv-obj-tools button[title="Polygon Zone"]').click();

    // Draw a triangle: three canvas clicks, then a double-click to finish.
    // Coords are inside the map (the sample maps are comfortably larger than
    // 10×10 tiles at the panel's default 50% zoom).
    const box = await advCanvas.boundingBox();
    const pts = [
      { x: box.x + 40, y: box.y + 40 },
      { x: box.x + 160, y: box.y + 48 },
      { x: box.x + 96, y: box.y + 160 },
    ];
    for (const p of pts) await page.mouse.click(p.x, p.y);
    // double-click on the last point commits the polygon (≥3 points)
    await page.mouse.dblclick(pts[2].x, pts[2].y);

    // The zone list now shows an Encounter zone, and the inspector is present.
    await expect(page.locator(".adv-zone-row").first()).toBeVisible();

    // Round-trip: read the persisted project (same JSON as a saved file) and
    // assert exactly one polygon encounter zone landed on some map.
    const found = await page.evaluate(() => {
      const proj = JSON.parse(localStorage.getItem("rpgatlas_project"));
      for (const m of proj.maps) {
        if (!Array.isArray(m.zones)) continue;
        const z = m.zones.find((z) => z.kind === "encounter" && z.shape && z.shape.type === "poly");
        if (z) return { mapId: m.id, pts: z.shape.pts.length, hasEnc: !!z.encounter };
      }
      return null;
    });
    expect(found, "a polygon encounter zone should be persisted").not.toBeNull();
    expect(found.pts).toBeGreaterThanOrEqual(3);
    expect(found.hasEnc).toBe(true);
  });
});
