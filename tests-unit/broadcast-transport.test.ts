/* RPGAtlas — tests-unit/broadcast-transport.test.ts
   Project Beacon MP4·B: the BroadcastChannel point-to-point transport. Node 18+
   exposes a same-thread BroadcastChannel, so two endpoints in this one process
   stand in for two browser tabs. Covers the join handshake, bidirectional frame
   routing (JSON-encoded wire path), buffering before the link is ready, and —
   the property that makes it a private link, not a bus — per-connection
   isolation (a frame to one client never reaches another). GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { connectBroadcast, openBroadcastServer } from "../src/engine/net/broadcast-transport";
import type { Transport } from "../src/shared/net/transport";

async function waitFor(pred: () => boolean, timeout = 3000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeout) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

let roomSeq = 0;
function freshRoom(): string {
  return "TEST" + Date.now().toString(36) + (roomSeq++).toString(36);
}

describe("BroadcastChannel point-to-point transport", () => {
  it("completes the handshake and routes frames both ways (JSON wire path)", async () => {
    const room = freshRoom();
    const serverInbox: any[] = [];
    const conns: { t: Transport; cid: string }[] = [];
    const server = openBroadcastServer(room, (t, cid) => {
      conns.push({ t, cid });
      t.onMessage((m) => serverInbox.push(m));
    });

    const client = connectBroadcast(room);
    const clientInbox: any[] = [];
    client.onMessage((m) => clientInbox.push(m));

    // Sent before the server answers `ready` → buffered, then flushed in order.
    client.send({ t: "hello", proto: 1, name: "Robin" } as any);
    await waitFor(() => serverInbox.length >= 1);
    expect(conns.length).toBe(1);
    expect(serverInbox[0]).toEqual({ t: "hello", proto: 1, name: "Robin" });

    conns[0].t.send({ t: "welcome", proto: 1, playerId: 2, roomCode: room, resumeToken: "x".repeat(16), tick: 0 } as any);
    await waitFor(() => clientInbox.length >= 1);
    expect(clientInbox[0]).toMatchObject({ t: "welcome", playerId: 2 });

    client.close();
    conns[0].t.close();
    server.close();
  });

  it("gives each client a private channel (no cross-talk)", async () => {
    const room = freshRoom();
    const conns: { t: Transport; cid: string }[] = [];
    const server = openBroadcastServer(room, (t, cid) => conns.push({ t, cid }));

    const a = connectBroadcast(room);
    const b = connectBroadcast(room);
    const aInbox: any[] = [];
    const bInbox: any[] = [];
    a.onMessage((m) => aInbox.push(m));
    b.onMessage((m) => bInbox.push(m));

    await waitFor(() => conns.length >= 2);
    expect(conns[0].cid).not.toBe(conns[1].cid);

    // Identify which server conn faces client A: A says hello, then find it.
    a.send({ t: "hello", proto: 1, name: "A" } as any);
    const seen: Record<string, any> = {};
    for (const c of conns) c.t.onMessage((m) => (seen[c.cid] = m));
    await waitFor(() => Object.values(seen).some((m) => m && m.name === "A"));
    const aCid = Object.keys(seen).find((cid) => seen[cid].name === "A")!;
    const aConn = conns.find((c) => c.cid === aCid)!;

    // A message down A's server channel reaches ONLY client A.
    aConn.t.send({ t: "presence", tick: 1, kind: "emote", playerId: 9, emote: "wave" } as any);
    await waitFor(() => aInbox.length >= 1);
    // Give any errant cross-talk a chance to arrive, then assert B got nothing.
    await new Promise((r) => setTimeout(r, 40));
    expect(aInbox.some((m) => m.t === "presence")).toBe(true);
    expect(bInbox.length).toBe(0);

    a.close();
    b.close();
    for (const c of conns) c.t.close();
    server.close();
  });
});
