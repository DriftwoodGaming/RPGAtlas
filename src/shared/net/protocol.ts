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
   public keys (MP8·A) arrive as the additive optional `pub`/`sig` fields on
   `hello`, answered to a world server's `challenge` — friend rooms never send
   a challenge and stay fully anonymous (D3). A passport public key is a
   device-local keypair's public half (no PII by construction, see
   src/shared/net/passport.ts).
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
/** Player-party size cap (MP6·A — a social group of players, not `G.party`). */
export const MAX_PARTY_MEMBERS = 4;
/** Total battlers in one shared battle (each participant brings
 *  `max(1, floor(8 / participants))`, trigger-first — MP6·A A-4). */
export const MAX_BATTLE_BATTLERS = 8;
/** Battlers one participant may contribute in a `battleJoin` reply. */
export const MAX_LOADOUT_BATTLERS = 4;
/** States carried on one battler loadout entry. */
export const MAX_LOADOUT_STATES = 32;

/* ── Shared shapes ─────────────────────────────────────────────────────── */

/** Cardinal facing/step direction, as the sim consumes it. */
export type Dir = "up" | "down" | "left" | "right";

/** The engine's numeric grid direction id (the map runtime's `DIRD` keys):
 *  0=down, 1=left, 2=right, 3=up, then the diagonals 4=down-left, 5=down-right,
 *  6=up-left, 7=up-right. Carried additively on a `move` intent as `dir8` so
 *  eight-direction movement survives the wire; a 4-direction network peer omits
 *  it and the world reads the cardinal `dir` instead. */
export type GridDir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Equipment slot selector for the `equip` menu-verb intent (§C5). */
export type EquipSlot = "weapon" | "weapon2" | "armor";

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
 *  latency).
 *
 *  MP2·B additive intents (protocol v1 unchanged — new `k` values + one
 *  optional field): `attack` is the action-RPG melee (a world write, routed
 *  live over the loopback transport). The menu verbs `useItem`/`equip`/
 *  `formation` are §C5 world writes; their wire shapes are DEFINED here now so
 *  MP4/MP5 compile against them, and are routed live once the world-side verb
 *  API is extracted (see docs/mp-2-spec.md §B — the menus still call the
 *  in-process helpers directly in loopback, which is the same process as the
 *  host, so nothing behaves differently yet). */
export type InputIntent =
  | { k: "move"; dir: Dir; run?: boolean; dir8?: GridDir }
  | { k: "face"; dir: Dir }
  /** Interact/confirm at the tile the player faces (action button). */
  | { k: "act" }
  /** Action-RPG melee swing (the `attack` action button). */
  | { k: "attack" }
  /** Field-use a consumable `item` on a party member (`target` = actor id;
   *  omitted for whole-party / no-target items). §C5, defined at MP2·B. */
  | { k: "useItem"; id: number; target?: number }
  /** Equip `id` (0 = remove) into `slot` of party actor `actor`. §C5. */
  | { k: "equip"; actor: number; slot: EquipSlot; id: number }
  /** Swap two party positions (formation). §C5. */
  | { k: "formation"; from: number; to: number }
  /** Invite another player to team up (MP6·A A-1). The world validates and
   *  emits a `choices` directive to the target; accepting joins the party. */
  | { k: "partyInvite"; target: PlayerId }
  /** Leave the current player-party (MP6·A). */
  | { k: "partyLeave" };

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
  /** Window backdrop (RM 101 background) — added at MP3·A when the Show
   *  Message conversion surfaced it (additive optional field, no version
   *  bump). Omitted = "window". */
  background?: "window" | "dim" | "transparent";
};

/** RM 101 stores position/background as 0/1/2; the wire uses the names above
 *  (kid-readable JSON). Index with the numeric command value to emit, and
 *  `indexOf` (or the reverse tables the client builds) to render. */
export const MESSAGE_POS_NAMES = ["top", "middle", "bottom"] as const;
export const MESSAGE_BG_NAMES = ["window", "dim", "transparent"] as const;
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
/** Select Item (RM 104) — the player picks one owned item; the reply carries
 *  the chosen id (0 = nothing chosen / canceled). Added at MP3·B (D-A4)
 *  following the D-A1 additive pattern — a new directive kind, no version bump
 *  (see docs/mp-3-spec.md D-B1). `itemType` is RM's category number; Atlas has
 *  one item bag and picks a regular item regardless, so it rides the wire
 *  informational (reserved for a future weapon/armor picker). */
