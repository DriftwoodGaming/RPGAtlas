/* RPGAtlas — src/shared/net/transport.ts
   Project Beacon MP2·A: the Transport seam. A `Transport` is one endpoint of a
   client↔server link that carries the typed protocol messages of
   `src/shared/net/protocol.ts`. Exactly one implementation ships in MP2 —
   `createLoopbackPair()`, the in-process link single-player runs over: the
   engine's client sends `input` intents down one end and the world host applies
   them out the other, *exactly as a network client will*, but with no socket
   and no serialization (structured objects are passed by reference — the MP0
   round-trip vitest suite already proves those same objects are wire-safe, so
   loopback can skip JSON.stringify without hiding a wire bug). MP5 adds the
   WebSocket implementation of this same interface (encode on send / decode on
   receive); nothing above the Transport changes.

   Delivery contract (loopback): `send()` hands the SAME object reference to the
   peer's handler synchronously and in order. If the peer has not attached a
   handler yet, messages buffer and flush in order the moment it does. This
   makes the seam deterministic — the receiver observes messages in exactly the
   order they were sent, on the sender's stack — which is what keeps
   single-player byte-identical once tick ownership rides this channel (MP2·B).
   The world host does not act on an intent when it arrives; it buffers it and
   applies it at tick time (see world-host.ts), so synchronous delivery never
   re-enters the tick.

   Headless and DOM-free (this module is pure plumbing — it may run in the
   Beacon server as-is). Copyright (C) 2026 RPGAtlas contributors —
   GPL-3.0-or-later (see LICENSE). */

import type { ClientMessage, ServerMessage } from "./protocol";

/** Anything that crosses a Transport: a client→server or server→client frame.
 *  Loopback carries these objects by reference; a socket transport (MP5)
 *  encodes/decodes them at the boundary. */
export type NetMessage = ClientMessage | ServerMessage;

/** One end of a client↔server link. The two directions are asymmetric only in
 *  which message union each end legally sends; the interface is shared so the
 *  host and the client session are transport-agnostic (loopback today, a
 *  WebSocket at MP5). */
export interface Transport {
  /** Send one frame to the peer. After {@link close}, sends are dropped. */
  send(msg: NetMessage): void;
  /** Register the handler for frames arriving from the peer. Attaching flushes
   *  any frames the peer sent before a handler existed, in order. Replacing the
   *  handler is allowed (the latest wins); only one handler is active. */
  onMessage(handler: (msg: NetMessage) => void): void;
  /** Close this endpoint. Idempotent. After close, {@link isOpen} is false and
   *  further sends from either end are dropped (the peer is notified via
   *  {@link isOpen} only — a deliberate close is a protocol-level `kick`, not a
   *  transport concern). */
  close(): void;
  /** False once either endpoint has been closed. */
  readonly isOpen: boolean;
}

/** A linked client/server endpoint pair sharing one in-process channel. */
export interface TransportPair {
  client: Transport;
  server: Transport;
}

/** One direction of a loopback channel: a buffer + the peer's live handler.
 *  `send` on endpoint A writes into the buffer B drains, and vice-versa. */
interface Channel {
  buffer: NetMessage[];
  handler: ((msg: NetMessage) => void) | null;
}

/** Create a connected loopback endpoint pair. Nothing is asynchronous: a
 *  `client.send()` synchronously invokes the server's handler (or buffers until
 *  it attaches), by reference, in order — and symmetrically for the server.
 *
 *  In single-player the engine builds one of these (see
 *  src/engine/net/solo-session.ts): the client end lives in the ClientSession
 *  the renderer reads through, the server end feeds the WorldHost that owns the
 *  world's tick. */
export function createLoopbackPair(): TransportPair {
  // toServer: what the client sends, waiting for the server's handler.
  // toClient: what the server sends, waiting for the client's handler.
  const toServer: Channel = { buffer: [], handler: null };
  const toClient: Channel = { buffer: [], handler: null };
  let open = true;

  // Deliver into `sink`: synchronous if a handler is attached, else buffered
  // in send-order to flush when one attaches.
  const deliver = (sink: Channel, msg: NetMessage): void => {
    if (sink.handler) sink.handler(msg);
    else sink.buffer.push(msg);
  };
  const attach = (sink: Channel, handler: (msg: NetMessage) => void): void => {
    sink.handler = handler;
    if (sink.buffer.length) {
      const pending = sink.buffer;
      sink.buffer = [];
      for (const msg of pending) handler(msg);
    }
  };

  const makeEndpoint = (out: Channel, inbound: Channel): Transport => ({
    send(msg: NetMessage): void {
      if (!open) return;
      deliver(out, msg);
    },
    onMessage(handler: (msg: NetMessage) => void): void {
      attach(inbound, handler);
    },
    close(): void {
      open = false;
    },
    get isOpen(): boolean {
      return open;
    },
  });

  return {
    client: makeEndpoint(toServer, toClient),
    server: makeEndpoint(toClient, toServer),
  };
}
