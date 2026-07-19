/* RPGAtlas — src/engine/net/client-session.ts
   Project Beacon MP2·A: the client side of the loopback split. A
   `ClientSession` is what the presentation layer (renderer, HUD, input capture)
   talks to instead of the world directly. It sends the player's input as
   `ClientInput` intents down a Transport and exposes the "world mirror" the
   renderer reads.

   The mirror (MP2·A): a real network client reconstructs world state from the
   server's snapshot/delta frames and renders THAT, never the authoritative
   world. In loopback single-player there is one process and one world, so the
   mirror IS the world, held by reference — the renderer keeps reading it through
   the existing engine shim (ctx/G → defaultWorld), byte-identical, and `view`
   below is that same object. `onServerMessage` therefore no-ops on
   welcome/snapshot/delta: there is nothing to reconstruct yet. MP4 replaces
   `view` with a client-local reconstruction fed by those frames — the seam is
   here so that swap touches only this file.

   Client-side by nature (a browser tab is one client); safe as an engine
   module. GPL-3.0-or-later (see LICENSE). */

import type { World } from "../../shared/sim/world.js";
import type { InputIntent } from "../../shared/net/protocol.js";
import type { Transport } from "../../shared/net/transport.js";

/** The presentation layer's handle on the running game. */
export class ClientSession {
  private readonly transport: Transport;
  /** The world the renderer reads. In loopback this is the authoritative world
   *  by reference (the mirror); MP4 makes it a client-local reconstruction. */
  private readonly world: World;
  /** Monotonic per-connection input sequence. Echoed back by the server as
   *  `delta.ack` for the prediction reconciliation MP4+ adds; here it only
   *  proves the intent stream is ordered. */
  private seq = 0;

  constructor(transport: Transport, world: World) {
    this.transport = transport;
    this.world = world;
    // Server frames (welcome/snapshot/delta) drive mirror reconstruction +
    // prediction reconciliation at MP4; loopback discards them (mirror ==
    // world by reference) — this is the marked seam.
    this.transport.onMessage(() => this.onServerFrame());
  }

  /** The world-mirror the renderer reads. Loopback: the world by reference. */
  get view(): World {
    return this.world;
  }

  /** The last input sequence number sent (test/diagnostic visibility). */
  get lastSeq(): number {
    return this.seq;
  }

  /** Send one input intent to the world host. The client asks; the world
   *  decides (server-authoritative) — see WorldHost + the map scene's applier. */
  sendInput(intent: InputIntent): void {
    this.transport.send({ t: "input", seq: ++this.seq, intent });
  }

  /** A server→client frame arrived. Loopback no-ops: the renderer reads the
   *  world by reference, so there is no snapshot/delta to apply, and prediction
   *  reconciliation (consuming `delta.ack`) lands at MP4. */
  private onServerFrame(): void {
    // MP2 loopback: mirror == world; nothing to reconstruct.
  }
}
