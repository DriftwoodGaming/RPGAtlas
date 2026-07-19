/* RPGAtlas — tests-unit/room-session.test.ts
   Project Beacon MP4·B: the host/client room protocol end-to-end over the real
   BroadcastChannel transport (Node's same-thread bus stands in for two tabs).
   No engine/DOM module loads — movement + rendering are the injected hooks, so
   this proves the PROTOCOL heart: join → welcome → snapshot (roster
   reconstructed on the client), input intents routed into the host tick inbox
   tagged by player, per-tick delta position sync, presence join/emote broadcast
   with isolation, and directive routing to the right client with the reply
   resuming the host-side interpreter. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, describe, expect, it } from "vitest";
import { createWorld, type World } from "../src/shared/sim/world";
import { createLoopbackPair } from "../src/shared/net/transport";
import { WorldHost } from "../src/engine/net/world-host";
import { RoomHost } from "../src/engine/net/room-host";
import { RoomClient, type RoomSnapshot } from "../src/engine/net/room-client";
import { emitDirective } from "../src/shared/sim/directives";
import { resetSession } from "../src/engine/net/session";
import { getPlayer, type PlayerState } from "../src/shared/sim/players";

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

/** Build a host: an authoritative world with a player-0 entity, its WorldHost
 *  loopback, and a RoomHost listening on `roomCode`. */
function makeHost(roomCode: string) {
  const world: World = createWorld(PROJ);
  world.g.player = { x: 5, y: 5, rx: 5, ry: 5, dir: 0, moving: false, animT: 0 };
  world.g.mapId = 1;
  const link = createLoopbackPair();
  const worldHost = new WorldHost(world, link.server);
  const presence: any[] = [];
  const host = new RoomHost(world, worldHost, roomCode, {
    localName: "Host", localCharset: "hero",
    onPresence: (p) => presence.push(p),
  });
  cleanups.push(() => host.close());
  return { world, worldHost, host, presence };
}

/** Build a client that records the frames its hooks receive. */
function makeClient(roomCode: string, name: string) {
  const world: World = createWorld(PROJ);
  world.g.player = { x: 0, y: 0, rx: 0, ry: 0, dir: 0, moving: false, animT: 0 };
  const rec = {
    welcomeId: -1,
    snapshot: null as RoomSnapshot | null,
    localStates: [] as PlayerState[],
    presence: [] as any[],
    directives: [] as any[],
  };
  const client = new RoomClient(world, roomCode, {
    name,
    onWelcome: (id) => (rec.welcomeId = id),
    onSnapshot: (s) => { rec.snapshot = s; },
    onLocal: (s) => rec.localStates.push(s),
    onPresence: (p) => rec.presence.push(p),
    renderDirective: async (d) => {
      rec.directives.push(d);
      return { kind: "message", done: true } as any;
    },
  });
  cleanups.push(() => client.close());
  return { world, client, rec };
}

