/* RPGAtlas — server/src/cf/world-do.ts
   Project Beacon MP8·B (item 3, D-8-1): the Cloudflare Durable Object PERSISTENT
   WORLD target. One DO hosts a whole BeaconWorld — the directory + its
   in-process map-zones + every player socket — with its state durably stored in
   the DO's own SQLite-backed storage. This is the "free-tier DO plan" self-host
   option from the roadmap (D2): a persistent world that survives hibernation and
   eviction, on Cloudflare, with no external database.

   How it closes the MP5·B boundary. room-do.ts documented that a mid-session
   eviction RESETS a room (a cold start rebuilt an empty room). A world DO does
   not: on cold start it rebuilds the BeaconWorld on the SAME DO storage and
   `await world.load()` restores the WorldSnapshot (switches/vars/timeOfDay +
   bans), every PlayerRecord (so a rejoin lands where the player left off), and
   every ZoneSnapshot (map-local self-switches + event state) — exactly the §A5
   units, through the SAME `KvWorldStore` the tests exercise, over
   `doStorageKv(state.storage)`. A periodic flush (the alarm) + the 60 Hz tick's
   dirty tracking keep the crash-loss window inside the §A5 ≤ 30 s budget.

   Tick cadence: the DO drives the authoritative 60 Hz sim with the SAME
   drift-compensated loop the Node drivers use (a plain 16.7 ms setInterval
   quantizes on some hosts — §A3) so world sim time tracks the wall clock.

   Scope (D-8-7 — the multi-DO scale-out): this single DO hosts the whole world,
   so cross-zone transfer is the in-process gateway (the socket never moves — no
   `handoff` needed). Sharding zones across SEPARATE DOs (one DO per zone + this
   as the directory DO, the socket-per-zone `handoff` reconnect) is the scale
   step beyond one isolate; the seams are ready (the `handoff` protocol frame,
   `doStorageKv`, ZoneSnapshots) and it is carried as D-8-7. GPL-3.0-or-later. */

import { BeaconWorld } from "../core/beacon-world.js";
import { KvWorldStore } from "../core/store.js";
import { doStorageKv } from "./do-store.js";
import type { ServerConnection } from "../core/connection.js";

/** The Worker env bindings the world DO needs: its own namespace + the game
 *  project JSON in KV (too large for a plaintext var), loaded once per isolate. */
export interface WorldEnv {
  BEACON_WORLD: DurableObjectNamespace;
  GAME: KVNamespace;
}

const TICK_MS = 1000 / 60;
const SWEEP_ALARM_MS = 1000;
/** Durable flush cadence in alarm ticks (§A5 crash-loss budget ≤ 30 s). */
const FLUSH_EVERY_ALARMS = 30;
let connSeq = 0;

/** Wrap a hibernatable WebSocket as a ServerConnection (mirrors room-do.ts —
 *  the message/close handlers live only in the live isolate; the DO re-wraps
 *  sockets on a cold start). */
function wrapWebSocket(
  ws: WebSocket,
  source: string,
): ServerConnection & { deliver(t: string): void; fireClose(): void } {
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

export class BeaconWorldDO {
  private readonly state: DurableObjectState;
  private readonly env: WorldEnv;
  private world: BeaconWorld | null = null;
  private building: Promise<BeaconWorld> | null = null;
  private readonly conns = new Map<WebSocket, ReturnType<typeof wrapWebSocket>>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private alarms = 0;

  constructor(state: DurableObjectState, env: WorldEnv) {
    this.state = state;
    this.env = env;
  }

  /** Build (once) the BeaconWorld this DO hosts — over DO-storage persistence —
   *  and RESTORE its durable state before anyone connects (the hibernation
   *  fix). Cached for the isolate's lifetime; concurrent callers await one
   *  build so `load()` runs exactly once. */
  private getWorld(): Promise<BeaconWorld> {
    if (this.world) return Promise.resolve(this.world);
    if (!this.building) {
      this.building = (async () => {
        const projectJson = await this.env.GAME.get("project");
        if (!projectJson) throw new Error("beacon: GAME KV has no 'project' key");
        const store = new KvWorldStore(doStorageKv(this.state.storage));
        const world = new BeaconWorld({ project: JSON.parse(projectJson), store, requirePassport: true });
        await world.load(); // §A5 restore: WorldSnapshot + records + ZoneSnapshots
        this.world = world;
        return world;
      })();
    }
    return this.building;
  }

  /** Drift-compensated 60 Hz (the §A3 pattern): advance the sim by the wall
   *  time actually elapsed, capped so a stall can't spiral. Stops itself when
   *  no sockets remain (the isolate may then hibernate). */
  private startTicking(): void {
    if (this.tickTimer) return;
    this.last = Date.now();
    this.acc = 0;
    this.tickTimer = setInterval(() => {
      const now = Date.now();
      this.acc += now - this.last;
      this.last = now;
      let n = Math.floor(this.acc / TICK_MS);
      if (n > 30) { this.acc = 0; n = 30; } else { this.acc -= n * TICK_MS; }
      while (n-- > 0) this.world?.tickZones();
      if (this.state.getWebSockets().length === 0) this.stopTicking();
    }, 8);
  }

  private stopTicking(): void {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  /** Worker → DO: the WebSocket upgrade for this world. */
  async fetch(req: Request): Promise<Response> {
    const world = await this.getWorld();
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response(JSON.stringify({ ok: true, mode: "world", ...world.stats() }), {
        headers: { "content-type": "application/json" },
      });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server); // hibernatable
    const conn = wrapWebSocket(server, req.headers.get("CF-Connecting-IP") || "cf");
    this.conns.set(server, conn);
    world.accept(conn);
    this.startTicking();
    void this.state.storage.setAlarm(Date.now() + SWEEP_ALARM_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Hibernation handler: one inbound frame. Rewraps the socket after a cold
   *  start; the client re-handshakes (passport hello + join) and — because the
   *  world reloaded its records from storage — lands at its saved position. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const world = await this.getWorld();
    let conn = this.conns.get(ws);
    if (!conn) {
      conn = wrapWebSocket(ws, "cf");
      this.conns.set(ws, conn);
      world.accept(conn); // cold-start re-accept: client must re-handshake
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

  /** Periodic sweep + durable flush via the storage alarm — runs even when the
   *  isolate would otherwise sleep. Flushes the dirty set every
   *  FLUSH_EVERY_ALARMS seconds (§A5). Re-arms while the world has players. */
  async alarm(): Promise<void> {
    const world = this.world;
    if (world) {
      world.sweep();
      if (++this.alarms % FLUSH_EVERY_ALARMS === 0) {
        await world.flush().catch(() => { /* a failed flush retries next cadence */ });
      }
    }
    if (this.state.getWebSockets().length > 0 || (world && world.playerCount > 0)) {
      void this.state.storage.setAlarm(Date.now() + SWEEP_ALARM_MS);
    } else if (world) {
      // Emptied: one last flush so a subsequent eviction loses nothing, then let
      // the isolate hibernate (a fresh message reloads from storage).
      await world.flush().catch(() => {});
    }
  }
}
