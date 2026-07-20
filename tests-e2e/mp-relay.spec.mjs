/* RPGAtlas — tests-e2e/mp-relay.spec.mjs
   Project Beacon MP5·C/E: the real browser "Play Together" flow against a real
   Beacon server. A child process runs the built Node server (server/dist/
   beacon.mjs) hosting Atlas Quest; two browser pages open the gated title entry,
   Create / Join a room over a genuine WebSocket (the browser's NATIVE
   WebSocket + socket-transport — the one path the headless `ws`-injected unit
   tests can't exercise), land in the shared world, and a move round-trips
   server-authoritatively. Captures no golden baseline; the frozen goldens are
   untouched (this game has multiplayer enabled only in this spec's project copy).
   GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const enableMp = (project) => {
  project.system = project.system || {};
  project.system.multiplayer = { enabled: true };
  return project;
};

let child = null;
let relayUrl = "";

test.beforeAll(async () => {
  child = spawn(process.execPath, ["server/dist/beacon.mjs", "--project", "Atlas_Quest.json", "--port", "0"], {
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
});

/** Load the game (multiplayer enabled) pointed at the local relay, and collect
 *  page errors. */
async function bootMp(page, label) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`[${label}] ${e}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource.*404/.test(msg.text())) return;
    errors.push(`[${label}] ${msg.text()}`);
  });
  await gotoWithAtlasQuest(page, `/play.html?relay=${encodeURIComponent(relayUrl)}`, { transformProject: enableMp });
  await expect(page.getByText("Play Together", { exact: true })).toBeVisible({ timeout: 15_000 });
  return errors;
}

async function openPlayTogether(page, name) {
  await page.getByText("Play Together", { exact: true }).click();
  await expect(page.locator(".mp-modal")).toBeVisible();
  await page.locator(".mp-modal input").first().fill(name);
}

const roster = (page) =>
  page.evaluate(() => [...window.RPGATLAS_MP.roster().players.values()].map((e) => ({ id: e.id, name: e.name, x: e.x })));
const localX = (page) => page.evaluate(() => (window.RPGATLAS_MP.localPlayer() || {}).x);

test.describe("MP5 relay Play Together (real server, native WebSocket)", () => {
  test("create + join over wss transport: shared world, move round-trips", async ({ browser }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    const guest = await context.newPage();

    const hostErr = await bootMp(host, "host");
    const guestErr = await bootMp(guest, "guest");

    // Host creates a room; the code banner shows and the game starts.
    await openPlayTogether(host, "Ana");
    await host.getByRole("button", { name: "Create Room" }).click();
    await expect(host.locator(".mp-code-banner")).toBeVisible({ timeout: 15_000 });
    await expect(host.locator("#gamecanvas")).toBeVisible();
    const code = await host.evaluate(() => window.RPGATLAS_MP.session().roomCode);
    expect(code).toMatch(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{9}$/);

    // Guest joins by that code.
    await openPlayTogether(guest, "Bo");
    await guest.getByRole("button", { name: "Join a Room" }).click(); // reveal the code field
    await guest.locator(".mp-code-in").fill(code);
    await guest.getByRole("button", { name: "Join", exact: true }).click();
    await expect(guest.locator("#gamecanvas")).toBeVisible({ timeout: 15_000 });

    // Both see each other (server-assigned ids: host=1, guest=2).
    await expect.poll(() => roster(host).then((r) => r.some((p) => p.id === 2))).toBe(true);
    await expect.poll(() => roster(guest).then((r) => r.some((p) => p.id === 1))).toBe(true);

    // The guest walks right; the server moves player 2 authoritatively and both
    // the guest's own player and the host's mirror reach the new tile.
    const startX = await localX(guest);
    await guest.evaluate(() => window.RPGATLAS_MP.sendInput({ k: "move", dir: "right", dir8: 2 }));
    await expect.poll(() => localX(guest)).toBe(startX + 1);
    await expect.poll(() => roster(host).then((r) => (r.find((p) => p.id === 2) || {}).x)).toBe(startX + 1);

    expect([...hostErr, ...guestErr]).toEqual([]);
    await context.close();
  });
});
