/* RPGAtlas — server/src/node/worker-room.ts
   Project Beacon MP9·E (E2, D-9E-1): the parent-side adapter that hosts a whole
   friend room's engine world (RoomWorld) on a worker_threads worker
   (room-worker.ts). Implements RoomSim by posting the fire-and-forget ops and
   routes the worker's outbox sends back into the room's RoomOutbox — the room
   (server.ts + room.ts) cannot tell a worker-hosted engine world from an
   in-process one (the worker-per-room seam, parallel to worker-zone.ts).

   `tick()` is a no-op here: the room world self-ticks at 60 Hz on its own thread
   (that is the point — a room's whole sim leaves the gateway thread, so one
   process can host many engine rooms). GPL-3.0-or-later (see LICENSE). */

import { Worker } from "node:worker_threads";
import type { RoomOutbox, RoomSim } from "../core/room-world.js";
import type { RoomWorkerIn, RoomWorkerOut } from "./room-worker.js";
import type { BeaconLimits } from "../core/config.js";
import type { ClientMessage, PlayerId } from "../../../src/shared/net/protocol.js";

export interface WorkerRoomFactoryOptions {
  /** Path/URL of the BUILT worker entry (dist/room-worker.mjs — or a test
   *  bundle; workers execute JS, not TS). */
  entry: string | URL;
  /** The project as JSON text (structured-clone once per room). */
  projectJson: string;
  limits: BeaconLimits;
  seed?: number | null;
  log?: (level: "info" | "warn", event: string, detail?: Record<string, unknown>) => void;
}

class WorkerRoomWorld implements RoomSim {
  private readonly worker: Worker;
  private stopped = false;

  constructor(outbox: RoomOutbox, opts: WorkerRoomFactoryOptions) {
    this.worker = new Worker(opts.entry, {
      workerData: {
        projectJson: opts.projectJson,
        limits: opts.limits,
        seed: opts.seed ?? null,
      },
    });
    this.worker.unref(); // a room never keeps the process alive by itself
    this.worker.on("message", (msg: RoomWorkerOut) => {
      if (msg.op === "send") outbox.send(msg.pid, msg.frame);
      else if (msg.op === "sendMany") outbox.sendMany(msg.pids, msg.frame);
    });
    this.worker.on("error", (e) => {
      opts.log?.("warn", "room-worker-error", { error: String(e) });
    });
  }

  private post(msg: RoomWorkerIn): void {
    if (!this.stopped) this.worker.postMessage(msg);
  }

  admit(pid: PlayerId, name: string, charset: string, snapshot: boolean): void {
    this.post({ op: "admit", pid, name, charset, snapshot });
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

/** A BeaconServer `roomSimFactory` that hosts every room's engine world on its
 *  own worker thread. Wired in room mode by default (self-hosted `beacon.mjs
 *  --project`); `--max-rooms N` caps how many workers a shared relay will spawn.
 *  The per-room `project` argument is ignored — all rooms in one process host
 *  the same configured game (opts.projectJson). */
export function workerRoomFactory(
  opts: WorkerRoomFactoryOptions,
): (project: unknown, outbox: RoomOutbox) => RoomSim {
  return (_project, outbox) => new WorkerRoomWorld(outbox, opts);
}
