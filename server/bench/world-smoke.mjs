/* RPGAtlas — server/bench/world-smoke.mjs
   Project Beacon MP8·A: the socketed world smoke — N passported bots over
   REAL WebSockets against a real BeaconWorld (in-process gateway, optional
   worker-thread zones = the actual multi-core deployment topology), spread
   round-robin across Z zones, random-walking + emoting, measuring
   intent→echo (send a move standing still → first delta reflecting it).
   With the 12 Hz decimated broadcast the echo includes the cadence wait BY
   DESIGN (that's what a player experiences). The MP8·B harness grows out of
   this; the stage-A numbers live in docs/mp-8-spec.md §A4.

     node bench/world-smoke.mjs [--bots 200] [--zones 1] [--seconds 12]
                                [--workers]

   GPL-3.0-or-later (see LICENSE). */

import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, []),
);
const BOTS = Number(args.bots) || 200;
const ZONES = Math.max(1, Number(args.zones) || 1);
const SECONDS = Number(args.seconds) || 12;
const WORKERS = args.workers !== undefined;

const SIZE = 128;
const PROJECT = {
  system: { startMapId: 1, startX: 2, startY: 2, startDir: "down" },
  maps: Array.from({ length: ZONES }, (_, i) => ({
    id: i + 1, width: SIZE, height: SIZE, layers: { ground: new Array(SIZE * SIZE).fill(1) },
  })),
  assets: { tiles: {} },
  autotiles: [],
};

async function loadCore() {
  const entrySrc = `
    export { startNodeWorldServer } from ${JSON.stringify(resolve(here, "../src/node/ws-server.ts").replace(/\\/g, "/"))};
    export { workerZoneFactory } from ${JSON.stringify(resolve(here, "../src/node/worker-zone.ts").replace(/\\/g, "/"))};
    export { DEFAULT_WORLD_LIMITS } from ${JSON.stringify(resolve(here, "../src/core/config.ts").replace(/\\/g, "/"))};
    export { generatePassport, passportPublicRaw, signChallenge } from ${JSON.stringify(resolve(here, "../../src/shared/net/passport.ts").replace(/\\/g, "/"))};
  `;
  const out = await build({
    stdin: { contents: entrySrc, resolveDir: here, loader: "ts" },
    bundle: true, platform: "node", target: "node20", format: "esm",
    write: false, external: ["ws"], logLevel: "silent",
  });
  // Keep the bundle inside the repo so its external `ws` import resolves by
  // walking up to node_modules (the OS tmpdir has no such ancestor).
  const dir = await mkdtemp(join(here, ".tmp-worldsmoke-"));
  const file = join(dir, "core.mjs");
  await writeFile(file, out.outputFiles[0].text);
  const mod = await import(pathToFileURL(file).href);
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}) };
}

function pct(xs, p) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const DIRS = ["down", "left", "right", "up"];

/** One bot: challenge → passported hello → join → random-walk + emote until
 *  `deadline`, measuring intent→echo. Reports its pid via onPid so the bench
 *  can deal bots across zones. */
function bot(mod, url, passport, index, deadline, onPid) {
  return new Promise((res) => {
    const ws = new WebSocket(url);
    const samples = [];
    let pid = -1;
    let pending = 0;
    let phase = "idle";
    let seq = 0;
    let retry = null;
    let emoteTimer = null;
    const send = (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };
    const done = () => {
      if (retry) clearTimeout(retry);
      if (emoteTimer) clearInterval(emoteTimer);
      try { ws.close(); } catch { /* */ }
      res(samples);
    };
    const move = () => {
      if (performance.now() > deadline) return done();
      pending = performance.now();
      phase = "await";
      send({ t: "input", seq: ++seq, intent: { k: "move", dir: DIRS[(seq + index) % 4] } });
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => { if (phase === "await") move(); }, 400 + Math.random() * 200);
    };
    ws.on("error", () => done());
    ws.on("message", (data) => {
      const text = String(data);
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (m.t === "challenge") {
        (async () => {
          send({
            t: "hello", proto: 1, name: "Bot " + index,
            pub: await mod.passportPublicRaw(passport),
            sig: await mod.signChallenge(passport, m.nonce),
          });
          send({ t: "join" });
        })();
      } else if (m.t === "welcome") {
        pid = m.playerId;
        onPid(pid);
      } else if (m.t === "snapshot") {
        setTimeout(move, 50 + Math.random() * 400); // stagger the herd
        if (!emoteTimer) emoteTimer = setInterval(() => send({ t: "emote", emote: "wave" }), 2500 + Math.random() * 1000);
      } else if (m.t === "delta") {
        const me = (m.changes.players || []).find((p) => p.id === pid);
        if (!me) return;
        if (phase === "await" && me.moving) {
          samples.push(performance.now() - pending);
          phase = "step";
          if (retry) clearTimeout(retry);
        }
        if (phase === "step" && !me.moving) {
          phase = "idle";
          setTimeout(move, 10);
        }
      } else if (m.t === "error" || m.t === "kick") {
        // rate-limited bots just keep walking; fatal errors end the bot
        if (m.fatal || m.t === "kick") done();
      }
    });
    setTimeout(done, SECONDS * 1000 + 15000); // safety net
  });
}

