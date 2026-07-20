/* RPGAtlas — tests-e2e/mp-battle.spec.mjs
   Project Beacon MP6·B: two tabs, one shared BATTLE — the live proof of co-op
   battles (D5). Two pages of ONE browser context (same origin ⇒ they share the
   BroadcastChannel bus) host + join a room, party up, then fight a shared battle
   side by side: the host triggers it, the client's party auto-joins over the
   battleJoin directive, the client answers a real battleCmd command UI, and both
   fight to victory — after which the client's OWN `G` receives its end frame
   (exp + gold applied client-side, no draws). Deterministic (seeded RNG), no
   golden baseline captured (screenshots off), additive (drives only the co-op
   dev hooks + the plugin battle entry, inert in normal play).

   Trigger note (logged as deviation D-6-B-2 in docs/mp-6-spec.md): the shared
   battle is started through the plugin API's battle entry
   (window.Atlas.atlas.startBattle) rather than an armed random encounter + a
   walked step. It routes through the identical Battle.run → openCoopBattle co-op
   path; going through startBattle keeps the two-context proof deterministic and
   free of tile-walking flake under the real (unfrozen) clock this transport
   needs. GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

/** An additive, in-memory-only weak encounter for the fight (never written to
 *  disk, never a golden): one frail dummy that the merged party drops in a
 *  single round and that pays out guaranteed exp + gold, so the client's end
 *  frame is deterministic. Both tabs seed the SAME project so troop 900 exists
 *  on the authority (the host). */
function addWeakTroop(project) {
  project.enemies.push({
    id: 900,
    name: "Practice Dummy",
    sprite: "slime",
    color: "#888888",
    stats: { mhp: 6, atk: 1, def: 0, mat: 0, mdf: 0, agi: 1 },
    exp: 30,
    gold: 15,
    actions: [{ skillId: 0, weight: 5 }],
  });
  project.troops.push({ id: 900, name: "Dummy", enemies: [900], pages: [] });
  return project;
}

const TROOP = 900;
const DUMMY_GOLD = 15;

async function newGame(page, name) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`[${name}] ${err}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource.*404/.test(msg.text())) return;
    errors.push(`[${name}] ${msg.text()}`);
  });
  await gotoWithAtlasQuest(page, "/play.html", { transformProject: addWeakTroop, rngSeed: 4242 });
  await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText("New Game", { exact: true }).click();
  await expect(page.locator("#gamecanvas")).toBeVisible();
  // map scene live (fade-in done) + the plugin API surface (window.Atlas) ready
  await expect
    .poll(() => page.evaluate(() => window.Atlas && window.Atlas.atlas.scene), { timeout: 10_000 })
    .toBe("map");
  return errors;
}

const partyMembers = (page) =>
  page.evaluate(() => {
    const t = window.RPGATLAS_MP.partyState();
    return t.length ? t[0].members.slice().sort((a, b) => a - b) : [];
  });

test.describe("MP6 co-op battle over BroadcastChannel", () => {
  test("two tabs party up and win a shared battle; the client gets its end frame", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    const host = await context.newPage();
    const client = await context.newPage();

    const hostErrors = await newGame(host, "host");
    const clientErrors = await newGame(client, "client");

    // Host opens a room; the client joins by code (the MP4 co-op handshake).
    const code = await host.evaluate(() => window.RPGATLAS_MP.createRoom("Ana"));
    expect(code).toMatch(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{9}$/);
    const joined = await client.evaluate((c) => window.RPGATLAS_MP.joinRoom(c, "Bo"), code);
    expect(joined).toBe(true);
    await expect.poll(() => host.evaluate(() => window.RPGATLAS_MP.roster().players.size)).toBe(1);

    // Host invites the client; the invite arrives as a choices directive the
    // client answers "Join!". Both party tables then carry [0, 1].
    await host.evaluate(() => window.RPGATLAS_MP.partyInvite(1));
    await expect(client.locator(".choicewin")).toBeVisible({ timeout: 10_000 });
    await client.getByText("Join!", { exact: true }).click();
    await expect.poll(() => partyMembers(host)).toEqual([0, 1]);
    await expect.poll(() => partyMembers(client)).toEqual([0, 1]);

    // Capture the client's gold before: its end frame will add the dummy's gold.
    const goldBefore = await client.evaluate(() => window.Atlas.game.state().gold);

    // Host triggers the SHARED battle (routes through Battle.run → openCoopBattle
    // because it is a co-op host with a partied, in-range peer).
    await host.evaluate((troop) => {
      window.__bres = null;
      window.__berr = null;
      window.Atlas.atlas
        .startBattle(troop, true)
        .then((r) => (window.__bres = r))
        .catch((e) => (window.__berr = String((e && e.stack) || e)));
    }, TROOP);

    // The host's battle window opens; the client's remote battle overlay opens
    // (the "start" event) — the remote participant's window on the fight.
    await expect(host.locator(".battlewin")).toBeVisible({ timeout: 15_000 });
    await expect(client.locator(".mp-battle-overlay")).toBeVisible({ timeout: 15_000 });

    // Drive BOTH tabs to victory: whenever a command / target window is up on a
    // page, press Enter (Attack → the lone enemy needs no target pick, so a
    // single Enter per battler resolves it — on the host's classic UI AND the
    // client's real battleCmd UI). Track that the client actually saw the fight.
    let clientSawLog = false;
    await expect
      .poll(
        async () => {
          if (!clientSawLog && (await client.locator(".mp-battle-log div").count()) > 0)
            clientSawLog = true;
          const done = await host.evaluate(() => window.__bres || window.__berr);
          if (done) return done;
          if (await host.locator(".cmdwin, .targetwin").count()) await host.keyboard.press("Enter");
          if (await client.locator(".cmdwin, .targetwin").count()) await client.keyboard.press("Enter");
          return null;
        },
        { timeout: 90_000, intervals: [200] },
      )
      .not.toBeNull();

    const outcome = await host.evaluate(() => ({ res: window.__bres, err: window.__berr }));
    expect(outcome.err).toBeNull();
    expect(outcome.res).toBe("win");

    // The client saw the fight (mirrored log lines in its overlay) …
    expect(clientSawLog).toBe(true);
    // … got its end frame applied to its OWN G (gold from the win) …
    await expect
      .poll(() => client.evaluate(() => window.Atlas.game.state().gold))
      .toBe(goldBefore + DUMMY_GOLD);
    // … and the overlay closed on the end event.
    await expect(client.locator(".mp-battle-overlay")).toHaveCount(0);
    // The host's battle window tore down too.
    await expect(host.locator(".battlewin")).toHaveCount(0);

    // No page/console errors on either tab across the whole flow.
    expect([...hostErrors, ...clientErrors]).toEqual([]);
    await context.close();
  });
});
