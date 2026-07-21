/* RPGAtlas — tests-e2e/mp-relay-battle.spec.mjs
   Project Beacon MP9·E stage E4: the F-1 fix proven end to end through the
   SHIPPED UI over a REAL relay. This is the playthrough the MP9 release gate
   found impossible: two players in two SEPARATE browser contexts (not the
   same-origin BroadcastChannel of mp-battle — real independent tabs) open the
   title-screen "Play Together" flow, Create / Join a room by code over a native
   WebSocket to a real `beacon.mjs` child process (engine rooms — the E2 default,
   one full engine world per room in a worker), TEAM UP through the 💬 social
   panel's **Team Up button** (E3), consent through the real "Join!" choice, and
   then fight a shared battle whose whole turn loop runs SERVER-SIDE in the room
   worker (E1's battle-runtime). Both tabs receive their own end frame (exp +
   gold applied to their own G, client-side, no draws).

   The battle runs on the SERVER, so — unlike mp-battle's local
   `Atlas.atlas.startBattle` — neither client can start it: it is triggered by an
   in-world battle EVENT the host walks up to and acts on. To keep the two-context
   proof deterministic under the real (unfrozen) clock this transport needs
   (walking + random-encounter rolls are the flake mp-battle's D-6-B-2 note
   avoided), the encounter is a hand-placed action-trigger battle event on the
   spawn tile's neighbours and the host triggers it with a single `act` intent
   (the RPGATLAS_MP dev hook — acceptable for the trigger per the §MP9·E work
   order and the mp-battle precedent; the INVITE, the thing F-1 was about, goes
   through the real Team Up button). Logged as deviation D-9E-E4-1.

   Captures no golden baseline; the frozen goldens are untouched (multiplayer is
   enabled only in this spec's own project copy). GPL-3.0-or-later (see LICENSE). */

import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { atlasQuestJson, gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const TROOP = 900;
const DUMMY_GOLD = 15;

/** The shared project transform, applied IDENTICALLY to the server's `--project`
 *  file and each browser's loaded copy (same transform + same base ⇒ byte-equal
 *  projects, so the client's battleJoin loadout matches the authority):
 *   · multiplayer on (the title offers "Play Together")
 *   · an additive, in-memory-only frail dummy troop that the merged party drops
 *     in one round for a deterministic exp + gold end frame (never a golden)
 *   · an action-trigger `battle` event on every tile orthogonally adjacent to the
 *     start, so whichever way the host faces at spawn (startDir), a single `act`
 *     triggers the shared battle server-side — no walking, no encounter roll. */
function setupBattle(project) {
  project.system = project.system || {};
  project.system.multiplayer = { enabled: true };
  project.enemies.push({
    id: 900,
    name: "Practice Dummy",
    sprite: "slime",
    color: "#888888",
    stats: { mhp: 6, mmp: 0, atk: 1, def: 0, mat: 0, mdf: 0, agi: 1 },
    exp: 30,
    gold: DUMMY_GOLD,
    actions: [{ skillId: 0, weight: 5 }],
  });
  project.troops.push({ id: 900, name: "Dummy", enemies: [900], pages: [] });

  const startMap = project.maps.find((m) => m.id === project.system.startMapId);
  const sx = Number(project.system.startX) || 0;
  const sy = Number(project.system.startY) || 0;
  let nextId = 1 + Math.max(0, ...(startMap.events || []).map((e) => e.id | 0));
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    startMap.events.push({
      id: nextId++,
      name: "coop-fight",
      x: sx + dx,
      y: sy + dy,
      pages: [{
        name: "",
        cond: { switchId: 0, varId: 0, varVal: 0, selfSw: "", questId: 0, questStatus: "active", objectiveQuestId: 0, objectiveIndex: 0, objectiveStatus: "completed" },
        charset: "",
        dir: 0,
        moveType: "fixed",
        trigger: "action",
        priority: "below",
        through: true,
        combat: { enabled: false, enemyId: 0, hp: 0, touchDamage: 0, knockbackTiles: 1, invulnFrames: 24, defeatSelfSwitch: "" },
        commands: [{ t: "battle", troopId: TROOP, escape: false, lose: false }],
      }],
    });
  }
  return project;
}

