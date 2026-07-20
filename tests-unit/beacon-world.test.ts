/* RPGAtlas — tests-unit/beacon-world.test.ts
   Project Beacon MP8·A: the persistent-world directory + zones
   (server/src/core/beacon-world.ts + zone.ts) end-to-end over in-memory
   connections — no sockets, no DOM. Proves: the passport challenge/verify
   gate (and its failure modes: bad sig, no passport, ban, session
   supersession), zone-per-map admission + authoritative movement, the
   decimated broadcast cadence, chunked AOI filtering of deltas/presence,
   cross-zone transfer handoff (gateway model), rejoin-at-last-position
   records, world-scoped resume, shared-state fan-out, and empty-zone
   expiry. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from "vitest";
import { BeaconWorld } from "../server/src/core/beacon-world";
import type { ServerConnection } from "../server/src/core/connection";
import {
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/shared/net/protocol";
import {
  generatePassport,
  passportPublicRaw,
  signChallenge,
  type Passport,
} from "../src/shared/net/passport";

/** Map 1: 20×20 open grass (start 1,1). Map 7: 8×8 grass. Tile 23 is the
 *  wall tile the shared collision fixtures use. */
const PROJECT = {
  system: { startMapId: 1, startX: 1, startY: 1, startDir: "down" },
  maps: [
    { id: 1, width: 20, height: 20, layers: { ground: new Array(400).fill(1) } },
    { id: 7, width: 8, height: 8, layers: { ground: new Array(64).fill(1) } },
  ],
  assets: { tiles: {} },
  autotiles: [],
};

/** Map 1 swapped for a 100×100 field (AOI tests need chunk distance). */
const BIG_PROJECT = {
  ...PROJECT,
  maps: [
    { id: 1, width: 100, height: 100, layers: { ground: new Array(10000).fill(1) } },
    PROJECT.maps[1],
  ],
};

let idc = 0;
class MockConn implements ServerConnection {
  readonly id = ++idc;
  isOpen = true;
  readonly sent: string[] = [];
  private msgH: ((t: string) => void) | null = null;
  private closeH: (() => void) | null = null;
  constructor(readonly source = "10.1.0." + (idc % 250)) {}
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
  all<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.frames().filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
  last<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    const f = this.all(t);
    return f[f.length - 1];
  }
}

/** Let the async passport verification settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeWorld(project: unknown = PROJECT, limits = {}, now = { now: 1000 }) {
  const world = new BeaconWorld({ project, clock: () => now.now, seed: 1, limits });
  return { world, now };
}

/** Connect + authenticate + join with a passport. Returns the connection and
 *  the player id. */
async function joinWorld(world: BeaconWorld, passport: Passport): Promise<{ conn: MockConn; pid: number }> {
  const conn = new MockConn();
  world.accept(conn);
  const challenge = conn.last("challenge");
  if (!challenge) throw new Error("no challenge frame");
  const pub = await passportPublicRaw(passport);
  const sig = await signChallenge(passport, challenge.nonce);
  conn.recv({ t: "hello", proto: 1, name: passport.name, pub, sig });
  conn.recv({ t: "join" }); // parks in the auth queue, drains after verify
  await flush();
  await flush();
  const w = conn.last("welcome");
  if (!w) throw new Error("join failed: " + conn.sent.join(" | "));
  return { conn, pid: w.playerId };
}

const players = (m: ServerMessage | undefined): any[] =>
  (m as any)?.world?.players ?? (m as any)?.changes?.players ?? [];

