/* RPGAtlas — tests-unit/relay-client.test.ts
   Project Beacon MP5·C: the browser client path (socket-transport + RelayClient)
   against the REAL Node Beacon server, headless — the `ws` package supplies both
   the server sockets AND the client WebSocket (injected into socket-transport),
   so no browser is needed. Proves: connect → create room (server-assigned code)
   → a friend joins by code → authoritative movement round-trips → emote presence
   → friendly error on a bad code → the wss-only guard. GPL-3.0. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startNodeServer, type NodeServerHandle } from "../server/src/node/ws-server";
import { connectSocket, isAllowedRelayUrl } from "../src/engine/net/socket-transport";
import { RelayClient } from "../src/engine/net/relay-client";
import { createWorld } from "../src/shared/sim/world";
import { resetSession } from "../src/engine/net/session";
import type { PlayerState } from "../src/shared/sim/players";

const PROJECT = {
  system: { startMapId: 1, startX: 2, startY: 2, startDir: "down", title: "Relay Test" },
  maps: [{ id: 1, width: 6, height: 6, layers: { ground: new Array(36).fill(1) } }],
  assets: { tiles: {} },
  autotiles: [],
};

let handle: NodeServerHandle | null = null;
const clients: RelayClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (handle) { await handle.close(); handle = null; }
  resetSession();
});

interface Rec {
  welcome?: { pid: number; code: string };
  locals: PlayerState[];
  presence: any[];
  errors: string[];
}

function relay(url: string, opts: { code?: string; name: string }): { client: RelayClient; rec: Rec } {
  const rec: Rec = { locals: [], presence: [], errors: [] };
  const world = createWorld(PROJECT);
  const transport = connectSocket(url, { WebSocketCtor: WebSocket as any });
  const client = new RelayClient(world, transport, {
    name: opts.name,
    code: opts.code,
    onWelcome: (pid, code) => (rec.welcome = { pid, code }),
    onLocal: (s) => rec.locals.push(s),
    onPresence: (p) => rec.presence.push(p),
    onError: (code) => rec.errors.push(code),
  });
  clients.push(client);
  return { client, rec };
}

async function waitFor(pred: () => boolean, timeout = 8000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeout) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("MP5·C RelayClient over a real WebSocket", () => {
  it("creates a room, a friend joins by code, movement round-trips", async () => {
    handle = await startNodeServer({ project: PROJECT, port: 0 });
    const url = `ws://127.0.0.1:${handle.port}`;

    const host = relay(url, { name: "Ana" }); // codeless = create
    await waitFor(() => !!host.rec.welcome);
    expect(host.rec.welcome!.pid).toBe(1);
    const code = host.rec.welcome!.code;
    expect(code).toMatch(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{9}$/);

    const guest = relay(url, { name: "Bo", code }); // join by code
    await waitFor(() => !!guest.rec.welcome);
    expect(guest.rec.welcome!.pid).toBe(2);
    // Guest's world reconstructs Ana into its roster; Ana's reconstructs Bo.
    await waitFor(() => guest.client.world.roster.players.has(1));
    await waitFor(() => host.client.world.roster.players.has(2));

    // Bo walks right; his authoritative position moves and Ana sees it.
    guest.client.sendInput({ k: "move", dir: "right", dir8: 2 });
    await waitFor(() => guest.rec.locals.some((s) => s.x === 3)); // his own onLocal
    await waitFor(() => (host.client.world.roster.players.get(2)?.x ?? 0) === 3); // Ana's mirror
  }, 15000);

  it("emote crosses from one client to the other", async () => {
    handle = await startNodeServer({ project: PROJECT, port: 0 });
    const url = `ws://127.0.0.1:${handle.port}`;
    const host = relay(url, { name: "Ana" });
    await waitFor(() => !!host.rec.welcome);
    const guest = relay(url, { name: "Bo", code: host.rec.welcome!.code });
    await waitFor(() => !!guest.rec.welcome);

    guest.client.sendEmote("wave");
    await waitFor(() => host.rec.presence.some((p) => p.kind === "emote" && p.playerId === 2 && p.emote === "wave"));
    await waitFor(() => (host.client.world.roster.players.get(2)?.emote?.id ?? "") === "wave");
  }, 15000);

  it("surfaces a friendly error for a bad room code", async () => {
    handle = await startNodeServer({ project: PROJECT, port: 0 });
    const url = `ws://127.0.0.1:${handle.port}`;
    const bad = relay(url, { name: "Zed", code: "000000000" }); // canonical shape, no such room
    await waitFor(() => bad.rec.errors.length > 0);
    expect(bad.rec.errors).toContain("room-not-found");
  }, 15000);

  it("refuses a non-wss relay URL (wss-only, off-loopback)", () => {
    expect(isAllowedRelayUrl("wss://beacon.example")).toBe(true);
    expect(isAllowedRelayUrl("ws://127.0.0.1:8787")).toBe(true);
    expect(isAllowedRelayUrl("ws://evil.example")).toBe(false);
    expect(() => connectSocket("ws://evil.example", { WebSocketCtor: WebSocket as any })).toThrow();
  });
});
