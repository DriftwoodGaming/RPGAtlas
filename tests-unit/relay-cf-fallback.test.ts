/* RPGAtlas — tests-unit/relay-cf-fallback.test.ts
   Post-2.0 hotfix, the real-socket proof (test:net): the browser dial path
   (relay-dial + socket-transport + RelayClient) against a server that speaks
   the CLOUDFLARE WORKER contract — a bare-path WS upgrade gets the HTTP 200
   health answer (exactly the live gap: the shipped 2.0.0 client surfaced it as
   "offline"), GET /new mints a room code, and /rt?code=… upgrades into a
   one-room BeaconServer (fixedRoomCode, the DO shape). Proves: create falls
   back through /new, a friend joins by the shared code with no extra /new, the
   plain Node target still connects bare with zero fallback traffic, and a dead
   host still ends in onOffline. Real TCP + 60 Hz ticks ⇒ test:net only.
   GPL-3.0. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { BeaconServer } from "../server/src/core/server";
import type { ServerConnection } from "../server/src/core/connection";
import { startNodeServer, type NodeServerHandle } from "../server/src/node/ws-server";
import { connectSocket } from "../src/engine/net/socket-transport";
import { RelayClient } from "../src/engine/net/relay-client";
import { dialRelay, type RelayDial } from "../src/engine/net/relay-dial";
import { generateRoomCode, isCanonicalRoomCode } from "../src/shared/net/room-code";
import { createWorld } from "../src/shared/sim/world";
import { resetSession } from "../src/engine/net/session";

const PROJECT = {
  system: { startMapId: 1, startX: 2, startY: 2, startDir: "down", title: "CF Fallback Test" },
  maps: [{ id: 1, width: 6, height: 6, layers: { ground: new Array(36).fill(1) } }],
  assets: { tiles: {} },
  autotiles: [],
};

const TICK_MS = 1000 / 60;
let connSeq = 0;

/** Wrap a live `ws` socket as a ServerConnection (ws-server.ts's shape). */
function wrapSocket(ws: WebSocket): ServerConnection {
  let open = true;
  return {
    id: ++connSeq,
    source: "cf-stub",
    get isOpen() { return open; },
    send(text: string): void { if (open && ws.readyState === ws.OPEN) ws.send(text); },
    close(): void { if (open) { open = false; try { ws.close(); } catch { /* */ } } },
    onMessage(handler: (t: string) => void): void {
      ws.on("message", (data: unknown, isBinary: boolean) => handler(isBinary ? "" : String(data)));
    },
    onClose(handler: () => void): void {
      ws.on("close", () => { open = false; handler(); });
      ws.on("error", () => { /* 'close' follows */ });
    },
  };
}

interface CfStub {
  port: number;
  /** How many times /new was hit, and the codes it minted (in order). */
  newHits: number;
  minted: string[];
  close(): Promise<void>;
}

/** A Node stand-in for server/src/cf/worker.ts + room-do.ts: HTTP routes at
 *  "/" (health) and /new (mint), WS upgrade ONLY at /rt?code=…, one
 *  fixedRoomCode BeaconServer per code (the one-room-per-DO shape). A WS
 *  upgrade on any other path gets the HTTP 200 health answer — the exact
 *  response the live Worker gives the shipped client's bare-path handshake. */
function startCfStub(): Promise<CfStub> {
  const rooms = new Map<string, BeaconServer>();
  const wss = new WebSocketServer({ noServer: true });
  const stub: { newHits: number; minted: string[] } = { newHits: 0, minted: [] };
  const http: Server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://stub");
    if (url.pathname === "/new") {
      stub.newHits++;
      const code = generateRoomCode();
      stub.minted.push(code);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ code }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "rpgatlas-beacon-stub" }));
  });
  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://stub");
    if (url.pathname !== "/rt") {
      // The Worker answers its HTTP route — a 200, not a 101 — which fails the
      // client's WebSocket handshake at the socket level.
      const body = JSON.stringify({ ok: true, service: "rpgatlas-beacon-stub" });
      socket.end(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n" +
        "content-length: " + Buffer.byteLength(body) + "\r\nconnection: close\r\n\r\n" + body,
      );
      return;
    }
    const code = url.searchParams.get("code") || "";
    if (!isCanonicalRoomCode(code)) {
      socket.end("HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let room = rooms.get(code);
      if (!room) {
        room = new BeaconServer({ project: PROJECT, fixedRoomCode: code });
        room.ensureRoom(code);
        rooms.set(code, room);
      }
      room.accept(wrapSocket(ws));
    });
  });
  const tick = setInterval(() => { for (const r of rooms.values()) r.tickRooms(); }, TICK_MS);
  if (typeof tick.unref === "function") tick.unref();
  return new Promise((resolve) => {
    http.listen(0, "127.0.0.1", () => {
      const addr = http.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      resolve({
        port,
        get newHits() { return stub.newHits; },
        get minted() { return stub.minted; },
        close(): Promise<void> {
          clearInterval(tick);
          for (const r of rooms.values()) r.shutdown();
          return new Promise((done) => wss.close(() => http.close(() => done())));
        },
      });
    });
  });
}

