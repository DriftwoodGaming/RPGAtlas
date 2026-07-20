/* RPGAtlas — server/src/node/ws-server.ts
   Project Beacon MP5·A: the plain-Node target. Wraps each `ws` WebSocket as a
   ServerConnection and feeds the transport-agnostic BeaconServer core (the same
   core the Cloudflare DO runs in MP5·B). Drives the authoritative 60 Hz room
   tick + the 1 Hz expiry/idle sweep. This is the "one-command deploy" self-host
   target from the roadmap (D2): `node beacon.mjs --project game.json`. GPL-3.0. */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { BeaconServer, type BeaconServerOptions } from "../core/server.js";
import { BeaconWorld, type BeaconWorldOptions } from "../core/beacon-world.js";
import { DEFAULT_LIMITS, DEFAULT_WORLD_LIMITS, type BeaconLimits, type WorldLimits } from "../core/config.js";
import type { ServerConnection } from "../core/connection.js";

export interface NodeServerOptions extends BeaconServerOptions {
  /** TCP port (0 = an OS-assigned free port; the returned handle reports it). */
  port?: number;
  host?: string;
  /** Trust an upstream proxy's X-Forwarded-For for the rate-limit source
   *  (Cloudflare/nginx in front). OFF by default — only enable behind a proxy
   *  you control, or a client can spoof its way past the join limiter. */
  trustProxy?: boolean;
}

export interface NodeServerHandle {
  server: BeaconServer;
  wss: WebSocketServer;
  http: Server;
  port: number;
  close(): Promise<void>;
}

/** The tick length must match the engine (loop.ts TICK_MS = 1000/60). */
const TICK_MS = 1000 / 60;
const SWEEP_MS = 1000;
/** Durable-persistence flush cadence (§A5 crash-loss budget ≤ 30 s). */
const PERSIST_MS = 30_000;

let connSeq = 0;

/** Extract the rate-limit source bucket (an IP). Never logged to players, never
 *  on the wire (D6). */
function sourceOf(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const first = Array.isArray(xff) ? xff[0] : xff;
    if (first) return first.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

/** Wrap a live `ws` socket as a ServerConnection for the core. */
function wrapSocket(ws: WebSocket, source: string): ServerConnection {
  let open = true;
  return {
    id: ++connSeq,
    source,
    get isOpen() { return open; },
    send(text: string): void {
      if (open && ws.readyState === ws.OPEN) ws.send(text);
    },
    close(): void {
      if (!open) return;
      open = false;
      try { ws.close(); } catch { /* already closing */ }
    },
    onMessage(handler: (t: string) => void): void {
      ws.on("message", (data: unknown, isBinary: boolean) => {
        if (isBinary) { handler(""); return; } // binary is not protocol v1 → malformed
        handler(String(data));
      });
    },
    onClose(handler: () => void): void {
      ws.on("close", () => { open = false; handler(); });
      ws.on("error", () => { /* 'close' always follows; swallow to avoid crash */ });
    },
  };
}

/** Start a Node Beacon server. Returns a handle with the bound port and a
 *  graceful `close()`. */
export function startNodeServer(opts: NodeServerOptions): Promise<NodeServerHandle> {
  const limits: BeaconLimits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const server = new BeaconServer({ ...opts, limits });
  const http = createServer((_req, res) => {
    // A tiny health endpoint; everything real is WebSocket upgrade traffic.
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...server.stats() }));
  });
  const wss = new WebSocketServer({ server: http, maxPayload: limits.maxFrameBytes });
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    server.accept(wrapSocket(ws, sourceOf(req, !!opts.trustProxy)));
  });

  const tickTimer = setInterval(() => server.tickRooms(), TICK_MS);
  const sweepTimer = setInterval(() => server.sweep(), SWEEP_MS);
  // Don't keep the process alive solely for the timers when nothing's connected.
  if (typeof tickTimer.unref === "function") tickTimer.unref();
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  return new Promise((resolve) => {
    http.listen(opts.port ?? 8787, opts.host, () => {
      const addr = http.address();
      const port = addr && typeof addr === "object" ? addr.port : (opts.port ?? 8787);
      resolve({
        server, wss, http, port,
        close(): Promise<void> {
          clearInterval(tickTimer);
          clearInterval(sweepTimer);
          server.shutdown();
          return new Promise((done) => {
            wss.close(() => http.close(() => done()));
          });
        },
      });
    });
  });
}

/* ── MP8·A: the persistent-world target (zones + AOI + passports) ───────── */

export interface NodeWorldOptions extends BeaconWorldOptions {
  port?: number;
  host?: string;
  trustProxy?: boolean;
  limits?: Partial<WorldLimits>;
}

export interface NodeWorldHandle {
  world: BeaconWorld;
  wss: WebSocketServer;
  http: Server;
  port: number;
  close(): Promise<void>;
}

/** Start a Node Beacon WORLD server: one game, one world, zone-per-map
 *  (`node beacon.mjs --project game.json --world`). Same socket wrapping and
 *  cadences as the friend-room relay; the core behind them is BeaconWorld. */
export async function startNodeWorldServer(opts: NodeWorldOptions): Promise<NodeWorldHandle> {
  const limits: WorldLimits = { ...DEFAULT_WORLD_LIMITS, ...(opts.limits || {}) };
  const world = new BeaconWorld({ ...opts, limits });
  // Restore durable state before any client can connect (§A5).
  await world.load();
  const http = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: "world", ...world.stats() }));
  });
  const wss = new WebSocketServer({ server: http, maxPayload: limits.maxFrameBytes });
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    world.accept(wrapSocket(ws, sourceOf(req, !!opts.trustProxy)));
  });

  // Drift-compensated 60 Hz for in-process zones: Windows quantizes a
  // 16.7 ms setInterval to ~31 ms, which would halve the sim rate (the same
  // fix zone-worker.ts carries for worker zones). Each firing advances the
  // sim by the wall time actually elapsed, capped so a stall can't spiral.
  let last = Date.now();
  let acc = 0;
  const tickTimer = setInterval(() => {
    const now = Date.now();
    acc += now - last;
    last = now;
    let n = Math.floor(acc / TICK_MS);
    if (n > 30) {
      acc = 0;
      n = 30;
    } else {
      acc -= n * TICK_MS;
    }
    while (n-- > 0) world.tickZones();
  }, 8);
  const sweepTimer = setInterval(() => world.sweep(), SWEEP_MS);
  // Durable flush loop (only when a store is configured): persist the dirty set
  // on a fixed cadence so a crash loses at most PERSIST_MS of world state (§A5).
  const persistTimer = opts.store
    ? setInterval(() => {
        void world.flush().catch((e) => opts.log?.("warn", "persist-error", { error: String(e) }));
      }, PERSIST_MS)
    : null;
  if (typeof tickTimer.unref === "function") tickTimer.unref();
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  if (persistTimer && typeof persistTimer.unref === "function") persistTimer.unref();

  return new Promise((resolve) => {
    http.listen(opts.port ?? 8787, opts.host, () => {
      const addr = http.address();
      const port = addr && typeof addr === "object" ? addr.port : (opts.port ?? 8787);
      resolve({
        world, wss, http, port,
        async close(): Promise<void> {
          clearInterval(tickTimer);
          clearInterval(sweepTimer);
          if (persistTimer) clearInterval(persistTimer);
          // Graceful shutdown flush (§A5): capture final positions/state before
          // the sockets close, so a clean stop loses nothing.
          if (opts.store) await world.flush().catch(() => {});
          world.shutdown();
          return new Promise((done) => {
            wss.close(() => http.close(() => done()));
          });
        },
      });
    });
  });
}