let child = null;
let relayUrl = "";
let workDir = "";

test.beforeAll(async () => {
  // Write the battle-ready project to a temp file and host it; the browsers load
  // the identical transform, so authority and clients agree on the fight.
  workDir = await mkdtemp(join(tmpdir(), "rpgatlas-relay-battle-"));
  const projectFile = join(workDir, "Atlas_Quest_Battle.json");
  await writeFile(projectFile, JSON.stringify(setupBattle(JSON.parse(atlasQuestJson()))), "utf8");

  child = spawn(process.execPath, ["server/dist/beacon.mjs", "--project", projectFile, "--port", "0"], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
  });
  relayUrl = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("beacon did not start in time")), 15000);
    child.stdout.on("data", (d) => {
      const m = /listening on :(\d+)/.exec(String(d));
      if (m) { clearTimeout(to); resolve(`ws://127.0.0.1:${m[1]}`); }
    });
    child.on("error", reject);
  });
});

test.afterAll(async () => {
  if (child && !child.killed) child.kill();
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

/** Load the battle-enabled game pointed at the local relay; collect page errors. */
async function bootMp(page, label) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`[${label}] ${e}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource.*404/.test(msg.text())) return;
    errors.push(`[${label}] ${msg.text()}`);
  });
  await gotoWithAtlasQuest(page, `/play.html?relay=${encodeURIComponent(relayUrl)}`, {
    transformProject: setupBattle,
  });
  await expect(page.getByText("Play Together", { exact: true })).toBeVisible({ timeout: 15_000 });
  return errors;
}

async function openPlayTogether(page, name) {
  await page.getByText("Play Together", { exact: true }).click();
  await expect(page.locator(".mp-modal")).toBeVisible();
  await page.locator(".mp-modal input").first().fill(name);
}

const roster = (page) =>
  page.evaluate(() => [...window.RPGATLAS_MP.roster().players.values()].map((e) => e.id));
const localPos = (page) =>
  page.evaluate(() => { const p = window.RPGATLAS_MP.localPlayer() || {}; return { x: p.x, y: p.y }; });
const gold = (page) => page.evaluate(() => window.Atlas.game.state().gold);
/** My party's member ids (sorted) as this tab's relay mirror sees them, or [] if
 *  unpartied. partyState() reads defaultWorld — which IS the RelayClient's mirror
 *  world (soloHost.world === defaultWorld) — so this reflects server authority. */
const partyMembers = (page) =>
  page.evaluate(() => {
    const t = window.RPGATLAS_MP.partyState();
    return t.length ? t[0].members.slice().sort((a, b) => a - b) : [];
  });

test.describe("MP9·E relay co-op battle (real server, native WebSocket, Team Up UI)", () => {
  test("two contexts party up through the panel and win a SERVER-side shared battle", async ({ browser }) => {
    test.setTimeout(150_000);
    // Two independent browser contexts — genuinely separate players (no shared
    // BroadcastChannel; every message crosses the real socket to the server).
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    const hostErr = await bootMp(host, "host");
    const guestErr = await bootMp(guest, "guest");

    // Host creates a room; the code banner shows and the game starts on the map.
    await openPlayTogether(host, "Ana");
    await host.getByRole("button", { name: "Create Room" }).click();
    await expect(host.locator(".mp-code-banner")).toBeVisible({ timeout: 15_000 });
    await expect(host.locator("#gamecanvas")).toBeVisible();
    const code = await host.evaluate(() => window.RPGATLAS_MP.session().roomCode);
    expect(code).toMatch(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{9}$/);

    // Guest joins by that code and lands in the shared world.
    await openPlayTogether(guest, "Bo");
    await guest.getByRole("button", { name: "Join a Room" }).click();
    await guest.locator(".mp-code-in").fill(code);
    await guest.getByRole("button", { name: "Join", exact: true }).click();
    await expect(guest.locator("#gamecanvas")).toBeVisible({ timeout: 15_000 });

    // Server-assigned ids: host = 1, guest = 2. Both see each other.
    await expect.poll(() => roster(host)).toContain(2);
    await expect.poll(() => roster(guest)).toContain(1);

    // Team Up THROUGH THE UI: the host opens the 💬 panel and clicks the guest's
    // **Team Up** button (F-1's whole point — the invite is player-reachable).
    await host.locator(".mp-social-btn").click();
    await expect(host.locator(".mp-social-panel")).toBeVisible();
    await host.locator(".mp-social-panel").getByRole("button", { name: "Team Up", exact: true }).click();

    // The guest gets the real consent prompt and taps "Join!".
    await expect(guest.locator(".choicewin")).toBeVisible({ timeout: 10_000 });
    await guest.getByText("Join!", { exact: true }).click();

    // Both relay mirrors now carry the party [1, 2] — the fight will be SHARED.
    await expect.poll(() => partyMembers(host)).toEqual([1, 2]);
    await expect.poll(() => partyMembers(guest)).toEqual([1, 2]);

    // The host is still on its spawn tile (it only clicked UI, never walked), so
    // it faces the battle event placed on every neighbouring tile.
    await expect.poll(() => localPos(host)).toEqual({ x: 12, y: 12 });

    const hostGold0 = await gold(host);
    const guestGold0 = await gold(guest);

    // Trigger the SHARED battle server-side: the host acts on the adjacent battle
    // event. The zone opens a co-op battle (both partied players in range), asks
    // BOTH for a loadout (battleJoin, auto-answered) and per-round commands.
    await host.evaluate(() => window.RPGATLAS_MP.sendInput({ k: "act" }));

    // Both tabs open the remote battle overlay (all-remote posture — even the
    // trigger fights as a participant, E1).
    await expect(host.locator(".mp-battle-overlay")).toBeVisible({ timeout: 20_000 });
    await expect(guest.locator(".mp-battle-overlay")).toBeVisible({ timeout: 20_000 });

    // Drive BOTH to victory: whenever a command / target window is up on a page,
    // press Enter (Attack → the lone enemy needs no target pick, so one Enter per
    // battler resolves it). Done when both have applied their end frame (gold).
    let hostSaw = false, guestSaw = false;
    await expect
      .poll(
        async () => {
          if (!hostSaw && (await host.locator(".mp-battle-log div").count()) > 0) hostSaw = true;
          if (!guestSaw && (await guest.locator(".mp-battle-log div").count()) > 0) guestSaw = true;
          if (await host.locator(".cmdwin, .targetwin").count()) await host.keyboard.press("Enter");
          if (await guest.locator(".cmdwin, .targetwin").count()) await guest.keyboard.press("Enter");
          const hg = await gold(host);
          const gg = await gold(guest);
          return hg === hostGold0 + DUMMY_GOLD && gg === guestGold0 + DUMMY_GOLD;
        },
        { timeout: 120_000, intervals: [200] },
      )
      .toBe(true);

    // Both saw the fight stream into their own overlay …
    expect(hostSaw).toBe(true);
    expect(guestSaw).toBe(true);
    // … both applied their own end frame (full gold to each — no draws) …
    expect(await gold(host)).toBe(hostGold0 + DUMMY_GOLD);
    expect(await gold(guest)).toBe(guestGold0 + DUMMY_GOLD);
    // … and both overlays closed on the end event.
    await expect(host.locator(".mp-battle-overlay")).toHaveCount(0);
    await expect(guest.locator(".mp-battle-overlay")).toHaveCount(0);

    // No page/console errors on either tab across the whole flow.
    expect([...hostErr, ...guestErr]).toEqual([]);

    await hostCtx.close();
    await guestCtx.close();
  });
});
