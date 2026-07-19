/* RPGAtlas — tests-e2e/mp-presence.spec.mjs
   Project Beacon MP4·A: live proof that a remote player renders in the real
   player. There is no transport yet (MP4·B), so the committed local-test roster
   surface (window.RPGATLAS_MP, boot.ts) stands in for a peer: adding a player
   drives the EXACT code path the BroadcastChannel host will (add on
   defaultWorld.roster → render-glue draws it on the local map).

   Determinism (mirrors renderer-golden.spec.mjs): the fake clock + seeded RNG +
   pinned movers freeze the whole scene, and `?hd2d=1` forces the HD path so
   #gamecanvas is an overlay-only 2D surface — the remote's name tag is then the
   only thing that can change it. So a remote appearing MUST alter the overlay,
   and removing it MUST restore the overlay byte-for-byte. The frozen goldens are
   untouched: this spec captures no baseline image and the hook is inert
   everywhere else. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest, pinMovers } from "./fixtures/atlas-quest.mjs";

const SCREEN_SIZE = { width: 816, height: 624 }; // matches Atlas_Quest screen size
test.use({ viewport: SCREEN_SIZE });
const RNG_SEED = 0x5eed;

async function bootToStableMap(page) {
  await gotoWithAtlasQuest(page, "/play.html?hd2d=1", {
    installClock: true,
    rngSeed: RNG_SEED,
    transformProject: pinMovers,
  });
  await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.clock.runFor(50);
  await page.getByText("New Game", { exact: true }).click();
  await page.clock.runFor(700); // clear both newGame fades
  await expect(page.locator(".titlewin")).toHaveCount(0);
  await page.clock.runFor(200); // land walk/idle animation on a stable frame
}

/** The #gamecanvas 2D overlay as a data URL. Under the HD path this surface
 *  holds only overlays (name tags, combat, presentation) — blank when idle. */
async function overlay(page) {
  return page.evaluate(() => document.getElementById("gamecanvas").toDataURL());
}

test.describe("MP4·A remote-player presence", () => {
  test("a remote player joins, renders a name tag, and leaves cleanly", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      if (/Failed to load resource.*404/.test(msg.text())) return; // benign asset 404s
      errors.push(msg.text());
    });

    await bootToStableMap(page);
    expect(await page.evaluate(() => window.RPGATLAS_MP.roster().players.size)).toBe(0);

    // Idle overlay, alone on the map.
    const alone = await overlay(page);

    // A second player "joins" one tile to the player's right on the same map.
    const placed = await page.evaluate(() =>
      window.RPGATLAS_MP.addPlayer(2, "Robin", { mapId: 1, x: 13, y: 12, dir: "left" }),
    );
    expect(placed).toMatchObject({ id: 2, name: "Robin", mapId: 1, x: 13, y: 12, dir: 1 });
    expect(await page.evaluate(() => window.RPGATLAS_MP.roster().players.size)).toBe(1);

    // Their name tag now paints on the overlay → it must differ from idle.
    await page.clock.runFor(100);
    const together = await overlay(page);
    expect(together).not.toBe(alone);

    // They leave → roster clears and the overlay returns to the exact idle image
    // (deterministic under the frozen clock: nothing else changed).
    expect(await page.evaluate(() => window.RPGATLAS_MP.removePlayer(2))).toBe(true);
    expect(await page.evaluate(() => window.RPGATLAS_MP.roster().players.size)).toBe(0);
    await page.clock.runFor(100);
    expect(await overlay(page)).toBe(alone);

    expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
