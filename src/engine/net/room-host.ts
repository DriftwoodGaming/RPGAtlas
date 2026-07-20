/* RPGAtlas — src/engine/net/room-host.ts
   Project Beacon MP4·B: the host side of local co-op. One tab owns the
   authoritative world (its `WorldHost` + tick, exactly as solo) and ALSO serves
   peers over the BroadcastChannel transport — the same server-authoritative
   shape (D1) the Beacon relay (MP5) will run per room, minus the socket. When a
   client joins it is assigned a player id, spawned into the world roster, sent a
   `welcome` + `snapshot`, and announced to the others with a `presence` join.
   Its inbound frames route the authoritative way: `input` intents are buffered
   into the tick's inbox tagged with its id (the world moves it — the engine tick
   drains and applies, `map.ts`); `reply` resumes its pending directive; `emote`/
   `chat` set the roster entity's social overlay and re-broadcast as presence.
   Each tick the host broadcasts a `delta` of every player's position.

   Headless by design (movement + collision stay in the engine tick; this module
   only orchestrates the protocol), so it is exercised in Node against the
   BroadcastChannel transport. It is engine/host glue — off the sim graph, but it
   never touches the DOM. GPL-3.0-or-later (see LICENSE). */

import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type JsonValue,
  type ServerPresence,
} from "../../shared/net/protocol.js";
import type { Transport } from "../../shared/net/transport.js";
import type { World } from "../../shared/sim/world.js";
import { deliverReply } from "../../shared/sim/directives.js";
import { drainBattleOutbox, type BattleEvent } from "../../shared/sim/coop-battle.js";
import { consumePartyDirty, partyTable } from "../../shared/sim/party.js";
import { addPlayer, buildPlayerStates, getPlayer, removePlayer } from "../../shared/sim/players.js";
import { openBroadcastServer, type BroadcastServer } from "./broadcast-transport.js";
import type { WorldHost } from "./world-host.js";
import { session } from "./session.js";

/** A resume-token-shaped random string (matches protocol `isResumeToken`). Not
 *  a security token in MP4 (local bus) — MP5 issues real per-session secrets. */
function randomToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let s = "";
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

interface ClientLink {
  pid: number;
  transport: Transport;
  name: string;
}

export interface RoomHostOptions {
  /** The host's own display name (player 0). */
  localName: string;
  /** The host's own appearance key (player 0), used to spawn peers too until
   *  per-player appearance lands (MP7). */
  localCharset: string;
  /** Fired when a peer joins (for the host's own presence toast/UI). */
  onPresence?: (p: ServerPresence) => void;
}

export class RoomHost {
  readonly world: World;
  private readonly worldHost: WorldHost;
  private readonly roomCode: string;
  private readonly opts: RoomHostOptions;
  private readonly server: BroadcastServer;
  private readonly clients = new Map<number, ClientLink>();
  private nextId = 1;
  private readonly loopbackSend: World["directives"]["send"];

  constructor(world: World, worldHost: WorldHost, roomCode: string, opts: RoomHostOptions) {
    this.world = world;
    this.worldHost = worldHost;
    this.roomCode = roomCode;
    this.opts = opts;
    // Route directives by player: player 0 stays on the loopback the WorldHost
    // installed; every other id goes to that client's transport.
    this.loopbackSend = world.directives.send;
    world.directives.send = (pid, frame) => {
      if (pid === 0) {
        if (this.loopbackSend) this.loopbackSend(0, frame);
        return;
      }
      const c = this.clients.get(pid);
      if (c) c.transport.send(frame);
    };
    session.mode = "host";
    session.roomCode = roomCode;
    session.localPlayerId = 0;
    session.name = opts.localName;
    this.server = openBroadcastServer(roomCode, (t) => this.accept(t));
  }

  /** The current player-state list (local player 0 + every roster peer). */
  private states() {
    return buildPlayerStates(this.world, this.opts.localName, this.opts.localCharset);
  }

