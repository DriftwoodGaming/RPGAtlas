/* RPGAtlas — tests-unit/net-transport.test.ts
   Project Beacon MP2·A: the loopback Transport and the WorldHost/ClientSession
   split it connects. These prove the seam single-player will run over: intents
   sent through a ClientSession arrive, in order, by reference, in the host's
   inbox and are drained by the tick — with no serialization (loopback passes
   the very objects; MP0's round-trip suite proves those objects are wire-safe).
   Pure/headless — no engine or DOM graph is pulled in. GPL-3.0-or-later. */

import { describe, it, expect } from "vitest";
import {
  createLoopbackPair,
  type NetMessage,
} from "../src/shared/net/transport";
import { WorldHost } from "../src/engine/net/world-host";
import { ClientSession } from "../src/engine/net/client-session";
import { createWorld } from "../src/shared/sim/world";
import type { ClientInput } from "../src/shared/net/protocol";

describe("createLoopbackPair", () => {
  it("delivers client→server and server→client by reference, in order", () => {
    const { client, server } = createLoopbackPair();
    const atServer: NetMessage[] = [];
    const atClient: NetMessage[] = [];
    server.onMessage((m) => atServer.push(m));
    client.onMessage((m) => atClient.push(m));

    const a: ClientInput = { t: "input", seq: 1, intent: { k: "move", dir: "up" } };
    const b: ClientInput = { t: "input", seq: 2, intent: { k: "act" } };
    client.send(a);
    client.send(b);
    server.send({ t: "welcome", proto: 1, playerId: 0, roomCode: "AAA-AAA-AAA", resumeToken: "0123456789abcdef", tick: 0 });

    expect(atServer).toHaveLength(2);
    // Same object reference — loopback does not clone (zero-copy in-process).
    expect(atServer[0]).toBe(a);
    expect(atServer[1]).toBe(b);
    expect((atServer[0] as ClientInput).seq).toBe(1);
    expect((atServer[1] as ClientInput).seq).toBe(2);
    expect(atClient).toHaveLength(1);
    expect((atClient[0] as { t: string }).t).toBe("welcome");
  });

  it("buffers frames sent before a handler attaches and flushes them in order", () => {
    const { client, server } = createLoopbackPair();
    // Client sends three intents before the server attaches its handler.
    client.send({ t: "input", seq: 1, intent: { k: "move", dir: "left" } });
    client.send({ t: "input", seq: 2, intent: { k: "move", dir: "left" } });
    client.send({ t: "input", seq: 3, intent: { k: "act" } });
    const got: NetMessage[] = [];
    server.onMessage((m) => got.push(m));
    expect(got.map((m) => (m as ClientInput).seq)).toEqual([1, 2, 3]);
    // A later send delivers synchronously now the handler exists.
    client.send({ t: "input", seq: 4, intent: { k: "face", dir: "up" } });
    expect(got.map((m) => (m as ClientInput).seq)).toEqual([1, 2, 3, 4]);
  });

  it("stops delivering after close and reports isOpen", () => {
    const { client, server } = createLoopbackPair();
    const got: NetMessage[] = [];
    server.onMessage((m) => got.push(m));
    expect(client.isOpen).toBe(true);
    client.send({ t: "input", seq: 1, intent: { k: "act" } });
    server.close();
    expect(client.isOpen).toBe(false);
    expect(server.isOpen).toBe(false);
    client.send({ t: "input", seq: 2, intent: { k: "act" } }); // dropped
    expect(got.map((m) => (m as ClientInput).seq)).toEqual([1]);
  });
});

describe("WorldHost + ClientSession over loopback", () => {
  it("buffers a session's intents into the host inbox and drains them once, in order", () => {
    const { client, server } = createLoopbackPair();
    const host = new WorldHost(createWorld(null), server);
    const session = new ClientSession(client, host.world);

    session.sendInput({ k: "move", dir: "up" });
    session.sendInput({ k: "face", dir: "left" });
    session.sendInput({ k: "act" });

    const drained = host.drainIntents();
    expect(drained.map((p) => p.intent.k)).toEqual(["move", "face", "act"]);
    // Sequence numbers are assigned by the client, monotonic from 1.
    expect(drained.map((p) => p.seq)).toEqual([1, 2, 3]);
    expect(session.lastSeq).toBe(3);
    // playerId is the one default player until MP4 keys per player.
    expect(drained.every((p) => p.playerId === 0)).toBe(true);
    // Draining is destructive: a second drain sees nothing.
    expect(host.drainIntents()).toHaveLength(0);
  });

  it("exposes the world by reference as the client mirror (loopback)", () => {
    const { client, server } = createLoopbackPair();
    const world = createWorld(null);
    const host = new WorldHost(world, server);
    const session = new ClientSession(client, world);
    expect(session.view).toBe(world);
    expect(host.world).toBe(world);
  });

  it("drives the world tick through the injected tick fn (host owns the tick)", () => {
    const { server } = createLoopbackPair();
    const world = createWorld(null);
    const host = new WorldHost(world, server);
    let ticks = 0;
    host.setTickFn(() => {
      world.tick++;
      ticks++;
    });
    host.tick();
    host.tick();
    expect(ticks).toBe(2);
    expect(world.tick).toBe(2);
  });

  it("ignores non-input frames without buffering an intent (room lifecycle is MP5)", () => {
    const { client, server } = createLoopbackPair();
    const host = new WorldHost(createWorld(null), server);
    // A future client may send hello/emote before the host understands them.
    client.send({ t: "hello", proto: 1, name: "Explorer" });
    client.send({ t: "emote", emote: "wave" });
    expect(host.drainIntents()).toHaveLength(0);
  });
});
