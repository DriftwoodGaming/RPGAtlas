/* RPGAtlas — tests-unit/coop-battle.test.ts
   Project Beacon MP6·A: the shared-battle coordination core, headless. A
   scripted directive `send` plays the room transport; replies arrive through
   deliverReply exactly as a room host routes them, and the AFK/join deadlines
   fire off pumped world ticks. Covers the presence gates (no party ⇒ null —
   the draw-conservation door), the A-4 battler split, remote-only blocking
   (A-10), loadout collection with the sit-out deadline, the command round
   with the AFK all-guard, disconnect withdrawal (D-6-4), the per-player event
   outbox, and teardown. GPL-3.0-or-later (see LICENSE). */

import { describe, expect, it } from "vitest";
import { createWorld, type World } from "../src/shared/sim/world";
import { deliverReply } from "../src/shared/sim/directives";
import { pumpTickTimers } from "../src/shared/sim/timers";
import { addPlayer } from "../src/shared/sim/players";
import { requestPartyInvite } from "../src/shared/sim/party";
import {
  activeParticipants,
  BATTLE_CMD_TIMEOUT_TICKS,
  BATTLE_JOIN_TIMEOUT_TICKS,
  closeSharedBattle,
  collectBattleCommands,
  collectLoadouts,
  drainBattleOutbox,
  openSharedBattle,
  queueBattleEvent,
  withdrawParticipant,
  type CmdRequest,
} from "../src/shared/sim/coop-battle";
import type { BattleCmdDirective, ServerDirective } from "../src/shared/net/protocol";

const PROJ = { system: { startMapId: 1, startX: 5, startY: 5, startDir: "down" } };

interface Sent {
  pid: number;
  frame: ServerDirective;
}

/** A room-shaped world: player 0 at (5,5), peers 1+2 adjacent, all partied. */
async function partiedWorld(peers = 2): Promise<{ w: World; sent: Sent[] }> {
  const w = createWorld(PROJ);
  w.g.mapId = 1;
  w.g.player = { x: 5, y: 5 };
  const sent: Sent[] = [];
  w.directives.send = (pid, frame) => sent.push({ pid, frame });
  for (let i = 1; i <= peers; i++) {
    addPlayer(w, i, "P" + i, { mapId: 1, x: 5 + i, y: 5 });
    const p = requestPartyInvite(w, 0, i, "Hero");
    const d = sent[sent.length - 1];
    deliverReply(w, i, d.frame.id, { kind: "choices", choice: 0 });
    await p;
  }
  sent.length = 0;
  return { w, sent };
}

const names = (pid: number) => "P" + pid;

describe("presence gates (draw conservation's door)", () => {
  it("no party ⇒ null: solo can never open a shared battle", () => {
    const w = createWorld(PROJ);
    w.g.player = { x: 5, y: 5 };
    expect(openSharedBattle(w, 0, 1, names)).toBeNull();
  });

  it("partied but out of range ⇒ null; an active battle blocks a second", async () => {
    const { w } = await partiedWorld(1);
    const e = w.roster.players.get(1)!;
    e.mapId = 2; // walked through a door
    expect(openSharedBattle(w, 0, 1, names)).toBeNull();
    e.mapId = 1;
    const sb = openSharedBattle(w, 0, 1, names)!;
    expect(sb).toBeTruthy();
    expect(openSharedBattle(w, 0, 2, names)).toBeNull();
    closeSharedBattle(w, sb);
  });
});

describe("open: split + blocking", () => {
  it("2 participants field 4 each; 3 field 2 each (A-4)", async () => {
    const two = await partiedWorld(1);
    let sb = openSharedBattle(two.w, 0, 1, names)!;
    expect(sb.participants.map((p) => p.slots)).toEqual([4, 4]);
    closeSharedBattle(two.w, sb);
    const three = await partiedWorld(2);
    sb = openSharedBattle(three.w, 0, 1, names)!;
    expect(sb.participants.map((p) => p.slots)).toEqual([2, 2, 2]);
    closeSharedBattle(three.w, sb);
  });

  it("blocks the REMOTE participants only (A-10) and releases on close", async () => {
    const { w } = await partiedWorld(2);
    const sb = openSharedBattle(w, 0, 1, names)!;
    expect(w.blocking.has(0)).toBe(false); // the trigger's pause is its scene's
    expect(w.blocking.has(1)).toBe(true);
    expect(w.blocking.has(2)).toBe(true);
    closeSharedBattle(w, sb);
    expect(w.blocking.size).toBe(0);
    expect(w.coopBattle.active).toBeNull();
  });
});

