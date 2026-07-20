/* RPGAtlas — server/src/core/connection.ts
   Project Beacon MP5·A: the transport-agnostic connection seam for the Beacon
   server core. One `ServerConnection` is one client link, wrapped by a target
   adapter — the Node `ws` socket (server/src/node) or the Cloudflare Durable
   Object hibernation WebSocket (server/src/cf). The core (BeaconServer /
   BeaconRoom) speaks only this interface, so the SAME room logic runs on both
   targets — the whole point of MP5's "one core, two targets".

   Frames cross as strings (the protocol is JSON on the wire, v1); the core
   decodes inbound text through `decodeClientMessage` and treats a failure as
   hostile input (never trusts, never crashes — the MP5·D fuzz gate). GPL-3.0. */

/** One client link as the server core sees it. Adapters implement this over a
 *  real socket. `source` is a coarse remote-origin bucket (IP or equivalent)
 *  used ONLY for abuse rate-limiting — it is never stored past the connection
 *  and never crosses the wire to any player (roadmap D6: no player learns
 *  another's IP; the relay retains it transiently for rate-limiting only). */
export interface ServerConnection {
  /** Process-unique connection id (adapter-assigned). */
  readonly id: number;
  /** Remote-origin bucket for rate limiting (e.g. IP). Transient, never shared. */
  readonly source: string;
  /** Send one already-encoded frame (a JSON string). No-op after close. */
  send(text: string): void;
  /** Close the link. `code`/`reason` are transport-level; a player-facing
   *  reason is a protocol `kick`/`error` frame sent BEFORE this. Idempotent. */
  close(code?: number, reason?: string): void;
  /** True until closed. */
  readonly isOpen: boolean;
  /** Register the handler for inbound frames (raw, undecoded text). The core
   *  attaches this in `accept`; the adapter forwards each socket message to it. */
  onMessage(handler: (text: string) => void): void;
  /** Register the close handler (either side dropped the link). */
  onClose(handler: () => void): void;
}
