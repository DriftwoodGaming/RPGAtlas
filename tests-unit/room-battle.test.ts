/* RPGAtlas — tests-unit/room-battle.test.ts
   Project Beacon MP9·E stage E2·b (D-9E-1): the F-1 fix proven through the
   DEPLOYMENT path — an engine friend room whose whole world runs in a real
   worker_threads worker (the built room-worker bundle), driven through the
   BeaconServer room stack exactly as a relay would. Two anonymous players join
   by ROOM CODE, TEAM UP over the party intent channel, and fight a shared battle
   whose interpreter + battle runner execute INSIDE the worker (its own
   defaultWorld, its own headless window shim) — the round-trips crossing the
   thread boundary back to each player. This exercises what the in-process
   room-world unit tests cannot: the esbuild room-worker bundle, the headless
   env in a real worker, and the RoomSim/RoomOutbox op protocol.

   REAL threads + REAL 60 Hz timers → the isolated serial net suite (the MP5
   timing rule). GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BeaconServer } from "../server/src/core/server";
import { workerRoomFactory } from "../server/src/node/worker-room";
import { DEFAULT_LIMITS } from "../server/src/core/config";
import type { ServerConnection } from "../server/src/core/connection";
import {
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/shared/net/protocol";

// A tiny battle-capable project: two players spawn on (1,1) facing down; a
// battle event sits one tile south, so acting triggers it with no walking.
const PROJECT = {
  system: { startMapId: 1, startX: 1, startY: 1, startDir: "down", currency: "Gold" },
  maps: [{
    id: 1, width: 20, height: 20, layers: { ground: new Array(400).fill(1) },
    events: [{
      id: 1, name: "fight", x: 1, y: 2,
      pages: [{
        trigger: "action", priority: "same", through: false, moveType: "fixed",
        dir: 0, cond: {}, commands: [{ t: "battle", troopId: 1 }],
      }],
    }],
  }],
  commonEvents: [],
  assets: { tiles: {} },
  autotiles: [],
  classes: [{
    id: 1, name: "Adventurer",
    base: { mhp: 50, mmp: 10, atk: 10, def: 5, mat: 5, mdf: 5, agi: 8 },
    growth: {}, learnings: [],
  }],
  actors: [
    { id: 1, name: "Hero", classId: 1, charset: "", level: 1 },
    { id: 2, name: "Scout", classId: 1, charset: "", level: 1 },
  ],
  items: [{ id: 3, name: "Potion", hp: 25 }],
  skills: [], states: [], weapons: [], armors: [],
  enemies: [{
    id: 1, name: "Slime", sprite: "slime",
    stats: { mhp: 10, mmp: 0, atk: 1, def: 0, mat: 0, mdf: 0, agi: 1 },
    exp: 7, gold: 5, drops: [{ kind: "item", id: 3, denominator: 1 }], actions: [],
  }],
  troops: [{ id: 1, name: "Slime x1", enemies: [1], pages: [] }],
};

let idc = 0;
class MockConn implements ServerConnection {
  readonly id = ++idc;
  isOpen = true;
  readonly sent: string[] = [];
  private msgH: ((t: string) => void) | null = null;
  private closeH: (() => void) | null = null;
  readonly source = "10.7.0." + (idc % 250);
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
  directives(kind?: string): any[] {
    return this.frames().filter((m: any) => m.t === "directive").filter((m: any) => !kind || m.directive.kind === kind);
  }
  battleEvents(): any[] {
    return this.frames().filter((m: any) => m.t === "delta" && m.changes && m.changes.battle).flatMap((m: any) => m.changes.battle);
  }
  partyTables(): any[] {
    return this.frames()
      .map((m: any) => (m.t === "delta" && m.changes && m.changes.party ? m.changes.party : m.t === "snapshot" && m.world && m.world.party ? m.world.party : null))
      .filter(Boolean);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(cond: () => T | undefined | false, ms = 8000): Promise<T> {
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
let server: BeaconServer | null = null;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "rpgatlas-room-battle-"));
  workerEntry = join(workDir, "room-worker.mjs");
  const bundle = await build({
    entryPoints: [join(__dirname, "..", "server", "src", "node", "room-worker.ts")],
    bundle: true, platform: "node", target: "node20", format: "esm",
    write: false, external: ["ws"], logLevel: "silent",
  });
  await writeFile(workerEntry, bundle.outputFiles[0].text);
}, 30000);

afterAll(async () => {
  server?.shutdown();
  await sleep(80);
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

/** hello (anonymous — friend rooms never challenge, D3) + join. */
async function joinRoom(s: BeaconServer, name: string, code?: string): Promise<{ conn: MockConn; pid: number; code: string }> {
  const conn = new MockConn();
  s.accept(conn);
  conn.recv({ t: "hello", proto: 1, name });
  conn.recv(code === undefined ? { t: "join" } : { t: "join", code });
  const welcome = await until(() => conn.last("welcome"));
  return { conn, pid: welcome.playerId, code: welcome.roomCode };
}

