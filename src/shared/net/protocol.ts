/* RPGAtlas — src/shared/net/protocol.ts
   Project Beacon wire protocol v1 (MP0·A). Every message that ever crosses
   client↔server is defined here as a versioned, typed union — JSON on the
   wire (binary/delta encoding is an MP8 optimization, measured not assumed).
   The decoders are strict structural validators: the server (MP5) feeds every
   inbound frame through decodeClientMessage and treats a null-result as
   hostile input, which is what makes the MP5·D fuzz gate honest. Loopback
   single-player (MP2) passes these same objects by reference — the round-trip
   vitest suite proves wire-safety independently so loopback can skip
   serialization without hiding a wire bug.
   Pure and DOM-free (vitest runs env=node; the sim core depends on this file).
   Forward compatibility: unknown EXTRA fields on a known message are accepted
   (additive evolution within a protocol version); unknown message types are
   rejected. PROTOCOL_VERSION bumps only on breaking shape changes — the
   hello/welcome handshake surfaces a mismatch as the friendly "This game needs
   a newer version" message (client copy, MP5·C).
   Player-facing identity note (D3/D6): a player is a server-assigned numeric
   id plus a display name — nothing else identifies them on the wire. Passport
   public keys (MP8) will arrive as additive optional fields.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import { isCanonicalRoomCode } from "./room-code";

/** Bumped only on breaking changes to message shapes. Additive optional
 *  fields do NOT bump this. */
export const PROTOCOL_VERSION = 1;

/* ── Limits (protocol-level; the transport additionally enforces true byte
      caps and per-message rate limits at MP5·D) ─────────────────────────── */

/** Ceiling on a single client→server frame. Client messages are small by
 *  design (the largest legal one is a shop-transcript reply); anything bigger
 *  is hostile or broken. Checked in UTF-16 units here — the socket layer
 *  enforces the true byte cap (MP5·D). */
export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;
/** Sanity ceiling on a server→client frame (snapshots are the big ones). */
export const MAX_SERVER_MESSAGE_BYTES = 4 * 1024 * 1024;
/** Display-name length cap (grapheme-naive; server may trim further). */
export const MAX_NAME_LEN = 24;
/** Free-text / preset-say chat length cap (D4 also rate-limits). */
export const MAX_CHAT_LEN = 200;
/** Emote-id length cap. */
export const MAX_EMOTE_LEN = 32;
/** Name-input directive replies (actor renames) may exceed display-name len. */
export const MAX_NAME_INPUT_LEN = 64;
/** Cap on one shop session's transaction log. */
export const MAX_SHOP_TRANSACTIONS = 200;

/* ── Shared shapes ─────────────────────────────────────────────────────── */

/** Cardinal facing/step direction, as the sim consumes it. */
export type Dir = "up" | "down" | "left" | "right";

/** Server-assigned per-room player id (small nonneg integer). Never reused
 *  within a room's lifetime. */
export type PlayerId = number;

/** Anything JSON.stringify/parse round-trips losslessly. Snapshot and delta
 *  payloads are typed as this at MP0; MP1/MP2 pin them to the world-state
 *  shape (the save-payload machinery doubles as join-sync per the roadmap). */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/* ── Input intents (client → world) ────────────────────────────────────── */

/** One player input, as an intent — the client never asserts state, it asks.
 *  Tile-grid movement: one `move` per attempted step (hold-to-walk repeats
 *  it); the client may predict the step locally and reconcile via
 *  {@link ServerDelta.ack} (MP2 leaves the seam, prediction lands with real
 *  latency). */
export type InputIntent =
  | { k: "move"; dir: Dir; run?: boolean }
  | { k: "face"; dir: Dir }
  /** Interact/confirm at the tile the player faces (action button). */
  | { k: "act" };

