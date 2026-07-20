/* RPGAtlas — tests-unit/beacon-moderation.test.ts
   Project Beacon MP9·A: friend-room chat + moderation over the in-memory
   ServerConnection (no socket, no engine, no DOM). Proves the D4 chat gate
   (off by default → free text rejected; opt-in text mode → free text accepted
   and profanity masked), the say/emote spam bucket, room-owner kick/ban/report,
   owner-only enforcement (a non-owner gets `not-allowed`), name-ban re-join
   refusal, and owner promotion when the owner leaves. GPL-3.0-or-later. */

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

/** A 3×3 all-grass map; multiplayer OFF (chat defaults to rejected free text). */
const PROJECT = {
  system: { startMapId: 1, startX: 1, startY: 1, startDir: "down" },
  maps: [{ id: 1, width: 3, height: 3, layers: { ground: [1, 1, 1, 1, 1, 1, 1, 1, 1] } }],
  assets: { tiles: {} },
  autotiles: [],
};

/** Same map, but the dev opted into filtered free-text chat (D4). */
const PROJECT_CHAT = {
  ...PROJECT,
  system: { ...PROJECT.system, multiplayer: { enabled: true, chatMode: "text" } },
};

let idc = 0;
class MockConn implements ServerConnection {
  readonly id = ++idc;
  isOpen = true;
  readonly sent: string[] = [];
  private msgH: ((t: string) => void) | null = null;
  private closeH: (() => void) | null = null;
  constructor(readonly source = "10.9.0." + (idc % 250)) {}
  send(text: string): void { if (this.isOpen) this.sent.push(text); }
  close(): void { if (this.isOpen) { this.isOpen = false; this.closeH?.(); } }
  onMessage(h: (t: string) => void): void { this.msgH = h; }
  onClose(h: () => void): void { this.closeH = h; }
  recv(msg: ClientMessage): void { this.msgH?.(encodeMessage(msg)); }
  frames(): ServerMessage[] {
    const out: ServerMessage[] = [];
    for (const s of this.sent) { const r = decodeServerMessage(s); if (r.ok) out.push(r.msg); }
    return out;
  }
  last<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    const f = this.frames().filter((m) => m.t === t) as any[];
    return f[f.length - 1];
  }
  presences(kind: string): any[] {
    return this.frames().filter((m) => m.t === "presence" && (m as any).kind === kind);
  }
}

function makeServer(project: unknown = PROJECT, now = { now: 1000 }, limits = {}) {
  return new BeaconServer({ project, clock: () => now.now, seed: 1, limits });
}

function createRoom(server: BeaconServer, name: string): { conn: MockConn; code: string } {
  const conn = new MockConn();
  server.accept(conn);
  conn.recv({ t: "hello", proto: 1, name });
  conn.recv({ t: "join" });
  const w = conn.last("welcome");
  if (!w) throw new Error("no welcome");
  return { conn, code: w.roomCode };
}

function joinRoom(server: BeaconServer, code: string, name: string): { conn: MockConn; pid: number } {
  const conn = new MockConn();
  server.accept(conn);
  conn.recv({ t: "hello", proto: 1, name });
  conn.recv({ t: "join", code });
  const w = conn.last("welcome");
  return { conn, pid: w ? w.playerId : -1 };
}

