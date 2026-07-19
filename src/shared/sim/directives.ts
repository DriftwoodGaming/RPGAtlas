/* RPGAtlas — src/shared/sim/directives.ts
   Project Beacon MP3·A: the presentation-directive engine. A modal event
   command (Show Message, Show Choices, Open Shop, …) running world-side never
   touches UI: it asks the PresentationPort, which emits a `directive` frame to
   the target player's client, suspends the interpreter, and resumes it with
   the validated `reply` (MP0·C §C3 lifecycle). The client renders directives
   with the engine's existing message/ui-stack code (src/engine/scenes/
   directive-renderer.ts) — this module is the world half and is headless by
   law (sim lint wall).

   Shared-map pause semantics (branch point, answered by Driftwood 2026-07-19):
   PARTICIPANTS ONLY. A cutscene-grade event pauses exactly the players
   participating in it (world.blocking is a per-player set); everyone else
   keeps playing and sees the event's world effects. Solo play: every context
   resolves to the one default player, so the aggregate view the engine reads
   (ctx.blockingRun) behaves exactly as the old boolean — byte-identical.

   Resume timing (a deliberate refinement of §C3.3, forced by D7): a validated
   reply resolves the awaiting interpreter IMMEDIATELY, in the same microtask
   chain — in loopback that reproduces the solo engine's exact dismiss→resume
   timing, which is what keeps the pixel goldens byte-identical. On a real
   server (MP5) a reply arrives between ticks and resuming there is equivalent
   to "before the next tick"; the server is the one authority (D1), so no
   cross-client ordering constraint is lost.

   Pending-directive concurrency (a deliberate refinement of §C3.5): pendings
   are keyed by id and a player may hold several at once, because a PARALLEL
   event can legally open a message while a blocking event's message is up —
   today's engine stacks both boxes, and byte-identity wins over the one-at-
   a-time simplification. The reply's `id` disambiguates. MP5 caps pendings
   per player as a hostile-event guard. GPL-3.0-or-later (see LICENSE). */

import type {
  Directive,
  DirectiveReplyValue,
  ServerDirective,
  ShopGood,
  ShopTransaction,
} from "../net/protocol.js";
import { MAX_NAME_INPUT_LEN, MAX_SHOP_TRANSACTIONS } from "../net/protocol.js";
import type { World } from "./world.js";

/** Who an interpreter run acts as (MP0·C §C6): a player context (`playerId`
 *  set — action/touch triggers, player-initiated flows) or a world context
 *  (`null` — autorun, parallel, timer-driven common events). Directives and
 *  per-player presentation effects target `participantsOf` this origin. */
export interface InterpOrigin {
  playerId: number | null;
}

/** The one player of a solo world (MP4 introduces real rosters). */
export const DEFAULT_PLAYER = 0;

/** One directive awaiting its player's reply. */
export interface PendingDirective {
  id: number;
  playerId: number;
  directive: Directive;
  resolve: (v: DirectiveReplyValue) => void;
}

/** Per-world directive-broker state. Runtime-only — never snapshotted: a
 *  pending directive never survives a save or a reconnect (C3.4 auto-resolve
 *  covers the disconnect path). */
export interface DirectiveState {
  /** Per-world monotonic directive id. */
  nextId: number;
  pending: Map<number, PendingDirective>;
  /** Outbound channel, installed by the world's host (WorldHost). Null in a
   *  bare headless world — emit then resolves with the escape value so an
   *  event can never hang a clientless world. */
  send: ((playerId: number, frame: ServerDirective) => void) | null;
  /** Loopback posture (MP2·A A4): the client's view IS this world by
   *  reference, so client-side presentation writes (shop session lines) are
   *  already authoritative and reply transcripts must NOT be re-applied.
   *  False for real remote sessions (MP4/MP5). */
  localEcho: boolean;
  /** Invalid/stale/foreign replies dropped (hostile-input counter; MP5 acts
   *  on it, MP3 just counts). */
  dropped: number;
}

export function createDirectiveState(): DirectiveState {
  return { nextId: 1, pending: new Map(), send: null, localEcho: false, dropped: 0 };
}

/* ── Participants + blocking (participants-only pause) ─────────────────── */

/** The players a directive (or a blocking pause) from this origin targets: a
 *  player context targets its player; a world context targets the event's map
 *  participants — the one default player until MP4 builds the roster. A
 *  missing origin (defensive: plugin-constructed interpreters) is the solo
 *  player context. */