export type SelectItemDirective = { kind: "selectItem"; itemType?: number };
/** Show Scrolling Text (RM 105) — a full-screen credits-style scroll the
 *  player can speed up (hold OK) or skip (Cancel). Modal like Show Message: it
 *  suspends the interpreter and the reply is a completion ack. Added at MP3·B
 *  (D-B2). `speed` 1–8 (omitted = 2); `noFast` disables the hold-OK speed-up. */
export type ScrollTextDirective = { kind: "scrollText"; text: string; speed?: number; noFast?: boolean };

/* ── Co-op battle shapes (MP6·A) ─────────────────────────────────────────
   Shared battles run on the world authority; participants contribute their
   OWN party (D-6-1 per-player parties) as a compact loadout — everything
   else (stats, traits, skills) derives from the SHARED project via
   actorId + level + equips, and the authority clamps hp/mp to the derived
   maxima. New directive kinds follow the MP3·B additive precedent (no
   protocol version bump, docs/mp-6-spec.md D-6-3). */

/** One battler as a participant contributes it to a shared battle. */
export type BattlerLoadout = {
  actorId: number;
  level: number;
  hp: number;
  mp: number;
  tp?: number;
  weaponId?: number;
  weapon2Id?: number;
  armorId?: number;
  row?: "front" | "back";
  states?: { id: number; turns: number }[];
};

/** The world asks a partied, proximate player to enter a shared battle.
 *  Auto-answered by the client with its party loadout — being partied IS the
 *  consent (A-3/A-4); an empty `party` reply sits the battle out. */
export type BattleJoinDirective = { kind: "battleJoin"; troopId: number; from: string };

/** One of this participant's own battlers, as a command round shows it. */
export type BattleAllyView = {
  /** Index into the shared battle's merged battler list (stable per battle). */
  idx: number;
  name: string;
  hp: number;
  mhp: number;
  mp: number;
  mmp: number;
  tp?: number;
  states: number[];
  skills: { id: number; name: string; mpCost: number; tpCost?: number; usable: boolean }[];
  /** False = stunned etc.: the battler is shown but collects no command. */
  canAct: boolean;
};
export type BattleEnemyView = { i: number; name: string; hp: number; mhp: number; alive: boolean };
export type BattleOtherView = { name: string; hp: number; mhp: number };

/** One command round for one participant: pick one action per entry of
 *  `yours`, in order. AFK timeout answers the escape value (all-guard). */
export type BattleCmdDirective = {
  kind: "battleCmd";
  round: number;
  canEscape: boolean;
  yours: BattleAllyView[];
  allies: BattleOtherView[];
  enemies: BattleEnemyView[];
};

/** One battler's chosen action. `enemy` = a BattleEnemyView.i; `ally` = a
 *  merged battler idx. The authority re-validates against live battle state
 *  (stale targets retarget; unusable skills fall back to guard). */
export type BattleActionCmd =
  | { type: "attack"; enemy: number }
  | { type: "skill"; id: number; enemy?: number; ally?: number }
  | { type: "item"; id: number; ally?: number }
  | { type: "guard" }
  | { type: "escape" };

export type Directive =
  | MessageDirective
  | ChoicesDirective
  | NumberInputDirective
  | NameInputDirective
  | ShopDirective
  | SelectItemDirective
  | ScrollTextDirective
  | BattleJoinDirective
  | BattleCmdDirective;

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
  | { kind: "shop"; transactions: ShopTransaction[] }
  | { kind: "selectItem"; id: number }
  | { kind: "scrollText"; done: true }
  | { kind: "battleJoin"; party: BattlerLoadout[] }
  | { kind: "battleCmd"; cmds: BattleActionCmd[] };

/* ── Client → server messages ──────────────────────────────────────────── */

