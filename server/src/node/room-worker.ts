/* RPGAtlas — server/src/node/room-worker.ts
   Project Beacon MP9·E (E2, D-9E-1): the worker_threads entry for a friend
   room's ENGINE world — one whole room (RoomWorld) running on its own thread.
   This is the room analogue of zone-worker.ts: the parent (server.ts +
   room.ts) keeps the sockets and every room semantic (code, TTL, resume, owner,
   name-ban, chat gate) on the main thread and speaks to this worker purely in
   the fire-and-forget RoomSim/RoomOutbox ops below; the RoomWorld itself
   (core/room-world.ts) is IDENTICAL in-process and here.

   Why worker-per-room (not zone-per-worker): the engine's module-level G/ctx
   bind to ONE defaultWorld per thread (the MP8·A §A2 rule). A room is one engine
   world that ticks its occupied maps in this one instance (engineZoneFactory:
   start map = engine zone with the runtime, extra maps = player-layer), so each
   room gets its own thread and its own defaultWorld. Importing engine-zone.ts
   stands up the headless window shim BEFORE src/shared/deps reads it. The worker
   self-ticks at the engine cadence (drift-compensated 60 Hz, the zone-worker
   fix for Windows timer quantization). GPL-3.0-or-later (see LICENSE). */

import { parentPort, workerData } from "node:worker_threads";
import { RoomWorld, roomWorldLimits, type RoomOutbox } from "../core/room-world.js";
import { engineZoneFactory } from "./engine-zone.js";
import type { BeaconLimits } from "../core/config.js";
import type { ClientMessage, PlayerId } from "../../../src/shared/net/protocol.js";

/** Parent → worker ops (mirror RoomSim, all fire-and-forget). No `tick` (the
 *  worker self-ticks) and no `shared` (a room is the whole world — there is no
 *  outer directory writing shared state into it). */
export type RoomWorkerIn =
  | { op: "admit"; pid: PlayerId; name: string; charset: string; snapshot: boolean }
  | { op: "remove"; pid: PlayerId; announce: boolean }
  | { op: "frame"; pid: PlayerId; msg: ClientMessage }
  | { op: "snap"; pid: PlayerId }
  | { op: "stop" };

/** Worker → parent ops (mirror RoomOutbox — only the two delivery ops leave a
 *  room world; transfer/shared/record are resolved inside RoomWorld). */
export type RoomWorkerOut =
  | { op: "send"; pid: PlayerId; frame: string }
  | { op: "sendMany"; pids: PlayerId[]; frame: string };

interface RoomWorkerData {
  projectJson: string;
  limits: BeaconLimits;
  seed: number | null;
}

const TICK_MS = 1000 / 60;

function main(): void {
  const port = parentPort;
  if (!port) return; // imported for types, not running as a worker
  const init = workerData as RoomWorkerData;
  const post = (msg: RoomWorkerOut) => port.postMessage(msg);
  const outbox: RoomOutbox = {
    send: (pid, frame) => post({ op: "send", pid, frame }),
    sendMany: (pids, frame) => post({ op: "sendMany", pids, frame }),
  };
  const project = JSON.parse(init.projectJson);
  const room = new RoomWorld(project, outbox, {
    limits: init.limits,
    seed: init.seed,
    // The engine runtime on the start map (extra maps fall back to player-layer,
    // the one-defaultWorld-per-worker shape). Built with the room's every-tick
    // broadcast limits so a small room needs no decimation.
    zoneFactory: engineZoneFactory({ project, limits: roomWorldLimits(init.limits), seed: init.seed }),
  });

  // Drift-compensated 60 Hz self-tick (zone-worker.ts rationale): Windows
  // quantizes setInterval(16.7ms) to ~31 ms, which would halve the sim rate, so
  // fire faster and advance the whole ticks of wall time that actually elapsed.
  let last = Date.now();
  let acc = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    acc += now - last;
    last = now;
    let n = Math.floor(acc / TICK_MS);
    if (n > 30) { acc = 0; n = 30; } else { acc -= n * TICK_MS; }
    while (n-- > 0) room.tick();
  }, 8);

  port.on("message", (msg: RoomWorkerIn) => {
    if (msg.op === "admit") room.admit(msg.pid, msg.name, msg.charset, msg.snapshot);
    else if (msg.op === "remove") room.remove(msg.pid, msg.announce);
    else if (msg.op === "frame") room.frame(msg.pid, msg.msg);
    else if (msg.op === "snap") room.requestSnapshot(msg.pid);
    else if (msg.op === "stop") {
      clearInterval(timer);
      room.stop();
      port.close();
    }
  });
}

main();
