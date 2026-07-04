/* RPGAtlas — tests-e2e/adv-perf.spec.mjs
   Phase 8 Stage G exit criterion: the big-map budget for the Advanced Map
   Editor feature set, as a CI regression gate.

   WHAT THIS PROTECTS: a 64×64 map carrying a full generalized layer stack
   (the four cores plus four extra tile layers with blend/opacity/tint, one
   of them overhead) and 50 gameplay zones of every kind must (a) load
   through prerenderMap's composite branch inside a fixed budget and (b) keep
   frame times flat while the player walks — walking is the zone hot path
   (collision/nav consult the load-time raster per step; encounter/sound/
   weather re-check on tile entry with a bbox pre-filter).

   CALIBRATION: same philosophy as renderer-perf.spec.mjs — measured through
   SwiftShader software rendering on the classic 2D path, where the whole
   scene held a locked 60 fps at capture time (2026-07-04: load 511 ms, 16.67
   ms/frame — exactly the rAF vsync cadence, i.e. zero dropped frames). The
   frame budget below (~6× vsync) still catches an accidental O(zones) or
   O(layers) cost landing in the per-frame or per-step path. If this spec
   starts failing, profile the change — don't bump the budget. Override:
   RPGATLAS_PERF_BUDGET_MS. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";
import { makeRand, measureFrames } from "./fixtures/perf.mjs";

const FRAME_BUDGET_MS = Number(process.env.RPGATLAS_PERF_BUDGET_MS) || 100;
const LOAD_BUDGET_MS = 8_000;
const WARMUP_FRAMES = 30;
const MEASURE_FRAMES = 120;

// Procedural tile ids (js/assets.js defTile order).
const T = { grass: 1, flowers: 2, dirt: 4, sand: 5, water: 7, tree: 15, bush: 17, rock: 18 };

function bigAdvancedMap() {
  const W = 64, H = 64, size = W * H;
  const at = (x, y) => y * W + x;
  const rand = makeRand(20260704);
  const ground = new Array(size).fill(T.grass);
  const decor = new Array(size).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = rand();
      if (r < 0.1) ground[at(x, y)] = T.dirt;
      else if (r < 0.14) decor[at(x, y)] = rand() < 0.5 ? T.tree : T.bush;
    }
  }
  // A water channel so the animated-cell ticker has real work.
  for (let x = 0; x < W; x++) for (let y = 30; y <= 32; y++) ground[at(x, y)] = T.water;

  const sparse = (tile, p) => {
    const a = new Array(size).fill(0);
    for (let i = 0; i < size; i++) if (rand() < p) a[i] = tile;
    return a;
  };
  const layersAdv = [
    { id: 1, name: "ground", type: "core", role: "ground" },
    { id: 2, name: "decor", type: "core", role: "decor" },
    { id: 3, name: "decor2", type: "core", role: "decor2" },
    { id: 4, name: "over", type: "core", role: "over" },
    { id: 5, name: "Detail A", type: "tile", slot: "below", data: sparse(T.flowers, 0.08) },
    { id: 6, name: "Detail B", type: "tile", slot: "below", opacity: 0.7, data: sparse(T.rock, 0.05) },
    { id: 7, name: "Glow", type: "tile", slot: "below", blend: "add", opacity: 0.4, data: sparse(T.sand, 0.06) },
    { id: 8, name: "Haze", type: "tile", slot: "above", opacity: 0.3, tint: "#9db4ff", data: sparse(T.water, 0.04) },
  ];

  // 50 zones, every kind, spread across the map (bbox pre-filter gets real work).
  const zones = [];
  const kinds = ["encounter", "sound", "weather", "custom", "collision", "nav", "transfer", "spawn"];
  for (let i = 0; i < 50; i++) {
    const kind = kinds[i % kinds.length];
    const x = (i * 7) % 56, y = ((i * 11) % 56) + (i % 2 ? 1 : 0);
    const z = { id: i + 1, name: "perf " + kind + " " + i, kind };
    z.shape = i % 3 === 0
      ? { type: "ellipse", cx: x + 3, cy: y + 3, rx: 3, ry: 2 }
      : i % 3 === 1
        ? { type: "poly", pts: [{ x, y }, { x: x + 5, y }, { x: x + 5, y: y + 4 }, { x, y: y + 4 }] }
        : { type: "rect", x, y, w: 6, h: 5 };
    if (kind === "encounter") z.encounter = { troops: [1], rate: 999 }; // never actually rolls in the window
    if (kind === "sound") z.sound = { key: "", vol: 1, falloff: "linear" };
    if (kind === "weather") z.weather = { kind: "rain", power: 2 };
    if (kind === "transfer") { z.shape = { type: "point", x: 63, y: 63 }; z.transfer = { mapId: 1, x: 12, y: 12 }; }
    zones.push(z);
  }

  return {
    id: 99, name: "Perf Plain", width: W, height: H,
    tilesetId: 1, music: "field",
    encounters: { troops: [], rate: 0 },
    layers: { ground, decor, decor2: new Array(size).fill(0), over: new Array(size).fill(0) },
    layersAdv, zones,
    shadows: new Array(size).fill(0), passOv: new Array(size).fill(0),
    heights: new Array(size).fill(0), regions: new Array(size).fill(0),
    events: [],
  };
}

test.describe("advanced-map performance budget (Phase 8)", () => {
  test("64×64 with 8 layers + 50 zones loads and walks inside the budget", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoWithAtlasQuest(page, "/play.html?hd2d=0", {
      transformProject: (project) => {
        project.maps.push(bigAdvancedMap());
        project.system.startMapId = 99;
        project.system.startX = 4;
        project.system.startY = 4;
        return project;
      },
    });
    await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 15_000 });
    const t0 = Date.now();
    await page.getByText("New Game", { exact: true }).click();
    await expect(page.locator(".titlewin")).toHaveCount(0, { timeout: LOAD_BUDGET_MS });
    await expect
      .poll(() => page.evaluate(() => window.Atlas.atlas.scene === "map" && !!window.Atlas.atlas.player))
      .toBe(true);
    const loadMs = Date.now() - t0;

    // Walk while measuring: tile entries fire the zone re-checks, steps hit the
    // collision/nav raster, and the water channel keeps the anim ticker busy.
    await page.keyboard.down("ArrowRight");
    const avgMs = await measureFrames(page, { warmup: WARMUP_FRAMES, frames: MEASURE_FRAMES });
    await page.keyboard.up("ArrowRight");

    console.log(
      `[perf] 64×64 advanced map: load ${loadMs} ms; ${avgMs.toFixed(2)} ms/frame avg over ${MEASURE_FRAMES} walking frames (budget ${FRAME_BUDGET_MS} ms, SwiftShader)`,
    );
    expect(loadMs).toBeLessThan(LOAD_BUDGET_MS);
    expect(avgMs).toBeLessThan(FRAME_BUDGET_MS);
  });
});
