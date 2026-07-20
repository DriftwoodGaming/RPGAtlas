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
  type ServerKick,
  type ServerMessage,
  type ServerPresence,
} from "../../shared/net/protocol.js";
import type { Transport } from "../../shared/net/transport.js";
import type { World } from "../../shared/sim/world.js";
import type { BattleEvent } from "../../shared/sim/coop-battle.js";
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
    // Handshake (buffered by the transport until the socket opens, in order).
    this.transport.send({ t: "hello", proto: PROTOCOL_VERSION, name: opts.name });
    if (opts.resume) this.transport.send({ t: "resume", code: opts.resume.code, token: opts.resume.token });
    else this.transport.send({ t: "join", code: opts.code });
  }

  private onFrame(m: ServerMessage): void {
    if (m.t === "welcome") {
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

  close(): void {
    this.transport.close();
  }
}