const { mod, cleanup } = await loadCore();
const limits = {
  ...mod.DEFAULT_WORLD_LIMITS,
  maxPlayersPerWorld: BOTS + 50,
  maxPlayersPerZone: Math.max(300, Math.ceil(BOTS / ZONES) + 50),
  // Every bot shares 127.0.0.1 — the per-source join limiter would cut the
  // 31st bot. Real deployments see distinct sources; lift it for the bench.
  joinsPerSource: Number.MAX_SAFE_INTEGER,
};

let handle = null;
let workerDist = null;
if (WORKERS) {
  workerDist = resolve(here, "../dist/zone-worker.mjs");
}
handle = await mod.startNodeWorldServer({
  project: PROJECT,
  port: 0,
  limits,
  zoneFactory: WORKERS
    ? mod.workerZoneFactory({ entry: workerDist, projectJson: JSON.stringify(PROJECT), limits })
    : undefined,
});
const url = `ws://127.0.0.1:${handle.port}`;
console.log(`world-smoke: ${BOTS} bots, ${ZONES} zone(s), ${SECONDS}s, workers=${WORKERS} — ${url}`);

console.log("generating passports…");
const passports = await Promise.all(Array.from({ length: BOTS }, (_, i) => mod.generatePassport("Bot " + i)));

const deadline = performance.now() + SECONDS * 1000 + 8000; // walk window incl. join stagger
const pids = [];
const runs = [];
const scatter = (n) => 2 + ((n * 2654435761) >>> 0) % (SIZE - 4); // deterministic spread
for (let i = 0; i < BOTS; i++) {
  runs.push(bot(mod, url, passports[i], i, deadline, (pid) => {
    pids.push(pid);
    // Deal bots across zones round-robin AND scatter them over the map (the
    // bench stands in for stage B's transfer events + authored spawn points;
    // transferPlayer IS the server API events will drive). Without the
    // scatter every bot stacks on the start tile and anti-stack jams them.
    const n = pids.length - 1;
    const mapId = (n % ZONES) + 1;
    handle.world.transferPlayer(pid, mapId, scatter(n), scatter(n * 7 + 3));
  }));
  if (i % 25 === 24) await new Promise((r) => setTimeout(r, 100)); // staggered joins
}

let midStats = null;
setTimeout(() => { midStats = handle.world.stats(); }, (SECONDS / 2) * 1000 + 4000);

const results = await Promise.all(runs);
const all = results.flat();
const stats = midStats || handle.world.stats();
const perZone = handle.world.zoneIds().sort((a, b) => a - b);
console.log(`zones live: [${perZone.join(", ")}] — stats: ${JSON.stringify(stats)}`);
console.log(
  `samples ${all.length} — intent→echo p50=${pct(all, 50).toFixed(1)}ms ` +
  `p95=${pct(all, 95).toFixed(1)}ms p99=${pct(all, 99).toFixed(1)}ms ` +
  `(12 Hz broadcast ⇒ ≈0–83ms cadence wait is part of the echo)`,
);
const moved = results.filter((r) => r.length > 0).length;
console.log(`bots that measured ≥1 move: ${moved}/${BOTS}`);
const cpu = process.cpuUsage();
console.log(
  `process (server+ALL bots${WORKERS ? "+workers" : ""}): rss=${(process.memoryUsage().rss / 1048576).toFixed(0)}MB ` +
  `cpu user=${(cpu.user / 1e6).toFixed(1)}s sys=${(cpu.system / 1e6).toFixed(1)}s over ~${SECONDS + 10}s wall`,
);
await handle.close();
await cleanup();
process.exit(0);
