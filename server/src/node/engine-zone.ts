/* RPGAtlas — server/src/node/engine-zone.ts
   Project Beacon MP8·B (item 1, D-8-0): the composition seam that plugs the
   engine event runtime into a Beacon zone. This is the ONE server module that
   imports the engine — keeping the rest of server/src off the engine graph —
   and it re-exports the two things the drivers need: the engine `defaultWorld`
   (a zone adopts it so the interpreter's compat shim drives that zone) and
   `createZoneEventRuntime` (the ZoneRuntimeFactory).

   Importing this module evaluates the engine slice, which stands up the
   headless window shim (src/engine/net/headless-env.ts) BEFORE src/shared/deps
   reads it — so it is safe to import from a plain-Node bundle (beacon.mjs) or a
   worker bundle (zone-worker.mjs). GPL-3.0-or-later (see LICENSE). */

import { createZoneEventRuntime } from "../../../src/engine/net/zone-event-runtime.js";
import { defaultWorld } from "../../../src/engine/state/default-world.js";
import { Zone, type ZoneApi, type ZoneOutbox } from "../core/zone.js";
import type { WorldLimits } from "../core/config.js";
import type { World } from "../../../src/shared/sim/world.js";

export { createZoneEventRuntime };
export const engineDefaultWorld: World = defaultWorld;

export interface EngineZoneOptions {
  project: unknown;
  limits: WorldLimits;
  seed?: number | null;
  log?: (level: "info" | "warn", event: string, detail?: Record<string, unknown>) => void;
}

/** A BeaconWorld `zoneFactory` that runs the ENGINE event runtime IN-PROCESS.
 *  Only the first occupied map gets the runtime (the engine's `defaultWorld` is
 *  a single process-global — §A2); a second occupied map falls back to a plain
 *  player-layer zone with a warning. In-process engine worlds are therefore
 *  single-map; multi-map engine worlds shard onto worker threads
 *  (`--engine-events --zone-workers`), where each worker owns its own
 *  defaultWorld. */
export function engineZoneFactory(
  opts: EngineZoneOptions,
): (mapId: number, outbox: ZoneOutbox) => ZoneApi {
  let claimed = false;
  return (mapId, outbox) => {
    if (!claimed) {
      claimed = true;
      return new Zone(mapId, opts.project, outbox, {
        limits: opts.limits,
        seed: opts.seed ?? null,
        world: engineDefaultWorld,
        runtimeFactory: createZoneEventRuntime,
      });
    }
    opts.log?.("warn", "engine-zone-inproc-extra-map", { mapId });
    return new Zone(mapId, opts.project, outbox, { limits: opts.limits, seed: opts.seed ?? null });
  };
}