describe("MP9·A chat gate (D4)", () => {
  it("free text is rejected by default (chat off); a preset always passes", () => {
    const server = makeServer(PROJECT);
    const { conn: a, code } = createRoom(server, "Ana");
    const { conn: b } = joinRoom(server, code, "Bo");
    b.recv({ t: "chat", text: "hello there" });
    expect(b.last("error")?.code).toBe("chat-disabled");
    expect(a.presences("say").length).toBe(0); // nothing broadcast
    b.recv({ t: "chat", preset: 2 });
    const say = a.presences("say").pop();
    expect(say?.preset).toBe(2);
    expect(say?.text).toBeUndefined();
  });

  it("with chatMode:text, free text is accepted and profanity is masked", () => {
    const server = makeServer(PROJECT_CHAT);
    const { conn: a, code } = createRoom(server, "Ana");
    const { conn: b } = joinRoom(server, code, "Bo");
    b.recv({ t: "chat", text: "you are a fuck" });
    const say = a.presences("say").pop();
    expect(say?.text).toBe("you are a ****"); // authoritative server-side mask
    expect(b.last("error")).toBeUndefined(); // never rejected, just masked
  });

  it("say/emote spam is capped by the social bucket", () => {
    const server = makeServer(PROJECT);
    const { conn: a, code } = createRoom(server, "Ana");
    const { conn: b } = joinRoom(server, code, "Bo");
    for (let i = 0; i < 10; i++) b.recv({ t: "emote", emote: "wave" });
    // Burst is 6 (no ticks elapsed → no refill), so only 6 reach the audience.
    expect(a.presences("emote").length).toBe(6);
  });
});

describe("MP9·A moderation (room owner)", () => {
  it("the first player is the owner; a non-owner cannot kick", () => {
    const server = makeServer();
    const { code } = createRoom(server, "Ana"); // pid 1 = owner
    const { conn: b } = joinRoom(server, code, "Bo"); // pid 2
    b.recv({ t: "mod", action: "kick", target: 1 });
    expect(b.last("error")?.code).toBe("not-allowed");
  });

  it("the owner can kick a player (kick frame + leave presence)", () => {
    const server = makeServer();
    const { conn: a, code } = createRoom(server, "Ana"); // owner pid 1
    const { conn: b, pid } = joinRoom(server, code, "Bo"); // pid 2
    a.recv({ t: "mod", action: "kick", target: pid });
    expect(b.last("kick")?.code).toBe("kicked");
    expect(b.isOpen).toBe(false);
    expect(a.presences("leave").some((p) => p.playerId === pid)).toBe(true);
  });

  it("a banned name cannot rejoin; a different name can", () => {
    const server = makeServer();
    const { conn: a, code } = createRoom(server, "Ana");
    const { conn: b, pid } = joinRoom(server, code, "Bo");
    a.recv({ t: "mod", action: "ban", target: pid });
    expect(b.last("kick")?.code).toBe("banned");
    // Bo tries to rejoin → refused (name ban).
    const bo2 = joinRoom(server, code, "Bo");
    expect(bo2.conn.last("error")?.code).toBe("not-allowed");
    expect(bo2.conn.last("welcome")).toBeUndefined();
    // A different name still gets in.
    const cass = joinRoom(server, code, "Cass");
    expect(cass.conn.last("welcome")).toBeTruthy();
  });

  it("a report reaches the owner's inbox with the target's name", () => {
    const server = makeServer();
    const { conn: a, code } = createRoom(server, "Ana"); // owner pid 1
    joinRoom(server, code, "Bo"); // pid 2
    const { conn: c } = joinRoom(server, code, "Cass"); // pid 3
    c.recv({ t: "mod", action: "report", target: 2, reason: "being mean" });
    const report = a.last("report")!;
    expect(report).toMatchObject({ from: 3, target: 2, name: "Bo", reason: "being mean" });
  });

  it("owner leaves → the next player inherits owner power", () => {
    const now = { now: 1000 };
    const server = makeServer(PROJECT, now);
    const { conn: a, code } = createRoom(server, "Ana"); // owner pid 1
    const bo = joinRoom(server, code, "Bo"); // pid 2
    const cass = joinRoom(server, code, "Cass"); // pid 3
    // While Ana is owner, Bo can't kick.
    bo.conn.recv({ t: "mod", action: "kick", target: cass.pid });
    expect(bo.conn.last("error")?.code).toBe("not-allowed");
    // Ana (owner) disconnects and is reaped past the resume grace (30s), but
    // under the 45s idle timeout so Bo/Cass's live sockets aren't idle-closed.
    a.close();
    now.now += 31_000;
    server.sweep();
    // Bo (pid 2) is now the owner and CAN kick Cass.
    bo.conn.recv({ t: "mod", action: "kick", target: cass.pid });
    expect(cass.conn.last("kick")?.code).toBe("kicked");
  });
});
