/* RPGAtlas — src/engine/net/relay-client.ts
   Project Beacon MP5·C: the client of a real Beacon server. Where MP4's
   RoomClient talked to a browser RoomHost over BroadcastChannel, RelayClient
   talks to the headless server (server/) over a WebSocket Transport — and here
   BOTH the room creator and the joiner are clients (the server is the one
   authority, D1; there is no browser host). It performs the handshake the server
   expects — `hello` then `join` (codeless = create, coded = join) or `resume` —
   and mirrors the server's world exactly as RoomClient did: `welcome` learns the
   player id + the server-assigned room code, `snapshot`/`delta` reconstruct the
   roster + own player, `directive` renders through the engine UI and replies,
   `presence` drives toasts + bubbles, and `error`/`kick` surface friendly copy.

   Reconstruction + rendering are injected hooks (the engine supplies them), so
   the protocol half is headless and testable in Node against the `ws` package
   via socket-transport's injectable WebSocket. GPL-3.0-or-later (see LICENSE). */

import {
  PROTOCOL_VERSION,
  type ErrorCode,
  type InputIntent,
  type JsonValue,
  type ServerHandoff,
  type ServerKick,
  type ServerMessage,
  type ServerPresence,
} from "../../shared/net/protocol.js";
import type { Transport } from "../../shared/net/transport.js";
import type { World } from "../../shared/sim/world.js";
import type { BattleEvent } from "../../shared/sim/coop-battle.js";
import { passportPublicRaw, signChallenge, type Passport } from "../../shared/net/passport.js";
import { applyPartyTable, type PartyChange, type PartyTableEntry } from "../../shared/sim/party.js";
import { applyPlayerStates, getPlayer, type PlayerState } from "../../shared/sim/players.js";
import type { RoomSnapshot } from "./room-client.js";
import type { DirectiveRenderer } from "./client-session.js";
import { session } from "./session.js";

export interface RelayClientOptions {
  /** This client's display name (sent in `hello`). */
  name: string;
  /** Room code to JOIN; omit to CREATE a fresh room (the server assigns one,
   *  returned via `welcome.roomCode` → onWelcome). */
  code?: string;
  /** Resume an existing session instead of joining fresh. */
  resume?: { code: string; token: string };
  /** WORLD mode (D-8-4): the device passport. When present, the client speaks
   *  the world handshake — it waits for the server's `challenge`, signs the
   *  nonce, and sends the signed `hello` (pub/sig) before `join`/`resume`.
   *  Absent ⇒ a friend room (anonymous, D3): the eager `hello` + `join` MP5
   *  path, byte-identical. */
  passport?: Passport;
  /** WORLD mode (D-8-1): the server asked this client to reconnect to another
   *  zone (the socket-per-zone handoff — the CF multi-DO path). The engine
   *  re-dials `url` and resumes with `token` on the target map. */
  onHandoff?: (h: { mapId: number; token: string; url?: string }) => void;
  /** Fired once with the player id AND the room code (create returns the
   *  server-assigned code here — the UI shows it to share). */
  onWelcome?: (playerId: number, roomCode: string, resumeToken: string) => void;
  /** Reconstruct the world from the snapshot (engine loads the map). */
  onSnapshot?: (snap: RoomSnapshot) => void | Promise<void>;
  /** Apply the local player's authoritative position (engine writes G.player). */
  onLocal?: (s: PlayerState) => void;
  /** Join/leave/emote/say for toasts + bubbles. */
  onPresence?: (p: ServerPresence) => void;
  /** Render a modal directive with the engine UI and resolve with the reply. */
  renderDirective?: DirectiveRenderer;
  /** A request failed (bad code, room full, rate limited, …) — friendly copy. */
  onError?: (code: ErrorCode) => void;
  /** The server closed us (kicked / room closed / idle). */
  onKick?: (code: ServerKick["code"]) => void;
  /** MP6·A: my party membership changed (a relay serves these from MP8·A —
   *  the MP5 server's player layer never emits them; wired now so the client
   *  is ready). */
  onParty?: (change: PartyChange) => void;
  /** MP6·A: a shared-battle event addressed to me (same MP8 note). */
  onBattle?: (ev: BattleEvent) => void;
  /** MP7·C: a plugin custom message from another player (works on the relay). */
  onCustom?: (msg: { from: number; data: JsonValue }) => void;
}

export class RelayClient {
  readonly world: World;
  readonly transport: Transport;
  localPlayerId = -1;
  roomCode = "";
  resumeToken = "";
  private readonly opts: RelayClientOptions;
  private seq = 0;

  constructor(world: World, transport: Transport, opts: RelayClientOptions) {
    this.world = world;
    this.transport = transport;
    this.opts = opts;
    this.transport.onMessage((m) => this.onFrame(m as ServerMessage));
    session.mode = "client";
    session.roomCode = opts.code || opts.resume?.code || "";
    session.name = opts.name;
    // A WORLD (passport present) waits for the server's `challenge` and answers
    // with a SIGNED hello (see onFrame). A FRIEND ROOM (no passport) sends the
    // anonymous handshake eagerly — the MP5 path, byte-identical. Both are
    // buffered by the transport until the socket opens, in order.
    if (!opts.passport) {
      this.transport.send({ t: "hello", proto: PROTOCOL_VERSION, name: opts.name });
      this.sendEntry();
    }
  }

