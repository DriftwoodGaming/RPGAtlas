/* RPGAtlas — src/shared/net/relay-endpoints.ts
   Project Beacon post-2.0 hotfix: the Cloudflare Worker target's client-facing
   endpoints, derived from a bare relay URL. The Node target upgrades a
   WebSocket on ANY path and creates with a codeless `join` — but a Workers
   deployment must route the upgrade to the right Durable Object, and it can
   only pick the DO from the URL, BEFORE the first frame. Hence its contract
   (server/src/cf/worker.ts):

     GET  http(s)://host/new         → { code }   mint a room code (a create)
     WS   ws(s)://host/rt?code=XXXX  → 101        connect to that room

   This module is the pure half: turn the configured relay URL into those two
   endpoints. Deciding WHEN to use them (the bare-connect-first fallback) is
   src/engine/net/relay-dial.ts. Pure — no DOM, no sockets — so it unit-tests
   in the fast vitest pool. GPL-3.0-or-later (see LICENSE). */

export interface CfRelayEndpoints {
  /** HTTP(S) GET that mints a fresh room code: answers `{ code }`. */
  newUrl: string;
  /** WS(S) URL that connects to the room with `code`. */
  rtUrl(code: string): string;
}

/** Derive the Worker-contract endpoints from a relay URL (`wss://…`, or a dev
 *  loopback `ws://…`). Any path on the base is kept (a relay can live behind a
 *  proxy prefix); a trailing slash is normalised away; query/hash are dropped
 *  (the Worker routes on the path alone). A non-WebSocket or unparseable URL
 *  returns null. */
export function cfRelayEndpoints(relayUrl: string): CfRelayEndpoints | null {
  let u: URL;
  try { u = new URL(relayUrl); } catch { return null; }
  if (u.protocol !== "wss:" && u.protocol !== "ws:") return null;
  const httpProto = u.protocol === "wss:" ? "https:" : "http:";
  const path = u.pathname.replace(/\/+$/, "");
  return {
    newUrl: httpProto + "//" + u.host + path + "/new",
    rtUrl: (code: string): string =>
      u.protocol + "//" + u.host + path + "/rt?code=" + encodeURIComponent(code),
  };
}