/** First frame on any connection: protocol handshake + display name.
 *  MP8·A additive passport fields (world servers only): `pub` is the client's
 *  passport public key (raw P-256 point, base64url) and `sig` its ECDSA-SHA256
 *  signature over the server's `challenge` nonce (domain-separated — see
 *  passport.ts signChallenge). A friend-room relay sends no challenge and
 *  ignores both fields; a world server requires them (else `auth-failed`). */
export type ClientHello = { t: "hello"; proto: number; name: string; pub?: string; sig?: string };
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
/** Plugin custom message (Beacon MP7·C — the additive net surface, the 2.0
 *  plugin-API unfreeze). `data` is an opaque JsonValue the engine NEVER
 *  interprets — only the game's own plugins do (atlas.mp.sendCustom /
 *  onCustom). Relayed to the room like emote/chat (communication tier, not
 *  world sim), so it works over both the local co-op bus and the relay. Size is
 *  bounded by the client frame byte cap; rate-limited by the message bucket. */
export type ClientCustom = { t: "custom"; data: JsonValue };

export type ClientMessage =
  | ClientHello
  | ClientJoin
  | ClientResume
  | ClientInput
  | ClientReply
  | ClientEmote
  | ClientChat
  | ClientCustom;

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
 *  copy (room owner kicked you / room closed / idle timeout / banned).
 *  MP8·A adds `replaced` (world servers: the same passport signed in from a
 *  new connection, which supersedes this one — additive within v1). */
export type ServerKick = { t: "kick"; code: "kicked" | "banned" | "room-closed" | "idle" | "replaced"; detail?: string };
/** Request failed. `code` picks localized, plain-language client copy
 *  (audience-beginners rule — a kid reads "Couldn't find that room — check
 *  the code and try again", never `detail`, which is for dev consoles/logs). */
export type ServerError = { t: "error"; code: ErrorCode; fatal?: boolean; detail?: string };
/** A plugin custom message relayed from another player in the room (Beacon
 *  MP7·C). `from` is the sender's player id; `data` is their opaque payload.
 *  Only the game's plugins interpret `data`. */
export type ServerCustom = { t: "custom"; from: PlayerId; data: JsonValue };
/** MP8·A (world servers only): sent immediately on connect, BEFORE the client's
 *  `hello`. The client answers by signing `nonce` with its passport key and
 *  carrying `pub`+`sig` on the hello. Friend-room relays never send this —
 *  a client that never receives a challenge sends the classic anonymous hello. */
export type ServerChallenge = { t: "challenge"; nonce: string };
/** MP8·A cross-zone handoff for socket-per-zone targets (the Cloudflare DO
 *  world, stage B): the player's map transfer lands in a zone hosted by a
 *  DIFFERENT socket endpoint, so the server tells the client to reconnect —
 *  `resume` with `token` at `url` (absent = same endpoint, new zone picks up
 *  the session). The Node gateway target transfers zones server-side and sends
 *  a fresh `snapshot` instead (no handoff frame, the socket never moves). */
export type ServerHandoff = { t: "handoff"; mapId: number; token: string; url?: string };

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
  | "auth-failed"
  | "internal";

export type ServerMessage =
  | ServerWelcome
  | ServerSnapshot
  | ServerDelta
  | ServerDirective
  | ServerPresence
  | ServerKick
  | ServerError
  | ServerCustom
  | ServerChallenge
  | ServerHandoff;

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
/** base64url text within [min, max] chars (passport pub/sig, challenge nonce). */
const isB64url = (v: unknown, min: number, max: number): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max && /^[A-Za-z0-9_-]+$/.test(v);
const isItemType = (v: unknown): v is "item" | "weapon" | "armor" =>
  v === "item" || v === "weapon" || v === "armor";

const isGridDir = (v: unknown): v is GridDir =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 7;
const isEquipSlot = (v: unknown): v is EquipSlot =>
  v === "weapon" || v === "weapon2" || v === "armor";

