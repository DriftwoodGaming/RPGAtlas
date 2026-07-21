/* RPGAtlas — vitest.config.mjs
   Vitest for new code. The legacy suites keep running under `node --test`
   (npm test); Vitest owns TS/ESM unit tests under src/ and tests-unit/.
   GPL-3.0-or-later. */

import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Only pick up the new Vitest specs; the node:test suites in tests/ are run
    // separately by `npm test` and must not be double-collected here.
    include: [
      "src/**/*.{test,spec}.{js,mjs,ts}",
      "tests-unit/**/*.{test,spec}.{js,mjs,ts}",
    ],
    // Project Beacon MP5: the Beacon tests that open REAL TCP WebSockets + run a
    // live 60 Hz server tick (beacon-ws, relay-client, beacon-load) are timing-
    // sensitive; in the parallel pool they starve perf-budget tests
    // (mz-scale-import) and flake each other under CPU contention. They run
    // isolated + serial via `npm run test:net` (vitest.net.config.mjs). The rest
    // of the Beacon suite uses in-memory mock connections and stays here.
    exclude: [
      ...configDefaults.exclude,
      "tests-unit/beacon-ws.test.ts",
      "tests-unit/relay-client.test.ts",
      "tests-unit/beacon-load.test.ts",
      "tests-unit/zone-worker.test.ts", // MP8·A: real worker threads + 60 Hz timers
      "tests-unit/world-smoke.test.ts", // MP8·B: real sockets + 60 Hz world tick
      "tests-unit/world-engine-events.test.ts", // MP8·B: engine runtime in a real worker
      "tests-unit/room-battle.test.ts", // MP9·E E2·b: engine friend room in a real worker
      "tests-unit/relay-cf-fallback.test.ts", // post-2.0: real sockets vs a CF-shaped stub
    ],
  },
});