export function participantsOf(world: World, origin?: InterpOrigin | null): number[] {
  return origin && origin.playerId != null ? [origin.playerId] : [DEFAULT_PLAYER];
}

/** Pause exactly these players (a blocking interpreter started). */
export function beginBlocking(world: World, participants: number[]): void {
  for (const id of participants) world.blocking.add(id);
}

/** Release exactly these players (the blocking interpreter finished). */
export function endBlocking(world: World, participants: number[]): void {
  for (const id of participants) world.blocking.delete(id);
}

export function isBlocked(world: World, playerId: number = DEFAULT_PLAYER): boolean {
  return world.blocking.has(playerId);
}

/* ── Lifecycle: emit → validate reply → resume ─────────────────────────── */

/** The C3.4 escape value a directive resolves to when its player can't answer
 *  (disconnect, battle-command timeout, clientless world): message → done;
 *  choices → canceled if cancelable else option 0 (RM default-branch);
 *  numberInput → initial ?? 0; nameInput → initial ?? "" (caller falls back
 *  to the current name); shop → empty transcript. Solo/loopback never
 *  auto-resolves. */
export function escapeValueOf(d: Directive): DirectiveReplyValue {
  switch (d.kind) {
    case "message":
      return { kind: "message", done: true };
    case "choices":
      return d.cancelable ? { kind: "choices", canceled: true } : { kind: "choices", choice: 0 };
    case "numberInput":
      return { kind: "numberInput", value: d.initial ?? 0 };
    case "nameInput":
      return { kind: "nameInput", value: d.initial ?? "" };
    case "shop":
      return { kind: "shop", transactions: [] };
  }
}

/** Emit one directive to one player and suspend until its validated reply
 *  (or the escape value when the world has no outbound channel). The pending
 *  entry is registered BEFORE the frame is sent, so a synchronously-delivered
 *  loopback reply always finds it. */
export function emitDirective(
  world: World,
  playerId: number,
  directive: Directive,
): Promise<DirectiveReplyValue> {
  const ds = world.directives;
  if (!ds.send) return Promise.resolve(escapeValueOf(directive));
  const id = ds.nextId++;
  return new Promise((resolve) => {
    ds.pending.set(id, { id, playerId, directive, resolve });
    ds.send!(playerId, { t: "directive", id, directive });
  });
}

/** Semantic reply validation against the directive that asked (C3.2c — layer
 *  (a) shape-checking is the wire decoder's job and layer (b) lifecycle is
 *  deliverReply's). Returns an error string or null. Exported for tests and
 *  for the MP5 server's fuzz gate. */
export function validateReplyValue(directive: Directive, value: DirectiveReplyValue): string | null {
  if (!value || typeof value !== "object") return "reply: not an object";
  if (value.kind !== directive.kind) return "reply: kind mismatch";
  switch (directive.kind) {
    case "message":
      return (value as { done?: unknown }).done === true ? null : "message: done must be true";
    case "choices": {
      const v = value as { choice?: unknown; canceled?: unknown };
      if (v.canceled === true) return directive.cancelable ? null : "choices: not cancelable";
      const c = v.choice;
      if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c >= directive.options.length)
        return "choices: choice out of range";
      return null;
    }
    case "numberInput": {
      const n = (value as { value?: unknown }).value;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return "numberInput: bad value";
      if (String(n).length > directive.digits) return "numberInput: too many digits";
      return null;
    }
    case "nameInput": {
      const s = (value as { value?: unknown }).value;
      if (typeof s !== "string") return "nameInput: bad value";
      if (s.length > Math.min(directive.maxLen, MAX_NAME_INPUT_LEN)) return "nameInput: too long";
      return null;
    }
    case "shop": {
      const txs = (value as { transactions?: unknown }).transactions;
      if (!Array.isArray(txs)) return "shop: bad transactions";
      if (txs.length > MAX_SHOP_TRANSACTIONS) return "shop: too many transactions";
      for (const tx of txs as ShopTransaction[]) {
        if (!tx || typeof tx !== "object") return "shop: bad line";
        if (tx.op !== "buy" && tx.op !== "sell") return "shop: bad op";
        if (tx.itemType !== "item" && tx.itemType !== "weapon" && tx.itemType !== "armor")
          return "shop: bad itemType";
        if (!Number.isInteger(tx.id) || tx.id < 0) return "shop: bad id";
        if (!Number.isInteger(tx.count) || tx.count < 1) return "shop: bad count";
      }
      return null;
    }
  }
}

