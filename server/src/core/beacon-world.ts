/* RPGAtlas — server/src/core/beacon-world.ts
   Project Beacon MP8·A: a persistent WORLD — the directory in front of the
   zones (zone.ts). One world = one game project, many map-zones, players
   identified by passport (passport.ts). This is the roadmap's third column:
   friend rooms (BeaconServer/BeaconRoom, MP5 — untouched) stay the anonymous
   small tier; a world adds identity, scale, and (stage B) persistence.

   The directory owns:
   - connections + the MP5 hardening pipeline (byte cap → token bucket →
     strict decode → route; strikes close floods). Deliberately the same
     constants/semantics as BeaconServer — duplicated rather than refactored
     so the MP5-audited room path stays byte-identical (docs/mp-8-spec.md §A6).
   - passport auth: challenge on connect, verify on hello, fingerprint =
     the player's identity key; ban-by-fingerprint; one live session per
     passport (a new sign-in supersedes the old — kick `replaced`).
   - the player table: pid ↔ fingerprint ↔ zone, resume tokens (world-scoped),
     and the passport-keyed player RECORDS (position now; stage B persists
     them durably + widens them per docs/mp-8-spec.md §A5).
   - zone lifecycle: get-or-create per occupied map, empty-zone expiry, and
     cross-zone transfer handoff (gateway model: the socket never moves — the
     directory re-homes the player and the new zone pushes a snapshot; the
     socket-per-zone `handoff` frame is the CF DO path, stage B).
   - world-shared state fan-out (sharedSet → every zone replica).

   Zones are held ONLY through ZoneApi/ZoneOutbox (fire-and-forget seam), so
   swapping the in-process zones for worker_threads or DO-hosted ones is an
   adapter change, not a directory change. GPL-3.0-or-later (see LICENSE). */

import {
  MAX_NAME_LEN,
  PROTOCOL_VERSION,
  decodeClientMessage,
  encodeMessage,
  type ClientMessage,
  type ErrorCode,
  type JsonValue,
  type PlayerId,
} from "../../../src/shared/net/protocol.js";
import { generateRoomCode } from "../../../src/shared/net/room-code.js";
import {
  fingerprintOfPub,
  randomChallengeNonce,
  verifyChallenge,
} from "../../../src/shared/net/passport.js";
import { resolveSpawn } from "../../../src/shared/sim/players.js";
import { createWorld, type World } from "../../../src/shared/sim/world.js";
import { Zone, type ZoneApi, type ZoneOutbox } from "./zone.js";
import { DEFAULT_WORLD_LIMITS, type WorldLimits } from "./config.js";
import { randomResumeToken } from "./tokens.js";
import type { PlayerRecord, WorldStore, ZoneSnapshot } from "./store.js";
import type { Clock } from "./room.js";
import type { ServerConnection } from "./connection.js";

export type { PlayerRecord };

export interface BeaconWorldOptions {
  /** The game project this world runs (shared read-only by every zone). */
  project: unknown;
  limits?: Partial<WorldLimits>;
  clock?: Clock;
  /** Deterministic zone-RNG seed (tests); production leaves it unseeded. */
  seed?: number | null;
  /** Require passport auth (the world default). Tests/tools may disable to
   *  exercise the anonymous path; production worlds should not. */
  requirePassport?: boolean;
  /** Build a zone. Default: in-process `Zone`. The Node worker adapter (and
   *  stage B's DO adapter) inject their own factory here — the directory
   *  never knows where a zone runs. */
  zoneFactory?: (mapId: number, outbox: ZoneOutbox) => ZoneApi;
  /** Durable persistence (MP8·B §A5). Absent ⇒ the world lives only in memory
   *  (state is lost on restart) — the pre-persistence behavior, kept for tests
   *  and ephemeral rooms. Present ⇒ `load()` restores it at start and `flush()`
   *  persists it on the driver's cadence + graceful shutdown. */
  store?: WorldStore;
  log?: (level: "info" | "warn", event: string, detail?: Record<string, unknown>) => void;
}

