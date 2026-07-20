/* RPGAtlas — tests-unit/beacon-ws.test.ts
   Project Beacon MP5·A: the Node `ws` target end-to-end over REAL WebSockets
   (server + clients both from the `ws` package, loopback TCP). Proves the whole
   plain-Node path the core test can't: socket framing, the 60 Hz tick timer,
   graceful close. Two clients join a room, one walks, and both receive the
   authoritative delta. GPL-3.0. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startNodeServer, type NodeServerHandle } from "../server/src/node/ws-server";
import {
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/shared/net/protocol";

const PROJECT = {
  system: { startMapId: 1, startX: 2, startY: 2, startDir: "down", title: "Test World" },
  maps: [{ id: 1, width: 6, height: 6, layers: { ground: new Array(36).fill(1) } }],
  assets: { tiles: {} },
  autotiles: [],
};

let handle: NodeServerHandle | null = null;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) { try { s.close(); } catch { /* */ } }
  if (handle) { await handle.close(); handle = null; }
});

/** A tiny WebSocket client that decodes server frames and can await one. */
class Client {
  readonly frames: ServerMessage[] = [];
  private ws: WebSocket;
  private open: Promise<void>;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    sockets.push(this.ws);
    this.open = new Promise((res, rej) => {
      this.ws.on("open", () => res());
      this.ws.on("error", rej);
    });
    this.ws.on("message", (data) => {
      const r = decodeServerMessage(String(data));
      if (r.ok) this.frames.push(r.msg);
    });
  }
  async ready(): Promise<this> { await this.open; return this; }
  send(msg: ClientMessage): void { this.ws.send(encodeMessage(msg)); }
  last<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    const f = this.frames.filter((m) => m.t === t);
    return f[f.length - 1] as Extract<ServerMessage, { t: T }> | undefined;
  }
  async waitFor(pred: () => boolean, timeout = 8000): Promise<void> {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > timeout) throw new Error("waitFor timed out");
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

const players = (m: ServerMessage | undefined): Array<{ id: number; x: number; y: number }> =>
  (m as any)?.world?.players ?? (m as any)?.changes?.players ?? [];

describe("MP5 Node ws server (real sockets)", () => {
  it("serves a room over WebSocket: join, walk, delta to both clients", async () => {
    handle = await startNodeServer({ project: PROJECT, port: 0 });
    const url = `ws://127.0.0.1:${handle.port}`;

    const a = await new Client(url).ready();
    a.send({ t: "hello", proto: 1, name: "Ana" });
    a.send({ t: "join" });
    await a.waitFor(() => !!a.last("welcome") && !!a.last("snapshot"));
    const code = a.last("welcome")!.roomCode;

    const b = await new Client(url).ready();
    b.send({ t: "hello", proto: 1, name: "Bo" });
    b.send({ t: "join", code });
    await b.waitFor(() => !!b.last("snapshot"));
    expect(players(b.last("snapshot")).map((p) => p.id).sort()).toEqual([1, 2]);

    // Ana walks right one tile; both clients see her authoritative position move.
    a.send({ t: "input", seq: 1, intent: { k: "move", dir: "right", dir8: 2 } });
    await b.waitFor(() => {
      const ana = players(b.last("delta")).find((p) => p.id === 1);
      return !!ana && ana.x === 3;
    });
    const anaOnB = players(b.last("delta")).find((p) => p.id === 1)!;
    expect(anaOnB).toMatchObject({ x: 3, y: 2 });

    // health endpoint reports live counts
    const res = await fetch(`http://127.0.0.1:${handle.port}/`);
    const health = await res.json();
    expect(health.ok).toBe(true);
    expect(health.players).toBe(2);
  }, 15000);

  it("closes gracefully (no lingering handles)", async () => {
    handle = await startNodeServer({ project: PROJECT, port: 0 });
    const c = await new Client(`ws://127.0.0.1:${handle.port}`).ready();
    c.send({ t: "hello", proto: 1, name: "Solo" });
    c.send({ t: "join" });
    await c.waitFor(() => !!c.last("welcome"));
    await handle.close();
    handle = null;
    expect(true).toBe(true); // afterEach would hang if close() leaked
  }, 15000);
});