describe("MP4·B room session over BroadcastChannel", () => {
  it("join → welcome + snapshot reconstruct the roster on the client", async () => {
    const room = "ROOMA" + Date.now().toString(36);
    const { world: hostWorld } = makeHost(room);
    const { world: clientWorld, rec } = makeClient(room, "Robin");

    await waitFor(() => rec.welcomeId >= 0 && rec.snapshot != null);
    expect(rec.welcomeId).toBe(1); // first joiner
    // the host spawned the peer into its own roster
    expect(hostWorld.roster.players.has(1)).toBe(true);
    // the snapshot carried the host (player 0) + the joiner (player 1)
    expect(rec.snapshot!.players.map((p) => p.id).sort()).toEqual([0, 1]);
    // the client reconstructed its roster as everyone-except-self → just the host
    await waitFor(() => clientWorld.roster.players.has(0));
    expect([...clientWorld.roster.players.keys()]).toEqual([0]);
    expect(clientWorld.roster.players.get(0)!.name).toBe("Host");
    // and its own authoritative baseline arrived via onLocal
    expect(rec.localStates.at(-1)).toMatchObject({ id: 1, name: "Robin", x: 5, y: 5 });
  });

  it("client input routes into the host tick inbox tagged with its player id", async () => {
    const room = "ROOMB" + Date.now().toString(36);
    const { worldHost } = makeHost(room);
    const { client, rec } = makeClient(room, "Robin");
    await waitFor(() => rec.welcomeId === 1);

    client.sendInput({ k: "move", dir: "right", dir8: 2 });
    await waitFor(() => worldHost.drainIntents !== undefined && peek(worldHost).length > 0);
    const drained = worldHost.drainIntents();
    expect(drained).toEqual([{ playerId: 1, seq: 1, intent: { k: "move", dir: "right", dir8: 2 } }]);
  });

  it("per-tick delta syncs every player's position to the client", async () => {
    const room = "ROOMC" + Date.now().toString(36);
    const { world: hostWorld, host } = makeHost(room);
    const { world: clientWorld, rec } = makeClient(room, "Robin");
    await waitFor(() => rec.snapshot != null);

    // The host tick moved player 0 and the peer; broadcast the delta.
    hostWorld.g.player.x = 9;
    hostWorld.g.player.rx = 9;
    const peer = hostWorld.roster.players.get(1)!;
    peer.x = 7; peer.rx = 7;
    hostWorld.tick = 42;
    host.afterTick();

    // client's own player (id 1) updated via onLocal; the host (id 0) in roster.
    await waitFor(() => rec.localStates.some((s) => s.x === 7));
    await waitFor(() => (clientWorld.roster.players.get(0)?.x ?? 0) === 9);
    expect(clientWorld.tick).toBe(42);
  });

  it("presence join/emote broadcast to the OTHER client only, and set bubbles", async () => {
    const room = "ROOMD" + Date.now().toString(36);
    const { world: hostWorld } = makeHost(room);
    const a = makeClient(room, "Ana");
    await waitFor(() => a.rec.welcomeId === 1);
    const b = makeClient(room, "Bo");
    await waitFor(() => b.rec.welcomeId === 2);

    // Ana should have been told Bo joined (presence to the OTHER client).
    await waitFor(() => a.rec.presence.some((p) => p.kind === "join" && p.playerId === 2));
    // Bo does not get a self-join echo.
    expect(b.rec.presence.some((p) => p.kind === "join" && p.playerId === 2)).toBe(false);

    // Ana emotes → host sets the roster bubble + broadcasts to Bo.
    a.client.sendEmote("wave");
    await waitFor(() => (getPlayer(hostWorld, 1)?.emote?.id ?? "") === "wave");
    await waitFor(() => b.rec.presence.some((p) => p.kind === "emote" && p.playerId === 1 && p.emote === "wave"));
    // Bo's mirror of Ana carries the bubble; Ana does not bubble herself.
    await waitFor(() => (getPlayer(b.world, 1)?.emote?.id ?? "") === "wave");
    expect(getPlayer(a.world, 1)).toBeUndefined(); // Ana is her own local player, not in her roster
  });

  it("a directive routes to the right client and its reply resumes the host", async () => {
    const room = "ROOME" + Date.now().toString(36);
    const { world: hostWorld } = makeHost(room);
    const { rec } = makeClient(room, "Robin");
    await waitFor(() => rec.welcomeId === 1);

    // The host-side interpreter shows player 1 a message and awaits the reply.
    const resolved = emitDirective(hostWorld, 1, { kind: "message", text: "hi Robin" });
    await waitFor(() => rec.directives.length > 0);
    expect(rec.directives[0]).toEqual({ kind: "message", text: "hi Robin" });
    const value = await resolved;
    expect(value).toEqual({ kind: "message", done: true });
    expect(hostWorld.directives.pending.size).toBe(0);
  });
});

/** Peek at a WorldHost's buffered intents without draining (test helper). */
function peek(worldHost: any): any[] {
  return worldHost.inbox as any[];
}