/** One world member (a connected or resume-grace player). */
export interface WorldMember {
  pid: PlayerId;
  fingerprint: string;
  name: string;
  charset: string;
  conn: ServerConnection | null;
  resumeToken: string;
  mapId: number;
  disconnectedAt: number;
}

interface ConnState {
  conn: ServerConnection;
  phase: "new" | "authing" | "ready" | "in-world";
  nonce: string;
  name: string;
  fingerprint: string;
  member: WorldMember | null;
  queue: ClientMessage[];
  tokens: number;
  lastRefill: number;
  strikes: number;
  lastActivity: number;
}

interface JoinBucket {
  count: number;
  windowStart: number;
}

export class BeaconWorld {
  /** World session code (room-code shaped so `welcome`/`resume` validate). */
  readonly code: string;
  private readonly project: unknown;
  private readonly limits: WorldLimits;
  private readonly clock: Clock;
  private readonly seed: number | null;
  private readonly requirePassport: boolean;
  private readonly zoneFactory: (mapId: number, outbox: ZoneOutbox) => ZoneApi;
  private readonly log: NonNullable<BeaconWorldOptions["log"]>;
  private readonly zones = new Map<number, ZoneApi>();
  private readonly zoneCounts = new Map<number, number>();
  private readonly zoneEmptySince = new Map<number, number>();
  private readonly members = new Map<PlayerId, WorldMember>();
  private readonly byFingerprint = new Map<string, WorldMember>();
  private readonly records = new Map<string, PlayerRecord>();
  private readonly bans = new Set<string>();
  private readonly conns = new Set<ConnState>();
  private readonly joinBuckets = new Map<string, JoinBucket>();
  /** Tombstones for just-dropped pids: a worker zone's async exit-position
   *  patch may land AFTER dropMember, and it must still reach the record. */
  private readonly recentDrops = new Map<PlayerId, { fingerprint: string; mapId: number; until: number }>();
  private nextPid = 1;
  /** Directory-owned world-shared state replicated to every zone (§A5). */
  private readonly shared = new Map<string, JsonValue>();
  /** Scratch world for pure project reads (resolveSpawn) — never ticked. */
  private readonly scratch: World;
  /** One outbox for every zone (pids are world-unique, so routing is by pid). */
  private readonly outbox: ZoneOutbox;
  /** Durable store (§A5) or null (in-memory only). */
  private readonly store: WorldStore | null;
  /** Fingerprints whose record changed since the last flush (flush only these). */
  private readonly dirtyRecords = new Set<string>();
  /** ZoneSnapshots loaded at start, applied when their map's zone is created. */
  private readonly pendingZoneSnapshots = new Map<number, ZoneSnapshot>();
  private worldDirty = false;
  private loaded = false;

  constructor(opts: BeaconWorldOptions) {
    this.project = opts.project;
    this.limits = { ...DEFAULT_WORLD_LIMITS, ...(opts.limits || {}) };
    this.clock = opts.clock || Date.now;
    this.seed = opts.seed ?? null;
    this.requirePassport = opts.requirePassport !== false;
    this.store = opts.store || null;
    this.zoneFactory =
      opts.zoneFactory ||
      ((mapId, outbox) => new Zone(mapId, this.project, outbox, { limits: this.limits, clock: this.clock, seed: this.seed }));
    this.log = opts.log || (() => {});
    this.code = generateRoomCode();
    this.scratch = createWorld(this.project);
    this.outbox = {
      send: (pid, frame) => {
        const m = this.members.get(pid);
        if (m && m.conn) m.conn.send(frame);
      },
      sendMany: (pids, frame) => {
        for (const pid of pids) {
          const m = this.members.get(pid);
          if (m && m.conn) m.conn.send(frame);
        }
      },
      transferOut: (pid, toMapId, x, y, dir) => {
        this.transferPlayer(pid, toMapId, x, y, dir);
      },
      sharedSet: (key, value) => {
        this.setShared(key, value);
      },
      recordPatch: (pid, patch) => {
        let fingerprint: string;
        let mapId: number;
        const m = this.members.get(pid);
        if (m) {
          fingerprint = m.fingerprint;
          mapId = m.mapId;
        } else {
          const tomb = this.recentDrops.get(pid);
          if (!tomb || this.clock() > tomb.until) return;
          fingerprint = tomb.fingerprint;
          mapId = tomb.mapId;
        }
        const rec = this.records.get(fingerprint);
        if (!rec) return;
        // A patch stamped with a zone the player has already left is stale —
        // drop it whole (the transfer race: a worker's exit mirror may land
        // after the directory re-homed the player).
        if (typeof patch.mapId === "number" && patch.mapId !== mapId) return;
        // Position keys land on the record itself (worker/DO zones mirror
        // positions this way — the directory can't read across the boundary);
        // everything else is durable per-player data (stage B widens it).
        for (const [k, v] of Object.entries(patch)) {
          if (k === "mapId") continue; // the stamp, consumed above
          else if (k === "x" && typeof v === "number") rec.x = v;
          else if (k === "y" && typeof v === "number") rec.y = v;
          else if (k === "dir" && typeof v === "number") rec.dir = v;
          else rec.data[k] = v;
        }
        this.dirtyRecords.add(fingerprint);
      },
    };
  }

