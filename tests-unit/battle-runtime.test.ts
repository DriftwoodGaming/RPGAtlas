/* RPGAtlas — tests-unit/battle-runtime.test.ts
   Project Beacon MP9·E stage E1: the headless shared-battle runner (the F-1
   fix), proven end-to-end through a REAL world zone — party intents routed by
   the zone (the verbs the release gate found silently dropped), consent over
   the directive broker, battleJoin/battleCmd round-trips over zone.frame, the
   battle-event outbox drained into per-player deltas, and the end frames the
   clients apply. The matrix D-9E-2 asks for: win / loss(A-7 revive) / escape ·
   items with D-6-7 itemUsed · AFK all-guard · withdrawal mid-battle · N=1
   solo · reward split · plus the party-table wire and the world-context
   auto-win. Headless + deterministic (manual ticks, seeded RNG): fast pool.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Zone, type ZoneOutbox } from "../server/src/core/zone";
import { createZoneEventRuntime, engineDefaultWorld } from "../server/src/node/engine-zone";
import { DEFAULT_WORLD_LIMITS } from "../server/src/core/config";
import { decodeServerMessage, type ClientMessage } from "../src/shared/net/protocol";

/* ── project builders ────────────────────────────────────────────────────── */

const ground = (id: number, w: number, h: number) => ({
  id, width: w, height: h, layers: { ground: new Array(w * h).fill(1) },
});
const ev = (id: number, x: number, y: number, pages: any[]) => ({ id, name: "ev" + id, x, y, pages });
const page = (o: any) => ({
  trigger: "action", moveType: "fixed", priority: "same", through: false,
  dir: 0, cond: {}, commands: [], ...o,
});

/** A battle-capable project: one hero class/actor, a potion, an escape skill,
 *  and two troops — 1 = a weak slime (one attack kills it), 2 = a brutal ogre
 *  (one-shots the hero, effectively unkillable). */
function makeProject(events: any[], extra: any = {}): any {
  return {
    system: {
      startMapId: 1, startX: 1, startY: 1, startDir: "down", currency: "Gold",
      ...(extra.system || {}),
    },
    maps: [{ ...ground(1, 20, 20), events }],
    commonEvents: [],
    assets: { tiles: {} },
    autotiles: [],
    classes: [
      {
        id: 1, name: "Adventurer",
        base: { mhp: 50, mmp: 10, atk: 10, def: 5, mat: 5, mdf: 5, agi: 8 },
        growth: {},
        learnings: [{ level: 1, skillId: 5 }],
      },
    ],
    actors: [
      { id: 1, name: "Hero", classId: 1, charset: "", level: 1 },
      { id: 2, name: "Scout", classId: 1, charset: "", level: 1 },
    ],
    items: [{ id: 3, name: "Potion", hp: 25 }],
    skills: [{ id: 5, name: "Smoke Bomb", type: "phys", mp: 0, escapeBattle: true }],
    states: [],
    weapons: [],
    armors: [],
    enemies: [
      {
        id: 1, name: "Slime", sprite: "slime",
        stats: { mhp: 10, mmp: 0, atk: 1, def: 0, mat: 0, mdf: 0, agi: 1 },
        exp: 7, gold: 5,
        drops: [{ kind: "item", id: 3, denominator: 1 }],
        actions: [],
      },
      {
        id: 2, name: "Ogre", sprite: "ogre",
        stats: { mhp: 999, mmp: 0, atk: 60, def: 50, mat: 0, mdf: 0, agi: 4 },
        exp: 0, gold: 0, drops: [], actions: [],
      },
    ],
    troops: [
      { id: 1, name: "Slime x1", enemies: [1], pages: [] },
      { id: 2, name: "Ogre x1", enemies: [2], pages: [] },
    ],
    ...extra.root,
  };
}

/** The standard arena: a battle event at (5,5) the acting player faces. */
function battleProject(troopId: number, extra: any = {}): any {
  return makeProject(
    [ev(1, 5, 5, [page({ trigger: "action", commands: [{ t: "battle", troopId }] })])],
    extra,
  );
}

/* ── capturing outbox + frame helpers ────────────────────────────────────── */

