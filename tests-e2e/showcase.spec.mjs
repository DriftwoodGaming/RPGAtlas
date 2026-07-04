/* RPGAtlas — tests-e2e/showcase.spec.mjs
   Phase 7 Stage D: the Atlas Quest HD showcase map (Driftwood Shore, map 4)
   loads through the real project pipeline with the HD-2D renderer active —
   guarding the sample game's flagship content against schema or renderer
   regressions. Phase 8 Stage G adds the Advanced Map Editor showcase
   (Meridian Village — Advanced, map 5): the generalized layer stack renders
   and the gameplay zones answer through the runtime. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

test("Driftwood Shore loads HD-2D with its dusk showcase config", async ({ page }) => {
  await gotoWithAtlasQuest(page, "/play.html?hd2d=1", {
    transformProject: (project) => {
      // Test-only warp (the in-game route is the cave's shore passage).
      project.commonEvents = [{ id: 1, name: "warp", trigger: "none", switchId: 0,
        commands: [{ t: "transfer", mapId: 4, x: 5, y: 6 }] }];
      return project;
    },
  });
  await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByText("New Game", { exact: true }).click();
  await expect(page.locator(".titlewin")).toHaveCount(0, { timeout: 20_000 });
  await expect
    .poll(() => page.evaluate(() => window.Atlas.atlas.scene === "map" && !!window.Atlas.atlas.player))
    .toBe(true);

  await page.evaluate(async () => {
    await window.Atlas.game.callCommonEvent(1);
  });
  await expect.poll(() => page.evaluate(() => window.Atlas.atlas.map.name)).toBe("Driftwood Shore");

  const state = await page.evaluate(() => ({
    hd2d: window.Atlas.atlas.map.hd2d,
    gpu: window.RPGATLAS_RENDERER_STATS(),
    events: window.Atlas.atlas.map.events.map((e) => e.name),
  }));
  // The flagship feature set is on and the GL scene is really rendering it.
  expect(state.hd2d).toMatchObject({
    enabled: true, water: true, cliffs: true, dayNight: true, materials: true, bloom: true,
  });
  expect(state.gpu).not.toBeNull();
  expect(state.gpu.calls).toBeGreaterThan(0);
  expect(state.events).toEqual(["To the Cave", "Sign", "Old Fisherman"]);
});

test("Meridian Village — Advanced loads its layer stack and zones (Phase 8)", async ({ page }) => {
  await gotoWithAtlasQuest(page, "/play.html?hd2d=0", {
    transformProject: (project) => {
      // Test-only warp (in the editor the map is opened directly / via F4).
      project.commonEvents = [{ id: 1, name: "warp", trigger: "none", switchId: 0,
        commands: [{ t: "transfer", mapId: 5, x: 12, y: 12 }] }];
      return project;
    },
  });
  await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByText("New Game", { exact: true }).click();
  await expect(page.locator(".titlewin")).toHaveCount(0, { timeout: 20_000 });
  await expect
    .poll(() => page.evaluate(() => window.Atlas.atlas.scene === "map" && !!window.Atlas.atlas.player))
    .toBe(true);

  await page.evaluate(async () => {
    await window.Atlas.game.callCommonEvent(1);
  });
  await expect.poll(() => page.evaluate(() => window.Atlas.atlas.map.name))
    .toBe("Meridian Village — Advanced");

  const state = await page.evaluate(() => ({
    layers: window.Atlas.atlas.map.layersAdv.length,
    plaza: window.Atlas.atlas.zonesAt(14, 10).map((z) => z.kind),
    meadow: window.Atlas.atlas.zonesAt(15, 11).map((z) => z.kind),
    outside: window.Atlas.atlas.zonesAt(0, 0).length,
    rules: window.Atlas.atlas.map.automapRules.length,
  }));
  // The generalized stack loaded (engine composite branch), the zones answer
  // through the plugin surface, and the automap rules ride along inertly.
  expect(state.layers).toBeGreaterThan(4);
  expect(state.plaza).toContain("custom");
  expect(state.meadow).toContain("encounter");
  expect(state.outside).toBe(0);
  expect(state.rules).toBeGreaterThanOrEqual(2);
});
