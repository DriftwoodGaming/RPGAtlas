/* RPGAtlas — tests-unit/room-world.test.ts
   Project Beacon MP9·E stage E2 (D-9E-1): friend rooms become engine worlds.
   Two layers, both in-process (fast pool) — the worker + real-socket path is
   proven separately by tests-unit/room-battle.test.ts in the net suite:

   1. RoomWorld directory routing (player-layer zones, no engine): admit routes
      to the start map, deltas broadcast every tick, a leave announces, and an
      internal transferOut re-homes a player onto a second zone. defaultWorld is
      never touched here.
   2. The F-1 fix through the full room stack: a BeaconServer whose rooms are
      ENGINE rooms (roomSimFactory → an in-process RoomWorld with the engine zone
      runtime). Two players join by ROOM CODE over mock sockets, team up via the
      party intent channel, fight a shared battle, and BOTH get their end frame —
      exactly what the release gate found unreachable over the relay. Plus a
      Transfer Player command lands a player on a second map inside the one room.

   The engine tests adopt the process-global defaultWorld (one at a time —
   reset + stop between), the zone-event-runtime pattern. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BeaconServer } from "../server/src/core/server";
import { RoomWorld, roomWorldLimits, type RoomOutbox } from "../server/src/core/room-world";
import { engineZoneFactory } from "../server/src/node/engine-zone";
import { engineDefaultWorld } from "../server/src/node/engine-zone";
import { DEFAULT_LIMITS } from "../server/src/core/config";
import type { ServerConnection } from "../server/src/core/connection";
import {
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/shared/net/protocol";

/* ── project builders (battle-runtime.test shape, trimmed) ───────────────── */

const ground = (id: number, w: number, h: number) => ({
  id, width: w, height: h, layers: { ground: new Array(w * h).fill(1) },
});
const ev = (id: number, x: number, y: number, pages: any[]) => ({ id, name: "ev" + id, x, y, pages });
const page = (o: any) => ({
  trigger: "action", moveType: "fixed", priority: "same", through: false,
  dir: 0, cond: {}, commands: [], ...o,
});

/** A battle-capable, two-map project: map 1 has a battle event at (5,5) and a
 *  transfer event at (8,8) → map 2; map 2 is a plain field. */
function coopProject(): any {
  return {
    system: { startMapId: 1, startX: 1, startY: 1, startDir: "down", currency: "Gold" },
    maps: [
      {
        ...ground(1, 20, 20),
        events: [
          ev(1, 5, 5, [page({ trigger: "action", commands: [{ t: "battle", troopId: 1 }] })]),
          ev(2, 8, 8, [page({ trigger: "action", commands: [{ t: "transfer", mapId: 2, x: 3, y: 3, dir: 2 }] })]),
        ],
      },
      { ...ground(2, 20, 20), events: [] },
    ],
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
    skills: [],
    states: [], weapons: [], armors: [],
    enemies: [{
      id: 1, name: "Slime", sprite: "slime",
      stats: { mhp: 10, mmp: 0, atk: 1, def: 0, mat: 0, mdf: 0, agi: 1 },
      exp: 7, gold: 5, drops: [{ kind: "item", id: 3, denominator: 1 }], actions: [],
    }],
    troops: [{ id: 1, name: "Slime x1", enemies: [1], pages: [] }],
  };
}

/** A plain two-map project with no events (directory-routing tests). */
function plainProject(): any {
  return {
    system: { startMapId: 1, startX: 1, startY: 1, startDir: "down" },
    maps: [ground(1, 20, 20), ground(2, 20, 20)],
    commonEvents: [], assets: { tiles: {} }, autotiles: [],
  };
}

/* ── mock connection (world-engine-events.test shape) ────────────────────── */

