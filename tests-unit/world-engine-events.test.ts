/* RPGAtlas — tests-unit/world-engine-events.test.ts
   Project Beacon MP8·B (item 1, D-8-0): the per-zone ENGINE event runtime,
   proven through the BUILT worker bundle — the deployment path
   `--world --engine-events --zone-workers`. A BeaconWorld shards a zone onto a
   worker thread with the engine runtime ON; a passported player joins over an
   in-memory connection, presses the action button facing an authored event, and
   the interpreter — running INSIDE the worker, against its own defaultWorld —
   emits a Show Message directive that crosses the thread boundary back to the
   player. This exercises what the headless unit tests cannot: the esbuild
   worker bundle, the headless window shim in a real worker thread, and the
   directive round-trip through the ZoneApi/ZoneOutbox seam.

   REAL threads + REAL 60 Hz timers → the isolated serial net suite (the MP5
   timing rule). GPL-3.0-or-later (see LICENSE). */

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

// Map 1's start tile is (1,1) facing down; an action event sits one tile SOUTH,
// so a fresh spawn faces it and the action button triggers it with no walking.
const PROJECT = {
  system: { startMapId: 1, startX: 1, startY: 1, startDir: "down" },
  maps: [
    {
      id: 1, width: 20, height: 20, layers: { ground: new Array(400).fill(1) },
      events: [
        {
          id: 1, name: "sign", x: 1, y: 2,
          pages: [{
            trigger: "action", priority: "same", through: false, moveType: "fixed",
            dir: 0, cond: {}, commands: [{ t: "text", text: "The road is long, friend." }],
          }],
        },
      ],
    },
  ],
  commonEvents: [],
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
  readonly source = "10.3.0." + (idc % 250);
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(cond: () => T | undefined | false, ms = 4000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = cond();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await sleep(15);
  }
}

let workDir = "";
let workerEntry = "";
let world: BeaconWorld | null = null;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "rpgatlas-engine-events-"));
  workerEntry = join(workDir, "zone-worker.engine.mjs");
  const bundle = await build({
    entryPoints: [join(__dirname, "..", "server", "src", "node", "zone-worker.ts")],
    bundle: true, platform: "node", target: "node20", format: "esm",
    write: false, external: ["ws"], logLevel: "silent",
  });
  await writeFile(workerEntry, bundle.outputFiles[0].text);
}, 30000);

afterAll(async () => {
  world?.shutdown();
  await sleep(50);
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
  await sleep(10);
  conn.recv({ t: "join" });
  const welcome = await until(() => conn.last("welcome"));
  return { conn, pid: welcome.playerId };
}

describe("MP8·B per-zone engine runtime in a worker (D-8-0)", () => {
  it("action button → interpreter runs in the worker → Show Message directive round-trips", async () => {
    world = new BeaconWorld({
      project: PROJECT,
      seed: 1,
      zoneFactory: workerZoneFactory({
        entry: workerEntry,
        projectJson: JSON.stringify(PROJECT),
        limits: DEFAULT_WORLD_LIMITS,
        seed: 1,
        engineRuntime: true, // the D-8-0 flag: run authored events in the worker
      }),
    });
    const passport = await generatePassport("Mara");
    const { conn, pid } = await joinWorld(world, passport);
    // The worker pushes the join snapshot across the thread boundary.
    await until(() => conn.last("snapshot"));

    // Press the action button — the fresh spawn faces the sign one tile south.
    conn.recv({ t: "input", seq: 1, intent: { k: "act" } });

    // The interpreter runs INSIDE the worker and emits the message directive,
    // which routes back through the outbox to this connection.
    const directive = await until(() => conn.last("directive"));
    expect((directive as any).directive.kind).toBe("message");
    expect((directive as any).directive.text).toBe("The road is long, friend.");
    expect((directive as any).id).toBeGreaterThan(0);
    expect(pid).toBeGreaterThan(0);

    world.shutdown();
    world = null;
  }, 30000);
});
