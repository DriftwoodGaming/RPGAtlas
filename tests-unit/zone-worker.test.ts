/* RPGAtlas — tests-unit/zone-worker.test.ts
   Project Beacon MP8·A: the worker_threads sharding proof — a BeaconWorld
   whose zones each run on their OWN THREAD (server/src/node/zone-worker.ts
   behind server/src/node/worker-zone.ts), driven through in-memory
   connections. Proves the ZoneApi/ZoneOutbox seam carries the whole life
   cycle across the thread boundary: join → snapshot, authoritative movement
   deltas from a self-ticking worker, cross-zone transfer between two
   workers (gateway model — the "socket" never moves), and the 1 Hz position
   mirror keeping rejoin-at-last-position alive in worker mode.

   REAL threads + REAL 60 Hz timers → this file lives in the isolated serial
   net suite (vitest.net.config.mjs), not the parallel pool (the MP5 rule:
   timing-sensitive suites starve/flake under contention). GPL-3.0. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BeaconWorld } from "../server/src/core/beacon-world";
import { workerZoneFactory } from "../server/src/node/worker-zone";
import { DEFAULT_WORLD_LIMITS } from "../server/src/core/config";
import type { ServerConnection } from "../server/src/core/connection";
import {
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/shared/net/protocol";
import { generatePassport, passportPublicRaw, signChallenge, type Passport } from "../src/shared/net/passport";

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
  readonly source = "10.2.0." + (idc % 250);
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Poll until `cond` is truthy (worker replies are asynchronous). */
async function until<T>(cond: () => T | undefined | false, ms = 4000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = cond();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await sleep(15);
  }
}

const players = (m: ServerMessage | undefined): any[] =>
  (m as any)?.world?.players ?? (m as any)?.changes?.players ?? [];

let workDir = "";
let workerEntry = "";
let world: BeaconWorld | null = null;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "rpgatlas-zone-worker-"));
  workerEntry = join(workDir, "zone-worker.test-bundle.mjs");
  const bundle = await build({
    entryPoints: [join(__dirname, "..", "server", "src", "node", "zone-worker.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    write: false,
    external: ["ws"],
    logLevel: "silent",
  });
  await writeFile(workerEntry, bundle.outputFiles[0].text);
}, 30000);

afterAll(async () => {
  world?.shutdown();
  await sleep(50); // let worker terminations settle before the dir vanishes
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

async function joinWorld(w: BeaconWorld, passport: Passport): Promise<{ conn: MockConn; pid: number }> {
  const conn = new MockConn();
  w.accept(conn);
  const challenge = await until(() => conn.last("challenge"));
  conn.recv({
    t: "hello", proto: 1, name: passport.name,
    pub: await passportPublicRaw(passport), sig: await signChallenge(passport, challenge.nonce),
  });
  await sleep(10); // async verify
  conn.recv({ t: "join" });
  const welcome = await until(() => conn.last("welcome"));
  return { conn, pid: welcome.playerId };
}

describe("MP8·A worker_threads zone sharding", () => {
  it("join → worker snapshot → authoritative movement → transfer across worker zones → record mirror", async () => {
    world = new BeaconWorld({
      project: PROJECT,
      seed: 1,
      zoneFactory: workerZoneFactory({
        entry: workerEntry,
        projectJson: JSON.stringify(PROJECT),
        limits: DEFAULT_WORLD_LIMITS,
        seed: 1,
      }),
    });
    const passport = await generatePassport("Riko");
    const { conn, pid } = await joinWorld(world, passport);

    // The snapshot is pushed BY the worker across the thread boundary.
    const snap = await until(() => conn.last("snapshot"));
    expect((snap as any).world.mapId).toBe(1);
    expect(players(snap).map((p) => p.id)).toContain(pid);

    // Movement: the worker self-ticks at 60 Hz; a step lands within ~200 ms
    // and the decimated broadcast reports it.
    conn.recv({ t: "input", seq: 1, intent: { k: "move", dir: "right" } });
    const moved = await until(() => {
      const me = players(conn.last("delta")).find((p) => p.id === pid);
      return me && me.x === 2 && !me.moving ? me : undefined;
    });
    expect(moved.y).toBe(1);

    // Cross-zone transfer: zone 7 spins up as a SECOND worker; the fresh
    // snapshot arrives from it (gateway model — same connection).
    expect(world.transferPlayer(pid, 7)).toBe(true);
    const snap7 = await until(() => {
      const s = conn.last("snapshot");
      return s && (s as any).world.mapId === 7 ? s : undefined;
    });
    expect(players(snap7).map((p) => p.id)).toEqual([pid]);
    expect(world.zoneIds().sort()).toEqual([1, 7]);

    // Ticks keep flowing in the new zone (deltas now come from worker 7).
    conn.sent.length = 0;
    conn.recv({ t: "input", seq: 2, intent: { k: "move", dir: "down" } });
    await until(() => {
      const me = players(conn.last("delta")).find((p) => p.id === pid);
      return me && me.y === 2 && !me.moving ? me : undefined;
    });

    // Rejoin-at-position via the worker's position mirror: the mirror runs at
    // 1 Hz, so give it one full period to stamp the record (worker-mode
    // position freshness is ≤ 1 s BY DESIGN — docs/mp-8-spec.md D-8-2),
    // then disconnect and sign back in with the same passport.
    await sleep(1200);
    conn.close();
    await sleep(100);
    const back = await joinWorld(world, passport);
    const snapBack = await until(() => back.conn.last("snapshot"));
    expect((snapBack as any).world.mapId).toBe(7); // where we left
    const me = players(snapBack).find((p) => p.id === back.pid);
    expect(me.y).toBe(2); // the mirrored tile, not the map-7 spawn
    world.shutdown();
    world = null;
  }, 30000);
});