/** Reply to every not-yet-answered directive of `kind` on `conn`. */
function makeAnswerer() {
  const done = new Set<string>();
  return async function answer(conn: MockConn, tag: string, kind: string, value: (d: any) => any): Promise<number> {
    let n = 0;
    for (const m of conn.directives(kind)) {
      const key = tag + ":" + m.id;
      if (done.has(key)) continue;
      done.add(key);
      conn.recv({ t: "reply", id: m.id, value: value(m.directive) });
      n++;
    }
    return n;
  };
}

describe("MP9·E E2·b engine friend room in a worker (D-9E-1, F-1 fix)", () => {
  it("two players join by code → Team Up → shared battle in the worker → BOTH end frames", async () => {
    server = new BeaconServer({
      project: PROJECT,
      seed: 7,
      roomSimFactory: workerRoomFactory({
        entry: workerEntry,
        projectJson: JSON.stringify(PROJECT),
        limits: DEFAULT_LIMITS,
        seed: 7,
      }),
    });

    const a = await joinRoom(server, "Ada");          // creates the room
    const b = await joinRoom(server, "Bo", a.code);   // joins by code
    // The worker pushes each join snapshot across the thread boundary.
    await until(() => a.conn.last("snapshot"));
    await until(() => b.conn.last("snapshot"));
    expect(a.conn.last("snapshot")!.world.mapId).toBe(1);
    expect(b.conn.last("snapshot")!.world.mapId).toBe(1);

    const answer = makeAnswerer();

    // Team Up: Ada invites Bo over the party intent channel; the sim (in the
    // worker) validates and emits Bo's consent prompt.
    a.conn.recv({ t: "input", seq: 1, intent: { k: "partyInvite", target: b.pid } });
    const invite = await until(() => b.conn.directives("choices").pop());
    expect(invite.directive.prompt).toMatch(/Ada wants to team up/);
    b.conn.recv({ t: "reply", id: invite.id, value: { kind: "choices", choice: 0 } });
    // The party table crosses back to the clients.
    const table = await until(() => b.conn.partyTables().find((t: any) => t.length && t[0].members.length === 2));
    expect(table[0].members).toEqual([a.pid, b.pid]);

    // Ada faces the battle event (one tile south of spawn) and acts.
    a.conn.recv({ t: "input", seq: 2, intent: { k: "act" } });
    // Both partied players are asked to contribute a loadout.
    await until(() => a.conn.directives("battleJoin").length && b.conn.directives("battleJoin").length);
    await answer(a.conn, "a", "battleJoin", () => ({ kind: "battleJoin", party: [{ actorId: 1, level: 1, hp: 50, mp: 10 }] }));
    await answer(b.conn, "b", "battleJoin", () => ({ kind: "battleJoin", party: [{ actorId: 2, level: 1, hp: 50, mp: 10 }] }));

    // Fight: attack every round until both end frames arrive.
    const attackAll = (d: any) => ({ kind: "battleCmd", cmds: d.yours.map(() => ({ type: "attack", enemy: 0 })) });
    await until(() => {
      void answer(a.conn, "a", "battleCmd", attackAll);
      void answer(b.conn, "b", "battleCmd", attackAll);
      return a.conn.battleEvents().some((e: any) => e.ev === "end") && b.conn.battleEvents().some((e: any) => e.ev === "end");
    }, 15000);

    const endA = a.conn.battleEvents().find((e: any) => e.ev === "end");
    const endB = b.conn.battleEvents().find((e: any) => e.ev === "end");
    expect(endA.result).toBe("win");
    expect(endB.result).toBe("win");
    expect(endA.exp).toBe(7);
    expect(endB.exp).toBe(7); // full rewards to each

    server.shutdown();
    server = null;
  }, 30000);
});