/** Returns an error string, or null when `v` is a valid intent. */
function checkIntent(v: unknown): string | null {
  if (!isObj(v)) return "intent must be an object";
  switch (v.k) {
    case "move":
      if (!isDir(v.dir)) return "move: bad dir";
      if (v.run !== undefined && typeof v.run !== "boolean") return "move: bad run flag";
      if (v.dir8 !== undefined && !isGridDir(v.dir8)) return "move: bad dir8";
      return null;
    case "face":
      return isDir(v.dir) ? null : "face: bad dir";
    case "act":
      return null;
    case "attack":
      return null;
    case "useItem":
      if (!isUint(v.id)) return "useItem: bad id";
      if (v.target !== undefined && !isUint(v.target)) return "useItem: bad target";
      return null;
    case "equip":
      if (!isUint(v.actor)) return "equip: bad actor";
      if (!isEquipSlot(v.slot)) return "equip: bad slot";
      if (!isUint(v.id)) return "equip: bad id"; // 0 = remove
      return null;
    case "formation":
      if (!isUint(v.from)) return "formation: bad from";
      if (!isUint(v.to)) return "formation: bad to";
      return null;
    case "partyInvite":
      return isUint(v.target) ? null : "partyInvite: bad target";
    case "partyLeave":
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
    case "selectItem":
      return isUint(v.id) ? null : "selectItem reply: bad id";
    case "scrollText":
      return v.done === true ? null : "scrollText reply: done must be true";
    case "battleJoin":
      return checkLoadouts(v.party);
    case "battleCmd":
      return checkBattleCmds(v.cmds);
    default:
      return "unknown reply kind";
  }
}

/** Structural check of a `battleJoin` reply's loadout list (MP6·A). */
function checkLoadouts(party: unknown): string | null {
  if (!Array.isArray(party)) return "battleJoin reply: party must be an array";
  if (party.length > MAX_LOADOUT_BATTLERS) return "battleJoin reply: too many battlers";
  for (const b of party) {
    if (!isObj(b)) return "battleJoin reply: bad battler";
    if (!isUint(b.actorId) || b.actorId === 0) return "battleJoin reply: bad actorId";
    if (!isUint(b.level) || b.level === 0 || b.level > 99) return "battleJoin reply: bad level";
    if (!isUint(b.hp)) return "battleJoin reply: bad hp";
    if (!isUint(b.mp)) return "battleJoin reply: bad mp";
    if (b.tp !== undefined && !isUint(b.tp)) return "battleJoin reply: bad tp";
    for (const k of ["weaponId", "weapon2Id", "armorId"] as const)
      if (b[k] !== undefined && !isUint(b[k])) return `battleJoin reply: bad ${k}`;
    if (b.row !== undefined && b.row !== "front" && b.row !== "back")
      return "battleJoin reply: bad row";
    if (b.states !== undefined) {
      if (!Array.isArray(b.states)) return "battleJoin reply: bad states";
      if (b.states.length > MAX_LOADOUT_STATES) return "battleJoin reply: too many states";
      for (const st of b.states)
        if (!isObj(st) || !isUint(st.id) || !isUint(st.turns))
          return "battleJoin reply: bad state entry";
    }
  }
  return null;
}

/** Structural check of a `battleCmd` reply's command list (MP6·A). */
function checkBattleCmds(cmds: unknown): string | null {
  if (!Array.isArray(cmds)) return "battleCmd reply: cmds must be an array";
  if (cmds.length > MAX_BATTLE_BATTLERS) return "battleCmd reply: too many cmds";
  for (const c of cmds) {
    if (!isObj(c)) return "battleCmd reply: bad cmd";
    switch (c.type) {
      case "attack":
        if (!isUint(c.enemy)) return "battleCmd reply: attack needs enemy";
        break;
      case "skill":
        if (!isUint(c.id)) return "battleCmd reply: skill needs id";
        if (c.enemy !== undefined && !isUint(c.enemy)) return "battleCmd reply: bad enemy";
        if (c.ally !== undefined && !isUint(c.ally)) return "battleCmd reply: bad ally";
        break;
      case "item":
        if (!isUint(c.id)) return "battleCmd reply: item needs id";
        if (c.ally !== undefined && !isUint(c.ally)) return "battleCmd reply: bad ally";
        break;
      case "guard":
      case "escape":
        break;
      default:
        return "battleCmd reply: unknown cmd type";
    }
  }
  return null;
}

