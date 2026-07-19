/* RPGAtlas — src/engine/net/broadcast-transport.ts
   Project Beacon MP4·B: a point-to-point Transport over the browser's
   BroadcastChannel — the MP4 stand-in for a network socket that lets two tabs
   on ONE machine share a world, with no server and no P2P/WebRTC (D6). MP5
   swaps in the real WebSocket transport behind the same `Transport` interface;
   nothing above it changes.

   BroadcastChannel is a same-origin BROADCAST bus (every instance with a given
   name hears every other instance's posts, but never its own). We build a
   point-to-point link on top of it:
     - a rendezvous channel `beacon:<room>` carries only the join handshake;
     - each accepted connection gets its OWN channel `beacon:<room>:c<cid>` that
       exactly two endpoints share (the host's server end + that one client),
       so it behaves like a private socket.
   Frames cross as JSON strings (encode on send / JSON.parse on receive) so this
   exercises the real wire path — unlike the in-process loopback, which passes
   objects by reference. The protocol round-trip vitest suite (MP0) proves those
   strings are wire-safe.

   Delivery is asynchronous (BroadcastChannel queues a task), so both ends buffer
   until they are wired up: a client buffers outbound frames until the server
   answers the handshake with `ready`; either end buffers inbound frames until
   its `onMessage` handler attaches (mirroring the loopback contract). This is
   client/host glue (a browser tab is one endpoint) — it lives in the engine
   layer, off the headless sim graph. GPL-3.0-or-later (see LICENSE). */

import type { NetMessage, Transport } from "../../shared/net/transport.js";

/** Control envelope on a per-connection channel (frames) or the rendezvous
 *  (connect). Kept tiny and distinct from protocol frames. */
type Envelope =
  | { k: "connect"; cid: string }
  | { k: "ready" }
  | { k: "frame"; data: string };

/** A short random connection id (host-namespaced channel suffix). Math.random
 *  is fine — this is a local-test channel name, not a security token (MP5's
 *  room codes carry the entropy). */
function randomCid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function channelName(roomCode: string, cid: string): string {
  return "beacon:" + roomCode + ":c" + cid;
}

/** One end of a per-connection channel as a {@link Transport}. `announceReady`
 *  is true for the SERVER end (it tells the client to flush its buffered
 *  sends); the client end waits for that signal before it sends. */
function makeEndpoint(name: string, announceReady: boolean): Transport {
  const ch = new BroadcastChannel(name);
  let open = true;
  let ready = announceReady; // the server is ready immediately; the client waits
  let handler: ((msg: NetMessage) => void) | null = null;
  const outBuf: NetMessage[] = [];
  const inBuf: NetMessage[] = [];

  const flushOut = (): void => {
    if (!ready) return;
    while (outBuf.length) ch.postMessage({ k: "frame", data: JSON.stringify(outBuf.shift()) } as Envelope);
  };

  ch.onmessage = (ev: MessageEvent): void => {
    const m = ev.data as Envelope;
    if (!m || !open) return;
    if (m.k === "ready") {
      ready = true;
      flushOut();
      return;
    }
    if (m.k === "frame") {
      let decoded: NetMessage;
      try {
        decoded = JSON.parse(m.data) as NetMessage;
      } catch {
        return; // a garbled frame never crashes the endpoint
      }
      if (handler) handler(decoded);
      else inBuf.push(decoded);
    }
  };

  // The server announces readiness so a client that connected first flushes.
  if (announceReady) ch.postMessage({ k: "ready" } as Envelope);

  return {
    send(msg: NetMessage): void {
      if (!open) return;
      if (ready) ch.postMessage({ k: "frame", data: JSON.stringify(msg) } as Envelope);
      else outBuf.push(msg);
    },
    onMessage(h: (msg: NetMessage) => void): void {
      handler = h;
      while (inBuf.length) h(inBuf.shift()!);
    },
    close(): void {
      open = false;
      ch.close();
    },
    get isOpen(): boolean {
      return open;
    },
  };
}

/** The server side of a room bus. Listens on the rendezvous channel and hands
 *  each new client a private {@link Transport} via `onConnection`. Returns a
 *  handle to stop listening. Existing connections stay open after `close()`. */
export interface BroadcastServer {
  close(): void;
}

export function openBroadcastServer(
  roomCode: string,
  onConnection: (transport: Transport, cid: string) => void,
): BroadcastServer {
  const rendezvous = new BroadcastChannel("beacon:" + roomCode);
  let open = true;
  const seen = new Set<string>();
  rendezvous.onmessage = (ev: MessageEvent): void => {
    const m = ev.data as Envelope;
    if (!open || !m || m.k !== "connect" || seen.has(m.cid)) return;
    seen.add(m.cid);
    // The server endpoint announces `ready`, so the client flushes its hello.
    onConnection(makeEndpoint(channelName(roomCode, m.cid), true), m.cid);
  };
  return {
    close(): void {
      open = false;
      rendezvous.close();
    },
  };
}

/** The client side: open a private channel, announce ourselves on the
 *  rendezvous, and return the {@link Transport}. Sends buffer until the server
 *  answers with `ready`. */
export function connectBroadcast(roomCode: string): Transport {
  const cid = randomCid();
  const endpoint = makeEndpoint(channelName(roomCode, cid), false);
  // Announce on the rendezvous AFTER our private channel is listening, so the
  // server's `ready` (and its first frames) can never arrive before we hear.
  const rendezvous = new BroadcastChannel("beacon:" + roomCode);
  rendezvous.postMessage({ k: "connect", cid } as Envelope);
  // The rendezvous is only for the initial connect; close it once we're linked.
  const inner = endpoint as Transport & { close(): void };
  const origClose = inner.close.bind(inner);
  inner.close = (): void => {
    origClose();
    rendezvous.close();
  };
  // Close the rendezvous shortly after connecting (best-effort; the private
  // channel carries everything from here). Kept open a beat in case the server
  // wasn't up yet and we need the connect to have landed.
  setTimeout(() => rendezvous.close(), 1000);
  return inner;
}
