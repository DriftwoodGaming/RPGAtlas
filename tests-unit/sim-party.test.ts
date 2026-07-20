/* RPGAtlas — tests-unit/sim-party.test.ts
   Project Beacon MP6·A: the player-party system, headless. A scripted
   directive `send` stands in for a room's transport: invites really emit
   `choices` directives through the broker and resolve on deliverReply (or on
   the pumped world-tick deadline). Covers the solo-inert invariant, the
   invite lifecycle (accept / decline / cancel / timeout / validations),
   leadership succession + dissolve, battle proximity, the leader warp, and
   the wire table + client mirror diff. GPL-3.0-or-later (see LICENSE). */

import { describe, expect, it } from "vitest";
import { createWorld, type World } from "../src/shared/sim/world";
import { deliverReply, type DirectiveState } from "../src/shared/sim/directives";
import { pumpTickTimers } from "../src/shared/sim/timers";
import { addPlayer } from "../src/shared/sim/players";
import {
  applyPartyTable,
  battleParticipantsFor,
  BATTLE_JOIN_RADIUS,
  consumePartyDirty,
  INVITE_TIMEOUT_TICKS,
  leaveParty,
  MAX_PARTY_MEMBERS,
  partyOf,
  partyTable,
  requestPartyInvite,
  warpPartyToLeader,
} from "../src/shared/sim/party";
import type { ServerDirective } from "../src/shared/net/protocol";

const PROJ = { system: { startMapId: 1, startX: 5, startY: 5, startDir: "down" } };

interface Sent {
  pid: number;
  frame: ServerDirective;
}

/** A world with a live player 0 at (5,5) on map 1 and a scripted transport. */
function roomWorld(): { w: World; sent: Sent[] } {
  const w = createWorld(PROJ);
  w.g.mapId = 1;
  w.g.player = { x: 5, y: 5 };
  const sent: Sent[] = [];
  w.directives.send = (pid, frame) => sent.push({ pid, frame });
  return { w, sent };
}

/** Answer the newest pending directive for `pid` with choice `i`. */
function answerChoice(w: World, sent: Sent[], pid: number, i: number): void {
  const d = [...sent].reverse().find((s) => s.pid === pid);
  expect(d, "expected a directive for pid " + pid).toBeTruthy();
  expect(deliverReply(w, pid, d!.frame.id, { kind: "choices", choice: i })).toBe(true);
}

/** Form a party of `pids` under leader `from` (answering each invite). */
async function formParty(w: World, sent: Sent[], from: number, pids: number[]): Promise<void> {
  for (const pid of pids) {
    const p = requestPartyInvite(w, from, pid, "Hero");
    answerChoice(w, sent, pid, 0);
    expect(await p).toBe("accepted");
  }
}

describe("solo-inert party state", () => {
  it("a fresh world has no parties and a lone battle roster", () => {
    const w = createWorld(PROJ);
    expect(w.party.parties.size).toBe(0);
    expect(w.party.dirty).toBe(false);
    w.g.player = { x: 1, y: 1 };
    expect(battleParticipantsFor(w, 0)).toEqual([0]);
  });

  it("a clientless world auto-declines an invite (escape value)", async () => {
    const w = createWorld(PROJ);
    w.g.player = { x: 1, y: 1 };
    addPlayer(w, 1, "Pal");
    expect(await requestPartyInvite(w, 0, 1, "Hero")).toBe("declined");
    expect(w.party.parties.size).toBe(0);
  });
});

describe("invite lifecycle", () => {
  it("accept forms the party: inviter leads, join order kept, dirty set", async () => {
    const { w, sent } = roomWorld();
    addPlayer(w, 1, "Ann");
    addPlayer(w, 2, "Ben");
    await formParty(w, sent, 0, [1, 2]);
    const p = partyOf(w, 0)!;
    expect(p.leader).toBe(0);
    expect(p.members).toEqual([0, 1, 2]);
    expect(partyOf(w, 2)).toBe(p);
    expect(consumePartyDirty(w)).toBe(true);
    expect(consumePartyDirty(w)).toBe(false);
    // the consent question is a plain choices directive to the invitee
    expect(sent[0].pid).toBe(1);
    expect(sent[0].frame.directive.kind).toBe("choices");
  });

  it("decline ('Not now') and cancel both leave no party", async () => {
    const { w, sent } = roomWorld();
    addPlayer(w, 1, "Ann");
    let p = requestPartyInvite(w, 0, 1, "Hero");
    answerChoice(w, sent, 1, 1);
    expect(await p).toBe("declined");
    p = requestPartyInvite(w, 0, 1, "Hero");
    const d = sent[sent.length - 1];
    deliverReply(w, 1, d.frame.id, { kind: "choices", canceled: true });
    expect(await p).toBe("declined");
    expect(w.party.parties.size).toBe(0);
  });

  it("an unanswered invite auto-declines at the tick deadline", async () => {
    const { w } = roomWorld();
    addPlayer(w, 1, "Ann");
    const p = requestPartyInvite(w, 0, 1, "Hero");
    for (let i = 0; i < INVITE_TIMEOUT_TICKS; i++) pumpTickTimers(w);
    expect(await p).toBe("declined");
    expect(w.party.parties.size).toBe(0);
    expect((w.directives as DirectiveState).pending.size).toBe(0);
  });

  it("validations: self, ghost target, partied target, double invite, full party", async () => {
    const { w, sent } = roomWorld();
    for (let i = 1; i <= 5; i++) addPlayer(w, i, "P" + i);
    expect(await requestPartyInvite(w, 0, 0, "Hero")).toBe("invalid");
    expect(await requestPartyInvite(w, 0, 99, "Hero")).toBe("invalid");
    await formParty(w, sent, 0, [1, 2, 3]); // party full at MAX_PARTY_MEMBERS
    expect(partyOf(w, 0)!.members.length).toBe(MAX_PARTY_MEMBERS);
    expect(await requestPartyInvite(w, 0, 4, "Hero")).toBe("invalid"); // full
    expect(await requestPartyInvite(w, 4, 1, "P4")).toBe("invalid"); // target partied
    const hang = requestPartyInvite(w, 4, 5, "P4"); // outstanding…
    expect(await requestPartyInvite(w, 4, 5, "P4")).toBe("invalid"); // …blocks a second
    answerChoice(w, sent, 5, 1);
    expect(await hang).toBe("declined");
  });
});