  /* ── public surface (adapters + operator tools) ──────────────────────── */

  stats(): { zones: number; players: number; connections: number } {
    let players = 0;
    for (const m of this.members.values()) if (m.conn) players++;
    return { zones: this.zones.size, players, connections: this.conns.size };
  }

  get playerCount(): number {
    return this.members.size;
  }

  zoneIds(): number[] {
    return Array.from(this.zones.keys());
  }

  /** Ban a passport fingerprint (operator surface; MP9 wires the CLI). Kicks
   *  a live session immediately. */
  ban(fingerprint: string): void {
    this.bans.add(fingerprint);
    this.worldDirty = true;
    const m = this.byFingerprint.get(fingerprint);
    if (m && m.conn) {
      m.conn.send(encodeMessage({ t: "kick", code: "banned" }));
      m.conn.close();
    }
  }

  /** Write one world-shared state cell and fan it out to every zone (the
   *  stage-B event runtime calls this via the zone outbox). */
  setShared(key: string, value: JsonValue): void {
    this.shared.set(key, value);
    this.worldDirty = true;
    for (const zone of this.zones.values()) zone.applyShared(key, value);
  }

  /** Move a player to another map (the cross-zone transfer handoff, gateway
   *  model). Omitted x/y/dir fall back to the map's authored spawn / start.
   *  Stage B's event runtime drives this through ZoneOutbox.transferOut. */
  transferPlayer(pid: PlayerId, mapId: number, x?: number, y?: number, dir?: number): boolean {
    const member = this.members.get(pid);
    if (!member) return false;
    if (this.zoneOccupancy(mapId) >= this.limits.maxPlayersPerZone) return false;
    const spawn = this.spawnOn(mapId, x, y, dir);
    const from = this.zones.get(member.mapId);
    if (from) {
      this.noteRecordPosition(member); // capture the exit position first
      from.remove(pid, true);
      this.bumpZone(member.mapId, -1);
    }
    const to = this.zoneFor(mapId);
    member.mapId = mapId;
    this.bumpZone(mapId, +1);
    // Admit pushes the fresh snapshot — the client renders the new map from
    // it exactly like a late join (the socket never moved: gateway model).
    to.admit(pid, member.name, member.charset, spawn.x, spawn.y, spawn.dir, true);
    const rec = this.records.get(member.fingerprint);
    if (rec) {
      rec.mapId = mapId;
      rec.x = spawn.x;
      rec.y = spawn.y;
      rec.dir = spawn.dir;
      this.dirtyRecords.add(member.fingerprint);
    }
    return true;
  }

  /** Accept a new client link (adapter entry, same seam as BeaconServer). */
  accept(conn: ServerConnection): void {
    const now = this.clock();
    const st: ConnState = {
      conn, phase: "new", nonce: randomChallengeNonce(), name: "", fingerprint: "",
      member: null, queue: [], tokens: this.limits.messageBurst, lastRefill: now,
      strikes: 0, lastActivity: now,
    };
    this.conns.add(st);
    conn.onMessage((text) => this.onFrame(st, text));
    conn.onClose(() => this.onClose(st));
    // The challenge goes out immediately — a passported client signs it into
    // its hello; a friend-room client would never see one (different server).
    conn.send(encodeMessage({ t: "challenge", nonce: st.nonce }));
  }

