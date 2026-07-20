/* RPGAtlas — src/engine/net/socket-transport.ts
   Project Beacon MP5·C: a Transport over a real WebSocket — the wire the Beacon
   server (server/) speaks. It replaces MP4's BroadcastChannel stand-in behind
   the SAME `Transport` interface, so RelayClient / the room protocol are
   transport-agnostic; nothing above this changes between local co-op and a live
   relay.

   Frames cross as JSON strings (encode on send / decode on receive). Inbound
   frames are strictly decoded (decodeServerMessage) and an invalid one is
   dropped, never crashes the client — a browser must survive a buggy or
   malicious self-hosted server (protocol note). Buffering mirrors the loopback
   contract: outbound frames buffer until the socket opens; inbound frames buffer
   until `onMessage` attaches.

   The WebSocket constructor is injectable (default `globalThis.WebSocket`) so the
   whole client↔server path is testable headlessly in Node against the `ws`
   package — no browser required. Client/engine glue, off the sim graph.
   GPL-3.0-or-later (see LICENSE). */

import type { NetMessage, Transport } from "../../shared/net/transport.js";
import { decodeServerMessage } from "../../shared/net/protocol.js";

/** The minimal browser-WebSocket surface both `globalThis.WebSocket` and the
 *  Node `ws` package expose (both support the `on*` property setters). */
interface WsLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
type WsCtor = new (url: string) => WsLike;

export interface SocketTransportOptions {
  /** WebSocket constructor (default globalThis.WebSocket; tests pass `ws`). */
  WebSocketCtor?: WsCtor;
  /** Fired when the socket opens (the client may then send its handshake). */
  onOpen?: () => void;
  /** Fired when the socket closes (network drop / server close). */
  onClose?: (info: { code?: number; reason?: string }) => void;
  /** Fired on a socket error (connection refused, TLS failure, …). */
  onError?: (err: unknown) => void;
}

/** True for a relay URL a browser will accept: `wss://` always, or `ws://` only
 *  to a loopback host (dev). Off-loopback `ws://` is refused so a game can't be
 *  tricked into cleartext (roadmap: wss-only, D6). */
export function isAllowedRelayUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === "wss:") return true;
  if (u.protocol === "ws:") return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
  return false;
}

/** Open a WebSocket transport to `url`. Throws synchronously only on a bad/
 *  disallowed URL; connection failures surface via `onError`/`onClose`. */
export function connectSocket(url: string, opts: SocketTransportOptions = {}): Transport {
  if (!isAllowedRelayUrl(url)) throw new Error("socket-transport: refusing non-wss relay URL");
  const Ctor: WsCtor = opts.WebSocketCtor || (globalThis as unknown as { WebSocket: WsCtor }).WebSocket;
  const ws = new Ctor(url);
  let open = false;
  let closed = false;
  const outBuf: NetMessage[] = [];
  const inBuf: NetMessage[] = [];
  let handler: ((msg: NetMessage) => void) | null = null;

  ws.onopen = (): void => {
    open = true;
    while (outBuf.length) ws.send(JSON.stringify(outBuf.shift()));
    opts.onOpen?.();
  };
  ws.onmessage = (ev): void => {
    const r = decodeServerMessage(String(ev.data));
    if (!r.ok) return; // drop a malformed/malicious server frame; never crash
    if (handler) handler(r.msg);
    else inBuf.push(r.msg);
  };
  ws.onclose = (ev): void => { closed = true; open = false; opts.onClose?.(ev || {}); };
  ws.onerror = (err): void => { opts.onError?.(err); };

  return {
    send(msg: NetMessage): void {
      if (closed) return;
      if (open) ws.send(JSON.stringify(msg));
      else outBuf.push(msg);
    },
    onMessage(h: (msg: NetMessage) => void): void {
      handler = h;
      while (inBuf.length) h(inBuf.shift()!);
    },
    close(): void {
      if (closed) return;
      closed = true;
      open = false;
      try { ws.close(); } catch { /* already closing */ }
    },
    get isOpen(): boolean {
      return !closed;
    },
  };
}