/* ── Presentation directives (world → one player's UI) and replies ─────────
   The modal-event seam (MP3): a server-side event command that needs a
   player's screen emits a directive, suspends, and resumes on the matching
   reply. Shapes live here so MP3 compiles against the wire truth; semantics
   (lifecycle, timeouts, who receives what) are specified in docs/mp-0-spec.md
   stage C. Waits are NOT directives — they are world-tick timers. */

export type MessageDirective = {
  kind: "message";
  text: string;
  /** Speaker name / portrait / box position mirror Show Message options. */
  speaker?: string;
  portrait?: string;
  pos?: "top" | "middle" | "bottom";
};
export type ChoicesDirective = {
  kind: "choices";
  options: string[];
  prompt?: string;
  /** When set, cancel is allowed and replies may be `{ canceled: true }`. */
  cancelable?: boolean;
};
export type NumberInputDirective = { kind: "numberInput"; digits: number; initial?: number };
export type NameInputDirective = { kind: "nameInput"; maxLen: number; initial?: string; actorId?: number };
export type ShopDirective = {
  kind: "shop";
  goods: ShopGood[];
  buyOnly?: boolean;
  /** Multi-currency wallet id; omitted = currency 1 (gold). */
  currencyId?: number;
};
export type ShopGood = { itemType: "item" | "weapon" | "armor"; id: number; price: number };

export type Directive =
  | MessageDirective
  | ChoicesDirective
  | NumberInputDirective
  | NameInputDirective
  | ShopDirective;

/** One buy/sell line in a shop session's reply transcript. The server
 *  re-validates every line against authoritative stock/wallet/inventory
 *  before applying — the client's shop UI is presentation, not authority. */
export type ShopTransaction = {
  op: "buy" | "sell";
  itemType: "item" | "weapon" | "armor";
  id: number;
  count: number;
};

/** The player's answer to a directive, tagged with the directive kind so the
 *  shape validates standalone; the awaiting interpreter additionally checks
 *  the kind matches the directive it issued (MP3). */
export type DirectiveReplyValue =
  | { kind: "message"; done: true }
  | { kind: "choices"; choice: number }
  | { kind: "choices"; canceled: true }
  | { kind: "numberInput"; value: number }
  | { kind: "nameInput"; value: string }
  | { kind: "shop"; transactions: ShopTransaction[] };

/* ── Client → server messages ──────────────────────────────────────────── */

/** First frame on any connection: protocol handshake + display name. */
export type ClientHello = { t: "hello"; proto: number; name: string };
/** Join a room by code, or — with `code` omitted — create a fresh room and
 *  become its owner. `code` must be canonical (client normalizes user typing
 *  via normalizeRoomCode before sending). */
export type ClientJoin = { t: "join"; code?: string };
/** Reconnect to a room with the resume token issued in `welcome`. */
export type ClientResume = { t: "resume"; code: string; token: string };
/** One input intent; `seq` increases monotonically per connection and is
 *  echoed back in {@link ServerDelta.ack} for prediction reconciliation. */
export type ClientInput = { t: "input"; seq: number; intent: InputIntent };
/** Answer to the directive with matching `id`. */
export type ClientReply = { t: "reply"; id: number; value: DirectiveReplyValue };
/** Emote bubble (always available, D4). */
export type ClientEmote = { t: "emote"; emote: string };
/** Say something: exactly one of `preset` (index into the game's dev-authored
 *  preset phrases — always available) or `text` (free text — only when the
 *  game's dev opted in, D4; server rejects otherwise with "chat-disabled"). */
export type ClientChat = { t: "chat"; text?: string; preset?: number };

export type ClientMessage =
  | ClientHello
  | ClientJoin
  | ClientResume
  | ClientInput
  | ClientReply
  | ClientEmote
  | ClientChat;

/* ── Server → client messages ──────────────────────────────────────────── */

/** Handshake + room admission succeeded. A full `snapshot` follows
 *  immediately; `resumeToken` is a per-session secret for `resume`. */
