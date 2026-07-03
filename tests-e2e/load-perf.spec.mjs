/* RPGAtlas — tests-e2e/load-perf.spec.mjs
   Phase 7 Stage A: load-time budgets, big-map stress coverage, and renderer
   memory stability, as CI regression gates beside the Phase 2 frame budget
   (renderer-perf.spec.mjs).

   WHAT THIS PROTECTS:
   1. Editor and player boot-to-interactive stay inside fixed budgets
      (RPGATLAS_BOOT_MS is set by both composition roots when boot finishes).
   2. A 160x160 map with ~200 events and 16 lights, all HD-2D features on,
      still boots and holds a frame budget — the "big map" the roadmap asked
      about never regresses into unusable.
   3. Repeated map transfers leave three.js alive-resource counts
      (renderer.info.memory geometries/textures) at a stable baseline — the
      dispose-leak canary.

   CALIBRATION: like renderer-perf.spec.mjs, budgets are calibrated for the
   SwiftShader software rasterizer used by this harness and CI, with wide
   headroom so they catch order-of-magnitude regressions rather than machine
   noise (measured 2026-07-03: editor boot ~1.5 s, player boot ~1.2 s, stress
   frame ~depends, see numbers below). Real GPUs run far faster. If one of
   these starts failing, profile the change — don't bump the budget.
   Overrides: RPGATLAS_EDITOR_BOOT_BUDGET_MS, RPGATLAS_PLAYER_BOOT_BUDGET_MS,
   RPGATLAS_STRESS_BUDGET_MS. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

const EDITOR_BOOT_BUDGET_MS = Number(process.env.RPGATLAS_EDITOR_BOOT_BUDGET_MS) || 15_000;
const PLAYER_BOOT_BUDGET_MS = Number(process.env.RPGATLAS_PLAYER_BOOT_BUDGET_MS) || 15_000;
const STRESS_BUDGET_MS = Number(process.env.RPGATLAS_STRESS_BUDGET_MS) || 500;

/** Deterministic LCG so the stress map is identical every run. */
function makeRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Blow the start map up to 160x160 with ~200 events and 16 lights, every
 *  HD-2D feature enabled — the roadmap's "big-map stress map". Events clone
 *  the sample's first NPC page (a real, fully-shaped page) with commands
 *  stripped and random movement, so they exercise page resolution, sprite
 *  batching, and per-tick movement without dialogue. */
function stressify(project) {
  const W = 160;
  const H = 160;
  const size = W * H;
  const rand = makeRand(1234567);
  const m = project.maps[0];
  m.width = W;
  m.height = H;
  m.layers = {
    ground: new Array(size).fill(1),
    decor: new Array(size).fill(0),
    decor2: new Array(size).fill(0),
    over: new Array(size).fill(0),
  };
  for (let i = 0; i < size; i++) {
    const r = rand();
    if (r < 0.1) m.layers.ground[i] = 2; // grass variation → chunk texture work
    else if (r < 0.14) m.layers.decor[i] = 6; // scattered decor
  }
  const pageTemplate = JSON.parse(JSON.stringify(m.events[0].pages[0]));
  pageTemplate.commands = [];
  pageTemplate.trigger = "action";
  pageTemplate.moveType = "random";
  m.events = [];
  for (let i = 0; i < 200; i++) {
    m.events.push({
      id: i + 1,
      name: "stress" + i,
      x: 1 + Math.floor(rand() * (W - 2)),
      y: 1 + Math.floor(rand() * (H - 2)),
      pages: [JSON.parse(JSON.stringify(pageTemplate))],
    });
  }
  m.encounters = []; // no random battles mid-measurement
  m.lights = [];
  for (let i = 0; i < 16; i++) {
    m.lights.push({
      rx: 4 + Math.floor(rand() * (W - 8)) + 0.5,
      ry: 4 + Math.floor(rand() * (H - 8)) + 0.5,
      color: ["#ffcc88", "#88bbff", "#ffb060", "#88ffaa"][i % 4],
      radius: 220 + (i % 4) * 30,
    });
  }
  m.hd2d = {
    enabled: true, tilt: 50, lights: true, ambient: 0.4,
    shadows: true, pointShadows: true, water: true, materials: true,
    weather: "rain", dropShadows: true, dayNight: true, timeOfDay: 16,
    bloom: true, dof: true, ssao: true, aces: true, vignette: true,
    lut: "warm", fxaa: true, fog: { color: "#101018" },
  };
  return project;
}

async function newGame(page) {
  await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByText("New Game", { exact: true }).click();
  await expect(page.locator(".titlewin")).toHaveCount(0, { timeout: 20_000 });
}