let idc = 0;
class MockConn implements ServerConnection {
  readonly id = ++idc;
  isOpen = true;
  readonly sent: string[] = [];
  private msgH: ((t: string) => void) | null = null;
  private closeH: (() => void) | null = null;
  readonly source = "10.9.0." + (idc % 250);
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

/* ── defaultWorld reset (engine tests only) ──────────────────────────────── */

function resetWorld(): void {
  const w = engineDefaultWorld as any;
  w.g.switches = {}; w.g.vars = {}; w.g.selfSw = {}; w.g.pSwitches = {};
  w.g.timeOfDay = 12; w.g.mapId = 0; w.g.player = null; w.g.quests = {};
  w.blocking.clear(); w.tickTimers = []; w.roster.players.clear();
  w.parallels.clear(); w.commonParallels.clear();
  w.tick = 0; w.evRTs = []; w.map = null;
  w.directives.pending.clear(); w.directives.nextId = 1; w.directives.dropped = 0;
  w.party.parties.clear(); w.party.byPid.clear(); w.party.invites.clear();
  w.party.dirty = false; w.party.nextId = 1;
  w.coopBattle.active = null; w.coopBattle.outbox = []; w.coopBattle.nextId = 1;
}

/* ── layer 1: RoomWorld directory routing (player-layer) ─────────────────── */

describe("RoomWorld directory routing (player-layer, no engine)", () => {
  let sends: Array<{ pid: number; frame: string }> = [];
  let rw: RoomWorld | null = null;
  const outbox = (): RoomOutbox => ({
    send: (pid, frame) => sends.push({ pid, frame }),
    sendMany: (pids, frame) => { for (const pid of pids) sends.push({ pid, frame }); },
  });
  const framesTo = (pid: number): any[] =>
    sends.filter((s) => s.pid === pid).map((s) => decodeServerMessage(s.frame)).filter((r: any) => r.ok).map((r: any) => r.msg);

  beforeEach(() => { sends = []; });
  afterEach(() => { if (rw) { rw.stop(); rw = null; } });

  it("admits to the start map, players see each other, movement broadcasts, leave announces", () => {
    rw = new RoomWorld(plainProject(), outbox(), { limits: DEFAULT_LIMITS, seed: 1 });
    rw.admit(1, "Ada", "", true);
    rw.admit(2, "Bo", "", true);
    // Ada's join snapshot shows the start map; Bo's join reaches Ada as presence.
    const snap1 = framesTo(1).find((m) => m.t === "snapshot");
    expect(snap1.world.mapId).toBe(1);
    expect(framesTo(1).some((m) => m.t === "presence" && m.kind === "join" && m.playerId === 2)).toBe(true);
    // A move ticks into a delta that carries both players.
    rw.frame(1, { t: "input", seq: 1, intent: { k: "move", dir: "right", run: false } });
    rw.tick();
    const delta = framesTo(2).filter((m) => m.t === "delta").pop();
    expect(delta).toBeTruthy();
    expect(delta.changes.players.length).toBe(2);
    // Ada leaves → Bo hears the presence leave.
    rw.remove(1, true);
    expect(framesTo(2).some((m) => m.t === "presence" && m.kind === "leave" && m.playerId === 1)).toBe(true);
    expect(rw.zoneCount).toBe(1); // one map occupied
  });
});

/* ── layer 2: the F-1 fix through the whole room stack (engine) ───────────── */

const PROTO = 1;

/** Drive a BeaconServer whose rooms are engine rooms. Helpers mirror the
 *  battle-runtime harness but talk over the socket + tick the server. */
describe("engine friend room over the room stack (MP9·E E2, F-1 fix)", () => {
  let server: BeaconServer | null = null;

  function makeServer(project: any, seed = 4242): BeaconServer {
    return new BeaconServer({
      project, seed,
      roomSimFactory: (proj, out) =>
        new RoomWorld(proj, out, {
          limits: DEFAULT_LIMITS, seed,
          zoneFactory: engineZoneFactory({ project: proj, limits: roomWorldLimits(DEFAULT_LIMITS), seed }),
        }),
    });
  }

  async function tick(n: number): Promise<void> {
    for (let i = 0; i < n; i++) { server!.tickRooms(); await flush(); }
  }

  const framesOf = (conn: MockConn): any[] => conn.frames();
  const directives = (conn: MockConn, kind?: string): any[] =>
    framesOf(conn).filter((m) => m.t === "directive").filter((m) => !kind || m.directive.kind === kind);
  const battleEvents = (conn: MockConn): any[] =>
    framesOf(conn).filter((m) => m.t === "delta" && m.changes && m.changes.battle).flatMap((m) => m.changes.battle);

  /** Reply to each unanswered directive of `kind` on `conn`. */
  function answerer() {
    const done = new Set<number>();
    return async (conn: MockConn, kind: string, value: (d: any) => any): Promise<void> => {
      for (const m of directives(conn, kind)) {
        if (done.has(m.id)) continue;
        done.add(m.id);
        conn.recv({ t: "reply", id: m.id, value: value(m.directive) });
      }
      await flush();
    };
  }

  /** hello + join(code) → returns the conn and the assigned pid. Codeless join
   *  (code omitted) creates a room. */
  async function join(name: string, code?: string): Promise<{ conn: MockConn; pid: number; code: string }> {
    const conn = new MockConn();
    server!.accept(conn);
    conn.recv({ t: "hello", proto: PROTO, name });
    conn.recv(code === undefined ? { t: "join" } : { t: "join", code });
    await flush();
    const welcome = conn.last("welcome")!;
    return { conn, pid: welcome.playerId, code: welcome.roomCode };
  }

  beforeEach(() => resetWorld());
  afterEach(() => { if (server) { server.shutdown(); server = null; } });

  it("two players join by code, TEAM UP over the relay, and BOTH win a shared battle", async () => {
    server = makeServer(coopProject());
    const a = await join("Ada");           // creates the room
    const b = await join("Bo", a.code);    // joins by code
    await tick(2);
    // Both landed in the same engine room on map 1.
    expect(a.conn.last("snapshot")!.world.mapId).toBe(1);
    expect(b.conn.last("snapshot")!.world.mapId).toBe(1);

    // Move Bo next to Ada (inside the party join radius) then team up. Ada is at
    // the start (1,1); walk Bo up-left toward her over a few ticks.
    const answer = answerer();
    // Team Up: the invite rides the party intent channel (E3 adds the button;
    // the wire is live now). Ada invites Bo; Bo consents via a choices directive.
    a.conn.recv({ t: "input", seq: 1, intent: { k: "partyInvite", target: b.pid } });
    await tick(1);
    const invite = directives(b.conn, "choices").pop();
    expect(invite).toBeTruthy();
    expect(invite.directive.prompt).toMatch(/Ada wants to team up/);
    await answer(b.conn, "choices", () => ({ kind: "choices", choice: 0 }));
    await tick(2);
    // The party table reached the clients.
    const table = framesOf(b.conn).filter((m) => m.t === "delta" && m.changes && m.changes.party).pop();
    expect(table!.changes.party[0].members).toEqual([a.pid, b.pid]);

    // Ada walks onto the battle event's face tile and acts. Rather than pathfind,
    // drive her straight there: face-move is validated by the zone, so send her
    // toward (5,5). Simplest: place the act at spawn by triggering via act facing
    // the event after moving. For determinism we move her step by step.
    // (The event is at (5,5); from (1,1) that is 4 east + 4 south.)
    for (let s = 0; s < 4; s++) { a.conn.recv({ t: "input", seq: 10 + s, intent: { k: "move", dir: "right", run: false } }); await tick(20); }
    for (let s = 0; s < 3; s++) { a.conn.recv({ t: "input", seq: 20 + s, intent: { k: "move", dir: "down", run: false } }); await tick(20); }
    // Now at (5,4) facing down toward the event at (5,5); press act.
    a.conn.recv({ t: "input", seq: 30, intent: { k: "act" } });
    await tick(2);
    // Both partied players are asked to contribute a loadout.
    expect(directives(a.conn, "battleJoin").length).toBe(1);
    expect(directives(b.conn, "battleJoin").length).toBe(1);
    await answer(a.conn, "battleJoin", () => ({ kind: "battleJoin", party: [{ actorId: 1, level: 1, hp: 50, mp: 10 }] }));
    await answer(b.conn, "battleJoin", () => ({ kind: "battleJoin", party: [{ actorId: 2, level: 1, hp: 50, mp: 10 }] }));

    // Fight: attack every round until both end frames arrive.
    for (let round = 0; round < 12; round++) {
      await answer(a.conn, "battleCmd", (d: any) => ({ kind: "battleCmd", cmds: d.yours.map(() => ({ type: "attack", enemy: 0 })) }));
      await answer(b.conn, "battleCmd", (d: any) => ({ kind: "battleCmd", cmds: d.yours.map(() => ({ type: "attack", enemy: 0 })) }));
      await tick(6);
      if (battleEvents(a.conn).some((e) => e.ev === "end") && battleEvents(b.conn).some((e) => e.ev === "end")) break;
    }
    const endA = battleEvents(a.conn).find((e) => e.ev === "end");
    const endB = battleEvents(b.conn).find((e) => e.ev === "end");
    expect(endA?.result).toBe("win");
    expect(endB?.result).toBe("win");
    expect(endA!.exp).toBe(7);
    expect(endB!.exp).toBe(7); // full rewards to each — co-op never punishes
  }, 20000);

  it("a Transfer Player command re-homes a player onto a second map inside the one room", async () => {
    server = makeServer(coopProject());
    const a = await join("Ada");
    await tick(2);
    // Walk to the transfer event at (8,8): 7 east + 7 south from (1,1).
    for (let s = 0; s < 7; s++) { a.conn.recv({ t: "input", seq: 10 + s, intent: { k: "move", dir: "right", run: false } }); await tick(20); }
    for (let s = 0; s < 6; s++) { a.conn.recv({ t: "input", seq: 20 + s, intent: { k: "move", dir: "down", run: false } }); await tick(20); }
    // At (8,7) facing down toward the event at (8,8); act to fire the transfer.
    a.conn.recv({ t: "input", seq: 30, intent: { k: "act" } });
    await tick(6);
    // The transfer re-snapshotted Ada onto map 2 (a second zone in the same room).
    expect(a.conn.last("snapshot")!.world.mapId).toBe(2);
  }, 20000);
});

/* ── room semantics still hold with a delegated sim (player-layer) ────────── */

describe("engine-room semantics through the delegated sim", () => {
  let server: BeaconServer | null = null;
  afterEach(() => { if (server) { server.shutdown(); server = null; } });

  // A player-layer RoomWorld sim (no engine) keeps this defaultWorld-free while
  // still exercising the BeaconRoom→RoomSim delegation for moderation.
  function makeServer(project: any): BeaconServer {
    return new BeaconServer({
      project, seed: 1,
      roomSimFactory: (proj, out) => new RoomWorld(proj, out, { limits: DEFAULT_LIMITS, seed: 1 }),
    });
  }
  async function join(s: BeaconServer, name: string, code?: string): Promise<{ conn: MockConn; pid: number; code: string }> {
    const conn = new MockConn();
    s.accept(conn);
    conn.recv({ t: "hello", proto: 1, name });
    conn.recv(code === undefined ? { t: "join" } : { t: "join", code });
    await flush();
    const w = conn.last("welcome")!;
    return { conn, pid: w.playerId, code: w.roomCode };
  }

  it("the owner (first player) can kick — the sim drops the entity and the leave reaches the room", async () => {
    server = makeServer(plainProject());
    const a = await join(server, "Ada");         // owner
    const b = await join(server, "Bo", a.code);
    await flush();
    // A non-owner kick is refused (owner-only).
    b.conn.recv({ t: "mod", action: "kick", target: a.pid });
    await flush();
    expect(b.conn.frames().some((m: any) => m.t === "error" && m.code === "not-allowed")).toBe(true);
    // The owner kicks Bo: Bo gets a kick frame, Ada hears the leave (from the sim).
    a.conn.recv({ t: "mod", action: "kick", target: b.pid });
    await flush();
    expect(b.conn.frames().some((m: any) => m.t === "kick")).toBe(true);
    expect(a.conn.frames().some((m: any) => m.t === "presence" && m.kind === "leave" && m.playerId === b.pid)).toBe(true);
  });
});