  /** Send `join` (fresh — codeless creates / a world's single room) or
   *  `resume`, after the hello. */
  private sendEntry(): void {
    if (this.opts.resume) this.transport.send({ t: "resume", code: this.opts.resume.code, token: this.opts.resume.token });
    else this.transport.send({ t: "join", code: this.opts.code });
  }

  /** WORLD handshake: sign the server's challenge nonce with the device
   *  passport and send the signed hello, then the entry frame. Any crypto
   *  failure surfaces as a friendly auth error (the server also fails closed). */
  private async answerChallenge(nonce: string): Promise<void> {
    const passport = this.opts.passport;
    if (!passport) return;
    try {
      const pub = await passportPublicRaw(passport);
      const sig = await signChallenge(passport, nonce);
      if (!this.transport) return;
      this.transport.send({ t: "hello", proto: PROTOCOL_VERSION, name: this.opts.name, pub, sig });
      this.sendEntry();
    } catch {
      this.opts.onError?.("auth-failed");
    }
  }

  private onFrame(m: ServerMessage): void {
    if (m.t === "challenge") {
      // WORLD mode: sign the nonce and send the signed hello (see constructor).
      void this.answerChallenge(m.nonce);
    } else if (m.t === "handoff") {
      // WORLD mode (D-8-1): the server moved us to another zone (socket-per-zone
      // CF path). The engine re-dials the target and resumes with the token.
      const h = m as ServerHandoff;
      this.opts.onHandoff?.({ mapId: h.mapId, token: h.token, url: h.url });
    } else if (m.t === "welcome") {
      this.localPlayerId = m.playerId;
      this.roomCode = m.roomCode;
      this.resumeToken = m.resumeToken;
      this.world.roster.local = m.playerId;
      session.localPlayerId = m.playerId;
      session.roomCode = m.roomCode;
      this.opts.onWelcome?.(m.playerId, m.roomCode, m.resumeToken);
    } else if (m.t === "snapshot") {
      const snap = m.world as unknown as RoomSnapshot;
      this.world.tick = m.tick;
      void (async () => {
        if (this.opts.onSnapshot) await this.opts.onSnapshot(snap);
        applyPlayerStates(this.world, this.localPlayerId, snap.players || [], this.opts.onLocal);
        if (snap.party) applyPartyTable(this.world, snap.party);
      })();
    } else if (m.t === "delta") {
      this.world.tick = m.tick;
      const changes = m.changes as unknown as {
        players?: PlayerState[];
        party?: PartyTableEntry[];
        battle?: BattleEvent[];
      };
      applyPlayerStates(this.world, this.localPlayerId, changes.players || [], this.opts.onLocal);
      if (changes.party) {
        const diff = applyPartyTable(this.world, changes.party);
        this.opts.onParty?.(diff);
      }
      if (changes.battle) for (const ev of changes.battle) this.opts.onBattle?.(ev);
    } else if (m.t === "directive") {
      const render = this.opts.renderDirective;
      if (render) void render(m.directive).then((value) => this.transport.send({ t: "reply", id: m.id, value }));
    } else if (m.t === "presence") {
      this.world.tick = m.tick;
      if (m.playerId !== this.localPlayerId) {
        const e = getPlayer(this.world, m.playerId);
        if (e && m.kind === "emote") e.emote = { id: m.emote || "", t: m.tick };
        if (e && m.kind === "say") e.say = { text: m.text, preset: m.preset, t: m.tick };
      }
      this.opts.onPresence?.(m);
    } else if (m.t === "error") {
      this.opts.onError?.(m.code);
    } else if (m.t === "kick") {
      this.opts.onKick?.(m.code);
    } else if (m.t === "custom") {
      // MP7·C: a plugin custom message from another player → the game's plugins.
      this.opts.onCustom?.({ from: m.from, data: m.data });
    }
  }

  /** Send one input intent to the server (the server moves the player). */
  sendInput(intent: InputIntent): void {
    this.transport.send({ t: "input", seq: ++this.seq, intent });
  }

  /** Send an emote (always available, D4). */
  sendEmote(emote: string): void {
    this.transport.send({ t: "emote", emote });
  }

  /** Say a dev-authored preset phrase (index) or free text (dev opt-in, D4). */
  sendChat(payload: { text?: string; preset?: number }): void {
    this.transport.send({ t: "chat", ...payload });
  }

  /** MP7·C: send a plugin custom message to the room (opaque payload). Works on
   *  the relay today (communication tier, relayed like emote/chat). */
  sendCustom(data: JsonValue): void {
    this.transport.send({ t: "custom", data });
  }

  close(): void {
    this.transport.close();
  }
}
