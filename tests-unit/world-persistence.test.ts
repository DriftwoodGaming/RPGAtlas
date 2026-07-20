/* RPGAtlas — tests-unit/world-persistence.test.ts
   Project Beacon MP8·B: durable world persistence (the WorldStore adapter,
   server/src/core/store.ts + server/src/node/file-store.ts) end-to-end over
   in-memory connections. THIS is the load-gate criterion the roadmap names —
   "kill a zone, restore, state intact": a BeaconWorld is built on a store,
   played, flushed, and SHUT DOWN; a fresh BeaconWorld built on the SAME store
   restores exactly what the first saved (player position, world switches, bans,
   zone-local self-switches). Proves both backends — the in-memory KV
   (MemoryWorldStore, = the CF DO-storage path's logic) and the Node default
   JSON file directory on real disk (NodeFileWorldStore, atomic-rename writes).

   No sockets, no DOM, deterministic (manual ticks + a fake clock): stays in the
   fast parallel pool, not the net suite. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BeaconWorld } from "../server/src/core/beacon-world";
import { MemoryWorldStore, type WorldStore } from "../server/src/core/store";
import { NodeFileWorldStore } from "../server/src/node/file-store";
import type { ServerConnection } from "../server/src/core/connection";
import {
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/shared/net/protocol";
import {
  fingerprintOfPub,
  generatePassport,
  passportPublicRaw,
  signChallenge,
  type Passport,
} from "../src/shared/net/passport";

const PROJECT = {
  system: { startMapId: 1, startX: 1, startY: 1, startDir: "down" },
  maps: [
    { id: 1, width: 20, height: 20, layers: { ground: new Array(400).fill(1) } },
    { id: 7, width: 8, height: 8, layers: { ground: new Array(64).fill(1) } },
  ],
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
    const f = this.frames().filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
    return f[f.length - 1];
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
/** Poll (bounded) until `pred` holds — robust where a fixed flush count would
 *  race the REAL async ECDSA passport verify under heavy parallel test load. */
async function waitFor(pred: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries && !pred(); i++) await flush();
}
const players = (m: ServerMessage | undefined): any[] =>
  (m as any)?.world?.players ?? (m as any)?.changes?.players ?? [];

function makeWorld(store?: WorldStore, now = { now: 1000 }) {
  return new BeaconWorld({ project: PROJECT, clock: () => now.now, seed: 1, store });
}

async function joinWorld(world: BeaconWorld, passport: Passport): Promise<{ conn: MockConn; pid: number }> {
  const conn = new MockConn();
  world.accept(conn);
  const challenge = conn.last("challenge");
  if (!challenge) throw new Error("no challenge frame");
  const pub = await passportPublicRaw(passport);
  const sig = await signChallenge(passport, challenge.nonce);
  conn.recv({ t: "hello", proto: 1, name: passport.name, pub, sig });
  conn.recv({ t: "join" });
  await waitFor(() => !!conn.last("welcome") || !!conn.last("error") || !conn.isOpen);
  const w = conn.last("welcome");
  if (!w) throw new Error("join failed: " + conn.sent.join(" | "));
  return { conn, pid: w.playerId };
}

/** Walk one tile right (start 1,1 → 2,1) and let the step complete. */
async function walkRight(world: BeaconWorld, conn: MockConn): Promise<void> {
  conn.recv({ t: "input", seq: 1, intent: { k: "move", dir: "right" } });
  for (let i = 0; i < 25; i++) world.tickZones();
}

