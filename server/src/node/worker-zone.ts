/* RPGAtlas — server/src/node/worker-zone.ts
   Project Beacon MP8·A: the parent-side adapter that hosts a Zone on a
   worker_threads worker (zone-worker.ts). Implements ZoneApi by posting the
   fire-and-forget op messages and routes the worker's outbox ops back into
   the directory's ZoneOutbox — the directory cannot tell a worker zone from
   an in-process one (the sharding seam, docs/mp-8-spec.md §A2/§A3).

   `tick()` is a no-op here: a worker zone self-ticks at 60 Hz on its own
   thread (that is the point — zone sim cost leaves the gateway thread).
   GPL-3.0-or-later (see LICENSE). */

import { Worker } from "node:worker_threads";
import type { ZoneApi, ZoneOutbox } from "../core/zone.js";
import type { ZoneWorkerIn, ZoneWorkerOut } from "./zone-worker.js";
import type { WorldLimits } from "../core/config.js";
import type { ClientMessage, JsonValue, PlayerId } from "../../../src/shared/net/protocol.js";

export interface WorkerZoneFactoryOptions {
  /** Path/URL of the BUILT worker entry (dist/zone-worker.mjs — or a test
   *  bundle; workers execute JS, not TS). */
  entry: string | URL;
  /** The project as JSON text (structured-clone once per zone). */
  projectJson: string;
  limits: WorldLimits;
  seed?: number | null;
  log?: (level: "info" | "warn", event: string, detail?: Record<string, unknown>) => void;
}

class WorkerZone implements ZoneApi {
  readonly mapId: number;
  private readonly worker: Worker;
  private stopped = false;

  constructor(mapId: number, outbox: ZoneOutbox, opts: WorkerZoneFactoryOptions) {
    this.mapId = mapId;
    this.worker = new Worker(opts.entry, {
      workerData: {
        mapId,
        projectJson: opts.projectJson,
        limits: opts.limits,
        seed: opts.seed ?? null,
      },
    });
    this.worker.unref(); // zones never keep the process alive by themselves
    this.worker.on("message", (msg: ZoneWorkerOut) => {
      if (msg.op === "send") outbox.send(msg.pid, msg.frame);
      else if (msg.op === "sendMany") outbox.sendMany(msg.pids, msg.frame);
      else if (msg.op === "transferOut") outbox.transferOut(msg.pid, msg.mapId, msg.x, msg.y, msg.dir);
      else if (msg.op === "sharedSet") outbox.sharedSet(msg.key, msg.value);
      else if (msg.op === "recordPatch") outbox.recordPatch(msg.pid, msg.patch);
    });
    this.worker.on("error", (e) => {
      opts.log?.("warn", "zone-worker-error", { mapId, error: String(e) });
    });
  }

  private post(msg: ZoneWorkerIn): void {
    if (!this.stopped) this.worker.postMessage(msg);
  }

  admit(pid: PlayerId, name: string, charset: string, x: number, y: number, dir: number, snapshot: boolean): void {
    this.post({ op: "admit", pid, name, charset, x, y, dir, snapshot });
  }
  remove(pid: PlayerId, announce: boolean): void {
    this.post({ op: "remove", pid, announce });
  }
  frame(pid: PlayerId, msg: ClientMessage): void {
    this.post({ op: "frame", pid, msg });
  }
  requestSnapshot(pid: PlayerId): void {
    this.post({ op: "snap", pid });
  }
  applyShared(key: string, value: JsonValue): void {
    this.post({ op: "shared", key, value });
  }
  tick(): void {
    // Self-ticking on its own thread.
  }
  stop(): void {
    if (this.stopped) return;
    this.post({ op: "stop" });
    this.stopped = true;
    void this.worker.terminate();
  }
}

/** A BeaconWorld `zoneFactory` that shards every zone onto its own worker
 *  thread. Wire it in world mode with `--zone-workers`. */
export function workerZoneFactory(
  opts: WorkerZoneFactoryOptions,
): (mapId: number, outbox: ZoneOutbox) => ZoneApi {
  return (mapId, outbox) => new WorkerZone(mapId, outbox, opts);
}