  /** Advance every zone one 60 Hz tick (in-process zones; worker/DO zones
   *  self-tick and ignore this). */
  tickZones(): void {
    for (const zone of this.zones.values()) zone.tick();
  }

  /** 1 Hz housekeeping: reap resume-grace members, expire empty zones, close
   *  idle links, forget stale join buckets, refresh record positions. */
  sweep(): void {
    const now = this.clock();
    for (const m of Array.from(this.members.values())) {
      if (m.conn === null && now - m.disconnectedAt >= this.limits.resumeGraceMs) {
        this.dropMember(m, true);
      } else {
        this.noteRecordPosition(m);
      }
    }
    for (const [mapId, count] of this.zoneCounts) {
      if (count > 0) {
        this.zoneEmptySince.delete(mapId);
      } else {
        const since = this.zoneEmptySince.get(mapId);
        if (since === undefined) this.zoneEmptySince.set(mapId, now);
        else if (now - since >= this.limits.emptyZoneTtlMs) this.dropZone(mapId);
      }
    }
    for (const st of Array.from(this.conns)) {
      if (now - st.lastActivity >= this.limits.idleTimeoutMs) {
        this.log("info", "conn-idle-timeout", { source: st.conn.source });
        st.conn.close();
      }
    }
    for (const [src, b] of Array.from(this.joinBuckets.entries())) {
      if (now - b.windowStart >= this.limits.joinWindowMs) this.joinBuckets.delete(src);
    }
    for (const [pid, tomb] of Array.from(this.recentDrops.entries())) {
      if (now > tomb.until) this.recentDrops.delete(pid);
    }
  }

  shutdown(): void {
    for (const m of this.members.values()) {
      this.noteRecordPosition(m);
      if (m.conn) {
        m.conn.send(encodeMessage({ t: "kick", code: "room-closed" }));
        m.conn.close();
      }
    }
    this.members.clear();
    this.byFingerprint.clear();
    for (const zone of this.zones.values()) zone.stop();
    this.zones.clear();
    this.zoneCounts.clear();
    for (const st of this.conns) st.conn.close();
    this.conns.clear();
  }

  /** The in-memory record for a fingerprint (stage B persists these). */
  recordOf(fingerprint: string): PlayerRecord | undefined {
    return this.records.get(fingerprint);
  }

  /* ── persistence (§A5) ───────────────────────────────────────────────────
     load() restores durable state at start (before any connection); flush()
     writes the dirty set on the driver's cadence + graceful shutdown. Both are
     no-ops without a store, so an ephemeral world is byte-identical to before. */

  /** Restore world-shared state, bans, player records, and per-zone snapshots
   *  from the store. Idempotent; call once before accepting connections. The
   *  passport auth pipeline stays synchronous because records are preloaded
   *  here (D-8-5) rather than fetched per join. */
  async load(): Promise<void> {
    if (!this.store || this.loaded) return;
    this.loaded = true;
    const w = await this.store.loadWorld();
    if (w) {
      for (const [key, value] of Object.entries(w.shared)) this.shared.set(key, value);
      for (const fp of w.bans) this.bans.add(fp);
    }
    for (const [fp, rec] of await this.store.loadRecords()) this.records.set(fp, rec);
    for (const mapId of await this.store.zoneIds()) {
      const snap = await this.store.loadZone(mapId);
      if (snap) this.pendingZoneSnapshots.set(mapId, snap);
    }
    this.log("info", "world-loaded", {
      records: this.records.size, bans: this.bans.size, zoneSnapshots: this.pendingZoneSnapshots.size,
    });
  }