test.describe("load-time budgets", () => {
  test("editor boots to interactive inside the budget", async ({ page }) => {
    await gotoWithAtlasQuest(page, "/");
    const bootMs = await page.waitForFunction(() => window.RPGATLAS_BOOT_MS).then((h) => h.jsonValue());
    console.log(`[perf] editor boot-to-interactive: ${bootMs.toFixed(0)} ms (budget ${EDITOR_BOOT_BUDGET_MS} ms)`);
    expect(bootMs).toBeLessThan(EDITOR_BOOT_BUDGET_MS);
  });

  test("player boots to title inside the budget", async ({ page }) => {
    await gotoWithAtlasQuest(page, "/play.html");
    await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 20_000 });
    const bootMs = await page.evaluate(() => window.RPGATLAS_BOOT_MS);
    console.log(`[perf] player boot-to-title: ${bootMs.toFixed(0)} ms (budget ${PLAYER_BOOT_BUDGET_MS} ms)`);
    expect(bootMs).toBeLessThan(PLAYER_BOOT_BUDGET_MS);
  });
});

test.describe("big-map stress", () => {
  test("160x160 map, 200 events, 16 lights, all features: boots and holds the frame budget", async ({ page }) => {
    test.setTimeout(180_000);
    await gotoWithAtlasQuest(page, "/play.html?hd2d=1", { transformProject: stressify });
    await newGame(page);

    const avgMs = await page.evaluate(
      ({ warmup, frames }) =>
        new Promise((resolve) => {
          let n = 0;
          let start = 0;
          function tick(now) {
            n++;
            if (n === warmup) start = now;
            if (n === warmup + frames) {
              resolve((now - start) / frames);
              return;
            }
            requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        }),
      { warmup: 20, frames: 60 },
    );
    console.log(`[perf] stress map: ${avgMs.toFixed(2)} ms/frame avg (budget ${STRESS_BUDGET_MS} ms, SwiftShader)`);
    expect(avgMs).toBeLessThan(STRESS_BUDGET_MS);

    // Perf overlay smoke: F3 shows live numbers (fps line + GPU counters).
    await page.keyboard.press("F3");
    await expect(page.locator(".perf-hud")).toBeVisible();
    await expect(page.locator(".perf-hud")).toContainText("fps", { timeout: 10_000 });
    await expect(page.locator(".perf-hud")).toContainText("draw", { timeout: 10_000 });
    await page.keyboard.press("F3");
    await expect(page.locator(".perf-hud")).toBeHidden();
  });
});

test.describe("renderer memory stability", () => {
  test("repeated map transfers keep alive geometries/textures at the baseline", async ({ page }) => {
    test.setTimeout(180_000);
    await gotoWithAtlasQuest(page, "/play.html?hd2d=1", {
      transformProject: (project) => {
        // HD-2D on both ends of the loop so each transfer rebuilds the scene.
        for (const m of project.maps) {
          m.hd2d = Object.assign({}, m.hd2d, { enabled: true, lights: true });
          m.encounters = [];
        }
        project.commonEvents = [
          { id: 1, name: "toCave", trigger: "none", switchId: 0,
            commands: [{ t: "transfer", mapId: 2, x: 3, y: 3 }] },
          { id: 2, name: "toVillage", trigger: "none", switchId: 0,
            commands: [{ t: "transfer", mapId: 1, x: 12, y: 12 }] },
        ];
        return project;
      },
    });
    await newGame(page);
    // Wait for the new-game map load to finish (player spawned on the map)
    // before driving transfers from outside the game loop.
    await expect
      .poll(() => page.evaluate(() => window.Atlas.atlas.scene === "map" && !!window.Atlas.atlas.player))
      .toBe(true);

    const cycle = async () => {
      await page.evaluate(async () => {
        await window.Atlas.game.callCommonEvent(1);
      });
      await expect.poll(() => page.evaluate(() => window.Atlas.atlas.map.id)).toBe(2);
      await page.evaluate(async () => {
        await window.Atlas.game.callCommonEvent(2);
      });
      await expect.poll(() => page.evaluate(() => window.Atlas.atlas.map.id)).toBe(1);
    };

    // Two warm-up cycles + a settle beat: chunk textures, sprite pools, and
    // most lazy walk-frame sprite textures (NPCs animate on random movement,
    // and each newly shown frame canvas mints a CanvasTexture) get created.
    await cycle();
    await cycle();
    await page.waitForTimeout(1000);
    const baseline = await page.evaluate(() => window.RPGATLAS_RENDERER_STATS());
    expect(baseline).not.toBeNull();

    for (let i = 0; i < 4; i++) await cycle();
    const after = await page.evaluate(() => window.RPGATLAS_RENDERER_STATS());
    console.log(
      `[perf] memory: baseline geo ${baseline.geometries} tex ${baseline.textures} → after 4 more cycles geo ${after.geometries} tex ${after.textures}`,
    );
    // Geometries must hold the baseline exactly (map disposal is exact); the
    // small texture slack absorbs stragglers from the lazy walk-frame cache
    // (bounded by charset frames), while a real setMap dispose leak adds ~4
    // textures per cycle (~16 here) and still trips this.
    expect(after.geometries).toBeLessThanOrEqual(baseline.geometries);
    expect(after.textures).toBeLessThanOrEqual(baseline.textures + 6);
  });
});