interface Captured {
  outbox: ZoneOutbox;
  sends: Array<{ pid: number; frame: string }>;
  shared: Array<[string, any]>;
}
function makeOutbox(): Captured {
  const sends: Captured["sends"] = [];
  const shared: Captured["shared"] = [];
  const outbox: ZoneOutbox = {
    send: (pid, frame) => sends.push({ pid, frame }),
    sendMany: (pids, frame) => { for (const pid of pids) sends.push({ pid, frame }); },
    transferOut: () => {},
    sharedSet: (key, value) => shared.push([key, value]),
    recordPatch: () => {},
  };
  return { outbox, sends, shared };
}
function framesTo(cap: Captured, pid: number): any[] {
  return cap.sends
    .filter((s) => s.pid === pid)
    .map((s) => decodeServerMessage(s.frame))
    .filter((r): r is { ok: true; msg: any } => r.ok)
    .map((r) => r.msg);
}
function directivesTo(cap: Captured, pid: number, kind?: string): any[] {
  return framesTo(cap, pid)
    .filter((m) => m.t === "directive")
    .filter((m) => !kind || m.directive.kind === kind);
}
/** Every battle event delivered to `pid` via delta.changes.battle, in order. */
function battleEventsTo(cap: Captured, pid: number): any[] {
  return framesTo(cap, pid)
    .filter((m) => m.t === "delta" && m.changes && m.changes.battle)
    .flatMap((m) => m.changes.battle);
}
/** The latest party table broadcast to `pid` (delta or snapshot), or null. */
function lastPartyTableTo(cap: Captured, pid: number): any[] | null {
  const tables = framesTo(cap, pid)
    .map((m) =>
      m.t === "delta" && m.changes && m.changes.party
        ? m.changes.party
        : m.t === "snapshot" && m.world && m.world.party
          ? m.world.party
          : null,
    )
    .filter(Boolean);
  return tables.length ? tables[tables.length - 1] : null;
}

/* ── world reset + zone harness (the zone-event-runtime.test pattern) ────── */

const flush = () => new Promise((r) => setTimeout(r, 0));

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

let zone: Zone | null = null;
function mkZone(project: any, seed = 12345): { zone: Zone; cap: Captured } {
  const cap = makeOutbox();
  zone = new Zone(1, project, cap.outbox, {
    limits: DEFAULT_WORLD_LIMITS,
    seed,
    world: engineDefaultWorld,
    runtimeFactory: createZoneEventRuntime,
  });
  return { zone, cap };
}
async function step(n: number): Promise<void> {
  for (let i = 0; i < n; i++) { (zone as Zone).tick(); await flush(); }
}
/** Advance many ticks WITHOUT per-tick macrotask yields (deadline tests). */
async function stepFast(n: number): Promise<void> {
  for (let i = 0; i < n; i++) (zone as Zone).tick();
  await flush(); await flush(); await flush();
}
const input = (intent: any, seq = 1): ClientMessage => ({ t: "input", seq, intent });
const reply = (id: number, value: any): ClientMessage => ({ t: "reply", id, value });

/** Answer helper: reply to every UNANSWERED directive of `kind` for `pid`. */
function makeAnswerer(cap: Captured) {
  const answered = new Set<string>();
  return async function answer(pid: number, kind: string, value: (d: any) => any): Promise<number> {
    let n = 0;
    for (const m of directivesTo(cap, pid, kind)) {
      const key = pid + ":" + m.id;
      if (answered.has(key)) continue;
      answered.add(key);
      (zone as Zone).frame(pid, reply(m.id, value(m.directive)));
      n++;
    }
    await flush();
    return n;
  };
}
const loadout = () => [{ actorId: 1, level: 1, hp: 50, mp: 10 }];
const joinValue = () => ({ kind: "battleJoin", party: loadout() });
const attackAll = (d: any) => ({
  kind: "battleCmd",
  cmds: d.yours.map(() => ({ type: "attack", enemy: 0 })),
});

/** Walk a player through: act → battleJoin → rounds of battleCmd (answered by
 *  `cmd`) until the end frame arrives (or `maxRounds` passes). */
async function fightToEnd(
  cap: Captured,
  pids: number[],
  cmd: (d: any) => any,
  maxRounds = 12,
): Promise<void> {
  const answer = makeAnswerer(cap);
  for (let round = 0; round < maxRounds; round++) {
    for (const pid of pids) await answer(pid, "battleJoin", joinValue);
    for (const pid of pids) await answer(pid, "battleCmd", cmd);
    await step(6); // drain outbox into deltas; let deadlines/timers pump
    const done = pids.every((pid) => battleEventsTo(cap, pid).some((e) => e.ev === "end"));
    if (done) return;
  }
}

beforeEach(() => resetWorld());
afterEach(() => { if (zone) { zone.stop(); zone = null; } });

/* ── the matrix ──────────────────────────────────────────────────────────── */

