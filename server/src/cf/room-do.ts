/* RPGAtlas — server/src/cf/room-do.ts
   Project Beacon MP5·B: the Cloudflare Durable Object target — ONE room/world
   per DO (roadmap MP5·B). The DO owns a single-room BeaconServer (the SAME core
   the Node target runs, config.fixedRoomCode) and accepts WebSockets via the
   hibernation API (`state.acceptWebSocket`), so an idle room costs no wall-clock
   compute. While players are connected the isolate stays warm and a setInterval
   drives the 60 Hz authoritative tick; when the room empties it hibernates and a
   storage alarm sweeps it for expiry.

   Scope note (MP5·B / D-5-0): world-state PERSISTENCE across a hibernation
   eviction is MP8 (per-zone snapshots to DO storage). In MP5 a cold start
   rebuilds an empty room, so a mid-session eviction behaves like a room reset
   (clients reconnect + re-join); this is rare for an active friend room (traffic
   keeps the isolate warm) and is documented as the MP5→MP8 boundary. The precise
   hibernation-friendly tick cadence (60 Hz vs decimated) is likewise an MP8
   measurement decision. GPL-3.0-or-later (see LICENSE). */

import { BeaconServer } from "../core/server.js";
import type { ServerConnection } from "../core/connection.js";
import { isCanonicalRoomCode } from "../../../src/shared/net/room-code.js";

/** The Worker env bindings this DO needs. The game project JSON lives in a KV
 *  namespace (`GAME`, key `project`) — too large for a plaintext var — and is
 *  loaded once per isolate. */
export interface Env {
  BEACON_ROOM: DurableObjectNamespace;
  GAME: KVNamespace;
}

const TICK_MS = 1000 / 60;
const SWEEP_ALARM_MS = 1000;
let connSeq = 0;

/** Wrap a hibernatable WebSocket as a ServerConnection. The message/close
 *  handlers live only in the live isolate; the DO re-wraps sockets on a cold
 *  start (webSocketMessage below). The room code is stashed in the socket's
 *  serialized attachment so it survives hibernation. */
function wrapWebSocket(ws: WebSocket, source: string): ServerConnection & { deliver(t: string): void; fireClose(): void } {
  let open = true;
  let onMsg: ((t: string) => void) | null = null;
  let onCls: (() => void) | null = null;
  return {
    id: ++connSeq,
    source,
    get isOpen() { return open; },
    send(text: string): void { if (open) try { ws.send(text); } catch { open = false; } },
    close(): void { if (open) { open = false; try { ws.close(); } catch { /* */ } } },
    onMessage(h: (t: string) => void): void { onMsg = h; },
    onClose(h: () => void): void { onCls = h; },
    deliver(t: string): void { onMsg?.(t); },
    fireClose(): void { open = false; onCls?.(); },
  };
}

export class BeaconRoomDO {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private server: BeaconServer | null = null;
  private code = "";
  private readonly conns = new Map<WebSocket, ReturnType<typeof wrapWebSocket>>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /** Build (once) the single-room server this DO hosts, loading the game project
   *  from KV. Cached for the isolate's lifetime. */
  private async getServer(code: string): Promise<BeaconServer> {
    if (!this.server) {
      const projectJson = await this.env.GAME.get("project");
      if (!projectJson) throw new Error("beacon: GAME KV has no 'project' key");
      this.code = code;
      this.server = new BeaconServer({ project: JSON.parse(projectJson), fixedRoomCode: code });
      this.server.ensureRoom(code);
    }
    return this.server;
  }

  private startTicking(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      this.server?.tickRooms();
      if (this.state.getWebSockets().length === 0) this.stopTicking();
    }, TICK_MS);
  }

  private stopTicking(): void {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  /** Worker → DO: the WebSocket upgrade for one room. `?code=` is this room's
   *  code (the Worker minted it for a create, or forwarded the join code). */
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") || "";
    if (!isCanonicalRoomCode(code)) return new Response("bad room code", { status: 400 });
    if (req.headers.get("Upgrade") !== "websocket") {
      const srv = await this.getServer(code);
      return new Response(JSON.stringify(srv.stats()), { headers: { "content-type": "application/json" } });
    }
    const srv = await this.getServer(code);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernatable accept — the DO can be evicted between messages.
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ code });
    const conn = wrapWebSocket(server, req.headers.get("CF-Connecting-IP") || "cf");
    this.conns.set(server, conn);
    srv.accept(conn);
    this.startTicking();
    void this.state.storage.setAlarm(Date.now() + SWEEP_ALARM_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Hibernation handler: one inbound frame. Rewraps the socket after a cold
   *  start so the room keeps serving (a mid-session eviction resets the room —
   *  MP5·B scope; MP8 persists). */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as { code?: string } | null;
    const code = att?.code || this.code;
    if (code) await this.getServer(code);
    let conn = this.conns.get(ws);
    if (!conn) {
      conn = wrapWebSocket(ws, "cf");
      this.conns.set(ws, conn);
      this.server?.accept(conn); // cold-start re-accept: client must re-handshake
      this.startTicking();
    }
    conn.deliver(typeof message === "string" ? message : "");
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const conn = this.conns.get(ws);
    if (conn) { conn.fireClose(); this.conns.delete(ws); }
    if (this.state.getWebSockets().length === 0) this.stopTicking();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /** Periodic sweep (expiry/idle) via the storage alarm — runs even when the
   *  isolate would otherwise sleep. Re-arms while the room still has state. */
  async alarm(): Promise<void> {
    this.server?.sweep();
    const live = this.state.getWebSockets().length > 0;
    if (live || (this.server && this.server.roomCount > 0)) {
      void this.state.storage.setAlarm(Date.now() + SWEEP_ALARM_MS);
    }
  }
}