function checkDirective(v: unknown): string | null {
  if (!isObj(v)) return "directive must be an object";
  switch (v.kind) {
    case "message":
      if (typeof v.text !== "string") return "message: bad text";
      if (v.pos !== undefined && v.pos !== "top" && v.pos !== "middle" && v.pos !== "bottom")
        return "message: bad pos";
      if (v.background !== undefined && v.background !== "window" && v.background !== "dim" && v.background !== "transparent")
        return "message: bad background";
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
    case "selectItem":
      if (v.itemType !== undefined && !isUint(v.itemType)) return "selectItem: bad itemType";
      return null;
    case "scrollText":
      if (typeof v.text !== "string") return "scrollText: bad text";
      if (v.speed !== undefined && (typeof v.speed !== "number" || !Number.isFinite(v.speed)))
        return "scrollText: bad speed";
      if (v.noFast !== undefined && typeof v.noFast !== "boolean") return "scrollText: bad noFast";
      return null;
    case "battleJoin":
      if (!isUint(v.troopId)) return "battleJoin: bad troopId";
      if (!isText(v.from, MAX_NAME_LEN)) return "battleJoin: bad from";
      return null;
    case "battleCmd": {
      if (!isUint(v.round)) return "battleCmd: bad round";
      if (typeof v.canEscape !== "boolean") return "battleCmd: bad canEscape";
      if (!Array.isArray(v.yours) || v.yours.length > MAX_BATTLE_BATTLERS)
        return "battleCmd: bad yours";
      for (const a of v.yours) {
        if (!isObj(a) || !isUint(a.idx) || typeof a.name !== "string") return "battleCmd: bad ally";
        if (typeof a.hp !== "number" || typeof a.mhp !== "number") return "battleCmd: bad ally hp";
        if (typeof a.mp !== "number" || typeof a.mmp !== "number") return "battleCmd: bad ally mp";
        if (!Array.isArray(a.states) || !Array.isArray(a.skills)) return "battleCmd: bad ally lists";
        if (typeof a.canAct !== "boolean") return "battleCmd: bad canAct";
      }
      if (!Array.isArray(v.allies)) return "battleCmd: bad allies";
      if (!Array.isArray(v.enemies) || v.enemies.length === 0) return "battleCmd: bad enemies";
      for (const e of v.enemies) {
        if (!isObj(e) || !isUint(e.i) || typeof e.name !== "string") return "battleCmd: bad enemy";
        if (typeof e.hp !== "number" || typeof e.mhp !== "number" || typeof e.alive !== "boolean")
          return "battleCmd: bad enemy state";
      }
      return null;
    }
    default:
      return "unknown directive kind";
  }
}

const KICK_CODES = ["kicked", "banned", "room-closed", "idle", "replaced"] as const;
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
  "auth-failed",
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
      // MP8·A passport fields (additive; world servers require them, friend
      // rooms ignore them). Structural only — signature semantics are the
      // server's job (verifyChallenge).
      if (m.pub !== undefined && !isB64url(m.pub, 40, 200)) return fail("hello: bad pub");
      if (m.sig !== undefined && !isB64url(m.sig, 40, 200)) return fail("hello: bad sig");
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
    case "custom":
      // `data` is opaque (any JsonValue). Presence + the frame byte cap is the
      // whole contract — the engine never interprets it, only plugins do.
      if (!("data" in m)) return fail("custom: missing data");
      break;
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
    case "custom":
      if (!isUint(m.from)) return fail("custom: bad from");
      if (!("data" in m)) return fail("custom: missing data");
      break;
    case "challenge":
      if (!isB64url(m.nonce, 16, 128)) return fail("challenge: bad nonce");
      break;
    case "handoff":
      if (!isUint(m.mapId)) return fail("handoff: bad mapId");
      if (!isResumeToken(m.token)) return fail("handoff: bad token");
      if (m.url !== undefined && !(typeof m.url === "string" && m.url.length >= 6 && m.url.length <= 512))
        return fail("handoff: bad url");
      break;
    default:
      return fail(`unknown server message type "${m.t}"`);
  }
  return { ok: true, msg: m as unknown as ServerMessage };
}