  private accept(transport: Transport): void {
    let pid = -1;
    transport.onMessage((msg) => {
      const m = msg as ClientMessage;
      if (m.t === "hello") {
        if (pid >= 0) return; // one hello per link
        pid = this.nextId++;
        const name = String(m.name || "Player " + pid).slice(0, 24) || "Player " + pid;
        addPlayer(this.world, pid, name, { charset: this.opts.localCharset });
        this.clients.set(pid, { pid, transport, name });
        transport.send({
          t: "welcome",
          proto: PROTOCOL_VERSION,
          playerId: pid,
          roomCode: this.roomCode,
          resumeToken: randomToken(),
          tick: this.world.tick,
        });
        transport.send({
          t: "snapshot",
          tick: this.world.tick,
          world: {
            players: this.states(),
            mapId: this.world.g ? this.world.g.mapId : 0,
            timeOfDay: this.world.g ? this.world.g.timeOfDay : 12,
            // MP6·A: a late joiner learns the current party table too.
            party: partyTable(this.world),
          } as unknown as JsonValue,
        });
        const pres: ServerPresence = { t: "presence", tick: this.world.tick, kind: "join", playerId: pid, name };
        this.broadcast(pres, pid);
        this.opts.onPresence?.(pres);
        return;
      }
      if (pid < 0) return; // no frames accepted before hello
      if (m.t === "input") {
        this.worldHost.pushInput(pid, m.seq, m.intent);
      } else if (m.t === "reply") {
        deliverReply(this.world, pid, m.id, m.value);
      } else if (m.t === "emote") {
        const e = getPlayer(this.world, pid);
        if (e) e.emote = { id: m.emote, t: this.world.tick };
        const pres: ServerPresence = { t: "presence", tick: this.world.tick, kind: "emote", playerId: pid, emote: m.emote };
        this.broadcast(pres);
        this.opts.onPresence?.(pres);
      } else if (m.t === "chat") {
        const e = getPlayer(this.world, pid);
        if (e) e.say = { text: m.text, preset: m.preset, t: this.world.tick };
        const pres: ServerPresence = {
          t: "presence", tick: this.world.tick, kind: "say", playerId: pid, text: m.text, preset: m.preset,
        };
        this.broadcast(pres);
        this.opts.onPresence?.(pres);
      }
    });
  }

  /** Send a frame to every connected client, optionally excluding one. */
  private broadcast(frame: ServerPresence, except = -1): void {
    for (const c of this.clients.values()) if (c.pid !== except) c.transport.send(frame);
  }

  /** Broadcast one delta of every player's position — called after each world
   *  tick by the loop (host mode). No clients ⇒ nothing sent (a lone host is
   *  byte-identical to solo). MP6·A: the delta additionally carries the party
   *  table when membership changed and each player's queued battle events
   *  (both additive `changes` content — the D-B1 precedent). */
  afterTick(): void {
    if (!this.clients.size) return;
    const players = this.states();
    const table = consumePartyDirty(this.world) ? partyTable(this.world) : null;
    const evs = drainBattleOutbox(this.world);
    let byPid: Map<number, BattleEvent[]> | null = null;
    if (evs.length) {
      byPid = new Map();
      for (const e of evs) {
        const list = byPid.get(e.pid);
        if (list) list.push(e.ev);
        else byPid.set(e.pid, [e.ev]);
      }
    }
    for (const c of this.clients.values()) {
      const changes: Record<string, unknown> = { players };
      if (table) changes.party = table;
      const mine = byPid && byPid.get(c.pid);
      if (mine) changes.battle = mine;
      c.transport.send({
        t: "delta",
        tick: this.world.tick,
        changes: changes as unknown as JsonValue,
      });
    }
  }

  /** Number of connected peers (0 ⇒ the host is effectively solo). */
  get peerCount(): number {
    return this.clients.size;
  }

  /** Stop accepting new peers and drop the roster. Restores player-0 directive
   *  routing to the loopback. */
  close(): void {
    this.server.close();
    for (const c of this.clients.values()) {
      removePlayer(this.world, c.pid);
      c.transport.close();
    }
    this.clients.clear();
    this.world.directives.send = this.loopbackSend;
  }
}
