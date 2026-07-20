/* RPGAtlas — server/src/core/server.ts
   Project Beacon MP5·A/D: the transport-agnostic Beacon server core. It owns the
   room table and the connection lifecycle — handshake, room create/join/resume,
   per-connection + per-source rate limiting, idle/expiry sweeping — and drives
   every room's authoritative tick. The Node `ws` adapter and the Cloudflare
   Durable Object both wrap their sockets as `ServerConnection` and hand them to
   `accept()`; the SAME core runs on both (MP5's "one core, two targets").

   Security posture (MP5·D + the security gate): every inbound frame is strictly
   decoded (decodeClientMessage) and a failure is counted + answered `malformed`,
   never crashes; frames are byte-capped; messages and joins are rate-limited;
   room codes are CSPRNG capability tokens checked for collision; empty rooms
   expire; a player's IP (the rate-limit `source`) never crosses the wire (D6).
   GPL-3.0-or-later (see LICENSE). */

import {
  MAX_NAME_LEN,
  PROTOCOL_VERSION,
  decodeClientMessage,
  encodeMessage,
  type ClientMessage,
  type ErrorCode,
} from "../../../src/shared/net/protocol.js";
import { generateRoomCode } from "../../../src/shared/net/room-code.js";
import { BeaconRoom, type Clock, type RoomMember } from "./room.js";
import { DEFAULT_LIMITS, type BeaconLimits } from "./config.js";
import type { ServerConnection } from "./connection.js";

export interface BeaconServerOptions {
  /** The game project every room in this process hosts (the configured game;
   *  Driftwood's relay = this deployed with the featured game). Rooms share it
   *  read-only. Required — the server bakes collision + spawns from it. */
  project: unknown;
  limits?: Partial<BeaconLimits>;
  clock?: Clock;
  /** Deterministic room-RNG seed (tests); production leaves it unseeded. */
  seed?: number | null;
  /** ONE-ROOM-PER-DO mode (MP5·B): pin this process to a single room with the
   *  given code. A codeless `join` (create) and a `join`/`resume` for this code
   *  all land in that one room; any other code is `room-not-found`. The Node
   *  target leaves this unset (many rooms, random codes). */
  fixedRoomCode?: string;
  /** Optional structured log sink (dev-facing; never player copy). */
  log?: (level: "info" | "warn", event: string, detail?: Record<string, unknown>) => void;
}

/** Per-connection bookkeeping the core keeps between frames. */
interface ConnState {
  conn: ServerConnection;
  phase: "new" | "in-room";
  name: string;
  room: BeaconRoom | null;
  member: RoomMember | null;
  /** Message token bucket. */
  tokens: number;
  lastRefill: number;
  /** Count of rate-limit / malformed strikes; enough of them closes the link. */
  strikes: number;
  lastActivity: number;
}

/** Per-source (IP) join-attempt limiter — caps room-code brute force. */
interface JoinBucket {
  count: number;
  windowStart: number;
}

export class BeaconServer {
  private readonly project: unknown;
  private readonly limits: BeaconLimits;
  private readonly clock: Clock;
  private readonly seed: number | null;
  private readonly fixedRoomCode: string | undefined;
  private readonly log: NonNullable<BeaconServerOptions["log"]>;
  private readonly rooms = new Map<string, BeaconRoom>();
  private readonly conns = new Set<ConnState>();
  private readonly joinBuckets = new Map<string, JoinBucket>();

  constructor(opts: BeaconServerOptions) {
    this.project = opts.project;
    this.limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
    this.clock = opts.clock || Date.now;
    this.seed = opts.seed ?? null;
    this.fixedRoomCode = opts.fixedRoomCode;
    this.log = opts.log || (() => {});
  }