describe("MP8·A world auth (passport challenge gate)", () => {
  it("challenge → signed hello → join: welcome + snapshot on the right map", async () => {
    const { world } = makeWorld();
    const p = await generatePassport("Riko");
    const { conn, pid } = await joinWorld(world, p);
    const snap = conn.last("snapshot")!;
    expect((snap as any).world.mapId).toBe(1);
    expect(players(snap).map((x) => x.id)).toContain(pid);
    expect(world.stats().zones).toBe(1);
    expect(world.stats().players).toBe(1);
  });

  it("a wrong signature is auth-failed, never a session", async () => {
    const { world } = makeWorld();
    const riko = await generatePassport("Riko");
    const mallory = await generatePassport("Mallory");
    const conn = new MockConn();
    world.accept(conn);
    const nonce = conn.last("challenge")!.nonce;
    // Mallory presents Riko's public key with her own signature.
    conn.recv({ t: "hello", proto: 1, name: "Riko?", pub: await passportPublicRaw(riko), sig: await signChallenge(mallory, nonce) });
    await flush();
    await flush();
    expect(conn.last("error")?.code).toBe("auth-failed");
    expect(conn.isOpen).toBe(false);
    expect(world.stats().players).toBe(0);
  });

  it("a passportless hello on a world server is auth-failed", async () => {
    const { world } = makeWorld();
    const conn = new MockConn();
    world.accept(conn);
    conn.recv({ t: "hello", proto: 1, name: "Anon" });
    expect(conn.last("error")?.code).toBe("auth-failed");
    expect(conn.isOpen).toBe(false);
  });

  it("ban by fingerprint: live kick now, refused at the door later", async () => {
    const { world } = makeWorld();
    const p = await generatePassport("Riko");
    const { conn } = await joinWorld(world, p);
    const fp = (world as any).byFingerprint.keys().next().value as string;
    world.ban(fp);
    expect(conn.last("kick")?.code).toBe("banned");
    expect(conn.isOpen).toBe(false);
    const again = new MockConn();
    world.accept(again);
    const nonce = again.last("challenge")!.nonce;
    again.recv({ t: "hello", proto: 1, name: "Riko", pub: await passportPublicRaw(p), sig: await signChallenge(p, nonce) });
    await flush();
    await flush();
    expect(again.last("kick")?.code).toBe("banned");
    expect(again.isOpen).toBe(false);
  });

  it("one live session per passport: a new sign-in supersedes the old", async () => {
    const { world } = makeWorld();
    const p = await generatePassport("Riko");
    const first = await joinWorld(world, p);
    const second = await joinWorld(world, p);
    expect(first.conn.last("kick")?.code).toBe("replaced");
    expect(first.conn.isOpen).toBe(false);
    expect(second.conn.last("welcome")).toBeTruthy();
    expect(world.stats().players).toBe(1);
  });
});

describe("MP8·A zones: movement, cadence, AOI", () => {
  it("authoritative movement with the decimated broadcast cadence", async () => {
    const { world } = makeWorld(PROJECT, { broadcastEveryTicks: 5 });
    const p = await generatePassport("Riko");
    const { conn, pid } = await joinWorld(world, p);
    conn.sent.length = 0;
    conn.recv({ t: "input", seq: 1, intent: { k: "move", dir: "right" } });
    for (let i = 0; i < 4; i++) world.tickZones();
    expect(conn.all("delta").length).toBe(0); // decimated: nothing yet
    world.tickZones(); // 5th tick → one broadcast
    expect(conn.all("delta").length).toBe(1);
    for (let i = 0; i < 25; i++) world.tickZones(); // let the step complete
    const me = players(conn.last("delta")).find((x) => x.id === pid);
    expect(me.x).toBe(2); // moved one tile right of the start (1,1)
    expect(me.y).toBe(1);
    expect(conn.all("delta").length).toBe(6); // 30 ticks / every-5 = 6 frames
  });

  it("AOI: far players are absent from your deltas, near ones present", async () => {
    const { world } = makeWorld(BIG_PROJECT, { aoiBypassMax: 2, broadcastEveryTicks: 1 });
    const a = await joinWorld(world, await generatePassport("Near-A"));
    const b = await joinWorld(world, await generatePassport("Near-B"));
    const c = await joinWorld(world, await generatePassport("Far-C"));
    // 3 members > aoiBypassMax(2) → chunked AOI. Everyone spawned at (1,1);
    // walk C far away: 4 chunks over (64+ tiles) is well outside the 3×3.
    (world as any).zones.get(1).world.roster.players.get(c.pid).x = 70;
    (world as any).zones.get(1).world.roster.players.get(c.pid).y = 70;
    world.tickZones();
    const aIds = players(a.conn.last("delta")).map((x: any) => x.id);
    expect(aIds).toContain(a.pid);
    expect(aIds).toContain(b.pid);
    expect(aIds).not.toContain(c.pid); // out of interest
    const cIds = players(c.conn.last("delta")).map((x: any) => x.id);
    expect(cIds).toEqual([c.pid]); // C sees only itself out there
  });

  it("AOI scopes emote presence to the audience that can see you", async () => {
    const { world } = makeWorld(BIG_PROJECT, { aoiBypassMax: 2, broadcastEveryTicks: 1 });
    const a = await joinWorld(world, await generatePassport("Near-A"));
    const b = await joinWorld(world, await generatePassport("Near-B"));
    const c = await joinWorld(world, await generatePassport("Far-C"));
    (world as any).zones.get(1).world.roster.players.get(c.pid).x = 70;
    (world as any).zones.get(1).world.roster.players.get(c.pid).y = 70;
    a.conn.sent.length = 0;
    b.conn.sent.length = 0;
    c.conn.sent.length = 0;
    a.conn.recv({ t: "emote", emote: "wave" });
    expect(b.conn.last("presence")?.kind).toBe("emote"); // neighbor sees the bubble
    expect(c.conn.all("presence").length).toBe(0); // far player never hears of it
    expect(a.conn.all("presence").length).toBe(0); // emoter already knows
  });
});