describe("loadout collection", () => {
  it("a valid reply seats the battlers; silence sits the peer out", async () => {
    const { w, sent } = await partiedWorld(2);
    const sb = openSharedBattle(w, 0, 7, names)!;
    const done = collectLoadouts(w, sb, "Hero");
    // both peers got a battleJoin naming the troop + the trigger
    const joins = sent.filter((s) => s.frame.directive.kind === "battleJoin");
    expect(joins.map((s) => s.pid).sort()).toEqual([1, 2]);
    expect(joins[0].frame.directive).toMatchObject({ troopId: 7, from: "Hero" });
    // P1 contributes two battlers; P2 never answers
    deliverReply(w, 1, joins.find((s) => s.pid === 1)!.frame.id, {
      kind: "battleJoin",
      party: [
        { actorId: 1, level: 3, hp: 30, mp: 5 },
        { actorId: 2, level: 2, hp: 20, mp: 8 },
      ],
    });
    for (let i = 0; i < BATTLE_JOIN_TIMEOUT_TICKS; i++) pumpTickTimers(w);
    await done;
    const p1 = sb.participants.find((p) => p.pid === 1)!;
    const p2 = sb.participants.find((p) => p.pid === 2)!;
    expect(p1.loadout.length).toBe(2);
    expect(p1.withdrawn).toBe(false);
    expect(p2.withdrawn).toBe(true); // sat out at the deadline
    expect(w.blocking.has(2)).toBe(false); // and released
    expect(activeParticipants(sb).map((p) => p.pid)).toEqual([0, 1]);
    closeSharedBattle(w, sb);
  });
});

function cmdView(round: number): BattleCmdDirective {
  return {
    kind: "battleCmd",
    round,
    canEscape: true,
    yours: [
      {
        idx: 4,
        name: "P1a",
        hp: 30,
        mhp: 30,
        mp: 5,
        mmp: 5,
        states: [],
        skills: [],
        canAct: true,
      },
    ],
    allies: [],
    enemies: [{ i: 0, name: "Slime", hp: 10, mhp: 10, alive: true }],
  };
}

describe("command round", () => {
  it("replies land; the AFK deadline answers all-guard (empty)", async () => {
    const { w, sent } = await partiedWorld(2);
    const sb = openSharedBattle(w, 0, 7, names)!;
    const requests: CmdRequest[] = [
      { pid: 1, view: cmdView(1) },
      { pid: 2, view: cmdView(1) },
    ];
    const round = collectBattleCommands(w, sb, requests);
    const d1 = sent.find((s) => s.pid === 1 && s.frame.directive.kind === "battleCmd")!;
    deliverReply(w, 1, d1.frame.id, {
      kind: "battleCmd",
      cmds: [{ type: "attack", enemy: 0 }],
    });
    for (let i = 0; i < BATTLE_CMD_TIMEOUT_TICKS; i++) pumpTickTimers(w);
    const replies = await round;
    expect(replies.get(1)).toEqual([{ type: "attack", enemy: 0 }]);
    expect(replies.get(2)).toEqual([]); // AFK ⇒ guard everything
    closeSharedBattle(w, sb);
  });

  it("a reply longer than `yours` is trimmed; a foreign reply is dropped", async () => {
    const { w, sent } = await partiedWorld(1);
    const sb = openSharedBattle(w, 0, 7, names)!;
    const round = collectBattleCommands(w, sb, [{ pid: 1, view: cmdView(2) }]);
    const d = sent.find((s) => s.frame.directive.kind === "battleCmd")!;
    // a foreign player answering P1's directive is dropped + counted
    expect(
      deliverReply(w, 2, d.frame.id, { kind: "battleCmd", cmds: [] }),
    ).toBe(false);
    expect(w.directives.dropped).toBeGreaterThan(0);
    deliverReply(w, 1, d.frame.id, {
      kind: "battleCmd",
      cmds: [{ type: "guard" }],
    });
    const replies = await round;
    expect(replies.get(1)).toEqual([{ type: "guard" }]);
    closeSharedBattle(w, sb);
  });
});

describe("withdrawal (D-6-4) + outbox (A-9)", () => {
  it("withdraw releases the block, escapes pendings, and bars the trigger", async () => {
    const { w, sent } = await partiedWorld(2);
    const sb = openSharedBattle(w, 0, 7, names)!;
    const round = collectBattleCommands(w, sb, [{ pid: 1, view: cmdView(1) }]);
    expect(sent.some((s) => s.pid === 1)).toBe(true);
    expect(withdrawParticipant(w, 0)).toBe(false); // the trigger can't withdraw
    expect(withdrawParticipant(w, 1)).toBe(true);
    expect(w.blocking.has(1)).toBe(false);
    const replies = await round; // the pending auto-resolved (escape value)
    expect(replies.get(1)).toEqual([]);
    expect(withdrawParticipant(w, 1)).toBe(false); // idempotent
    expect(activeParticipants(sb).map((p) => p.pid)).toEqual([0, 2]);
    closeSharedBattle(w, sb);
  });

  it("events queue per player, skip the local player, and drain once", async () => {
    const { w } = await partiedWorld(2);
    queueBattleEvent(w, [0, 1, 2], { ev: "round", n: 3 });
    queueBattleEvent(w, [1], { ev: "log", text: "Slime attacks!" });
    const drained = drainBattleOutbox(w);
    expect(drained.map((d) => d.pid)).toEqual([1, 2, 1]); // pid 0 never queued
    expect(drained[2].ev).toEqual({ ev: "log", text: "Slime attacks!" });
    expect(drainBattleOutbox(w)).toEqual([]);
  });
});
