/* RPGAtlas — server/src/node/zone-worker.ts
   Project Beacon MP8·A: the worker_threads ZONE entry — one zone (one map's
   sim) running on its own thread. The Node scale-out of the sharding seam:
   the directory (beacon-world.ts) stays on the main thread with the sockets
   (gateway model) and speaks to this worker purely in the fire-and-forget
   ZoneApi/ZoneOutbox messages below; the zone code itself (core/zone.ts) is
   IDENTICAL in-process and here — that seam is the whole point.

   The worker self-ticks at the engine cadence (60 Hz) and mirrors member
   positions to the directory once a second via recordPatch (the directory
   cannot reach positionOf across the thread), which keeps rejoin-at-last-
   position working in worker mode. Stage B's per-zone event runtime lands
   here: one zone per worker means the engine's default-world compat shim can
   bind to THIS zone's world (docs/mp-8-spec.md §A2). GPL-3.0-or-later. */

import { parentPort, workerData } from "node:worker_threads";
import { Zone, type ZoneOutbox } from "../core/zone.js";
import type { WorldLimits } from "../core/config.js";
import type { ClientMessage, JsonValue, PlayerId } from "../../../src/shared/net/protocol.js";

/** Parent → worker ops (mirror ZoneApi, all fire-and-forget). */
export type ZoneWorkerIn =
  | { op: "admit"; pid: PlayerId; name: string; charset: string; x: number; y: number; dir: number; snapshot: boolean }
  | { op: "remove"; pid: PlayerId; announce: boolean }
  | { op: "frame"; pid: PlayerId; msg: ClientMessage }
  | { op: "snap"; pid: PlayerId }
  | { op: "shared"; key: string; value: JsonValue }
  | { op: "stop" };

/** Worker → parent ops (mirror ZoneOutbox). */
export type ZoneWorkerOut =
  | { op: "send"; pid: PlayerId; frame: string }
  | { op: "sendMany"; pids: PlayerId[]; frame: string }
  | { op: "transferOut"; pid: PlayerId; mapId: number; x: number; y: number; dir: number }
  | { op: "sharedSet"; key: string; value: JsonValue }
  | { op: "recordPatch"; pid: PlayerId; patch: Record<string, JsonValue> };

interface ZoneWorkerData {
  mapId: number;
  projectJson: string;
  limits: WorldLimits;
  seed: number | null;
}

const TICK_MS = 1000 / 60;
const POSITION_MIRROR_TICKS = 60; // 1 Hz

function main(): void {
  const port = parentPort;
  if (!port) return; // not running as a worker (imported for types)
  const init = workerData as ZoneWorkerData;
  const post = (msg: ZoneWorkerOut) => port.postMessage(msg);
  const outbox: ZoneOutbox = {
    send: (pid, frame) => post({ op: "send", pid, frame }),
    sendMany: (pids, frame) => post({ op: "sendMany", pids, frame }),
    transferOut: (pid, mapId, x, y, dir) => post({ op: "transferOut", pid, mapId, x, y, dir }),
    sharedSet: (key, value) => post({ op: "sharedSet", key, value }),
    recordPatch: (pid, patch) => post({ op: "recordPatch", pid, patch }),
  };
  const zone = new Zone(init.mapId, JSON.parse(init.projectJson), outbox, {
    limits: init.limits,
    seed: init.seed,
  });
  const pids = new Set<PlayerId>(); // membership shadow for the position mirror
  // Every patch is stamped with THIS zone's mapId so the directory can drop a
  // stale one that lands after the player transferred away (the async race).
  const posPatch = (pid: PlayerId) => {
    const pos = zone.positionOf(pid);
    if (pos) post({ op: "recordPatch", pid, patch: { x: pos.x, y: pos.y, dir: pos.dir, mapId: init.mapId } });
  };
  let ticks = 0;
  // Drift-compensated 60 Hz: Windows quantizes a worker's setInterval(16.7ms)
  // to ~31 ms (the 15.6 ms timer clock), which would halve the sim rate. So
  // the interval fires FASTER than a tick and each firing advances however
  // many whole ticks of wall time actually elapsed (capped so a long stall
  // can't spiral). Sim time tracks the wall clock on every platform.
  let last = Date.now();
  let acc = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    acc += now - last;
    last = now;
    let n = Math.floor(acc / TICK_MS);
    if (n > 30) {
      acc = 0; // stalled (debugger, CPU starvation): drop the backlog
      n = 30;
    } else {
      acc -= n * TICK_MS;
    }
    while (n-- > 0) {
      zone.tick();
      if (++ticks % POSITION_MIRROR_TICKS === 0) {
        for (const pid of pids) posPatch(pid);
      }
    }
  }, 8);

  port.on("message", (msg: ZoneWorkerIn) => {
    if (msg.op === "admit") {
      pids.add(msg.pid);
      zone.admit(msg.pid, msg.name, msg.charset, msg.x, msg.y, msg.dir, msg.snapshot);
    } else if (msg.op === "remove") {
      // Mirror the exit position BEFORE the entity goes (transfer/leave both
      // want the final tile in the record; the mapId stamp keeps a late
      // arrival from clobbering a post-transfer spawn).
      posPatch(msg.pid);
      pids.delete(msg.pid);
      zone.remove(msg.pid, msg.announce);
    } else if (msg.op === "frame") {
      zone.frame(msg.pid, msg.msg);
    } else if (msg.op === "snap") {
      zone.requestSnapshot(msg.pid);
    } else if (msg.op === "shared") {
      zone.applyShared(msg.key, msg.value);
    } else if (msg.op === "stop") {
      clearInterval(timer);
      zone.stop();
      port.close();
    }
  });
}

main();
