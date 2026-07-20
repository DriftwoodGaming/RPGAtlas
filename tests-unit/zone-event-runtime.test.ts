/* RPGAtlas — tests-unit/zone-event-runtime.test.ts
   Project Beacon MP8·B (item 1, D-8-0): the per-zone ENGINE event runtime,
   proven end-to-end against the REAL interpreter registry. No golden covers a
   server event runtime (the roadmap hand-off says so), so correctness rests
   here: a Zone is built with the engine runtime attached (adopting the engine
   defaultWorld), driven by manual 60 Hz ticks, and the world effects are
   asserted on the zone outbox — world switches/vars fan out via sharedSet,
   per-player switches via recordPatch, transfers via transferOut, and modal
   commands (Show Message) through the directive broker. Autorun, parallel,
   action-button and touch triggers, and authored NPC move routes all run.

   Headless + deterministic (manual ticks, seeded RNG, no sockets/DOM): stays in
   the fast parallel pool. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Zone, type ZoneOutbox } from "../server/src/core/zone";
import { createZoneEventRuntime, engineDefaultWorld } from "../server/src/node/engine-zone";
import { DEFAULT_WORLD_LIMITS } from "../server/src/core/config";
import { decodeServerMessage, type ClientMessage } from "../src/shared/net/protocol";

/* ── project + event builders ────────────────────────────────────────────── */

const ground = (id: number, w: number, h: number) => ({
  id, width: w, height: h, layers: { ground: new Array(w * h).fill(1) },
});
function makeProject(events: any[]): any {
  return {
    system: { startMapId: 1, startX: 1, startY: 1, startDir: "down" },
    maps: [{ ...ground(1, 20, 20), events }, { ...ground(7, 8, 8), events: [] }],
    commonEvents: [],
    assets: { tiles: {} },
    autotiles: [],
  };
}
const ev = (id: number, x: number, y: number, pages: any[]) => ({ id, name: "ev" + id, x, y, pages });
const page = (o: any) => ({
  trigger: "action", moveType: "fixed", priority: "same", through: false,
  dir: 0, cond: {}, commands: [], ...o,
});

/* ── capturing outbox ───────────────────────────────────────────────────── */

interface Captured {
  outbox: ZoneOutbox;
  sends: Array<{ pid: number; frame: string }>;
  shared: Array<[string, any]>;
  transfers: Array<{ pid: number; mapId: number; x: number; y: number; dir: number }>;
  patches: Array<{ pid: number; patch: Record<string, any> }>;
}
function makeOutbox(): Captured {
  const sends: Captured["sends"] = [];
  const shared: Captured["shared"] = [];
  const transfers: Captured["transfers"] = [];
  const patches: Captured["patches"] = [];
  const outbox: ZoneOutbox = {
    send: (pid, frame) => sends.push({ pid, frame }),
    sendMany: (pids, frame) => { for (const pid of pids) sends.push({ pid, frame }); },
    transferOut: (pid, mapId, x, y, dir) => transfers.push({ pid, mapId, x, y, dir }),
    sharedSet: (key, value) => shared.push([key, value]),
    recordPatch: (pid, patch) => patches.push({ pid, patch }),
  };
  return { outbox, sends, shared, transfers, patches };
}
function directivesTo(cap: Captured, pid: number): any[] {
  return cap.sends
    .filter((s) => s.pid === pid)
    .map((s) => decodeServerMessage(s.frame))
    .filter((r): r is { ok: true; msg: any } => r.ok)
    .map((r) => r.msg)
    .filter((m) => m.t === "directive");
}

/* ── harness: reset the shared engine defaultWorld between tests ─────────── */

const flush = () => new Promise((r) => setTimeout(r, 0));

function resetWorld(): void {
  const w = engineDefaultWorld as any;
  w.g.switches = {}; w.g.vars = {}; w.g.selfSw = {}; w.g.pSwitches = {};
  w.g.timeOfDay = 12; w.g.mapId = 0; w.g.player = null; w.g.quests = {};
  w.blocking.clear(); w.tickTimers = []; w.roster.players.clear();
  w.parallels.clear(); w.commonParallels.clear();
  w.tick = 0; w.evRTs = []; w.map = null;
  w.directives.pending.clear(); w.directives.nextId = 1;
}

let zone: Zone | null = null;
function mkZone(project: any): { zone: Zone; cap: Captured } {
  const cap = makeOutbox();
  zone = new Zone(1, project, cap.outbox, {
    limits: DEFAULT_WORLD_LIMITS,
    seed: 12345,
    world: engineDefaultWorld,
    runtimeFactory: createZoneEventRuntime,
  });
  return { zone, cap };
}
async function step(n: number): Promise<void> {
  for (let i = 0; i < n; i++) { (zone as Zone).tick(); await flush(); }
}
const input = (intent: any, seq = 1): ClientMessage => ({ t: "input", seq, intent });

beforeEach(() => resetWorld());
afterEach(() => { if (zone) { zone.stop(); zone = null; } });

/* ── the tests ───────────────────────────────────────────────────────────── */

