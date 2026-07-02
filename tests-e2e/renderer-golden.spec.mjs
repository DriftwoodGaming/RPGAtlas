/* RPGAtlas — tests-e2e/renderer-golden.spec.mjs
   Golden-image harness for the map renderer: HD-2D (WebGL2) and classic
   (Canvas 2D) paths, both on the sample project's start map.

   WHAT THIS PROTECTS: the Phase 2 renderer port must reproduce these pixels
   (within the configured tolerance). If a future renderer rewrite changes
   these screenshots, that's either an intentional visual change (update the
   baseline — see tests-e2e/README.md) or a regression to investigate.

   DETERMINISM:
   - The engine's whole simulation is driven by requestAnimationFrame via a
     fixed-timestep loop (see js/engine.js loop()/TICK_MS) and setTimeout-based
     fades (sleep()). Playwright's page.clock.install() replaces both with a
     virtual clock we advance by an exact number of milliseconds, so every run
     performs the exact same number of ticks — confirmed byte-identical
     screenshots across repeated runs in development of this harness.
   - The renderer itself (js/renderer.js) has no internal Math.random()/
     Date.now()/performance.now() calls — every animated value (light
     flicker, camera shake, walk-cycle frame) derives from the engine's tick
     counter (globalT), so freezing the clock freezes the whole scene.
   - Chromium is launched with software-rendering flags (SwiftShader/ANGLE —
     see playwright.config.mjs) so the WebGL2 HD-2D path rasterizes the same
     way regardless of the host GPU.
   - The viewport is fixed at exactly the project's configured screen
     resolution (816x624) so js/engine.js fitStage() computes scale = 1
     (window.innerWidth/SCREEN_W == 1) — no sub-pixel canvas scaling to
     introduce interpolation differences between machines.
   GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

const SCREEN_SIZE = { width: 816, height: 624 }; // matches Atlas_Quest system.screenWidth/Height

test.use({ viewport: SCREEN_SIZE });

/** Boots play.html with the clock frozen, starts a new game, and advances
 * the virtual clock through the title/map fade transitions plus a fixed
 * number of extra ticks so any looping animation (idle/walk frames, light
 * flicker) lands on the same frame every time. */
async function bootToStableMap(page, hdParam, transformProject) {
  await gotoWithAtlasQuest(page, `/play.html?hd2d=${hdParam}`, {
    installClock: true,
    transformProject,
  });
  await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 15_000 });
  // A couple of virtual frames for the title backdrop to finish its own setup.
  await page.clock.runFor(50);
  await page.getByText("New Game", { exact: true }).click();
  // newGame(): fadeTo(1,300) -> loadMap -> render() -> fadeTo(0,300); each
  // fadeTo awaits sleep(ms+30). 700ms of virtual time clears both fades.
  await page.clock.runFor(700);
  await expect(page.locator(".titlewin")).toHaveCount(0);
  // Extra fixed run so the walk-cycle/idle animation and any light flicker
  // settle on a specific, reproducible tick rather than whatever frame the
  // fade happened to land on.
  await page.clock.runFor(500);
}

test.describe("renderer golden images", () => {
  test("HD-2D map (Meridian Village, ?hd2d=1) renders a stable frame", async ({ page }) => {
    await bootToStableMap(page, 1);
    await expect(page.locator("#stage")).toHaveScreenshot("hd2d-meridian-village.png");
  });

  // Phase 2: the default HD-2D path above now runs on the three.js renderer;
  // this spec pins the classic raw-WebGL2 fallback (?renderer=classic) to the
  // SAME baseline until parity sign-off retires it (docs/phase-2-spec.md).
  test("classic-renderer fallback (?renderer=classic) matches the same HD-2D golden", async ({ page }) => {
    await bootToStableMap(page, "1&renderer=classic");
    await expect(page.locator("#stage")).toHaveScreenshot("hd2d-meridian-village.png");
  });

  // The sample project keeps bloom/DoF/fog off, so the specs above never run
  // the post chain. This pair covers it: the baseline was captured from the
  // CLASSIC renderer (see tests-e2e/README.md), and the default three.js path
  // must reproduce it — post-stack parity, machine-checked.
  const withPostStack = (project) => {
    project.maps[0].hd2d = {
      enabled: true, tilt: 50, bloom: true, dof: true,
      fog: { color: "#101018" }, lights: true, ambient: 0.45,
    };
    return project;
  };

  test("HD-2D post stack (bloom+DoF+fog) renders a stable frame", async ({ page }) => {
    await bootToStableMap(page, 1, withPostStack);
    await expect(page.locator("#stage")).toHaveScreenshot("hd2d-post-meridian-village.png");
  });

  test("classic-renderer fallback matches the same post-stack golden", async ({ page }) => {
    await bootToStableMap(page, "1&renderer=classic", withPostStack);
    await expect(page.locator("#stage")).toHaveScreenshot("hd2d-post-meridian-village.png");
  });

  // Stage B: sun shadow maps are a NEW capability (three.js renderer only —
  // no classic reference exists), so this baseline was captured from the
  // three.js renderer itself and guards against regressions from here on.
  test("HD-2D sun shadows (map.hd2d.shadows) render a stable frame", async ({ page }) => {
    await bootToStableMap(page, 1, (project) => {
      project.maps[0].hd2d = { enabled: true, tilt: 50, shadows: true, lights: true, ambient: 0.45 };
      return project;
    });
    await expect(page.locator("#stage")).toHaveScreenshot("hd2d-shadows-meridian-village.png");
  });

  test("classic 2D renderer (?hd2d=0 override) renders a stable frame", async ({ page }) => {
    await bootToStableMap(page, 0);
    await expect(page.locator("#stage")).toHaveScreenshot("classic2d-meridian-village.png");
  });
});
