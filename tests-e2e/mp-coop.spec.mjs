/* RPGAtlas — tests-e2e/mp-coop.spec.mjs
   Project Beacon MP4·B/D: two tabs, one world, over the BroadcastChannel
   transport — the first moment a second player is really there. Two pages of ONE
   browser context (same origin ⇒ they share the BroadcastChannel bus, exactly
   like two tabs on one machine) host + join a room and prove the round trip: the
   host sees the joiner in its roster, the joiner mirrors the host, a move the
   joiner sends is simulated by the host and echoed back to both, an emote
   crosses the wire, and a late joiner gets a snapshot of everyone already
   present. The frozen goldens are untouched — this spec captures no baseline
   image and drives only the co-op dev hooks (inert in normal play).
   GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

async function newGame(page, name) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`[${name}] ${err}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource.*404/.test(msg.text())) return;
    errors.push(`[${name}] ${msg.text()}`);
  });
  await gotoWithAtlasQuest(page, "/play.html");
  await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText("New Game", { exact: true }).click();
  await expect(page.locator("#gamecanvas")).toBeVisible();
  return errors;
}

const rosterSize = (page) => page.evaluate(() => window.RPGATLAS_MP.roster().players.size);
const peer = (page, id) =>
  page.evaluate((i) => {
    const e = window.RPGATLAS_MP.roster().players.get(i);
    return e ? { name: e.name, x: e.x, dir: e.dir, emote: e.emote && e.emote.id } : null;
  }, id);
const localX = (page) => page.evaluate(() => (window.RPGATLAS_MP.localPlayer() || {}).x);

test.describe("MP4 local co-op over BroadcastChannel", () => {
  test("two tabs share a world: join, mirror, move, emote, late-join", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const client = await context.newPage();

    const hostErrors = await newGame(host, "host");
    const clientErrors = await newGame(client, "client");

    // Host opens a room; the client joins by code.
    const code = await host.evaluate(() => window.RPGATLAS_MP.createRoom("Ana"));
    expect(code).toMatch(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{9}$/);
    const joined = await client.evaluate((c) => window.RPGATLAS_MP.joinRoom(c, "Bo"), code);
    expect(joined).toBe(true);

    // The host now has the joiner in its roster; the client mirrors the host.
    await expect.poll(() => rosterSize(host)).toBe(1);
    expect(await peer(host, 1)).toMatchObject({ name: "Bo" });
    await expect
      .poll(() => client.evaluate(() => window.RPGATLAS_MP.session().localPlayerId))
      .toBe(1);
    await expect.poll(() => rosterSize(client)).toBe(1);
    expect(await peer(client, 0)).toMatchObject({ name: "Ana" });

    // The client walks right one tile. The host simulates the move (its roster
    // entity for Bo advances), and the authoritative position echoes back to the
    // client's own player.
    const startX = (await peer(host, 1)).x;
    await client.evaluate(() => window.RPGATLAS_MP.sendInput({ k: "move", dir: "right", dir8: 2 }));
    await expect.poll(() => peer(host, 1).then((p) => p.x)).toBe(startX + 1);
    await expect.poll(() => localX(client)).toBe(startX + 1);

    // The client emotes; the host's mirror of Bo carries the bubble.
    await client.evaluate(() => window.RPGATLAS_MP.sendEmote("wave"));
    await expect.poll(() => peer(host, 1).then((p) => p.emote)).toBe("wave");

    // A third tab joins late and is handed a snapshot of everyone already here.
    const late = await context.newPage();
    const lateErrors = await newGame(late, "late");
    await late.evaluate((c) => window.RPGATLAS_MP.joinRoom(c, "Cy"), code);
    await expect.poll(() => rosterSize(late)).toBe(2); // sees Ana (host) + Bo
    const names = await late.evaluate(() =>
      [...window.RPGATLAS_MP.roster().players.values()].map((e) => e.name).sort(),
    );
    expect(names).toEqual(["Ana", "Bo"]);

    expect([...hostErrors, ...clientErrors, ...lateErrors]).toEqual([]);
    await context.close();
  });
});