/** Route one player's reply to its pending directive. Stale, duplicate,
 *  foreign (wrong player) or semantically invalid replies are dropped and
 *  counted — the pending stays pending, so a hostile frame can't kill an
 *  honest player's directive. A valid reply resumes the suspended interpreter
 *  in this same microtask chain (see the header's §C3.3 note). */
export function deliverReply(
  world: World,
  playerId: number,
  id: number,
  value: DirectiveReplyValue,
): boolean {
  const ds = world.directives;
  const p = ds.pending.get(id);
  if (!p || p.playerId !== playerId) {
    ds.dropped++;
    return false;
  }
  if (validateReplyValue(p.directive, value) != null) {
    ds.dropped++;
    return false;
  }
  ds.pending.delete(id);
  p.resolve(value);
  return true;
}

/** C3.4: resolve every pending directive of a disconnecting player with its
 *  escape value, so a pending modal never hangs a shared world. Returns the
 *  number resolved. Never called in solo/loopback. */
export function autoResolveDirectivesFor(world: World, playerId: number): number {
  const ds = world.directives;
  let n = 0;
  for (const p of Array.from(ds.pending.values())) {
    if (p.playerId !== playerId) continue;
    ds.pending.delete(p.id);
    p.resolve(escapeValueOf(p.directive));
    n++;
  }
  return n;
}

/* ── The presentation port (what command handlers call) ────────────────── */

/** The world-side surface modal command handlers talk to instead of UI.
 *  Every method takes the interpreter's origin (§C6) and returns once the
 *  targeted player(s) replied. Injected into EngineServices at boot (solo)
 *  and built per world on a server (MP5). */
export interface PresentationPort {
  /** Loopback posture passthrough — handlers use it to skip re-applying
   *  world writes the client session already made by reference (shop). */
  readonly localEcho: boolean;
  message(
    origin: InterpOrigin | undefined,
    d: Omit<Extract<Directive, { kind: "message" }>, "kind">,
  ): Promise<void>;
  /** Resolves to the chosen option index, or -1 when canceled (only possible
   *  when the directive is cancelable). */
  choices(
    origin: InterpOrigin | undefined,
    d: Omit<Extract<Directive, { kind: "choices" }>, "kind">,
  ): Promise<number>;
  numberInput(
    origin: InterpOrigin | undefined,
    d: Omit<Extract<Directive, { kind: "numberInput" }>, "kind">,
  ): Promise<number>;
  nameInput(
    origin: InterpOrigin | undefined,
    d: Omit<Extract<Directive, { kind: "nameInput" }>, "kind">,
  ): Promise<string>;
  shop(
    origin: InterpOrigin | undefined,
    d: { goods: ShopGood[]; buyOnly?: boolean; currencyId?: number },
  ): Promise<ShopTransaction[]>;
}

export function createPresentationPort(world: World): PresentationPort {
  /** Emit to every participant and join on all replies (C3.1). The answering
   *  value is the origin player's reply when the origin is a player context,
   *  else the first participant's — one target either way until MP4. */
  async function ask(
    origin: InterpOrigin | undefined,
    directive: Directive,
  ): Promise<DirectiveReplyValue> {
    const targets = participantsOf(world, origin);
    if (targets.length === 1) return emitDirective(world, targets[0], directive);
    const replies = await Promise.all(targets.map((pid) => emitDirective(world, pid, directive)));
    const originIdx = origin && origin.playerId != null ? targets.indexOf(origin.playerId) : 0;
    return replies[originIdx < 0 ? 0 : originIdx];
  }
  return {
    get localEcho() {
      return world.directives.localEcho;
    },
    async message(origin, d) {
      await ask(origin, { kind: "message", ...d });
    },
    async choices(origin, d) {
      const r = await ask(origin, { kind: "choices", ...d });
      return r.kind === "choices" && "choice" in r ? r.choice : -1;
    },
    async numberInput(origin, d) {
      const r = await ask(origin, { kind: "numberInput", ...d });
      return r.kind === "numberInput" ? r.value : (d.initial ?? 0);
    },
    async nameInput(origin, d) {
      const r = await ask(origin, { kind: "nameInput", ...d });
      return r.kind === "nameInput" ? r.value : (d.initial ?? "");
    },
    async shop(origin, d) {
      const r = await ask(origin, { kind: "shop", ...d });
      return r.kind === "shop" ? r.transactions : [];
    },
  };
}
