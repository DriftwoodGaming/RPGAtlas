/* RPGAtlas — tests-unit/coop-moderation.test.ts
   Project Beacon MP9·A: chat + moderation over the local BroadcastChannel co-op
   path (RoomHost as the owner/authority, RoomClient peers). Proves the SAME D4
   gate as the relay runs here: free text under chatMode:"text" is masked; a peer
   report reaches the host's inbox; a peer can't kick (not-allowed); the host
   (owner) can kick a peer; a banned name can't rejoin. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, describe, expect, it } from "vitest";
import { createWorld, type World } from "../src/shared/sim/world";
import { createLoopbackPair } from "../src/shared/net/transport";
import { WorldHost } from "../src/engine/net/world-host";
import { RoomHost } from "../src/engine/net/room-host";
import { RoomClient } from "../src/engine/net/room-client";
import { resetSession } from "../src/engine/net/session";

async function waitFor(pred: () => boolean, timeout = 3000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeout) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const CHAT_PROJ = {
  system: { startMapId: 1, startX: 5, startY: 5, startDir: "down", multiplayer: { enabled: true, chatMode: "text" } },
};
const OFF_PROJ = { system: { startMapId: 1, startX: 5, startY: 5, startDir: "down" } };

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); resetSession(); });

function makeHost(roomCode: string, project: unknown, onReport?: (r: any) => void) {
  const world: World = createWorld(project);
  world.g.player = { x: 5, y: 5, rx: 5, ry: 5, dir: 0, moving: false, animT: 0 } as any;
  world.g.mapId = 1;
  const link = createLoopbackPair();
  const worldHost = new WorldHost(world, link.server);
  const host = new RoomHost(world, worldHost, roomCode, { localName: "Host", localCharset: "hero", onReport });
  cleanups.push(() => host.close());
  return host;
}

function makeClient(roomCode: string, name: string) {
  const world: World = createWorld(OFF_PROJ);
  world.g.player = { x: 0, y: 0, rx: 0, ry: 0, dir: 0, moving: false, animT: 0 } as any;
  const rec = {
    pid: -1,
    says: [] as Array<{ playerId: number; text?: string; preset?: number }>,
    errors: [] as string[],
    kicks: [] as string[],
  };
  const client = new RoomClient(world, roomCode, {
    name,
    onWelcome: (id) => (rec.pid = id),
    onPresence: (p) => { if (p.kind === "say") rec.says.push({ playerId: p.playerId, text: (p as any).text, preset: (p as any).preset }); },
    onError: (c) => rec.errors.push(c),
    onKick: (c) => rec.kicks.push(c),
  });
  cleanups.push(() => client.close());
  return { client, rec };
}

describe("MP9·A co-op moderation (BroadcastChannel)", () => {
  it("chatMode:text masks a peer's profanity for the other peers", async () => {
    makeHost("MODROOM111", CHAT_PROJ);
    const a = makeClient("MODROOM111", "Ana");
    const b = makeClient("MODROOM111", "Bo");
    await waitFor(() => a.rec.pid > 0 && b.rec.pid > 0);
    a.client.sendChat({ text: "you fuck" });
    await waitFor(() => b.rec.says.length > 0);
    expect(b.rec.says[0].text).toBe("you ****");
  });

  it("chat off rejects a peer's free text (chat-disabled)", async () => {
    makeHost("MODROOM222", OFF_PROJ);
    const a = makeClient("MODROOM222", "Ana");
    await waitFor(() => a.rec.pid > 0);
    a.client.sendChat({ text: "hello" });
    await waitFor(() => a.rec.errors.length > 0);
    expect(a.rec.errors[0]).toBe("chat-disabled");
  });

  it("a peer report reaches the host's (owner) inbox", async () => {
    let report: any = null;
    makeHost("MODROOM333", OFF_PROJ, (r) => (report = r));
    const a = makeClient("MODROOM333", "Ana");
    const b = makeClient("MODROOM333", "Bo");
    await waitFor(() => a.rec.pid > 0 && b.rec.pid > 0);
    a.client.sendMod("report", b.rec.pid, "griefing");
    await waitFor(() => report !== null);
    expect(report).toMatchObject({ from: a.rec.pid, target: b.rec.pid, name: "Bo", reason: "griefing" });
  });

  it("a peer cannot kick another peer (not-allowed); the host owner can", async () => {
    const host = makeHost("MODROOM444", OFF_PROJ);
    const a = makeClient("MODROOM444", "Ana");
    const b = makeClient("MODROOM444", "Bo");
    await waitFor(() => a.rec.pid > 0 && b.rec.pid > 0 && host.peerCount === 2);
    // Ana (a peer) tries to kick Bo → refused, Bo stays.
    a.client.sendMod("kick", b.rec.pid);
    await waitFor(() => a.rec.errors.includes("not-allowed"));
    expect(host.peerCount).toBe(2);
    // The host (owner) kicks Ana → Ana is removed + told.
    host.sendMod("kick", a.rec.pid);
    await waitFor(() => a.rec.kicks.length > 0);
    expect(a.rec.kicks[0]).toBe("kicked");
    await waitFor(() => host.peerCount === 1);
  });

  it("a banned name cannot rejoin the local room", async () => {
    const host = makeHost("MODROOM555", OFF_PROJ);
    const bo = makeClient("MODROOM555", "Bo");
    await waitFor(() => bo.rec.pid > 0);
    host.sendMod("ban", bo.rec.pid);
    await waitFor(() => bo.rec.kicks.includes("banned"));
    // A fresh "Bo" is refused at hello.
    const bo2 = makeClient("MODROOM555", "Bo");
    await waitFor(() => bo2.rec.errors.includes("not-allowed"));
    expect(bo2.rec.pid).toBe(-1); // never welcomed
  });
});