interface Rec {
  welcome?: { pid: number; code: string };
  errors: string[];
  offline: number;
}

const clients: RelayClient[] = [];
let cfStub: CfStub | null = null;
let nodeHandle: NodeServerHandle | null = null;
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  if (cfStub) { await cfStub.close(); cfStub = null; }
  if (nodeHandle) { await nodeHandle.close(); nodeHandle = null; }
  resetSession();
});

/** Dial `url` the way co-op.ts does: real socket-transport (ws injected for
 *  Node), real RelayClient, settle on welcome. `code` undefined ⇒ CREATE. */
function dialReal(url: string, opts: { code?: string; name: string; fetchJson?: (u: string) => Promise<unknown> }): Rec {
  const rec: Rec = { errors: [], offline: 0 };
  const world = createWorld(PROJECT);
  let client: RelayClient | null = null;
  let dial: RelayDial | null = null;
  dial = dialRelay({
    url,
    code: opts.code,
    connect: (u, h) => connectSocket(u, { WebSocketCtor: WebSocket as any, onClose: h.onClose, onError: h.onError }),
    fetchJson: opts.fetchJson,
    attach: (transport, joinCode) => {
      client = new RelayClient(world, transport, {
        name: opts.name,
        code: joinCode,
        onWelcome: (pid, roomCode) => { dial?.settle(); rec.welcome = { pid, code: roomCode }; },
        onError: (c) => { dial?.settle(); rec.errors.push(c); },
      });
      clients.push(client);
    },
    teardown: () => { client?.close(); client = null; },
    onOffline: () => rec.offline++,
  });
  return rec;
}

async function waitFor(pred: () => boolean, timeout = 8000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeout) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("post-2.0: the dial fallback against the Cloudflare Worker contract", () => {
  it("CREATE falls back through /new and enters the minted room; a friend joins by code", async () => {
    cfStub = await startCfStub();
    const url = `ws://127.0.0.1:${cfStub.port}`;

    const host = dialReal(url, { name: "Ana" }); // bare dial gets the 200 → /new → /rt
    await waitFor(() => !!host.welcome);
    expect(cfStub.newHits).toBe(1);
    expect(host.welcome!.pid).toBe(1);
    expect(host.welcome!.code).toBe(cfStub.minted[0]);
    expect(host.offline).toBe(0);
    expect(host.errors).toEqual([]);

    // The friend types the shared code: same fallback, but NO extra /new.
    const guest = dialReal(url, { name: "Bo", code: host.welcome!.code });
    await waitFor(() => !!guest.welcome);
    expect(guest.welcome!.pid).toBe(2);
    expect(guest.welcome!.code).toBe(host.welcome!.code);
    expect(cfStub.newHits).toBe(1);
    expect(guest.offline).toBe(0);
  }, 15000);

  it("the plain Node target still connects bare — zero fallback traffic", async () => {
    nodeHandle = await startNodeServer({ project: PROJECT, port: 0 });
    const fetches: string[] = [];
    const rec = dialReal(`ws://127.0.0.1:${nodeHandle.port}`, {
      name: "Ana",
      fetchJson: (u) => { fetches.push(u); return Promise.reject(new Error("must not fetch")); },
    });
    await waitFor(() => !!rec.welcome);
    expect(rec.welcome!.pid).toBe(1);
    expect(fetches).toEqual([]);
    expect(rec.offline).toBe(0);
  }, 15000);

  it("a dead host still ends in the offline copy (both styles refused)", async () => {
    // Grab a port with nothing listening: bind, note it, release it.
    const probe = createServer();
    const deadPort = await new Promise<number>((resolve) => {
      probe.listen(0, "127.0.0.1", () => {
        const addr = probe.address();
        resolve(addr && typeof addr === "object" ? addr.port : 0);
      });
    });
    await new Promise((r) => probe.close(r));

    const rec = dialReal(`ws://127.0.0.1:${deadPort}`, { name: "Ana" });
    await waitFor(() => rec.offline > 0);
    expect(rec.offline).toBe(1);
    expect(rec.welcome).toBeUndefined();
  }, 15000);
});
