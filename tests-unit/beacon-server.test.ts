/* RPGAtlas — tests-unit/beacon-server.test.ts
   Project Beacon MP5·A/D: the Beacon server core (server/src/core) end-to-end
   over an in-memory ServerConnection — no socket, no engine, no DOM. Proves the
   room lifecycle the WebSocket/DO adapters ride: handshake → create room (code)
   → join by code → authoritative movement with wall collision → presence/emote
   → per-tick delta → resume by token → empty-room expiry, plus the MP5·D
   hardening (byte cap, message + join rate limits, malformed frames never
   crash) and directive routing. GPL-3.0. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from "vitest";
import { BeaconServer } from "../server/src/core/server";
import type { ServerConnection } from "../server/src/core/connection";
import {
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/shared/net/protocol";
import { emitDirective } from "../src/shared/sim/directives";

/** A 3×3 all-grass map with one wall at (2,1); start at (1,1) facing down. */
const PROJECT = {
  system: { startMapId: 1, startX: 1, startY: 1, startDir: "down" },
  maps: [{ id: 1, width: 3, height: 3, layers: { ground: [1, 1, 1, 1, 1, 23, 1, 1, 1] } }],
  assets: { tiles: {} },
  autotiles: [],
};

let idc = 0;
class MockConn implements ServerConnection {
  readonly id = ++idc;
  isOpen = true;
  readonly sent: string[] = [];
  private msgH: ((t: string) => void) | null = null;
  private closeH: (() => void) | null = null;
  constructor(readonly source = "10.0.0." + (idc % 250)) {}
  send(text: string): void { if (this.isOpen) this.sent.push(text); }
  close(): void { if (this.isOpen) { this.isOpen = false; this.closeH?.(); } }
  onMessage(h: (t: string) => void): void { this.msgH = h; }
  onClose(h: () => void): void { this.closeH = h; }
  /** Test drives an inbound client frame. */
  recv(msg: ClientMessage): void { this.msgH?.(encodeMessage(msg)); }
  recvRaw(text: string): void { this.msgH?.(text); }
  frames(): ServerMessage[] {
    const out: ServerMessage[] = [];
    for (const s of this.sent) { const r = decodeServerMessage(s); if (r.ok) out.push(r.msg); }
    return out;
  }
  last<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    const f = this.frames().filter((m) => m.t === t);
    return f[f.length - 1] as Extract<ServerMessage, { t: T }> | undefined;
  }
}

/** A clock the test advances by hand. */
function clockAt(ref: { now: number }) {
  return () => ref.now;
}

function makeServer(now = { now: 1000 }, limits = {}) {
  const server = new BeaconServer({ project: PROJECT, clock: clockAt(now), seed: 1, limits });
  return { server, now };
}

/** hello + join(no code) → returns the connection's room code. */
function createRoom(server: BeaconServer, name: string): { conn: MockConn; code: string } {
  const conn = new MockConn();
  server.accept(conn);
  conn.recv({ t: "hello", proto: 1, name });
  conn.recv({ t: "join" });
  const w = conn.last("welcome");
  if (!w) throw new Error("no welcome");
  return { conn, code: w.roomCode };
}

function joinRoom(server: BeaconServer, code: string, name: string): MockConn {
  const conn = new MockConn();
  server.accept(conn);
  conn.recv({ t: "hello", proto: 1, name });
  conn.recv({ t: "join", code });
  return conn;
}

const roster = (m: ServerMessage | undefined): Array<{ id: number; x: number; y: number }> =>
  (m as any)?.world?.players ?? (m as any)?.changes?.players ?? [];

describe("MP5 BeaconServer lifecycle", () => {
  it("handshake → create room → welcome + snapshot", () => {
    const { server } = makeServer();
    const { conn, code } = createRoom(server, "Robin");
    expect(code).toMatch(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{9}$/);
    const w = conn.last("welcome")!;
    expect(w.proto).toBe(1);
    expect(w.playerId).toBe(1);
    expect(w.resumeToken).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    const snap = conn.last("snapshot")!;
    expect(roster(snap).map((p) => p.id)).toEqual([1]);
    expect((snap as any).world.mapId).toBe(1);
    expect(server.roomCount).toBe(1);
  });

  it("second player joins by code; both see the roster + presence", () => {
    const { server } = makeServer();
    const { conn: a, code } = createRoom(server, "Ana");
    const b = joinRoom(server, code, "Bo");
    // Bo's snapshot has both players.
    expect(roster(b.last("snapshot")).map((p) => p.id).sort()).toEqual([1, 2]);
    // Ana was told Bo joined.
    const join = a.frames().find((m) => m.t === "presence" && (m as any).kind === "join" && (m as any).playerId === 2);
    expect(join).toBeTruthy();
  });

  it("unknown code → room-not-found; full room → room-full", () => {
    const { server } = makeServer(undefined, { maxPlayersPerRoom: 1 });
    const bad = new MockConn();
    server.accept(bad);
    bad.recv({ t: "hello", proto: 1, name: "X" });
    bad.recv({ t: "join", code: "000000000" });
    expect(bad.last("error")?.code).toBe("room-not-found");
    const { code } = createRoom(server, "Ana");
    const full = joinRoom(server, code, "Bo");
    expect(full.last("error")?.code).toBe("room-full");
  });

  it("proto mismatch is fatal", () => {
    const { server } = makeServer();
    const conn = new MockConn();
    server.accept(conn);
    conn.recv({ t: "hello", proto: 999, name: "X" });
    expect(conn.last("error")?.code).toBe("proto-mismatch");
    expect(conn.isOpen).toBe(false);
  });
});