describe("MP8·B persistence — kill a world, restore, state intact", () => {
  it("player position survives a full restart (in-memory KV store)", async () => {
    const store = new MemoryWorldStore();
    const passport = await generatePassport("Riko");

    const a = makeWorld(store);
    const first = await joinWorld(a, passport);
    await walkRight(a, first.conn);
    await a.flush();
    a.shutdown(); // "kill" the world

    // A brand-new world on the SAME store restores the record set.
    const b = makeWorld(store);
    await b.load();
    const back = await joinWorld(b, passport);
    const me = players(back.conn.last("snapshot")).find((p) => p.id === back.pid);
    expect(me.x).toBe(2); // the saved tile, not the project start (1,1)
    expect(me.y).toBe(1);
    b.shutdown();
  });

  it("world-shared switches/timeOfDay and bans survive a restart", async () => {
    const store = new MemoryWorldStore();
    const banned = await generatePassport("Griefer");

    const a = makeWorld(store);
    a.setShared("switch:9", true);
    a.setShared("timeOfDay", 20);
    a.ban((await fingerprintOfPub(await passportPublicRaw(banned)))!);
    await a.flush();
    a.shutdown();

    const b = makeWorld(store);
    await b.load();
    // A fresh zone gets the restored shared state replayed into it on creation.
    const rk = await joinWorld(b, await generatePassport("Riko"));
    const zone1 = (b as any).zones.get(1);
    expect(zone1.world.g.switches["9"]).toBe(true);
    expect(zone1.world.g.timeOfDay).toBe(20);
    void rk;
    // The restored ban refuses the griefer at the door.
    const conn = new MockConn();
    b.accept(conn);
    const nonce = conn.last("challenge")!.nonce;
    conn.recv({ t: "hello", proto: 1, name: "Griefer", pub: await passportPublicRaw(banned), sig: await signChallenge(banned, nonce) });
    await waitFor(() => !!conn.last("kick") || !conn.isOpen);
    expect(conn.last("kick")?.code).toBe("banned");
    b.shutdown();
  });

  it("zone-local self-switches survive a restart (ZoneSnapshot round-trip)", async () => {
    const store = new MemoryWorldStore();
    const passport = await generatePassport("Riko");

    const a = makeWorld(store);
    await joinWorld(a, passport); // creates zone 1
    // Stand in for a server event flipping a self-switch on map 1.
    (a as any).zones.get(1).world.g.selfSw["1:3:A"] = true;
    await a.flush();
    a.shutdown();

    const b = makeWorld(store);
    await b.load();
    await joinWorld(b, passport); // zone 1 recreated → snapshot restored
    expect((b as any).zones.get(1).world.g.selfSw["1:3:A"]).toBe(true);
    b.shutdown();
  });

  it("WITHOUT a store, nothing persists — a restart resets to the project start", async () => {
    const passport = await generatePassport("Riko");
    const a = makeWorld(); // no store
    const first = await joinWorld(a, passport);
    await walkRight(a, first.conn);
    await a.flush(); // no-op
    a.shutdown();

    const b = makeWorld();
    await b.load(); // no-op
    const back = await joinWorld(b, passport);
    const me = players(back.conn.last("snapshot")).find((p) => p.id === back.pid);
    expect(me.x).toBe(1); // back at the project start — nothing was persisted
    expect(me.y).toBe(1);
    b.shutdown();
  });
});

describe("MP8·B persistence — Node JSON file store on real disk", () => {
  let dir = "";
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("position + world switches round-trip through atomic-rename JSON files", async () => {
    dir = await mkdtemp(join(tmpdir(), "rpgatlas-world-"));
    const store = new NodeFileWorldStore(dir);
    const passport = await generatePassport("Riko");

    const a = makeWorld(store);
    const first = await joinWorld(a, passport);
    await walkRight(a, first.conn);
    a.setShared("switch:4", true);
    await a.flush();
    a.shutdown();

    // The snapshot files are real, human-readable JSON on disk.
    const records = JSON.parse(await readFile(join(dir, "records.json"), "utf8"));
    const worldSnap = JSON.parse(await readFile(join(dir, "world.json"), "utf8"));
    expect(Object.keys(records).length).toBe(1);
    expect(Object.values(records)[0]).toMatchObject({ x: 2, y: 1, mapId: 1 });
    expect(worldSnap.shared["switch:4"]).toBe(true);

    // A fresh store instance on the same directory restores the world.
    const b = makeWorld(new NodeFileWorldStore(dir));
    await b.load();
    const back = await joinWorld(b, passport);
    const me = players(back.conn.last("snapshot")).find((p) => p.id === back.pid);
    expect(me.x).toBe(2);
    expect(me.y).toBe(1);
    expect((b as any).zones.get(1).world.g.switches["4"]).toBe(true);
    b.shutdown();
  });
});