  /** Persist everything that changed since the last flush: the world snapshot
   *  (if shared/bans moved), the dirty player records, and a fresh ZoneSnapshot
   *  for every live in-process zone. Safe to call concurrently-ish (writes are
   *  atomic per unit); the driver calls it on a timer + at shutdown. */
  async flush(): Promise<void> {
    if (!this.store) return;
    // Refresh live positions into records first, so a flush captures the latest
    // tile even between the 1 Hz sweeps.
    for (const m of this.members.values()) this.noteRecordPosition(m);
    const tasks: Array<Promise<void>> = [];
    if (this.worldDirty) {
      this.worldDirty = false;
      tasks.push(
        this.store.saveWorld({
          shared: Object.fromEntries(this.shared),
          bans: Array.from(this.bans),
        }),
      );
    }
    if (this.dirtyRecords.size) {
      const batch: Array<[string, PlayerRecord]> = [];
      for (const fp of this.dirtyRecords) {
        const rec = this.records.get(fp);
        if (rec) batch.push([fp, rec]);
      }
      this.dirtyRecords.clear();
      if (batch.length) tasks.push(this.store.saveRecords(batch));
    }
    for (const [mapId, zone] of this.zones) {
      if (zone instanceof Zone) tasks.push(this.store.saveZone(mapId, zone.snapshot()));
    }
    await Promise.all(tasks);
  }

  /* ── connection pipeline (MP5 posture, see header) ───────────────────── */

  private onClose(st: ConnState): void {
    this.conns.delete(st);
    if (st.member && st.member.conn === st.conn) {
      st.member.conn = null;
      st.member.disconnectedAt = this.clock();
      this.noteRecordPosition(st.member);
    }
  }

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

  private strike(st: ConnState): void {
    if (++st.strikes >= 20) {
      this.log("warn", "conn-closed-strikes", { source: st.conn.source });
      st.conn.close();
    }
  }

  private onFrame(st: ConnState, text: string): void {
    st.lastActivity = this.clock();
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
    // While the async signature verify runs, well-behaved pipelining (a join
    // right behind the hello) parks in a small queue; a flood overflows it.
    if (st.phase === "authing") {
      if (st.queue.length >= 8) {
        this.strike(st);
        this.sendError(st, "rate-limited");
        return;
      }
      st.queue.push(decoded.msg);
      return;
    }
    this.route(st, decoded.msg);
  }

  private route(st: ConnState, msg: ClientMessage): void {
    if (st.phase === "in-world") {
      if (msg.t === "input" || msg.t === "reply" || msg.t === "emote" || msg.t === "chat" || msg.t === "custom") {
        const m = st.member;
        if (m && m.conn === st.conn) {
          const zone = this.zones.get(m.mapId);
          if (zone) zone.frame(m.pid, msg);
        }
      } else if (msg.t === "hello" || msg.t === "join" || msg.t === "resume") {
        this.sendError(st, "already-in-room");
      }
      return;
    }
    if (msg.t === "hello") {
      this.handleHello(st, msg);
      return;
    }
    if (st.phase !== "ready" || !st.name) {
      this.sendError(st, "malformed"); // join/resume before a (verified) hello
      return;
    }
    if (msg.t === "join") this.handleJoin(st, msg.code);
    else if (msg.t === "resume") this.handleResume(st, msg.code, msg.token);
    else this.sendError(st, "malformed");
  }

  private handleHello(st: ConnState, msg: Extract<ClientMessage, { t: "hello" }>): void {
    if (msg.proto !== PROTOCOL_VERSION) {
      this.log("info", "proto-mismatch", { got: msg.proto });
      this.sendError(st, "proto-mismatch", true);
      return;
    }
    const name = String(msg.name || "").slice(0, MAX_NAME_LEN);
    if (!this.requirePassport && (msg.pub === undefined || msg.sig === undefined)) {
      st.name = name;
      st.fingerprint = "anon:" + st.nonce; // test/tool mode: connection-scoped identity
      st.phase = "ready";
      return;
    }
    if (msg.pub === undefined || msg.sig === undefined) {
      this.sendError(st, "auth-failed", true); // a world needs a passport
      return;
    }
    st.phase = "authing";
    void this.verifyHello(st, name, msg.pub, msg.sig);
  }

