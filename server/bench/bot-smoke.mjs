/* RPGAtlas — server/bench/bot-smoke.mjs
   Project Beacon MP5·E: a standalone WAN/latency smoke for the Beacon relay —
   the seed of the MP8 load harness. Spins up the built Node server (or connects
   to a URL you pass), floods a room with N random-walking, emoting bots, and
   reports intent→echo latency percentiles. Run heavier N here than the in-gate
   tests-unit/beacon-load.test.ts (16 bots + 2 clients) do.

     node bench/bot-smoke.mjs [--bots 16] [--seconds 8] [--url ws://host:port]
                              [--project ../Atlas_Quest.json]

   With no --url it launches dist/beacon.mjs itself (run `npm run build` first).
   GPL-3.0-or-later (see LICENSE). */

import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const BOTS = Number(args.bots) || 16;
const SECONDS = Number(args.seconds) || 8;
const PROJECT = args.project || resolve(here, "..", "..", "Atlas_Quest.json");
const DIRS = [["down", 0], ["left", 1], ["right", 2], ["up", 3]];

function pct(xs, p) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function launchServer() {
  const child = spawn(process.execPath, [resolve(here, "..", "dist", "beacon.mjs"), "--project", PROJECT, "--port", "0", "--max-players", String(BOTS + 4)], {
    cwd: resolve(here, ".."),
    stdio: ["ignore", "pipe", "inherit"],
  });
  const url = await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error("server did not start")), 15000);
    child.stdout.on("data", (d) => {
      const m = /listening on :(\d+)/.exec(String(d));
      if (m) { clearTimeout(to); res(`ws://127.0.0.1:${m[1]}`); }
    });
  });
  return { child, url };
}

function bot(url, code, index, deadline, onCode) {
  return new Promise((res) => {
    const ws = new WebSocket(url);
    const samples = [];
    let pid = -1, lastRx = 0, lastRy = 0, pending = 0, attempts = 0, phase = "idle", timer = null;
    const send = (m) => ws.send(JSON.stringify(m));
    const done = () => { if (timer) clearTimeout(timer); try { ws.close(); } catch { /* */ } res(samples); };
    const move = () => {
      if (performance.now() > deadline) return done();
      const [dir, dir8] = DIRS[(attempts + index) % 4];
      pending = performance.now(); phase = "await";
      send({ t: "input", seq: ++attempts, intent: { k: "move", dir, dir8 } });
      if (Math.random() < 0.15) send({ t: "emote", emote: "wave" });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (phase === "await") move(); }, 90 + Math.random() * 80);
    };
    ws.on("open", () => { send({ t: "hello", proto: 1, name: "bot" + index }); send({ t: "join", code }); });
    ws.on("error", done);
    ws.on("message", (data) => {
      let m; try { m = JSON.parse(String(data)); } catch { return; }
      if (m.t === "error" || m.t === "kick") return done();
      if (m.t === "welcome") { pid = m.playerId; if (onCode) onCode(m.roomCode); }
      else if (m.t === "snapshot") { const me = (m.world.players || []).find((p) => p.id === pid); if (me) { lastRx = me.rx; lastRy = me.ry; } setTimeout(move, 0); }
      else if (m.t === "delta") {
        const me = (m.changes.players || []).find((p) => p.id === pid);
        if (!me) return;
        if (phase === "await" && (me.moving || me.rx !== lastRx || me.ry !== lastRy)) { samples.push(performance.now() - pending); phase = "step"; if (timer) clearTimeout(timer); }
        if (phase === "step" && !me.moving) { phase = "idle"; setTimeout(move, 6); }
        lastRx = me.rx; lastRy = me.ry;
      }
    });
  });
}

async function main() {
  let launched = null, url = args.url;
  if (!url) { launched = await launchServer(); url = launched.url; }
  console.log(`[bench] ${BOTS} bots, ${SECONDS}s, url=${url}`);
  const deadline = performance.now() + SECONDS * 1000;
  let code = "";
  const codeReady = new Promise((r) => { code = null; main._r = r; });
  const host = bot(url, undefined, 0, deadline, (c) => main._r(c));
  code = await codeReady;
  const rest = [];
  for (let i = 1; i < BOTS; i++) { rest.push(bot(url, code, i, deadline)); await new Promise((r) => setTimeout(r, 40)); }
  const all = (await Promise.all([host, ...rest])).flat();
  console.log(`[bench] ${all.length} intent→echo samples: p50=${pct(all, 50).toFixed(1)}ms p95=${pct(all, 95).toFixed(1)}ms p99=${pct(all, 99).toFixed(1)}ms max=${Math.max(...all).toFixed(1)}ms`);
  if (launched) launched.child.kill();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
