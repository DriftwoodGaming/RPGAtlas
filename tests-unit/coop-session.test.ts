/* RPGAtlas — tests-unit/coop-session.test.ts
   Project Beacon MP6·A: the co-op party + shared-battle wire paths end-to-end
   over the real BroadcastChannel transport (the room-session.test.ts harness,
   extended). Proves: a party invite reaches the invitee as a choices
   directive and the accept forms the party ON THE HOST; the party table rides
   the next delta and mirrors on the client (with the joined diff); a
   battleJoin directive crosses the bus and the client's loadout reply seats
   its battlers; battle events queued for a player arrive through that
   player's delta only. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, describe, expect, it } from "vitest";
import { createWorld, type World } from "../src/shared/sim/world";
import { createLoopbackPair } from "../src/shared/net/transport";
import { WorldHost } from "../src/engine/net/world-host";
import { RoomHost } from "../src/engine/net/room-host";
import { RoomClient, type RoomSnapshot } from "../src/engine/net/room-client";
import { resetSession } from "../src/engine/net/session";
import { requestPartyInvite, partyOf, type PartyChange } from "../src/shared/sim/party";
import {
  collectLoadouts,
  openSharedBattle,
  queueBattleEvent,
  type BattleEvent,
} from "../src/shared/sim/coop-battle";
import type { Directive, DirectiveReplyValue } from "../src/shared/net/protocol";

async function waitFor(pred: () => boolean, timeout = 3000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeout) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

const PROJ = { system: { startMapId: 1, startX: 5, startY: 5, startDir: "down" } };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  resetSession();
});

function makeHost(roomCode: string, onCustom?: (m: { from: number; data: unknown }) => void) {
  const world: World = createWorld(PROJ);
  world.g.player = { x: 5, y: 5, rx: 5, ry: 5, dir: 0, moving: false, animT: 0 };
  world.g.mapId = 1;
  const link = createLoopbackPair();
  const worldHost = new WorldHost(world, link.server);
  const host = new RoomHost(world, worldHost, roomCode, {
    localName: "Host",
    localCharset: "hero",
    onCustom,
  });
  cleanups.push(() => host.close());
  return { world, worldHost, host };
}

function makeClient(
  roomCode: string,
  name: string,
  render: (d: Directive) => DirectiveReplyValue,
) {
  const world: World = createWorld(PROJ);
  world.g.player = { x: 0, y: 0, rx: 0, ry: 0, dir: 0, moving: false, animT: 0 };
  const rec = {
    welcomeId: -1,
    snapshot: null as RoomSnapshot | null,
    directives: [] as Directive[],
    party: [] as PartyChange[],
    battle: [] as BattleEvent[],
    custom: [] as Array<{ from: number; data: unknown }>,
  };
  const client = new RoomClient(world, roomCode, {
    name,
    onWelcome: (id) => (rec.welcomeId = id),
    onSnapshot: (s) => {
      rec.snapshot = s;
    },
    renderDirective: async (d) => {
      rec.directives.push(d);
      return render(d);
    },
    onParty: (c) => rec.party.push(c),
    onBattle: (ev) => rec.battle.push(ev),
    onCustom: (m) => rec.custom.push(m),
  });
  cleanups.push(() => client.close());
  return { world, client, rec };
}

const acceptInvite = (d: Directive): DirectiveReplyValue =>
  d.kind === "choices" ? { kind: "choices", choice: 0 } : ({ kind: "message", done: true } as any);

describe("MP6·A co-op session over BroadcastChannel", () => {
  it("invite → choices directive → accept forms the party; the table rides the delta", async () => {
    const room = "COOPA" + Date.now().toString(36);
    const { world: hostWorld, host } = makeHost(room);
    const { world: clientWorld, rec } = makeClient(room, "Robin", acceptInvite);
    await waitFor(() => rec.welcomeId === 1 && rec.snapshot != null);

    const invite = requestPartyInvite(hostWorld, 0, 1, "Host");
    await waitFor(() => rec.directives.some((d) => d.kind === "choices"));
    const q = rec.directives.find((d) => d.kind === "choices") as any;
    expect(q.prompt).toContain("Host");
    expect(await invite).toBe("accepted");
    const p = partyOf(hostWorld, 0)!;
    expect(p.leader).toBe(0);
    expect(p.members).toEqual([0, 1]);

    // the membership change reaches the client on the next delta
    host.afterTick();
    await waitFor(() => rec.party.length > 0);
    expect(rec.party[0].joined).toBe(true);
    expect(partyOf(clientWorld, 1)!.members).toEqual([0, 1]);
  });

  it("battleJoin crosses the bus; the client's loadout seats its battlers", async () => {
    const room = "COOPB" + Date.now().toString(36);
    const { world: hostWorld } = makeHost(room);
    const { rec } = makeClient(room, "Robin", (d) => {
      if (d.kind === "battleJoin")
        return { kind: "battleJoin", party: [{ actorId: 1, level: 2, hp: 25, mp: 4 }] };
      return acceptInvite(d);
    });
    await waitFor(() => rec.welcomeId === 1);
    const invite = requestPartyInvite(hostWorld, 0, 1, "Host");
    await waitFor(() => rec.directives.some((d) => d.kind === "choices"));
    expect(await invite).toBe("accepted");

    const sb = openSharedBattle(hostWorld, 0, 7, (pid) => (pid === 0 ? "Host" : "Robin"))!;
    expect(sb.participants.map((x) => x.pid)).toEqual([0, 1]);
    const done = collectLoadouts(hostWorld, sb, "Host");
    await waitFor(() => rec.directives.some((d) => d.kind === "battleJoin"));
    expect(rec.directives.find((d) => d.kind === "battleJoin")).toMatchObject({
      troopId: 7,
      from: "Host",
    });
    await done;
    const p1 = sb.participants.find((x) => x.pid === 1)!;
    expect(p1.withdrawn).toBe(false);
    expect(p1.loadout).toEqual([{ actorId: 1, level: 2, hp: 25, mp: 4 }]);
    // the shared battle blocks the remote participant while it runs
    expect(hostWorld.blocking.has(1)).toBe(true);
    expect(hostWorld.blocking.has(0)).toBe(false);
  });

  it("battle events reach only their addressee's delta", async () => {
    const room = "COOPC" + Date.now().toString(36);
    const { world: hostWorld, host } = makeHost(room);
    const a = makeClient(room, "Ana", acceptInvite);
    await waitFor(() => a.rec.welcomeId === 1);
    const b = makeClient(room, "Bo", acceptInvite);
    await waitFor(() => b.rec.welcomeId === 2);

    queueBattleEvent(hostWorld, [1], { ev: "log", text: "Slime attacks!" });
    queueBattleEvent(hostWorld, [0], { ev: "log", text: "never sent (local)" });
    host.afterTick();
    await waitFor(() => a.rec.battle.length > 0);
    expect(a.rec.battle).toEqual([{ ev: "log", text: "Slime attacks!" }]);
    // give the bus a beat, then confirm Bo heard nothing
    host.afterTick();
    await waitFor(() => a.rec.battle.length >= 1);
    expect(b.rec.battle).toEqual([]);
  });

  it("MP6·B: an itemUsed event rides its owner's delta so the client decrements its own bag (D-6-7)", async () => {
    const room = "COOPD" + Date.now().toString(36);
    const { world: hostWorld, host } = makeHost(room);
    const a = makeClient(room, "Ana", acceptInvite);
    await waitFor(() => a.rec.welcomeId === 1);
    const b = makeClient(room, "Bo", acceptInvite);
    await waitFor(() => b.rec.welcomeId === 2);

    // the authority consumed one of Ana's items resolving her battler's command
    queueBattleEvent(hostWorld, [1], { ev: "itemUsed", id: 9 });
    host.afterTick();
    await waitFor(() => a.rec.battle.length > 0);
    expect(a.rec.battle).toEqual([{ ev: "itemUsed", id: 9 }]);
    host.afterTick();
    expect(b.rec.battle).toEqual([]); // Bo's inventory is never touched
  });

  it("MP7·C: plugin custom messages relay both directions over the bus", async () => {
    const room = "COOPE" + Date.now().toString(36);
    const hostGot: Array<{ from: number; data: unknown }> = [];
    const { host } = makeHost(room, (m) => hostGot.push(m));
    const a = makeClient(room, "Ana", acceptInvite);
    await waitFor(() => a.rec.welcomeId === 1);
    const b = makeClient(room, "Bo", acceptInvite);
    await waitFor(() => b.rec.welcomeId === 2);

    // client → host (and NOT echoed back to the sender)
    a.client.sendCustom({ hi: "there", n: 3 });
    await waitFor(() => hostGot.length > 0);
    expect(hostGot[0]).toEqual({ from: 1, data: { hi: "there", n: 3 } });
    await waitFor(() => b.rec.custom.length > 0); // Bo (another client) hears it, from Ana
    expect(b.rec.custom[0]).toEqual({ from: 1, data: { hi: "there", n: 3 } });
    expect(a.rec.custom).toEqual([]); // the sender never receives its own echo

    // host → all clients (from id 0)
    host.sendCustom({ pong: true });
    await waitFor(() => a.rec.custom.length > 0);
    expect(a.rec.custom[0]).toEqual({ from: 0, data: { pong: true } });
  });
});