  private async verifyHello(st: ConnState, name: string, pub: string, sig: string): Promise<void> {
    let fingerprint: string | null = null;
    if (await verifyChallenge(pub, st.nonce, sig)) fingerprint = await fingerprintOfPub(pub);
    if (!st.conn.isOpen) return;
    if (!fingerprint) {
      st.phase = "new";
      st.queue.length = 0;
      this.sendError(st, "auth-failed", true);
      return;
    }
    if (this.bans.has(fingerprint)) {
      st.phase = "new";
      st.queue.length = 0;
      st.conn.send(encodeMessage({ t: "kick", code: "banned" }));
      st.conn.close();
      return;
    }
    st.name = name;
    st.fingerprint = fingerprint;
    st.phase = "ready";
    const queued = st.queue.splice(0);
    for (const m of queued) this.route(st, m);
  }

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
    if (code !== undefined && code !== this.code) {
      // A world has no other rooms; a stray room code cannot exist here.
      this.sendError(st, "room-not-found");
      return;
    }
    // One live session per passport: a new sign-in supersedes the old.
    const existing = this.byFingerprint.get(st.fingerprint);
    if (existing) {
      if (existing.conn) {
        existing.conn.send(encodeMessage({ t: "kick", code: "replaced" }));
        existing.conn.close();
      }
      this.dropMember(existing, false);
    }
    if (this.members.size >= this.limits.maxPlayersPerWorld) {
      this.sendError(st, "room-full");
      return;
    }
    const rec = this.records.get(st.fingerprint);
    const spawn = rec
      ? this.spawnOn(rec.mapId, rec.x, rec.y, rec.dir)
      : (() => {
          const s = resolveSpawn(this.scratch, {});
          return { mapId: s.mapId, x: s.x, y: s.y, dir: s.dir };
        })();
    if (this.zoneOccupancy(spawn.mapId) >= this.limits.maxPlayersPerZone) {
      this.sendError(st, "room-full");
      return;
    }
    const pid = this.nextPid++;
    const member: WorldMember = {
      pid, fingerprint: st.fingerprint, name: st.name || "Player " + pid, charset: "",
      conn: st.conn, resumeToken: randomResumeToken(), mapId: spawn.mapId, disconnectedAt: 0,
    };
    this.members.set(pid, member);
    this.byFingerprint.set(st.fingerprint, member);
    this.records.set(st.fingerprint, {
      name: member.name, mapId: spawn.mapId, x: spawn.x, y: spawn.y, dir: spawn.dir,
      data: rec ? rec.data : {}, lastSeen: this.clock(),
    });
    this.dirtyRecords.add(st.fingerprint);
    st.member = member;
    st.phase = "in-world";
    st.conn.send(encodeMessage({
      t: "welcome", proto: PROTOCOL_VERSION, playerId: pid,
      roomCode: this.code, resumeToken: member.resumeToken, tick: 0,
    }));
    const zone = this.zoneFor(spawn.mapId);
    this.bumpZone(spawn.mapId, +1);
    zone.admit(pid, member.name, member.charset, spawn.x, spawn.y, spawn.dir, true);
    this.log("info", "world-join", { pid, mapId: spawn.mapId, players: this.members.size });
  }

  private handleResume(st: ConnState, code: string, token: string): void {
    if (!this.allowJoinAttempt(st)) return;
    if (code !== this.code) {
      this.sendError(st, "room-not-found");
      return;
    }
    for (const m of this.members.values()) {
      if (m.conn === null && m.resumeToken === token && m.fingerprint === st.fingerprint) {
        m.conn = st.conn;
        m.disconnectedAt = 0;
        m.resumeToken = randomResumeToken(); // rotate: a replayed token is dead
        st.member = m;
        st.phase = "in-world";
        st.conn.send(encodeMessage({
          t: "welcome", proto: PROTOCOL_VERSION, playerId: m.pid,
          roomCode: this.code, resumeToken: m.resumeToken, tick: 0,
        }));
        const zone = this.zones.get(m.mapId);
        if (zone) zone.requestSnapshot(m.pid);
        return;
      }
    }
    // Ambiguous on purpose (no token oracle) — same posture as MP5.
    this.sendError(st, "room-not-found");
  }

  /* ── zones + records ─────────────────────────────────────────────────── */

  private zoneFor(mapId: number): ZoneApi {
    let zone = this.zones.get(mapId);
    if (!zone) {
      zone = this.zoneFactory(mapId, this.outbox);
      this.zones.set(mapId, zone);
      if (!this.zoneCounts.has(mapId)) this.zoneCounts.set(mapId, 0);
      // Replay the world-shared state into the fresh replica (§A5).
      for (const [key, value] of this.shared) zone.applyShared(key, value);
      // Restore this map's persisted zone-local state, if any (in-process
      // zones only — a worker/DO zone gets its snapshot injected at spawn).
      const snap = this.pendingZoneSnapshots.get(mapId);
      if (snap && zone instanceof Zone) {
        zone.restore(snap);
        this.pendingZoneSnapshots.delete(mapId);
      }
      this.log("info", "zone-created", { mapId, zones: this.zones.size });
    }
    return zone;
  }

  private zoneOccupancy(mapId: number): number {
    return this.zoneCounts.get(mapId) || 0;
  }

  private bumpZone(mapId: number, delta: number): void {
    this.zoneCounts.set(mapId, Math.max(0, (this.zoneCounts.get(mapId) || 0) + delta));
  }

  private dropZone(mapId: number): void {
    const zone = this.zones.get(mapId);
    if (!zone) return;
    // Preserve the zone-local state across the expiry: stash it so a respawn
    // restores it, and persist it durably (§A5: snapshot on empty-zone expiry).
    if (zone instanceof Zone) {
      const snap = zone.snapshot();
      this.pendingZoneSnapshots.set(mapId, snap);
      if (this.store) void this.store.saveZone(mapId, snap).catch(() => {});
    }
    zone.stop();
    this.zones.delete(mapId);
    this.zoneCounts.delete(mapId);
    this.zoneEmptySince.delete(mapId);
    this.log("info", "zone-expired", { mapId });
  }

  private dropMember(m: WorldMember, announce: boolean): void {
    this.noteRecordPosition(m);
    const zone = this.zones.get(m.mapId);
    if (zone) {
      // Out-of-process zones answer the remove with an async exit-position
      // patch — leave a tombstone so it still reaches the record.
      if (!(zone instanceof Zone)) {
        this.recentDrops.set(m.pid, { fingerprint: m.fingerprint, mapId: m.mapId, until: this.clock() + 5000 });
      }
      zone.remove(m.pid, announce);
    }
    this.bumpZone(m.mapId, -1);
    this.members.delete(m.pid);
    if (this.byFingerprint.get(m.fingerprint) === m) this.byFingerprint.delete(m.fingerprint);
  }

  /** Pull the member's live position out of its zone into the record (the
   *  1 Hz sweep + every leave/transfer path). In-process zones expose
   *  positionOf; worker/DO zones mirror positions via recordPatch instead. */
  private noteRecordPosition(m: WorldMember): void {
    const rec = this.records.get(m.fingerprint);
    if (!rec) return;
    const zone = this.zones.get(m.mapId);
    const pos = zone instanceof Zone ? zone.positionOf(m.pid) : null;
    rec.mapId = m.mapId;
    if (pos) {
      rec.x = pos.x;
      rec.y = pos.y;
      rec.dir = pos.dir;
    }
    rec.lastSeen = this.clock();
    this.dirtyRecords.add(m.fingerprint);
  }

  /** Spawn placement on a map: explicit coords win; else the map's authored
   *  multiplayer spawn point; else the project start (resolveSpawn rules). */
  private spawnOn(mapId: number, x?: number, y?: number, dir?: number): { mapId: number; x: number; y: number; dir: number } {
    const s = resolveSpawn(this.scratch, { mapId, x, y, dir });
    return { mapId, x: s.x, y: s.y, dir: s.dir };
  }
}

/** UTF-8 byte length (the true wire size the byte cap enforces). */
function byteLen(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