describe("per-zone engine event runtime (D-8-0)", () => {
  it("adopts the engine defaultWorld and rejects a foreign world", () => {
    // The interpreter reads through the MP1 compat shim (one zone per process).
    expect(() =>
      createZoneEventRuntime({
        world: {} as any, mapId: 1,
        collision: { width: 0, height: 0, loopH: false, loopV: false, pass: new Uint8Array(0) },
        outbox: { transferOut() {}, sharedSet() {}, recordPatch() {} },
      }),
    ).toThrow(/defaultWorld/);
  });

  it("autorun flips a WORLD switch → sharedSet, and a self-switch stays zone-local", async () => {
    const project = makeProject([
      ev(1, 2, 2, [
        page({ trigger: "auto", commands: [{ t: "switch", id: 5, val: true }, { t: "selfsw", key: "A", val: true }] }),
        page({ cond: { selfSw: "A" }, trigger: "action" }), // one-shot: page 2 is inert
      ]),
    ]);
    const { zone: z, cap } = mkZone(project);
    await step(3);
    // world switch fanned out (+ persisted via the WorldSnapshot upstream)…
    expect(cap.shared).toContainEqual(["switch:5", true]);
    // …but the self-switch is zone-local: it never fans out, and it rides the
    // ZoneSnapshot instead.
    expect(cap.shared.find(([k]) => k.startsWith("selfsw") || k.includes("A"))).toBeUndefined();
    expect(z.snapshot().selfSw["1:1:A"]).toBe(true);
    expect((engineDefaultWorld as any).g.switches[5]).toBe(true);
  });

  it("action button on an NPC runs its event → a Show Message directive reaches the actor", async () => {
    const project = makeProject([
      ev(2, 5, 5, [page({ trigger: "action", commands: [{ t: "text", text: "Welcome, traveler." }] })]),
    ]);
    const { zone: z, cap } = mkZone(project);
    z.admit(9, "Ada", "", 5, 6, 3, false); // stands south of the sign, facing up
    z.frame(9, input({ k: "act" }));
    await flush();
    const dirs = directivesTo(cap, 9);
    expect(dirs.length).toBe(1);
    expect(dirs[0].directive.kind).toBe("message");
    expect(dirs[0].directive.text).toBe("Welcome, traveler.");
  });

  it("a parallel event writes a WORLD variable → sharedSet", async () => {
    const project = makeProject([
      ev(4, 3, 3, [page({ trigger: "parallel", commands: [{ t: "var", id: 1, op: "set", val: 42 }, { t: "wait", frames: 5 }] })]),
    ]);
    const { cap } = mkZone(project);
    await step(3);
    expect(cap.shared).toContainEqual(["var:1", 42]);
  });

  it("a transfer command re-homes the acting player → transferOut", async () => {
    const project = makeProject([
      ev(5, 8, 5, [page({ trigger: "action", commands: [{ t: "transfer", mapId: 7, x: 2, y: 2, dir: 0 }] })]),
    ]);
    const { zone: z, cap } = mkZone(project);
    z.admit(4, "Bo", "", 8, 6, 3, false);
    z.frame(4, input({ k: "act" }));
    await flush();
    expect(cap.transfers).toContainEqual({ pid: 4, mapId: 7, x: 2, y: 2, dir: 0 });
  });

  it("stepping onto a touch tile sets a PER-PLAYER switch → recordPatch", async () => {
    const project = makeProject([
      ev(3, 7, 7, [page({ trigger: "touch", priority: "below", commands: [{ t: "switch", id: 9, val: true, scope: "player" }] })]),
    ]);
    const { cap } = mkZone(project);
    (zone as Zone).admit(6, "Cy", "", 7, 8, 3, false); // one tile south of the trap
    (zone as Zone).frame(6, input({ k: "move", dir: "up", dir8: 3, run: false }));
    await step(25); // walk north onto the trap, then let the diff propagate
    expect((engineDefaultWorld as any).g.pSwitches[6]?.[9]).toBe(true);
    expect(cap.patches).toContainEqual({ pid: 6, patch: { "pSwitch:9": true } });
    // A per-player switch is NOT world-shared — it never fans out via sharedSet.
    expect(cap.shared.find(([k]) => k === "switch:9")).toBeUndefined();
  });

  it("an authored move route advances an NPC; eventStates + snapshot carry it", async () => {
    const project = makeProject([
      ev(6, 10, 10, [
        page({ trigger: "auto", commands: [{ t: "move", target: "event", steps: ["right"], wait: false }, { t: "selfsw", key: "B", val: true }] }),
        page({ cond: { selfSw: "B" }, trigger: "action" }),
      ]),
    ]);
    const { zone: z } = mkZone(project);
    await step(30); // autorun sets the one-shot route; the step completes
    const states = z.eventStates();
    const wanderer = states.find((e) => e.id === 6);
    expect(wanderer).toBeTruthy();
    expect(wanderer!.x).toBe(11); // walked one tile east
    const snap = z.snapshot();
    const saved = (snap.data.events as any[]).find((e) => e.id === 6);
    expect(saved.x).toBe(11);
  });

  it("restoreData re-applies snapshotted event positions after an eviction", async () => {
    const project = makeProject([ev(6, 10, 10, [page({ trigger: "action" })])]);
    const { zone: z } = mkZone(project);
    z.restore({ selfSw: {}, data: { events: [{ id: 6, x: 14, y: 12, dir: 2, page: 0, erased: false }] } });
    const wanderer = z.eventStates().find((e) => e.id === 6);
    expect(wanderer!.x).toBe(14);
    expect(wanderer!.y).toBe(12);
  });

  it("a runtime-less zone is byte-identical: no events field, no interpreter", () => {
    // A plain player-layer zone (fresh isolated world, no runtimeFactory) never
    // carries an events payload — the MP8·A guarantee.
    const cap = makeOutbox();
    const bare = new Zone(1, makeProject([ev(2, 5, 5, [page({ trigger: "auto", commands: [{ t: "switch", id: 5, val: true }] })])]), cap.outbox, {
      limits: DEFAULT_WORLD_LIMITS,
    });
    bare.admit(1, "Z", "", 1, 1, 0, false);
    bare.tick();
    bare.tick();
    expect(cap.shared).toHaveLength(0); // no interpreter ran
    bare.stop();
  });
});
