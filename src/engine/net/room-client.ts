/* RPGAtlas — src/engine/net/room-client.ts
   Project Beacon MP4·B: the client side of local co-op. A joining tab does NOT
   run the authoritative simulation — it mirrors the host's world over the
   BroadcastChannel transport and renders it (the reconstruction the MP2·A
   ClientSession comment reserved: `view` becomes a client-local reconstruction
   fed by snapshot/delta frames). On `welcome` it learns its player id; on
   `snapshot` the engine reconstructs the map + its own player baseline, then
   every player's authoritative position is applied; each `delta` refreshes those
   positions; `directive` frames render through the engine's modal UI and answer
   with `reply`; `presence` drives join/leave toasts + emote/say bubbles. The
   client sends its own input as `input` intents — the host is the one authority
   (D1), so the client asks and the host decides.

   Reconstruction + rendering side effects are injected as hooks (the engine
   supplies them), so the protocol half is headless and testable in Node against
   the BroadcastChannel transport. GPL-3.0-or-later (see LICENSE). */

import {
  PROTOCOL_VERSION,
  type InputIntent,
  type ServerMessage,
  type ServerPresence,
} from "../../shared/net/protocol.js";
import type { Transport } from "../../shared/net/transport.js";
import type { World } from "../../shared/sim/world.js";
import type { BattleEvent } from "../../shared/sim/coop-battle.js";
import { applyPartyTable, type PartyChange, type PartyTableEntry } from "../../shared/sim/party.js";
import { applyPlayerStates, getPlayer, type PlayerState } from "../../shared/sim/players.js";
import type { DirectiveRenderer } from "./client-session.js";
import { connectBroadcast } from "./broadcast-transport.js";
import { session } from "./session.js";

/** The MP4 snapshot payload (ServerSnapshot.world / ServerDelta.changes carry
 *  opaque JSON at the protocol level; this is the shape the room host/client
 *  agree on). MP6·A adds the party table. */
export interface RoomSnapshot {
  players: PlayerState[];
  mapId: number;
  timeOfDay: number;
  party?: PartyTableEntry[];
}

export interface RoomClientOptions {
  /** This client's display name (sent in `hello`). */
  name: string;
  /** Fired once, with the server-assigned player id. */
  onWelcome?: (playerId: number) => void;
  /** Reconstruct the world from the snapshot (engine: load the map, init the
   *  local player baseline). Awaited before positions are applied. */
  onSnapshot?: (snap: RoomSnapshot) => void | Promise<void>;
  /** Apply the local player's authoritative position (engine: write G.player). */
  onLocal?: (s: PlayerState) => void;
  /** Join/leave/emote/say for toasts. */
  onPresence?: (p: ServerPresence) => void;
  /** Render a modal directive with the engine UI and resolve with the reply. */
  renderDirective?: DirectiveRenderer;
  /** MP6·A: my party membership changed (engine toasts it). */
  onParty?: (change: PartyChange) => void;
  /** MP6·A: a shared-battle event addressed to me (stage B renders it). */
  onBattle?: (ev: BattleEvent) => void;
}

export class RoomClient {
  readonly world: World;
  readonly transport: Transport;
  localPlayerId = -1;
  private readonly opts: RoomClientOptions;
  private seq = 0;

  constructor(world: World, roomCode: string, opts: RoomClientOptions) {
    this.world = world;
    this.opts = opts;
    this.transport = connectBroadcast(roomCode);
    this.transport.onMessage((m) => this.onFrame(m));
    session.mode = "client";
    session.roomCode = roomCode;
    session.name = opts.name;
    this.transport.send({ t: "hello", proto: PROTOCOL_VERSION, name: opts.name });
  }

  private onFrame(msg: ServerMessage | { t: string }): void {
    const m = msg as ServerMessage;
    if (m.t === "welcome") {
      this.localPlayerId = m.playerId;
      this.world.roster.local = m.playerId;
      session.localPlayerId = m.playerId;
      this.opts.onWelcome?.(m.playerId);
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
      // MP6·A additive delta content: the party table + my battle events.
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
    }
  }

  /** Send one input intent to the host (the host moves the player). */
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