describe("MP5 authoritative movement", () => {
  const tick = (s: BeaconServer, n: number) => { for (let i = 0; i < n; i++) s.tickRooms(); };

  it("applies a legal step and echoes it in the delta", () => {
    const { server } = makeServer();
    const { conn } = createRoom(server, "Ana");
    conn.recv({ t: "input", seq: 1, intent: { k: "move", dir: "left", dir8: 1 } });
    tick(server, 20);
    const me = roster(conn.last("delta")).find((p) => p.id === 1)!;
    expect(me.x).toBe(0); // stepped from (1,1) to (0,1)
    expect(me.y).toBe(1);
  });

  it("blocks a step into a wall", () => {
    const { server } = makeServer();
    const { conn } = createRoom(server, "Ana");
    conn.recv({ t: "input", seq: 1, intent: { k: "move", dir: "right", dir8: 2 } }); // (2,1) is a wall
    tick(server, 20);
    const me = roster(conn.last("delta")).find((p) => p.id === 1)!;
    expect(me.x).toBe(1); // did not move into the wall
    expect(me.dir).toBe(2); // but faced that way
  });

  it("does not stack two players on one tile", () => {
    const { server } = makeServer();
    const { conn: a, code } = createRoom(server, "Ana"); // player 1 at (1,1)
    const b = joinRoom(server, code, "Bo"); // player 2 also spawns (1,1)
    // Move Ana off the tile so Bo has somewhere to be; then both aim for (1,0).
    a.recv({ t: "input", seq: 1, intent: { k: "move", dir: "up", dir8: 3 } });
    server.tickRooms(); // Ana starts stepping to (1,0)
    b.recv({ t: "input", seq: 1, intent: { k: "move", dir: "up", dir8: 3 } });
    for (let i = 0; i < 20; i++) server.tickRooms();
    const states = roster(a.last("delta"));
    const p1 = states.find((p) => p.id === 1)!;
    const p2 = states.find((p) => p.id === 2)!;
    expect(p1.x === p2.x && p1.y === p2.y).toBe(false); // never share a tile
  });
});

describe("MP5 presence, resume, expiry", () => {
  it("emote broadcasts to the other player only", () => {
    const { server } = makeServer();
    const { conn: a, code } = createRoom(server, "Ana");
    const b = joinRoom(server, code, "Bo");
    b.recv({ t: "emote", emote: "wave" });
    // Ana (the other player) hears Bo's emote; Bo does not get a self-echo.
    const heard = a.frames().find(
      (m) => m.t === "presence" && (m as any).kind === "emote" && (m as any).playerId === 2,
    );
    expect((heard as any)?.emote).toBe("wave");
    expect(b.frames().some((m) => m.t === "presence" && (m as any).kind === "emote")).toBe(false);
  });

  it("resume by token re-attaches the same player slot", () => {
    const ref = { now: 1000 };
    const { server } = makeServer(ref);
    const { conn, code } = createRoom(server, "Ana");
    const token = conn.last("welcome")!.resumeToken;
    conn.close(); // drop the socket
    ref.now += 1000;
    const back = new MockConn();
    server.accept(back);
    back.recv({ t: "hello", proto: 1, name: "Ana" });
    back.recv({ t: "resume", code, token });
    const w = back.last("welcome");
    expect(w?.playerId).toBe(1); // same slot, not a new player
    expect(server.roomCount).toBe(1);
  });

  it("bad resume token → room-not-found (no oracle)", () => {
    const { server } = makeServer();
    const { code } = createRoom(server, "Ana");
    const conn = new MockConn();
    server.accept(conn);
    conn.recv({ t: "hello", proto: 1, name: "Z" });
    conn.recv({ t: "resume", code, token: "wrongtokenwrongtoken00" });
    expect(conn.last("error")?.code).toBe("room-not-found");
  });

  it("an empty room expires after its TTL and a disconnected member is reaped", () => {
    const ref = { now: 1000 };
    const { server } = makeServer(ref, { resumeGraceMs: 5000, emptyRoomTtlMs: 10000 });
    const { conn } = createRoom(server, "Ana");
    conn.close();
    server.sweep();
    expect(server.roomCount).toBe(1); // still within grace/ttl
    ref.now += 20000;
    server.sweep();
    expect(server.roomCount).toBe(0); // expired
  });
});