describe("membership", () => {
  it("leader leave passes the lead; a party of one dissolves", async () => {
    const { w, sent } = roomWorld();
    addPlayer(w, 1, "Ann");
    addPlayer(w, 2, "Ben");
    await formParty(w, sent, 0, [1, 2]);
    expect(leaveParty(w, 0)).toBe(true);
    const p = partyOf(w, 1)!;
    expect(p.leader).toBe(1);
    expect(p.members).toEqual([1, 2]);
    expect(leaveParty(w, 2)).toBe(true); // Ann alone → dissolved
    expect(partyOf(w, 1)).toBeNull();
    expect(w.party.parties.size).toBe(0);
  });
});

describe("battle proximity (A-3)", () => {
  it("same map within the radius joins, in trigger-then-join order", async () => {
    const { w, sent } = roomWorld();
    addPlayer(w, 1, "Near", { mapId: 1, x: 5 + BATTLE_JOIN_RADIUS, y: 5 });
    addPlayer(w, 2, "Far", { mapId: 1, x: 5 + BATTLE_JOIN_RADIUS + 1, y: 5 });
    addPlayer(w, 3, "Elsewhere", { mapId: 2, x: 5, y: 5 });
    await formParty(w, sent, 0, [1, 2, 3]);
    expect(battleParticipantsFor(w, 0)).toEqual([0, 1]);
  });

  it("a non-partied trigger battles alone", () => {
    const { w } = roomWorld();
    addPlayer(w, 1, "Ann");
    expect(battleParticipantsFor(w, 0)).toEqual([0]);
  });
});

describe("warp to leader (A-2)", () => {
  it("only the leader pulls; members land on the arrival tile", async () => {
    const { w, sent } = roomWorld();
    addPlayer(w, 1, "Ann", { mapId: 1, x: 2, y: 2 });
    await formParty(w, sent, 0, [1]);
    w.g.mapId = 7;
    w.g.player = { x: 10, y: 11 };
    expect(warpPartyToLeader(w, 1)).toBe(0); // Ann isn't the leader
    expect(warpPartyToLeader(w, 0)).toBe(1);
    const e = w.roster.players.get(1)!;
    expect([e.mapId, e.x, e.y, e.rx, e.ry, e.moving]).toEqual([7, 10, 11, 10, 11, false]);
  });
});

describe("wire table + client mirror", () => {
  it("partyTable round-trips through applyPartyTable with a correct diff", async () => {
    const { w, sent } = roomWorld();
    addPlayer(w, 1, "Ann");
    addPlayer(w, 2, "Ben");
    await formParty(w, sent, 0, [1, 2]);
    const table = partyTable(w);
    // a client whose local player is 1 mirrors the table
    const c = createWorld(PROJ);
    c.roster.local = 1;
    const joined = applyPartyTable(c, table);
    expect(joined.joined).toBe(true);
    expect(partyOf(c, 1)!.members).toEqual([0, 1, 2]);
    // Ben leaves server-side → the next table diff reports my mate set shrank
    leaveParty(w, 2);
    const after = applyPartyTable(c, partyTable(w));
    expect(after.joined).toBe(false);
    expect(after.left).toBe(false);
    expect(partyOf(c, 1)!.members).toEqual([0, 1]);
    // I leave → the mirror reports left
    leaveParty(w, 1);
    const gone = applyPartyTable(c, partyTable(w));
    expect(gone.left).toBe(true);
    expect(partyOf(c, 1)).toBeNull();
  });
});
