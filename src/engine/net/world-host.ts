/* RPGAtlas — src/engine/net/world-host.ts
   Project Beacon MP2·A: the server side of the loopback split. A `WorldHost`
   owns ONE running world (src/shared/sim/world.ts) and the tick that advances
   it. Clients reach it only through a Transport: inbound `input` frames are
   buffered into a per-tick intent inbox and drained by the world's tick — never
   applied on arrival, so message delivery never re-enters the simulation.

   In single-player this host wraps `defaultWorld` and its transport is the
   server end of a loopback pair (see solo-session.ts); the exact same class is
   what the Beacon relay (MP5) will host per room, over a WebSocket transport.
   That is the whole point of the loopback phase: the code that owns the tick
   and consumes intents is written ONCE, here, and single-player exercises it
   every frame.

   MP2 scope fence: the host owns the tick and the intent inbox; it does NOT yet
   contain the world-write logic (movement/collision/interaction still lives in
   the engine's map scene, which drains this inbox — see scenes/map.ts). The
   world-tick function is injected (`setTickFn`) rather than imported so this
   module stays free of the engine/DOM modules the tick currently touches; the
   full headless extraction of the tick body is a later phase. The delta
   broadcast is a marked no-op: in loopback the client reads the world by
   reference (the mirror IS the world), so there is nothing to serialize yet.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { World } from "../../shared/sim/world.js";
import type { DirectiveReplyValue, InputIntent } from "../../shared/net/protocol.js";
import type { NetMessage, Transport } from "../../shared/net/transport.js";
import { deliverReply } from "../../shared/sim/directives.js";

/** One buffered input, tagged with the connection sequence number it arrived
 *  with and the player it came from. `playerId` is 0 (the one default player)
 *  until MP4 keys the world per player. */
export interface PendingIntent {
  playerId: number;
  seq: number;
  intent: InputIntent;
}

/** The server-authoritative host for one world. */
export class WorldHost {
  /** The world this host advances. Exposed read-only for the tick body (the
   *  engine map scene) and, in loopback, for the client's by-reference mirror. */
  readonly world: World;
  private readonly transport: Transport;
  private inbox: PendingIntent[] = [];
  private tickFn: (() => void) | null = null;

  constructor(world: World, transport: Transport) {
    this.world = world;
    this.transport = transport;
    this.transport.onMessage((msg) => this.onMessage(msg));
    // MP3·A: the host owns the world's outbound directive channel — the
    // world-side presentation port (sim/directives.ts) emits modal directives
    // through this send. One transport = the one default player; MP4 keys the
    // routing per connection.
    world.directives.send = (_playerId, frame) => this.transport.send(frame);
  }

  /** Route one inbound frame. `input` buffers an intent for the tick to drain
   *  (A2: never applied on arrival); `reply` (MP3) resolves its pending
   *  directive IMMEDIATELY — deliberately un-buffered, because resuming the
   *  suspended interpreter continues an already-running async event in the
   *  same microtask chain (the solo engine's exact dismiss→resume timing, the
   *  byte-identity requirement) and cannot re-enter the tick. The remaining
   *  room-lifecycle frames (`hello`/`join`/`resume`/`emote`/`chat`) are MP5
   *  business and are accepted-and-ignored so a future client can send them
   *  without the host throwing. */
  private onMessage(msg: NetMessage): void {
    if ((msg as any).t === "input") {
      const m = msg as { seq: number; intent: InputIntent };
      this.inbox.push({ playerId: 0, seq: m.seq, intent: m.intent });
    } else if ((msg as any).t === "reply") {
      const m = msg as { id: number; value: DirectiveReplyValue };
      deliverReply(this.world, 0, m.id, m.value);
    }
  }

  /** Take and clear the intents buffered since the last drain. The world tick
   *  calls this once and applies each in order. */
  drainIntents(): PendingIntent[] {
    if (!this.inbox.length) return EMPTY; // idle tick allocates nothing
    const drained = this.inbox;
    this.inbox = [];
    return drained;
  }

  /** Bind the world-tick function (the engine's map-scene `update`). Injected
   *  rather than imported to keep this module off the engine/DOM graph. */
  setTickFn(fn: () => void): void {
    this.tickFn = fn;
  }

  /** Advance the world one fixed step. The loop (src/engine/loop.ts) drains
   *  whole ticks by calling this — tick ownership lives here, not in the loop.
   *  The delta broadcast that a networked host would emit after the tick is a
   *  marked no-op in loopback (mirror == world by reference). */
  tick(): void {
    if (this.tickFn) this.tickFn();
    // MP2 seam: broadcastDelta() lands with real clients (MP4/MP5). In
    // loopback the client renders the world directly, so nothing is sent.
  }
}

/** Shared empty result so an idle tick (no input) allocates nothing. */
const EMPTY: PendingIntent[] = [];
