/* RPGAtlas — server/src/core/store.ts
   Project Beacon MP8·B: durable world persistence — the `WorldStore` adapter
   from the stage-A design (docs/mp-8-spec.md §A5). A persistent world's state
   is partitioned into three units and this narrow, async interface is the ONE
   seam every storage backend implements:

     - WorldSnapshot  — world-shared switches/vars/timeOfDay + the ban list.
     - PlayerRecord   — one per passport fingerprint: last position + a durable
                        per-player `data` bag (pSwitches now; party/inv once the
                        per-zone event runtime lands, D-8-0).
     - ZoneSnapshot   — one per occupied map: the zone-local state (selfSw now;
                        event-runtime positions/pages/respawn timers later).

   Two production backends ship: the Node default is a zero-dep JSON snapshot
   directory (file-store.ts — the answered branch point, atomic-rename writes);
   the Cloudflare target wraps DO storage (the KvWorldStore below over a DO
   `storage` handle). MemoryWorldStore backs the tests and a `--data`-less run.

   Deviation from the §A5 sketch (D-8-5): records load as ONE batch
   (`loadRecords()`) at world start instead of `loadRecord(fingerprint)` lazily
   per join. Rationale: it keeps the MP5-audited auth pipeline (verifyHello →
   handleJoin) fully SYNCHRONOUS — no `await` inserted into the door — and a
   1000-player record set is ~1 MB (§A5), trivial to preload. The file store
   reads one file; the DO store lists one key prefix (transactional). Pure +
   DOM-free; runs on Node ≥ 20 and workerd. GPL-3.0-or-later (see LICENSE). */

import type { JsonValue } from "../../../src/shared/net/protocol.js";

/** A passport-keyed player record — the per-player persistence unit. Keyed by
 *  the SHA-256 fingerprint of the passport public key (never PII, never an IP —
 *  D6/§A6). Position lets a rejoin land where you left off; `data` is the
 *  durable per-player bag the zone event runtime widens (pSwitches, and
 *  party/inv/gold slices once events run server-side). */
export interface PlayerRecord {
  name: string;
  mapId: number;
  x: number;
  y: number;
  dir: number;
  data: Record<string, JsonValue>;
  lastSeen: number;
}

/** World-shared persistence unit: the directory-owned shared cells (switches/
 *  vars/timeOfDay, keyed "switch:N" | "var:N" | "timeOfDay" — the same keys the
 *  zone `applyShared` seam speaks) plus the operator ban list (passport
 *  fingerprints). */
export interface WorldSnapshot {
  shared: Record<string, JsonValue>;
  bans: string[];
}

/** Per-zone (per-map) persistence unit: the zone-local state a fresh zone must
 *  restore to behave as it did before an eviction/restart. `selfSw` holds the
 *  map-scoped self-switches; `data` is reserved for the event-runtime state
 *  (event positions/pages, respawn timers) the per-zone runtime adds (D-8-0). */
export interface ZoneSnapshot {
  selfSw: Record<string, boolean>;
  data: Record<string, JsonValue>;
}

/** The one durable-storage seam. Every method is async; a backend may be a
 *  file directory, DO storage, or (tests) an in-memory map. Load returns null
 *  when nothing has been saved yet (a fresh world). */
export interface WorldStore {
  loadWorld(): Promise<WorldSnapshot | null>;
  saveWorld(snap: WorldSnapshot): Promise<void>;
  /** Every stored player record (batch — see the D-8-5 header note). */
  loadRecords(): Promise<Array<[string, PlayerRecord]>>;
  /** Merge a batch of records (dirty set) into the store. */
  saveRecords(batch: Array<[string, PlayerRecord]>): Promise<void>;
  loadZone(mapId: number): Promise<ZoneSnapshot | null>;
  saveZone(mapId: number, snap: ZoneSnapshot): Promise<void>;
  /** Map ids that have a stored ZoneSnapshot (so a restart can restore them
   *  before any player arrives). */
  zoneIds(): Promise<number[]>;
}

/** A minimal async key/value surface — exactly the slice of Cloudflare DO
 *  storage (and any similar KV) the world persistence needs. A DO passes its
 *  `state.storage` adapted to this; tests pass an in-memory map. */
