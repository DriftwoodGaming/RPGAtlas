/* RPGAtlas — server/bench/tick-strategy.mjs
   Project Beacon MP8·A: THE tick-strategy measurement (roadmap: "60 Hz sim
   vs decimated tick + interpolation is decided by measurement, not
   assumed"). Drives one Zone headlessly — no sockets, no timers, a tight
   loop of 60 Hz sim ticks with synthetic random-walking members — and
   measures, per configuration:

     - CPU: wall ms burned per SIM SECOND (60 ticks) — movement + AOI
       bucketing + broadcast encode, everything the zone does.
     - Wire: outbound bytes/s per client and per zone (frame length ×
       recipients, ASCII JSON ≈ 1 byte/char).

   Matrix: players × broadcast rate (60/20/12/6 Hz) × AOI on/off. The sim
   rate itself NEVER changes (motion constants are per-tick); only the
   broadcast cadence is a knob. Run:  node bench/tick-strategy.mjs
   Results + the decision live in docs/mp-8-spec.md §A4. GPL-3.0. */

import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Bundle the Zone core (TS) into an importable module for this bench. */
async function loadCore() {
  const entrySrc = `
    export { Zone } from ${JSON.stringify(resolve(here, "../src/core/zone.ts").replace(/\\/g, "/"))};
    export { DEFAULT_WORLD_LIMITS } from ${JSON.stringify(resolve(here, "../src/core/config.ts").replace(/\\/g, "/"))};
  `;
  const out = await build({
    stdin: { contents: entrySrc, resolveDir: here, loader: "ts" },
    bundle: true, platform: "node", target: "node20", format: "esm",
    write: false, external: ["ws"], logLevel: "silent",
  });
  const dir = await mkdtemp(join(tmpdir(), "rpgatlas-tickbench-"));
  const file = join(dir, "core.mjs");
  await writeFile(file, out.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}) };
}

/** 128×128 open field (a persistent-world-sized zone map). */
const SIZE = 128;
const PROJECT = {
  system: { startMapId: 1, startX: 1, startY: 1, startDir: "down" },
  maps: [{ id: 1, width: SIZE, height: SIZE, layers: { ground: new Array(SIZE * SIZE).fill(1) } }],
  assets: { tiles: {} },
  autotiles: [],
};

/** Deterministic RNG (reproducible runs). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIM_SECONDS = 10; // 600 ticks per configuration
const TICKS = SIM_SECONDS * 60;
const DIRS = ["down", "left", "right", "up"];

function runConfig(Zone, LIMITS, players, broadcastEveryTicks, aoi) {
  const limits = {
    ...LIMITS,
    broadcastEveryTicks,
    aoiBypassMax: aoi ? 32 : Number.MAX_SAFE_INTEGER,
  };
  let bytes = 0;
  const outbox = {
    send: (_pid, frame) => { bytes += frame.length; },
    sendMany: (pids, frame) => { bytes += frame.length * pids.length; },
    transferOut: () => {},
    sharedSet: () => {},
    recordPatch: () => {},
  };
  const zone = new Zone(1, PROJECT, outbox, { limits, seed: 42 });
  const rand = rng(1234);
  const seqs = new Map();
  for (let pid = 1; pid <= players; pid++) {
    const x = 1 + Math.floor(rand() * (SIZE - 2));
    const y = 1 + Math.floor(rand() * (SIZE - 2));
    zone.admit(pid, "Bot " + pid, "", x, y, 0, false);
    seqs.set(pid, 0);
  }
  bytes = 0; // ignore join presence

  const t0 = performance.now();
  for (let t = 0; t < TICKS; t++) {
    // hold-to-walk: every idle bot asks for another random step (worst case
    // input pressure ≈ 5 intents/s/bot at walk speed).
    for (const [pid, e] of zone.world.roster.players) {
      if (!e.moving) {
        const seq = seqs.get(pid) + 1;
        seqs.set(pid, seq);
        zone.frame(pid, { t: "input", seq, intent: { k: "move", dir: DIRS[Math.floor(rand() * 4)] } });
      }
    }
    zone.tick();
  }
  const wallMs = performance.now() - t0;
  return {
    players,
    hz: Math.round(60 / broadcastEveryTicks),
    aoi,
    cpuMsPerSimSec: wallMs / SIM_SECONDS,
    kbPerSecPerClient: bytes / SIM_SECONDS / players / 1024,
    zoneMbPerSec: bytes / SIM_SECONDS / (1024 * 1024),
  };
}

const { mod, cleanup } = await loadCore();
const { Zone, DEFAULT_WORLD_LIMITS } = mod;

console.log(`tick-strategy bench — ${SIZE}×${SIZE} zone, ${SIM_SECONDS}s sim per config, hold-to-walk bots`);
console.log("players | bcast | AOI | CPU ms/sim-s | KB/s/client | zone MB/s");
console.log("--------|-------|-----|--------------|-------------|----------");
for (const players of [50, 100, 200, 400]) {
  for (const every of [1, 3, 5, 10]) {
    for (const aoi of [false, true]) {
      const r = runConfig(Zone, DEFAULT_WORLD_LIMITS, players, every, aoi);
      console.log(
        String(r.players).padStart(7) + " | " +
        String(r.hz + " Hz").padStart(5) + " | " +
        (r.aoi ? " on" : "off") + " | " +
        r.cpuMsPerSimSec.toFixed(1).padStart(12) + " | " +
        r.kbPerSecPerClient.toFixed(1).padStart(11) + " | " +
        r.zoneMbPerSec.toFixed(2).padStart(9),
      );
    }
  }
}
await cleanup();