export type ServerWelcome = {
  t: "welcome";
  proto: number;
  playerId: PlayerId;
  roomCode: string;
  resumeToken: string;
  tick: number;
};
/** Complete world state at `tick` (join-sync, reconnect-resync — the
 *  save-payload machinery, per the roadmap). */
export type ServerSnapshot = { t: "snapshot"; tick: number; world: JsonValue };
/** Incremental world change since the previous delta/snapshot. `ack` is the
 *  highest input `seq` from THIS client the world had processed by `tick`. */
export type ServerDelta = { t: "delta"; tick: number; ack?: number; changes: JsonValue };
/** A modal presentation request for this player; answer with `reply` id. */
export type ServerDirective = { t: "directive"; id: number; directive: Directive };
/** Player-social event in the room. D6 audit surface: name and the social
 *  payload below are the ONLY per-player facts that ever cross the wire
 *  (entity state travels in snapshot/delta). `join` carries `name`; `emote`
 *  carries `emote`; `say` carries `text` (pre-filtered server-side) or
 *  `preset`; `leave` carries nothing extra. */
export type ServerPresence = {
  t: "presence";
  tick: number;
  kind: "join" | "leave" | "emote" | "say";
  playerId: PlayerId;
  name?: string;
  emote?: string;
  text?: string;
  preset?: number;
};
/** Connection is being closed deliberately; `code` picks the friendly client
 *  copy (room owner kicked you / room closed / idle timeout / banned). */
export type ServerKick = { t: "kick"; code: "kicked" | "banned" | "room-closed" | "idle"; detail?: string };
/** Request failed. `code` picks localized, plain-language client copy
 *  (audience-beginners rule — a kid reads "Couldn't find that room — check
 *  the code and try again", never `detail`, which is for dev consoles/logs). */
export type ServerError = { t: "error"; code: ErrorCode; fatal?: boolean; detail?: string };

export type ErrorCode =
  | "proto-mismatch"
  | "bad-code"
  | "room-not-found"
  | "room-full"
  | "not-in-room"
  | "already-in-room"
  | "chat-disabled"
  | "rate-limited"
  | "malformed"
  | "internal";

export type ServerMessage =
  | ServerWelcome
  | ServerSnapshot
  | ServerDelta
  | ServerDirective
  | ServerPresence
  | ServerKick
  | ServerError;

/* ── Codec ─────────────────────────────────────────────────────────────── */

/** Encode a message for the wire. Plain JSON by design (v1). */
export function encodeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

/** Decode outcome: either a structurally valid message or a reason string.
 *  Reasons are developer-facing (server logs, fuzz-test assertions) — they
 *  are never shown to players. */
