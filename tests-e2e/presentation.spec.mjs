/* RPGAtlas — tests-e2e/presentation.spec.mjs
   Project Compass M2·A: pixel proof that the presentation layer (pictures)
   renders over the live map scene. A parallel common event shows a picture in
   slot 1 — an inline magenta SVG data-URL, so no external asset is needed and
   the canvas stays origin-clean for getImageData — then flips a switch to erase
   it. We read the engine's #gamecanvas 2D overlay (transparent over the map in
   HD-2D, the full frame in classic-2D — either way the picture is painted onto
   it, exactly like the screen flash). Map 1 (Driftwood Shore goldens) is never
   touched: the project is transformed in memory to add the common event.
   GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

// A 40×40 solid-magenta SVG data-URL. SVG data-URLs are origin-clean, so
// drawing this into the picture layer does NOT taint #gamecanvas — getImageData
// keeps working.
const MAGENTA =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='#ff00ff'/></svg>",
  );

// Free switch id used only to gate the one-shot show/erase (Atlas Quest doesn't
// use anything near this high).
const GATE = 950;

function addPictureCommonEvent(project, { erase } = { erase: false }) {
  const nextId = (project.commonEvents || []).reduce((m, ce) => Math.max(m, ce.id), 0) + 1;
  const showThenGate = [
    { t: "showPic", id: 1, name: MAGENTA, origin: 0, x: 100, y: 100, scaleX: 100, scaleY: 100, opacity: 255, blend: 0 },
    ...(erase ? [{ t: "erasePic", id: 1 }] : []),
    { t: "switch", id: GATE, val: true },
  ];
  project.commonEvents = project.commonEvents || [];
  project.commonEvents.push({
    id: nextId,
    name: "M2A Picture Probe",
    trigger: "parallel",
    switchId: 0,
    // Only act once: run the show/erase until the gate switch is set.
    commands: [{ t: "if", cond: { kind: "switch", id: GATE, val: false }, then: showThenGate, else: [] }],
  });
  return project;
}

async function startGame(page, transform) {
  await gotoWithAtlasQuest(page, "/play.html", { transformProject: transform });
  await expect(page.getByText("New Game", { exact: true })).toBeVisible();
  await page.getByText("New Game", { exact: true }).click();
  await expect(page.locator(".titlewin")).toHaveCount(0);
  await expect(page.locator("#gamecanvas")).toBeVisible();
}

/** Read one pixel [r,g,b,a] from the #gamecanvas 2D backing store. */
async function pixel(page, x, y) {
  return page.evaluate(([px, py]) => {
    const cv = document.getElementById("gamecanvas");
    const g = cv.getContext("2d");
    const d = g.getImageData(px, py, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }, [x, y]);
}

const isMagenta = ([r, g, b, a]) => r > 200 && g < 70 && b > 200 && a > 200;

test.describe("M2·A presentation — Show Picture over the map", () => {
  test("a Show Picture command paints its image onto the map scene", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      if (/Failed to load resource.*404/.test(msg.text())) return; // benign asset-discovery 404s
      errors.push(msg.text());
    });

    await startGame(page, (p) => addPictureCommonEvent(p, { erase: false }));

    // The image loads async then paints on the next frame — poll (real rAF).
    await expect
      .poll(async () => isMagenta(await pixel(page, 110, 110)), { timeout: 6000 })
      .toBe(true);

    // Sanity: a spot outside the 40×40 picture is not magenta.
    const outside = await pixel(page, 400, 400);
    expect(isMagenta(outside)).toBe(false);

    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("an Erase Picture command clears the slot (nothing paints)", async ({ page }) => {
    await startGame(page, (p) => addPictureCommonEvent(p, { erase: true }));

    // Give the show+erase common event several frames to run, then confirm the
    // picture pixel never shows magenta (erased in the same pass it was shown).
    await page.waitForTimeout(600);
    for (let i = 0; i < 5; i++) {
      expect(isMagenta(await pixel(page, 110, 110))).toBe(false);
      await page.waitForTimeout(80);
    }
  });
});