describe("MP8·A transfers, records, resume, shared state, zone expiry", () => {
  it("cross-zone transfer: leave old zone, join new, fresh snapshot (gateway model)", async () => {
    const { world } = makeWorld();
    const a = await joinWorld(world, await generatePassport("Riko"));
    const b = await joinWorld(world, await generatePassport("Buddy"));
    b.conn.sent.length = 0;
    a.conn.sent.length = 0;
    expect(world.transferPlayer(a.pid, 7)).toBe(true);
    const snap = a.conn.last("snapshot")!;
    expect((snap as any).world.mapId).toBe(7); // the client re-renders from this
    expect(world.zoneIds().sort()).toEqual([1, 7]);
    expect(b.conn.last("presence")?.kind).toBe("leave"); // map-1 neighbors saw the exit
    for (let i = 0; i < 5; i++) world.tickZones(); // one full broadcast window
    expect(players(b.conn.last("delta")).map((x: any) => x.id)).toEqual([b.pid]); // gone from zone 1's deltas
    expect(players(a.conn.last("delta")).map((x: any) => x.id)).toEqual([a.pid]); // ticking in zone 7
  });

  it("records: a rejoin with the same passport lands where you left off", async () => {
    const { world, now } = makeWorld();
    const p = await generatePassport("Riko");
    const first = await joinWorld(world, p);
    first.conn.recv({ t: "input", seq: 1, intent: { k: "move", dir: "right" } });
    for (let i = 0; i < 20; i++) world.tickZones(); // complete the step → (2,1)
    first.conn.close();
    now.now += 31_000; // past resume grace
    world.sweep(); // reaped; position written back to the record
    expect(world.stats().players).toBe(0);
    const second = await joinWorld(world, p);
    const me = players(second.conn.last("snapshot")).find((x: any) => x.id === second.pid);
    expect(me.x).toBe(2); // not the project start — the record position
    expect(me.y).toBe(1);
  });

  it("resume: world-scoped token reattaches, rotates, and is fingerprint-bound", async () => {
    const { world } = makeWorld();
    const p = await generatePassport("Riko");
    const { conn } = await joinWorld(world, p);
    const welcome = conn.last("welcome")!;
    conn.close();
    // Same passport resumes with the token…
    const back = new MockConn();
    world.accept(back);
    const nonce = back.last("challenge")!.nonce;
    back.recv({ t: "hello", proto: 1, name: "Riko", pub: await passportPublicRaw(p), sig: await signChallenge(p, nonce) });
    await flush();
    await flush();
    back.recv({ t: "resume", code: welcome.roomCode, token: welcome.resumeToken });
    expect(back.last("welcome")?.playerId).toBe(welcome.playerId);
    expect(back.last("welcome")?.resumeToken).not.toBe(welcome.resumeToken); // rotated
    expect(back.last("snapshot")).toBeTruthy();
    // …but a DIFFERENT passport replaying a stolen token is refused.
    const thief = await generatePassport("Thief");
    back.close();
    const steal = new MockConn();
    world.accept(steal);
    const n2 = steal.last("challenge")!.nonce;
    steal.recv({ t: "hello", proto: 1, name: "Thief", pub: await passportPublicRaw(thief), sig: await signChallenge(thief, n2) });
    await flush();
    await flush();
    steal.recv({ t: "resume", code: welcome.roomCode, token: back.last("welcome")!.resumeToken });
    expect(steal.last("error")?.code).toBe("room-not-found"); // ambiguous, no oracle
  });

  it("shared state fans out to live zones AND replays into fresh ones", async () => {
    const { world } = makeWorld();
    const a = await joinWorld(world, await generatePassport("Riko"));
    world.setShared("switch:9", true);
    world.setShared("timeOfDay", 20);
    expect((world as any).zones.get(1).world.g.switches["9"]).toBe(true);
    expect((world as any).zones.get(1).world.g.timeOfDay).toBe(20);
    world.transferPlayer(a.pid, 7); // zone 7 created AFTER the writes
    expect((world as any).zones.get(7).world.g.switches["9"]).toBe(true); // replica replayed
    expect((world as any).zones.get(7).world.g.timeOfDay).toBe(20);
  });

  it("an emptied zone expires after its TTL; occupied zones never do", async () => {
    const { world, now } = makeWorld();
    const a = await joinWorld(world, await generatePassport("Riko"));
    world.transferPlayer(a.pid, 7); // zone 1 now empty
    expect(world.zoneIds().sort()).toEqual([1, 7]);
    world.sweep(); // marks zone 1 empty-since
    now.now += 61_000;
    world.sweep();
    expect(world.zoneIds()).toEqual([7]); // zone 1 dropped, zone 7 (occupied) alive
  });
});