export type DecodeResult<T> = { ok: true; msg: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isUint = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;
/** Non-empty string with no control characters, within `max` length. */
const isText = (v: unknown, max: number): v is string =>
  // eslint-disable-next-line no-control-regex
  typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const isDir = (v: unknown): v is Dir =>
  v === "up" || v === "down" || v === "left" || v === "right";
const isResumeToken = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(v);
const isItemType = (v: unknown): v is "item" | "weapon" | "armor" =>
  v === "item" || v === "weapon" || v === "armor";

/** Returns an error string, or null when `v` is a valid intent. */
function checkIntent(v: unknown): string | null {
  if (!isObj(v)) return "intent must be an object";
  switch (v.k) {
    case "move":
      if (!isDir(v.dir)) return "move: bad dir";
      if (v.run !== undefined && typeof v.run !== "boolean") return "move: bad run flag";
      return null;
    case "face":
      return isDir(v.dir) ? null : "face: bad dir";
    case "act":
      return null;
    default:
      return "unknown intent kind";
  }
}

function checkReplyValue(v: unknown): string | null {
  if (!isObj(v)) return "reply value must be an object";
  switch (v.kind) {
    case "message":
      return v.done === true ? null : "message reply: done must be true";
    case "choices":
      if (v.canceled === true) return "choice" in v ? "choices reply: canceled excludes choice" : null;
      return isUint(v.choice) ? null : "choices reply: bad choice index";
    case "numberInput":
      return isUint(v.value) ? null : "numberInput reply: bad value";
    case "nameInput":
      return typeof v.value === "string" && v.value.length <= MAX_NAME_INPUT_LEN
        ? null
        : "nameInput reply: bad value";
    case "shop": {
      const txs = v.transactions;
      if (!Array.isArray(txs)) return "shop reply: transactions must be an array";
      if (txs.length > MAX_SHOP_TRANSACTIONS) return "shop reply: too many transactions";
      for (const tx of txs) {
        if (!isObj(tx)) return "shop reply: bad transaction";
        if (tx.op !== "buy" && tx.op !== "sell") return "shop reply: bad op";
        if (!isItemType(tx.itemType)) return "shop reply: bad itemType";
        if (!isUint(tx.id)) return "shop reply: bad id";
        if (!isUint(tx.count) || tx.count === 0) return "shop reply: bad count";
      }
      return null;
    }
    default:
      return "unknown reply kind";
  }
}

function checkDirective(v: unknown): string | null {
  if (!isObj(v)) return "directive must be an object";
  switch (v.kind) {
    case "message":
      if (typeof v.text !== "string") return "message: bad text";
      if (v.pos !== undefined && v.pos !== "top" && v.pos !== "middle" && v.pos !== "bottom")
        return "message: bad pos";
      return null;
    case "choices":
      if (!Array.isArray(v.options) || v.options.length === 0) return "choices: bad options";
      for (const o of v.options) if (typeof o !== "string") return "choices: bad option";
      return null;
    case "numberInput":
      return isUint(v.digits) && v.digits > 0 ? null : "numberInput: bad digits";
    case "nameInput":
      return isUint(v.maxLen) && v.maxLen > 0 ? null : "nameInput: bad maxLen";
    case "shop": {
      if (!Array.isArray(v.goods)) return "shop: goods must be an array";
      for (const g of v.goods) {
        if (!isObj(g) || !isItemType(g.itemType) || !isUint(g.id) || !isUint(g.price))
          return "shop: bad good";
      }
      return null;
    }
    default:
      return "unknown directive kind";
  }
}

const KICK_CODES = ["kicked", "banned", "room-closed", "idle"] as const;
const ERROR_CODES: readonly ErrorCode[] = [
  "proto-mismatch",
  "bad-code",
  "room-not-found",
  "room-full",
  "not-in-room",
  "already-in-room",
  "chat-disabled",
  "rate-limited",
  "malformed",
  "internal",
];
const PRESENCE_KINDS = ["join", "leave", "emote", "say"] as const;

function parseRoot(text: string, cap: number): DecodeResult<Record<string, unknown>> {
  if (text.length > cap) return fail("message too large");
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return fail("not JSON");
  }
  if (!isObj(root)) return fail("root must be an object");
  if (typeof root.t !== "string") return fail("missing message type");
  return { ok: true, msg: root };
}

/** Strict-validate one client→server frame. The server treats a failure as
 *  hostile/broken input (count it, answer `malformed`, never crash — MP5·D). */
