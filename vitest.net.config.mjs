/* RPGAtlas — vitest.net.config.mjs
   Project Beacon MP5: an ISOLATED, SERIAL runner for the Beacon tests that use
   REAL TCP WebSockets + a live 60 Hz server tick (beacon-ws, relay-client, and
   the beacon-load latency gate). Real sockets + real timers are timing-
   sensitive: run in the main parallel pool they both starve perf-budget tests
   (mz-scale-import) AND flake each other under CPU contention. `npm run
   test:net` runs them alone, one file at a time, so they are reliable and hurt
   nothing else. The rest of the Beacon suite (collision, server core + fuzz)
   uses in-memory mock connections and stays in the fast parallel pool.
   GPL-3.0-or-later. */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "tests-unit/beacon-ws.test.ts",
      "tests-unit/relay-client.test.ts",
      "tests-unit/beacon-load.test.ts",
      "tests-unit/zone-worker.test.ts", // MP8·A: worker_threads zone sharding
      "tests-unit/world-smoke.test.ts", // MP8·B: world load smoke + socket persistence
    ],
    fileParallelism: false,
  },
});