describe("headless shared-battle runner (MP9·E E1)", () => {
  it("N=1 solo: a battle event runs server-side — battleJoin → battleCmd → win with rewards", async () => {
    const { zone: z, cap } = mkZone(battleProject(1));
    z.admit(7, "Ada", "", 5, 6, 3, false); // south of the event, facing up
    z.frame(7, input({ k: "act" }));
    await flush();
    // The trigger contributes its loadout over a directive (all-remote posture).
    expect(directivesTo(cap, 7, "battleJoin").length).toBe(1);
    await fightToEnd(cap, [7], attackAll);
    const evs = battleEventsTo(cap, 7);
    expect(evs.find((e) => e.ev === "start")).toBeTruthy();
    expect(evs.some((e) => e.ev === "log" && /Victory!/.test(e.text))).toBe(true);
    const end = evs.find((e) => e.ev === "end");
    expect(end).toBeTruthy();
    expect(end.result).toBe("win");
    expect(end.exp).toBe(7);
    expect(end.gold).toBe(5);
    expect(end.loot).toEqual([{ kind: "item", id: 3 }]); // denominator 1 = sure drop
    expect(end.battlers.length).toBe(1);
    expect(end.battlers[0].hp).toBeGreaterThan(0);
    // The battle released its slot and the zone is quiet again.
    expect((engineDefaultWorld as any).coopBattle.active).toBeNull();
    expect((engineDefaultWorld as any).blocking.size).toBe(0);
  });

  it("N=1 determinism: the same seed + same replies produce identical end frames", async () => {
    const run = async (): Promise<any> => {
      resetWorld();
      if (zone) { zone.stop(); zone = null; }
      const { zone: z, cap } = mkZone(battleProject(1), 999);
      z.admit(7, "Ada", "", 5, 6, 3, false);
      z.frame(7, input({ k: "act" }));
      await flush();
      await fightToEnd(cap, [7], attackAll);
      return battleEventsTo(cap, 7);
    };
    const a = await run();
    const b = await run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.find((e: any) => e.ev === "end")).toBeTruthy();
  });

  it("loss: the party falls, A-7 revives every battler at 1 HP, result rides the end frame", async () => {
    const { zone: z, cap } = mkZone(battleProject(2)); // the ogre
    z.admit(7, "Ada", "", 5, 6, 3, false);
    z.frame(7, input({ k: "act" }));
    await flush();
    await fightToEnd(cap, [7], attackAll, 4);
    const end = battleEventsTo(cap, 7).find((e) => e.ev === "end");
    expect(end).toBeTruthy();
    expect(end.result).toBe("lose");
    expect(end.exp).toBe(0);
    expect(end.battlers[0].hp).toBe(1); // never 0 — a world battle can't game-over
    expect(battleEventsTo(cap, 7).some((e) => e.ev === "log" && /has fallen/.test(e.text))).toBe(true);
  });

  it("escape: an escapeBattle skill slips the party away — no rewards", async () => {
    const { zone: z, cap } = mkZone(battleProject(2));
    z.admit(7, "Ada", "", 5, 6, 3, false);
    z.frame(7, input({ k: "act" }));
    await flush();
    await fightToEnd(cap, [7], (d: any) => ({
      kind: "battleCmd",
      cmds: d.yours.map(() => ({ type: "skill", id: 5 })),
    }), 4);
    const end = battleEventsTo(cap, 7).find((e) => e.ev === "end");
    expect(end).toBeTruthy();
    expect(end.result).toBe("escape");
    expect(end.exp).toBe(0);
    expect(end.loot).toEqual([]);
  });

  it("items (D-6-7): the heal applies and itemUsed reaches the owner — no server bag", async () => {
    const { zone: z, cap } = mkZone(battleProject(1));
    z.admit(7, "Ada", "", 5, 6, 3, false);
    z.frame(7, input({ k: "act" }));
    await flush();
    const answer = makeAnswerer(cap);
    // Contribute a WOUNDED hero (hp 20/50) so the potion has room to heal.
    await answer(7, "battleJoin", () => ({
      kind: "battleJoin",
      party: [{ actorId: 1, level: 1, hp: 20, mp: 10 }],
    }));
    // Round 1: drink the potion (self-target). The slime chips 1 HP after.
    await answer(7, "battleCmd", (d: any) => ({
      kind: "battleCmd",
      cmds: d.yours.map(() => ({ type: "item", id: 3 })),
    }));
    await step(6);
    const evs1 = battleEventsTo(cap, 7);
    expect(evs1.some((e) => e.ev === "itemUsed" && e.id === 3)).toBe(true);
    expect(evs1.some((e) => e.ev === "log" && /uses Potion/.test(e.text))).toBe(true);
    // Round 2+: attack to finish; the end frame carries 20+25−(slime chip) HP.
    await fightToEnd(cap, [7], attackAll);
    const end = battleEventsTo(cap, 7).find((e) => e.ev === "end");
    expect(end.result).toBe("win");
    expect(end.battlers[0].hp).toBe(44); // 20 + 25 potion − 1 slime hit
  });

  it("AFK all-guard: an unanswered battleCmd round times out into guards, the fight continues", async () => {
    const { zone: z, cap } = mkZone(battleProject(1));
    z.admit(7, "Ada", "", 5, 6, 3, false);
    z.frame(7, input({ k: "act" }));
    await flush();
    const answer = makeAnswerer(cap);
    await answer(7, "battleJoin", joinValue);
    await flush();
    expect(directivesTo(cap, 7, "battleCmd").length).toBe(1);
    // Say nothing: the round deadline (30 s of world ticks) guards the battler.
    await stepFast(30 * 60 + 5);
    await step(6); // the guard round's events drain on the next broadcasts
    const evs = battleEventsTo(cap, 7);
    expect(evs.some((e) => e.ev === "log" && /Hero guards\./.test(e.text))).toBe(true);
    // Round 2 asked — answer it and win.
    expect(directivesTo(cap, 7, "battleCmd").length).toBeGreaterThanOrEqual(2);
    await fightToEnd(cap, [7], attackAll);
    expect(battleEventsTo(cap, 7).find((e) => e.ev === "end")?.result).toBe("win");
  });

  it("co-op N=2: party up via intents → both contribute → shared fight → BOTH end frames (full rewards each)", async () => {
    const { zone: z, cap } = mkZone(battleProject(1));
    z.admit(1, "Ada", "", 5, 6, 3, false);
    z.admit(2, "Bo", "", 4, 6, 3, false); // adjacent — inside the join radius
    const answer = makeAnswerer(cap);
    // Team up: invite rides the intent channel; consent is a choices directive.
    z.frame(1, input({ k: "partyInvite", target: 2 }));
    await flush();
    const invites = directivesTo(cap, 2, "choices");
    expect(invites.length).toBe(1);
    expect(invites[0].directive.prompt).toMatch(/Ada wants to team up/);
    await answer(2, "choices", () => ({ kind: "choices", choice: 0 }));
    await step(6);
    const table = lastPartyTableTo(cap, 2);
    expect(table).toBeTruthy();
    expect(table![0].members).toEqual([1, 2]);
    // Trigger the battle: both get battleJoin (Bo contributes the Scout).
    z.frame(1, input({ k: "act" }));
    await flush();
    expect(directivesTo(cap, 1, "battleJoin").length).toBe(1);
    expect(directivesTo(cap, 2, "battleJoin").length).toBe(1);
    await answer(1, "battleJoin", joinValue);
    await answer(2, "battleJoin", () => ({
      kind: "battleJoin",
      party: [{ actorId: 2, level: 1, hp: 50, mp: 10 }],
    }));
    await fightToEnd(cap, [1, 2], attackAll);
    const end1 = battleEventsTo(cap, 1).find((e) => e.ev === "end");
    const end2 = battleEventsTo(cap, 2).find((e) => e.ev === "end");
    expect(end1?.result).toBe("win");
    expect(end2?.result).toBe("win");
    // Full rewards to each (co-op never punishes playing together)…
    expect(end1!.exp).toBe(7);
    expect(end2!.exp).toBe(7);
    expect(end1!.gold).toBe(5);
    expect(end2!.gold).toBe(5);
    // …and each drew their OWN sure drop (A-8: trigger first, join order).
    expect(end1!.loot).toEqual([{ kind: "item", id: 3 }]);
    expect(end2!.loot).toEqual([{ kind: "item", id: 3 }]);
    const start2 = battleEventsTo(cap, 2).find((e) => e.ev === "start");
    expect(start2!.names).toEqual(["Ada", "Bo"]);
  });

  it("withdrawal mid-battle (D-6-4): a leaver's battlers bow out, the fight ends for the rest", async () => {
    const { zone: z, cap } = mkZone(battleProject(1));
    z.admit(1, "Ada", "", 5, 6, 3, false);
    z.admit(2, "Bo", "", 4, 6, 3, false);
    const answer = makeAnswerer(cap);
    z.frame(1, input({ k: "partyInvite", target: 2 }));
    await flush();
    await answer(2, "choices", () => ({ kind: "choices", choice: 0 }));
    await flush();
    z.frame(1, input({ k: "act" }));
    await flush();
    await answer(1, "battleJoin", joinValue);
    await answer(2, "battleJoin", () => ({
      kind: "battleJoin",
      party: [{ actorId: 2, level: 1, hp: 50, mp: 10 }],
    }));
    await flush();
    // Both were asked for round-1 commands; Bo disconnects instead of answering.
    expect(directivesTo(cap, 2, "battleCmd").length).toBe(1);
    z.remove(2, true);
    await flush();
    // Ada fights on alone and wins — no hang on the absent player.
    await fightToEnd(cap, [1], attackAll);
    const end1 = battleEventsTo(cap, 1).find((e) => e.ev === "end");
    expect(end1?.result).toBe("win");
    // The leaver got no end frame (withdrawn draws nothing, D-6-4)…
    expect(battleEventsTo(cap, 2).find((e) => e.ev === "end")).toBeUndefined();
    // …and the party dissolved (leave on zone exit, one-zone scope D-9E-4).
    expect((engineDefaultWorld as any).party.parties.size).toBe(0);
  });

  it("a world-context battle (autorun) resolves 'win' without fighting — the narrowed D-8-6 remainder", async () => {
    const project = makeProject([
      ev(1, 2, 2, [
        page({
          trigger: "auto",
          commands: [{ t: "battle", troopId: 1 }, { t: "switch", id: 7, val: true }],
        }),
        page({ cond: { switchId: 7 }, trigger: "action" }),
      ]),
    ]);
    const { cap } = mkZone(project);
    await step(4);
    // No directives to anyone, no battle events — and the event CONTINUED.
    expect(cap.sends.filter((s) => framesTo(cap, s.pid).some((m) => m.t === "directive")).length).toBe(0);
    expect(cap.shared).toContainEqual(["switch:7", true]);
  });

  it("partyLeave dissolves the team and the empty table still broadcasts", async () => {
    const { zone: z, cap } = mkZone(battleProject(1));
    z.admit(1, "Ada", "", 5, 6, 3, false);
    z.admit(2, "Bo", "", 4, 6, 3, false);
    const answer = makeAnswerer(cap);
    z.frame(1, input({ k: "partyInvite", target: 2 }));
    await flush();
    await answer(2, "choices", () => ({ kind: "choices", choice: 0 }));
    await step(6);
    expect(lastPartyTableTo(cap, 1)!.length).toBe(1);
    z.frame(2, input({ k: "partyLeave" }));
    await step(6);
    expect(lastPartyTableTo(cap, 1)).toEqual([]); // the dissolve reaches clients
    expect((engineDefaultWorld as any).party.parties.size).toBe(0);
  });

  it("a fresh member's snapshot carries the live party table", async () => {
    const { zone: z, cap } = mkZone(battleProject(1));
    z.admit(1, "Ada", "", 5, 6, 3, false);
    z.admit(2, "Bo", "", 4, 6, 3, false);
    const answer = makeAnswerer(cap);
    z.frame(1, input({ k: "partyInvite", target: 2 }));
    await flush();
    await answer(2, "choices", () => ({ kind: "choices", choice: 0 }));
    await flush();
    z.admit(3, "Cy", "", 8, 8, 0, true); // snapshot on admit
    const snap = framesTo(cap, 3).find((m) => m.t === "snapshot");
    expect(snap).toBeTruthy();
    expect(snap.world.party.length).toBe(1);
    expect(snap.world.party[0].members).toEqual([1, 2]);
  });

  it("solo-rules fallback: an unpartied second player is NOT pulled into a neighbor's battle", async () => {
    const { zone: z, cap } = mkZone(battleProject(1));
    z.admit(1, "Ada", "", 5, 6, 3, false);
    z.admit(2, "Bo", "", 4, 6, 3, false); // adjacent but NOT partied
    z.frame(1, input({ k: "act" }));
    await flush();
    expect(directivesTo(cap, 1, "battleJoin").length).toBe(1);
    expect(directivesTo(cap, 2, "battleJoin").length).toBe(0); // presence gate #1
    await fightToEnd(cap, [1], attackAll);
    expect(battleEventsTo(cap, 1).find((e) => e.ev === "end")?.result).toBe("win");
    expect(battleEventsTo(cap, 2).length).toBe(0);
  });
});