  /** Get-or-create a room with EXACTLY `code` (the one-room-per-DO entry). Used
   *  by the Durable Object target so its single room exists before any client
   *  frame arrives. Returns null if the room cap is hit. */
  ensureRoom(code: string): BeaconRoom | null {
    let room = this.rooms.get(code);
    if (!room) {
      if (this.rooms.size >= this.limits.maxRooms) return null;
      room = new BeaconRoom(code, this.project, { limits: this.limits, clock: this.clock, seed: this.seed });
      this.rooms.set(code, room);
    }
    return room;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get connectionCount(): number {
    return this.conns.size;
  }

  /** Snapshot of live counts (health/metrics; carries no player data). */
  stats(): { rooms: number; connections: number; players: number } {
    let players = 0;
    for (const r of this.rooms.values()) players += r.connectedCount;
    return { rooms: this.rooms.size, connections: this.conns.size, players };
  }

  /** Accept a new client link. The adapter has wired the socket into a
   *  `ServerConnection`; the core attaches its frame/close handling. */
  accept(conn: ServerConnection): void {
    const now = this.clock();
    const st: ConnState = {
      conn, phase: "new", name: "", room: null, member: null,
      tokens: this.limits.messageBurst, lastRefill: now, strikes: 0, lastActivity: now,
    };
    this.conns.add(st);
    conn.onMessage((text) => this.onFrame(st, text));
    conn.onClose(() => this.onClose(st));
  }

  private onClose(st: ConnState): void {
    this.conns.delete(st);
    if (st.room && st.member) st.room.detach(st.member);
  }

  /** Refill + spend one message token. Returns false when the bucket is empty
   *  (the frame is rate-limited). */
  private spendToken(st: ConnState): boolean {
    const now = this.clock();
    const refill = ((now - st.lastRefill) / 1000) * this.limits.messagesPerSecond;
    if (refill > 0) {
      st.tokens = Math.min(this.limits.messageBurst, st.tokens + refill);
      st.lastRefill = now;
    }
    if (st.tokens < 1) return false;
    st.tokens -= 1;
    return true;
  }

  private sendError(st: ConnState, code: ErrorCode, fatal = false): void {
    st.conn.send(encodeMessage({ t: "error", code, fatal }));
    if (fatal) st.conn.close();
  }

  /** One strike; too many (flood / repeated malformed) closes the link. */
  private strike(st: ConnState): void {
    if (++st.strikes >= 20) {
      this.log("warn", "conn-closed-strikes", { source: st.conn.source });
      st.conn.close();
    }
  }

  private onFrame(st: ConnState, text: string): void {
    st.lastActivity = this.clock();
    // Hard byte cap before anything else (oversized frame never reaches parse).
    if (typeof text !== "string" || byteLen(text) > this.limits.maxFrameBytes) {
      this.strike(st);
      this.sendError(st, "malformed");
      return;
    }
    if (!this.spendToken(st)) {
      this.strike(st);
      this.sendError(st, "rate-limited");
      return;
    }
    const decoded = decodeClientMessage(text);
    if (!decoded.ok) {
      this.strike(st);
      this.sendError(st, "malformed");
      return;
    }
    this.route(st, decoded.msg);
  }

  private route(st: ConnState, msg: ClientMessage): void {
    // In a room: only in-room frames are meaningful; hello/join/resume there are
    // protocol errors (already in a room).
    if (st.phase === "in-room") {
      if (msg.t === "input" || msg.t === "reply" || msg.t === "emote" || msg.t === "chat" || msg.t === "custom") {
        if (st.room && st.member) st.room.handleFrame(st.member, msg);
      } else if (msg.t === "hello" || msg.t === "join" || msg.t === "resume") {
        this.sendError(st, "already-in-room");
      }
      return;
    }
    // Pre-room: the first meaningful frame must be `hello`, then join/resume.
    if (msg.t === "hello") {
      if (msg.proto !== PROTOCOL_VERSION) {
        this.log("info", "proto-mismatch", { got: msg.proto });
        this.sendError(st, "proto-mismatch", true);
        return;
      }
      st.name = String(msg.name || "").slice(0, MAX_NAME_LEN);
      return;
    }
    if (!st.name) {
      // A join/resume/anything before hello is malformed sequencing.
      this.sendError(st, "malformed");
      return;
    }
    if (msg.t === "join") this.handleJoin(st, msg.code);
    else if (msg.t === "resume") this.handleResume(st, msg.code, msg.token);
    else this.sendError(st, "malformed");
  }

  /** Enforce the per-source join/resume budget. Returns false (and answers
   *  `rate-limited`) when the source has exhausted it. */
  private allowJoinAttempt(st: ConnState): boolean {
    const now = this.clock();
    let b = this.joinBuckets.get(st.conn.source);
    if (!b || now - b.windowStart >= this.limits.joinWindowMs) {
      b = { count: 0, windowStart: now };
      this.joinBuckets.set(st.conn.source, b);
    }
    if (b.count >= this.limits.joinsPerSource) {
      this.strike(st);
      this.sendError(st, "rate-limited");
      return false;
    }
    b.count++;
    return true;
  }

  private handleJoin(st: ConnState, code: string | undefined): void {
    if (!this.allowJoinAttempt(st)) return;
    // One-room-per-DO: a codeless (create) OR matching-code join both enter the
    // pinned room; any other code cannot exist here.
    if (this.fixedRoomCode) {
      if (code !== undefined && code !== this.fixedRoomCode) {
        this.sendError(st, "room-not-found");
        return;
      }
      const room = this.ensureRoom(this.fixedRoomCode);
      if (!room || room.isFull) { this.sendError(st, room ? "room-full" : "internal"); return; }
      this.enter(st, room);
      return;
    }
    if (code === undefined) {
      // Create a fresh room and become its first player.
      if (this.rooms.size >= this.limits.maxRooms) {
        this.sendError(st, "internal");
        return;
      }
      const room = this.createRoom();
      this.enter(st, room);
      this.log("info", "room-created", { code: room.code, rooms: this.rooms.size });
      return;
    }
    const room = this.rooms.get(code);
    if (!room) {
      this.sendError(st, "room-not-found");
      return;
    }
    if (room.isFull) {
      this.sendError(st, "room-full");
      return;
    }
    this.enter(st, room);
  }

  private handleResume(st: ConnState, code: string, token: string): void {
    if (!this.allowJoinAttempt(st)) return;
    const room = this.rooms.get(code);
    const member = room ? room.resume(st.conn, token) : null;
    if (!room || !member) {
      // Ambiguous on purpose — do not reveal whether the room or the token was
      // the miss (no oracle for guessing).
      this.sendError(st, "room-not-found");
      return;
    }
    st.phase = "in-room";
    st.room = room;
    st.member = member;
  }

  /** Admit a greeted connection into a room as a NEW player. */
  private enter(st: ConnState, room: BeaconRoom): void {
    const member = room.admit(st.conn, st.name, "");
    if (!member) {
      this.sendError(st, "room-full");
      return;
    }
    st.phase = "in-room";
    st.room = room;
    st.member = member;
  }

  /** Create a room with a fresh, collision-checked room code. */
  private createRoom(): BeaconRoom {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room = new BeaconRoom(code, this.project, { limits: this.limits, clock: this.clock, seed: this.seed });
    this.rooms.set(code, room);
    return room;
  }

  /** Advance every room one authoritative tick (movement + delta broadcast).
   *  The adapter calls this at 60 Hz. */
  tickRooms(): void {
    for (const room of this.rooms.values()) room.tick();
  }

  /** Reap stale members + expired rooms + idle connections. The adapter calls
   *  this on an interval (≈ once/second). */
  sweep(): void {
    const now = this.clock();
    for (const [code, room] of Array.from(this.rooms.entries())) {
      if (room.sweep(now)) {
        this.rooms.delete(code);
        this.log("info", "room-expired", { code });
      }
    }
    for (const st of Array.from(this.conns)) {
      if (now - st.lastActivity >= this.limits.idleTimeoutMs) {
        this.log("info", "conn-idle-timeout", { source: st.conn.source });
        st.conn.close();
      }
    }
    // Forget stale join buckets so the map can't grow unbounded.
    for (const [src, b] of Array.from(this.joinBuckets.entries())) {
      if (now - b.windowStart >= this.limits.joinWindowMs) this.joinBuckets.delete(src);
    }
  }

  /** Close every room + connection (server shutdown). */
  shutdown(): void {
    for (const room of this.rooms.values()) room.close();
    this.rooms.clear();
    for (const st of this.conns) st.conn.close();
    this.conns.clear();
  }
}

/** UTF-8 byte length of a string (the true wire size the byte cap enforces). */
function byteLen(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; } // surrogate pair
    else bytes += 3;
  }
  return bytes;
}