export function decodeClientMessage(text: string): DecodeResult<ClientMessage> {
  const r = parseRoot(text, MAX_CLIENT_MESSAGE_BYTES);
  if (!r.ok) return r;
  const m = r.msg;
  switch (m.t) {
    case "hello":
      if (!isUint(m.proto)) return fail("hello: bad proto");
      if (!isText(m.name, MAX_NAME_LEN)) return fail("hello: bad name");
      break;
    case "join":
      if (m.code !== undefined && !(typeof m.code === "string" && isCanonicalRoomCode(m.code)))
        return fail("join: bad code");
      break;
    case "resume":
      if (typeof m.code !== "string" || !isCanonicalRoomCode(m.code)) return fail("resume: bad code");
      if (!isResumeToken(m.token)) return fail("resume: bad token");
      break;
    case "input": {
      if (!isUint(m.seq)) return fail("input: bad seq");
      const err = checkIntent(m.intent);
      if (err) return fail(`input: ${err}`);
      break;
    }
    case "reply": {
      if (!isUint(m.id)) return fail("reply: bad id");
      const err = checkReplyValue(m.value);
      if (err) return fail(`reply: ${err}`);
      break;
    }
    case "emote":
      if (!isText(m.emote, MAX_EMOTE_LEN)) return fail("emote: bad emote");
      break;
    case "chat": {
      const hasText = m.text !== undefined;
      const hasPreset = m.preset !== undefined;
      if (hasText === hasPreset) return fail("chat: exactly one of text/preset");
      if (hasText && !isText(m.text, MAX_CHAT_LEN)) return fail("chat: bad text");
      if (hasPreset && !isUint(m.preset)) return fail("chat: bad preset");
      break;
    }
    default:
      return fail(`unknown client message type "${m.t}"`);
  }
  return { ok: true, msg: m as unknown as ClientMessage };
}

/** Strict-validate one server→client frame (clients validate too — a client
 *  must survive a buggy or malicious self-hosted server without crashing). */
export function decodeServerMessage(text: string): DecodeResult<ServerMessage> {
  const r = parseRoot(text, MAX_SERVER_MESSAGE_BYTES);
  if (!r.ok) return r;
  const m = r.msg;
  switch (m.t) {
    case "welcome":
      if (!isUint(m.proto)) return fail("welcome: bad proto");
      if (!isUint(m.playerId)) return fail("welcome: bad playerId");
      if (typeof m.roomCode !== "string" || !isCanonicalRoomCode(m.roomCode))
        return fail("welcome: bad roomCode");
      if (!isResumeToken(m.resumeToken)) return fail("welcome: bad resumeToken");
      if (!isUint(m.tick)) return fail("welcome: bad tick");
      break;
    case "snapshot":
      if (!isUint(m.tick)) return fail("snapshot: bad tick");
      if (!("world" in m)) return fail("snapshot: missing world");
      break;
    case "delta":
      if (!isUint(m.tick)) return fail("delta: bad tick");
      if (m.ack !== undefined && !isUint(m.ack)) return fail("delta: bad ack");
      if (!("changes" in m)) return fail("delta: missing changes");
      break;
    case "directive": {
      if (!isUint(m.id)) return fail("directive: bad id");
      const err = checkDirective(m.directive);
      if (err) return fail(`directive: ${err}`);
      break;
    }
    case "presence":
      if (!isUint(m.tick)) return fail("presence: bad tick");
      if (!PRESENCE_KINDS.includes(m.kind as (typeof PRESENCE_KINDS)[number]))
        return fail("presence: bad kind");
      if (!isUint(m.playerId)) return fail("presence: bad playerId");
      if (m.kind === "join" && !isText(m.name, MAX_NAME_LEN)) return fail("presence: join needs name");
      if (m.kind === "emote" && !isText(m.emote, MAX_EMOTE_LEN)) return fail("presence: emote needs emote");
      if (m.kind === "say") {
        const hasText = m.text !== undefined;
        const hasPreset = m.preset !== undefined;
        if (hasText === hasPreset) return fail("presence: say needs exactly one of text/preset");
        if (hasText && !isText(m.text, MAX_CHAT_LEN)) return fail("presence: bad text");
        if (hasPreset && !isUint(m.preset)) return fail("presence: bad preset");
      }
      break;
    case "kick":
      if (!KICK_CODES.includes(m.code as (typeof KICK_CODES)[number])) return fail("kick: bad code");
      break;
    case "error":
      if (!ERROR_CODES.includes(m.code as ErrorCode)) return fail("error: bad code");
      if (m.fatal !== undefined && typeof m.fatal !== "boolean") return fail("error: bad fatal");
      break;
    default:
      return fail(`unknown server message type "${m.t}"`);
  }
  return { ok: true, msg: m as unknown as ServerMessage };
}
