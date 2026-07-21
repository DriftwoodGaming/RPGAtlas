/* RPGAtlas — src/engine/net/relay-dial.ts
   Project Beacon post-2.0 hotfix: dial a friend-room relay that may be EITHER
   server target. The Node target (server/src/node/ws-server.ts) upgrades a
   WebSocket on any path and creates with a codeless `join`; the Cloudflare
   Worker target (server/src/cf/worker.ts) can't — Durable Object routing needs
   the room code in the URL before the first frame — so it wants GET /new (mint
   a code) then WS /rt?code=…. 2.0.0 shipped only the Node dial, so the browser
   client couldn't reach a Workers relay at all: its bare-path upgrade got the
   Worker's HTTP 200 health answer and surfaced as "offline".

   The scheme is transport-agnostic, no probing: ALWAYS dial the Node style
   first (bare URL, codeless/coded join). If that socket fails BEFORE any
   server frame (refused, dropped, or a non-101 answer — the Worker's health
   page), fall back to the Worker contract: a CREATE fetches /new for a code,
   a JOIN uses the code the player typed; both then connect /rt?code=…. A
   server frame (welcome / error / kick) proves a real Beacon server — the
   caller calls settle() and every later socket-level event is ignored, so an
   in-session drop can never re-dial or double-report. Both dial styles failing
   at the socket level fires onOffline once (the friendly copy stays with the
   caller). connect/fetch are injectable, so the sequencing unit-tests in the
   fast pool; the real-socket proof lives in test:net (relay-cf-fallback).
   GPL-3.0-or-later (see LICENSE). */

import type { Transport } from "../../shared/net/transport.js";
import { connectSocket } from "./socket-transport.js";
import { cfRelayEndpoints } from "../../shared/net/relay-endpoints.js";
import { isCanonicalRoomCode } from "../../shared/net/room-code.js";

/** Socket-level failure handlers a dial attempt hands to its connector. */
export interface DialSocketHandlers {
  onClose: () => void;
  onError: () => void;
}

export interface RelayDialOptions {
  /** The configured relay URL (already validated by isAllowedRelayUrl). */
  url: string;
  /** Canonical room code to JOIN; undefined ⇒ CREATE a fresh room. */
  code?: string;
  /** Build the protocol client on a freshly-dialed wire. `code` is the join
   *  code for THIS attempt (the CF create fallback mints one mid-dial). */
  attach(transport: Transport, code: string | undefined): void;
  /** Close the previous attempt's client before the fallback re-dials. */
  teardown(): void;
  /** Every dial style failed at the socket level — show the offline copy. */
  onOffline(): void;
  /** Injectable connector (tests); default connectSocket. */
  connect?(url: string, h: DialSocketHandlers): Transport;
  /** Injectable GET-JSON (tests); default fetch + res.json(). */
  fetchJson?(url: string): Promise<unknown>;
}

export interface RelayDial {
  /** A server frame arrived (welcome / error / kick): the dial is decided;
   *  ignore every later socket-level event (no fallback, no offline copy). */
  settle(): void;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("relay-dial: " + url + " answered " + res.status);
  return res.json();
}

/** Dial the relay Node-style, falling back to the Worker contract (header). */
export function dialRelay(opts: RelayDialOptions): RelayDial {
  const connect =
    opts.connect || ((u: string, h: DialSocketHandlers): Transport => connectSocket(u, { onClose: h.onClose, onError: h.onError }));
  const fetchJson = opts.fetchJson || defaultFetchJson;
  let settled = false;
  const offline = (): void => { if (!settled) { settled = true; opts.onOffline(); } };

  // One attempt: a socket-level failure fires `onFail` exactly once (a dead
  // dial typically fires BOTH onerror and onclose).
  const attempt = (url: string, code: string | undefined, onFail: () => void): void => {
    let failed = false;
    const fail = (): void => { if (failed || settled) return; failed = true; onFail(); };
    let transport: Transport;
    try { transport = connect(url, { onClose: fail, onError: fail }); }
    catch { fail(); return; }
    opts.attach(transport, code);
  };

  // The Worker-contract fallback: tear down the dead Node-style attempt, then
  // mint (CREATE) or reuse (JOIN) the code and connect /rt?code=….
  const cfFallback = (): void => {
    if (settled) return;
    opts.teardown();
    const eps = cfRelayEndpoints(opts.url);
    if (!eps) { offline(); return; }
    if (opts.code !== undefined) { attempt(eps.rtUrl(opts.code), opts.code, offline); return; }
    fetchJson(eps.newUrl).then((body) => {
      if (settled) return;
      const minted = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
      if (typeof minted !== "string" || !isCanonicalRoomCode(minted)) { offline(); return; }
      attempt(eps.rtUrl(minted), minted, offline);
    }, offline);
  };

  attempt(opts.url, opts.code, cfFallback);
  return { settle: (): void => { settled = true; } };
}