describe("MP5·D hardening", () => {
  it("rejects a malformed frame without crashing", () => {
    const { server } = makeServer();
    const conn = new MockConn();
    server.accept(conn);
    conn.recvRaw("}{ not json");
    conn.recvRaw(JSON.stringify({ t: "bogus" }));
    conn.recvRaw(JSON.stringify({ t: "input", seq: -1, intent: { k: "fly" } }));
    expect(conn.frames().every((m) => m.t === "error")).toBe(true);
    expect(conn.last("error")?.code).toBe("malformed");
    expect(conn.isOpen).toBe(true); // survived
  });

  it("rejects an oversized frame", () => {
    const { server } = makeServer(undefined, { maxFrameBytes: 200 });
    const conn = new MockConn();
    server.accept(conn);
    conn.recvRaw(JSON.stringify({ t: "hello", proto: 1, name: "x".repeat(500) }));
    expect(conn.last("error")?.code).toBe("malformed");
  });

  it("rate-limits a message flood", () => {
    const { server } = makeServer(undefined, { messagesPerSecond: 5, messageBurst: 5 });
    const { conn } = createRoom(server, "Ana"); // uses 2 tokens (hello+join)
    for (let i = 0; i < 20; i++) conn.recv({ t: "emote", emote: "spam" });
    expect(conn.last("error")?.code).toBe("rate-limited");
  });

  it("rate-limits join brute-force from one source", () => {
    const { server } = makeServer(undefined, { joinsPerSource: 3, joinWindowMs: 60000 });
    const conn = new MockConn("1.2.3.4");
    server.accept(conn);
    conn.recv({ t: "hello", proto: 1, name: "Z" });
    for (let i = 0; i < 6; i++) conn.recv({ t: "join", code: "00000000" + (i % 10) });
    expect(conn.last("error")?.code).toBe("rate-limited");
  });

  it("free-text chat is rejected (chat off by default, D4)", () => {
    const { server } = makeServer();
    const { conn } = createRoom(server, "Ana");
    conn.recv({ t: "chat", text: "hello world" });
    expect(conn.last("error")?.code).toBe("chat-disabled");
  });
});

describe("MP5·B one-room-per-DO (fixedRoomCode)", () => {
  it("codeless and matching-code joins both enter the one pinned room", () => {
    const CODE = "BCDFGHJKM";
    const server = new BeaconServer({ project: PROJECT, clock: () => 1000, seed: 1, fixedRoomCode: CODE });
    server.ensureRoom(CODE);
    // Creator: codeless join.
    const a = new MockConn();
    server.accept(a);
    a.recv({ t: "hello", proto: 1, name: "Ana" });
    a.recv({ t: "join" });
    expect(a.last("welcome")?.roomCode).toBe(CODE);
    // Joiner: matching code → same room, second player.
    const b = new MockConn();
    server.accept(b);
    b.recv({ t: "hello", proto: 1, name: "Bo" });
    b.recv({ t: "join", code: CODE });
    expect(b.last("welcome")?.playerId).toBe(2);
    expect(server.roomCount).toBe(1);
  });

  it("a non-matching code is room-not-found in a pinned server", () => {
    const server = new BeaconServer({ project: PROJECT, clock: () => 1000, fixedRoomCode: "BCDFGHJKM" });
    const conn = new MockConn();
    server.accept(conn);
    conn.recv({ t: "hello", proto: 1, name: "Z" });
    conn.recv({ t: "join", code: "MNPQRSTVW" });
    expect(conn.last("error")?.code).toBe("room-not-found");
  });
});

describe("MP5 directive routing", () => {
  it("routes a directive to the right player and its reply resumes the world", async () => {
    const { server } = makeServer();
    const { conn } = createRoom(server, "Ana");
    // Reach the room's world to emit a directive at player 1 (as MP8's runtime
    // will). The core exposes rooms via a test-only accessor below.
    const room = (server as any).rooms.values().next().value;
    const resolved = emitDirective(room.world, 1, { kind: "message", text: "hi" });
    const d = conn.last("directive")!;
    expect(d.directive).toEqual({ kind: "message", text: "hi" });
    conn.recv({ t: "reply", id: d.id, value: { kind: "message", done: true } });
    expect(await resolved).toEqual({ kind: "message", done: true });
    expect(room.world.directives.pending.size).toBe(0);
  });
});
