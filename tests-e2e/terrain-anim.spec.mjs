/* RPGAtlas — tests-e2e/terrain-anim.spec.mjs
   Phase 8 Stage C exit criteria: animated terrain animates in all three
   surfaces, and preset terrain formats import → paint.

   Rather than commit baseline PNGs (the classic 2D baseline itself drifts on
   some GPUs), these compare renders captured IN THE SAME RUN under the frozen
   virtual clock. An A1 (animated) terrain is injected onto the start map with a
   3-frame SVG sheet whose frames are visibly different colours; advancing the
   virtual clock past a frame boundary must change the rendered pixels, while two
   captures at the same clock time must be identical (deterministic). A separate
   check paints a non-animated preset terrain and asserts it renders (no throw,
   frame differs from bare ground).

   The engine drives terrain animation off performance.now() (map.ts update →
   tickMapAnim), which Playwright's page.clock virtualises — so freezing +
   advancing the clock deterministically drives the water frame. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

const SCREEN_SIZE = { width: 816, height: 624 };
test.use({ viewport: SCREEN_SIZE });

const AUTOTILE_BASE = 1_000_000;

// A 3-frame A1 sheet as an SVG data URL: three 96×144 (2×3 tile) blocks laid
// side by side (288×144 total), each a solid distinct colour. Solid blocks make
// the blob47 corner rule resolve to a flat fill, so a frame change is a clean,
// obvious colour swap in the rendered map — ideal for a deterministic diff.
function a1SheetDataUrl() {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='288' height='144'>` +
    `<rect x='0' y='0' width='96' height='144' fill='#1060ff'/>` +
    `<rect x='96' y='0' width='96' height='144' fill='#10c0ff'/>` +
    `<rect x='192' y='0' width='96' height='144' fill='#20ffa0'/>` +
    `</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}
// A plain A2 (blob47) terrain sheet — single 96×144 solid block.
function a2SheetDataUrl(fill) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='144'>` +
    `<rect width='96' height='144' fill='${fill}'/></svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

const startMap = (project) =>
  project.maps.find((m) => m.id === project.system.startMapId) || project.maps[0];

/** These fixtures prove "frame changed ⇔ the TERRAIN frame changed", comparing
 * whole screenshots across different virtual times — so the start map must
 * carry no actors at all: NPC sprites animate off the same clock (the Save
 * Crystal sparkles, movers roll unseeded RNG) and would flip pixels for
 * reasons that have nothing to do with terrain. The original fixtures were
 * only sound because the then-start-map happened to have zero events. */
const stripStartEvents = (project) => {
  startMap(project).events = [];
  return project;
};

/** Paint a terrain group over the start map's ground layer and register it. */
function paintTerrain(project, group) {
  project.autotiles = project.autotiles || [];
  project.autotiles.push(group);
  const m = startMap(project);
  const tileId = AUTOTILE_BASE + group.id;
  m.layers.ground = m.layers.ground.map(() => tileId);
  // clear anything above so the terrain colour is unobstructed
  m.layers.decor = m.layers.decor.map(() => 0);
  m.layers.decor2 = m.layers.decor2.map(() => 0);
  return project;
}

const withAnimatedWater = (project) => paintTerrain(project, {
  id: 90, name: "Anim Water", sheet: a1SheetDataUrl(),
  terrain: true, pass: true, kind: "a1", anim: { frames: 3, fps: 4 },
});
const withStaticTerrain = (project) => paintTerrain(project, {
  id: 91, name: "Flat Stone", sheet: a2SheetDataUrl("#a08060"),
  terrain: true, pass: true, // absent kind ⇒ blob47
});

async function bootTo(page, hdParam, transform, extraMs = 0) {
  await gotoWithAtlasQuest(page, `/play.html?hd2d=${hdParam}`, {
    installClock: true,
    transformProject: (project) =>
      stripStartEvents(transform ? (transform(project) ?? project) : project),
  });
  await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.clock.runFor(50);
  await page.getByText("New Game", { exact: true }).click();
  await page.clock.runFor(700);
  await expect(page.locator(".titlewin")).toHaveCount(0);
  await page.clock.runFor(500 + extraMs);
  return page.locator("#stage").screenshot();
}

async function pixelDiff(page, a, b) {
  return page.evaluate(async ([aB64, bB64]) => {
    const load = (b64) => new Promise((res) => {
      const img = new Image(); img.onload = () => res(img);
      img.src = "data:image/png;base64," + b64;
    });
    const [ia, ib] = await Promise.all([load(aB64), load(bB64)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return -1;
    const data = (img) => {
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      return c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    };
    const da = data(ia), db = data(ib);
    let diff = 0;
    for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diff++;
    return diff;
  }, [a.toString("base64"), b.toString("base64")]);
}

test.describe("animated terrain (Phase 8 Stage C)", () => {
  test("classic 2D: animated water changes frame over time, deterministically", async ({ page }) => {
    // Two captures at the SAME virtual time must be byte-identical…
    const t0a = await bootTo(page, 0, withAnimatedWater, 0);
    const t0b = await bootTo(page, 0, withAnimatedWater, 0);
    expect(await pixelDiff(page, t0a, t0b)).toBe(0);
    // …and a capture ~half a second later (past the 4fps frame boundary) must
    // differ — the water advanced to the next, differently-coloured frame.
    const t1 = await bootTo(page, 0, withAnimatedWater, 500);
    expect(await pixelDiff(page, t0a, t1)).toBeGreaterThan(0);
  });

  test("HD-2D: animated water animates without diverging on a static frame", async ({ page }) => {
    // Same clock time ⇒ stable (within the WebGL boot noise floor); a later time
    // ⇒ the water frame changed and re-textured the lower buffer.
    const a = await bootTo(page, 1, withAnimatedWater, 0);
    const b = await bootTo(page, 1, withAnimatedWater, 0);
    const later = await bootTo(page, 1, withAnimatedWater, 500);
    const noise = await pixelDiff(page, a, b);
    expect(await pixelDiff(page, a, later)).toBeGreaterThan(noise);
  });
});

test.describe("preset terrain import → paint (Phase 8 Stage C)", () => {
  test("classic 2D: a non-animated preset terrain paints and differs from ground", async ({ page }) => {
    const bare = await bootTo(page, 0, null, 0);
    const stone = await bootTo(page, 0, withStaticTerrain, 0);
    // The terrain visibly repaints the ground (flat stone colour over the whole
    // start map), so the frame must differ from the untransformed sample.
    expect(await pixelDiff(page, bare, stone)).toBeGreaterThan(0);
    // …and it is deterministic (no anim ⇒ no per-frame change).
    const stone2 = await bootTo(page, 0, withStaticTerrain, 500);
    expect(await pixelDiff(page, stone, stone2)).toBe(0);
  });
});
