/* RPGAtlas — server/build.mjs
   Bundle the Node Beacon server into a single runnable ESM file
   (server/dist/beacon.mjs). The core imports the shared sim + protocol from
   ../../src/shared, so esbuild inlines them — the deployed binary needs no
   RPGAtlas source tree, just Node + the `ws` dependency. GPL-3.0. */

import { build } from "esbuild";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "dist/beacon.mjs");
const workerOut = resolve(here, "dist/zone-worker.mjs");

await mkdir(dirname(out), { recursive: true });
await build({
  entryPoints: [resolve(here, "src/node/main.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // `ws` stays external (a real dependency installed alongside the bundle);
  // everything else (shared sim/protocol/collision) is inlined.
  external: ["ws"],
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
});
await chmod(out, 0o755).catch(() => {});
process.stdout.write(`built ${out}\n`);

// MP8·A: the worker_threads zone entry (`--world --zone-workers`) — a second
// self-contained bundle the main bundle spawns per zone.
await build({
  entryPoints: [resolve(here, "src/node/zone-worker.ts")],
  outfile: workerOut,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["ws"],
  legalComments: "none",
});
process.stdout.write(`built ${workerOut}\n`);