export interface AsyncKv {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  /** All keys beginning with `prefix` (DO storage `list({ prefix })`). */
  list(prefix: string): Promise<string[]>;
}

const REC_PREFIX = "rec:";
const ZONE_PREFIX = "zone:";
const WORLD_KEY = "world";

/** A WorldStore over any AsyncKv (the Cloudflare DO target: wrap the DO's
 *  `state.storage`). Records and zones are individual keys (small, so DO
 *  storage's per-key transactions fit); the world snapshot is one key. */
export class KvWorldStore implements WorldStore {
  constructor(private readonly kv: AsyncKv) {}

  async loadWorld(): Promise<WorldSnapshot | null> {
    const v = await this.kv.get<WorldSnapshot>(WORLD_KEY);
    return v ? normalizeWorld(v) : null;
  }
  async saveWorld(snap: WorldSnapshot): Promise<void> {
    await this.kv.put(WORLD_KEY, snap);
  }
  async loadRecords(): Promise<Array<[string, PlayerRecord]>> {
    const keys = await this.kv.list(REC_PREFIX);
    const out: Array<[string, PlayerRecord]> = [];
    for (const key of keys) {
      const rec = await this.kv.get<PlayerRecord>(key);
      if (rec) out.push([key.slice(REC_PREFIX.length), normalizeRecord(rec)]);
    }
    return out;
  }
  async saveRecords(batch: Array<[string, PlayerRecord]>): Promise<void> {
    for (const [fp, rec] of batch) await this.kv.put(REC_PREFIX + fp, rec);
  }
  async loadZone(mapId: number): Promise<ZoneSnapshot | null> {
    const v = await this.kv.get<ZoneSnapshot>(ZONE_PREFIX + mapId);
    return v ? normalizeZone(v) : null;
  }
  async saveZone(mapId: number, snap: ZoneSnapshot): Promise<void> {
    await this.kv.put(ZONE_PREFIX + mapId, snap);
  }
  async zoneIds(): Promise<number[]> {
    const keys = await this.kv.list(ZONE_PREFIX);
    return keys.map((k) => Number(k.slice(ZONE_PREFIX.length))).filter((n) => Number.isFinite(n));
  }
}

/** An in-memory AsyncKv (tests + the CF DO-storage mock). Values are
 *  structured-cloned on the way in and out so a caller can't mutate stored
 *  state by reference — matching real DO storage semantics. */
export class MemoryKv implements AsyncKv {
  private readonly map = new Map<string, string>();
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const v = this.map.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }
  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.map.keys()) if (k.startsWith(prefix)) out.push(k);
    return out;
  }
}

/** The tests' (and a store-less run's) WorldStore: KV over an in-memory map.
 *  Persistence is real within the process lifetime — a second BeaconWorld built
 *  on the SAME MemoryWorldStore restores exactly what the first saved, which is
 *  the kill-a-zone/restore load-gate proof without touching disk. */
export class MemoryWorldStore extends KvWorldStore {
  constructor() {
    super(new MemoryKv());
  }
}

/* ── defensive normalizers (stored JSON is treated as possibly-corrupt) ──── */

function num(v: unknown, dflt = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}

export function normalizeRecord(v: unknown): PlayerRecord {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const data = r.data && typeof r.data === "object" ? (r.data as Record<string, JsonValue>) : {};
  return {
    name: typeof r.name === "string" ? r.name : "",
    mapId: num(r.mapId),
    x: num(r.x),
    y: num(r.y),
    dir: num(r.dir),
    data,
    lastSeen: num(r.lastSeen),
  };
}

export function normalizeWorld(v: unknown): WorldSnapshot {
  const w = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const shared = w.shared && typeof w.shared === "object" ? (w.shared as Record<string, JsonValue>) : {};
  const bans = Array.isArray(w.bans) ? w.bans.filter((b): b is string => typeof b === "string") : [];
  return { shared, bans };
}

export function normalizeZone(v: unknown): ZoneSnapshot {
  const z = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const selfSw: Record<string, boolean> = {};
  if (z.selfSw && typeof z.selfSw === "object") {
    for (const [k, val] of Object.entries(z.selfSw as Record<string, unknown>)) selfSw[k] = !!val;
  }
  const data = z.data && typeof z.data === "object" ? (z.data as Record<string, JsonValue>) : {};
  return { selfSw, data };
}
