/* RPGAtlas — server/src/node/main.ts
   Project Beacon MP5·A: the Beacon server CLI (plain-Node target). Loads a game
   project and serves friend rooms over WebSocket:

     node beacon.mjs --project path/to/game.json [--port 8787] [--trust-proxy]

   This is the open-source "host a world in one command" entry (roadmap D2).
   Driftwood's free relay is this, deployed with a featured game. GPL-3.0. */

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { BeaconWorld } from "../core/beacon-world.js";
import { DEFAULT_LIMITS, DEFAULT_WORLD_LIMITS, type BeaconLimits, type WorldLimits } from "../core/config.js";
import { workerZoneFactory } from "./worker-zone.js";
import { workerRoomFactory } from "./worker-room.js";
import { engineZoneFactory } from "./engine-zone.js";
import { NodeFileWorldStore } from "./file-store.js";
import { startNodeServer, startNodeWorldServer } from "./ws-server.js";

interface Args {
  project?: string;
  port: number;
  host?: string;
  maxPlayers?: number;
  maxRooms?: number;
  trustProxy: boolean;
  world: boolean;
  zoneWorkers: boolean;
  engineEvents: boolean;
  /** Engine friend rooms (co-op parties + shared battles, worker-per-room).
   *  Default ON in room mode; `--no-engine-rooms` opts back to MP5 player-layer
   *  rooms (walk/emote/chat only — the same posture the CF DO target keeps). */
  engineRooms: boolean;
  data?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    port: 8787, trustProxy: false, world: false, zoneWorkers: false,
    engineEvents: false, engineRooms: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--project" || a === "-p") out.project = next();
    // `--port 0` means an OS-assigned ephemeral port (standard listen(0); the
    // real port is read back from the socket and printed in the banner). Only a
    // missing/invalid value falls back to the 8787 default — `|| 8787` used to
    // clobber a legitimate 0, so two beacons on `--port 0` both grabbed 8787 and
    // the second died on EADDRINUSE (surfaced by the MP9·E parallel relay e2e).
    else if (a === "--port") { const p = Number(next()); out.port = Number.isFinite(p) && p >= 0 ? p : 8787; }
    else if (a === "--host") out.host = next();
    else if (a === "--max-players") out.maxPlayers = Number(next()) || undefined;
    else if (a === "--max-rooms") out.maxRooms = Number(next()) || undefined;
    else if (a === "--trust-proxy") out.trustProxy = true;
    else if (a === "--world") out.world = true;
    else if (a === "--zone-workers") out.zoneWorkers = true;
    else if (a === "--engine-events") out.engineEvents = true;
    else if (a === "--no-engine-rooms") out.engineRooms = false;
    else if (a === "--data") out.data = next();
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    "RPGAtlas Beacon server (Project Beacon MP5/MP8)\n\n" +
    "  node beacon.mjs --project <game.json> [options]\n\n" +
    "  --project, -p <path>   Game project JSON to host (required)\n" +
    "  --no-engine-rooms      Friend rooms run the FULL engine by default (one\n" +
    "                         worker per room — co-op parties + shared battles,\n" +
    "                         NPCs/events server-side). This flag opts back to\n" +
    "                         MP5 walk/emote/chat-only rooms (no server events).\n" +
    "  --max-rooms <n>        Cap simultaneous rooms (= engine-room worker budget\n" +
    "                         for a shared relay; default 1000). Beyond it, a new\n" +
    "                         room create is refused.\n" +
    "  --world                Persistent-world mode (MP8): one shared world,\n" +
    "                         zone-per-map, passport sign-in — instead of\n" +
    "                         friend rooms with codes\n" +
    "  --zone-workers         With --world: run each zone on its own worker\n" +
    "                         thread (multi-core scale-out)\n" +
    "  --engine-events        With --world: run authored NPCs/events/cutscenes\n" +
    "                         server-side (the per-zone engine runtime). In-process\n" +
    "                         it hosts one map; add --zone-workers for a multi-map\n" +
    "                         engine world (one map per worker).\n" +
    "  --data <dir>           With --world: persist the world to JSON snapshot\n" +
    "                         files in <dir> (players rejoin where they left off\n" +
    "                         across restarts). Omit for an in-memory world.\n" +
    "  --port <n>             Port to listen on (default 8787)\n" +
    "  --host <addr>          Bind address (default all interfaces)\n" +
    "  --max-players <n>      Players per room (default 16); in world mode,\n" +
    "                         players per world (default 1200)\n" +
    "  --trust-proxy          Read X-Forwarded-For for rate-limit source\n" +
    "  --help, -h             Show this help\n\n" +
    "  In --world mode an interactive operator console (stdin) accepts\n" +
    "  moderation commands: players, reports, ban <pid|fingerprint>, unban,\n" +
    "  bans, help. Bans are by passport and durable (persist with --data).\n",
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    process.stderr.write("beacon: --project <game.json> is required (see --help)\n");
    process.exit(2);
  }
  let project: unknown;
  try {
    project = JSON.parse(await readFile(args.project, "utf8"));
  } catch (e) {
    process.stderr.write(`beacon: could not read project "${args.project}": ${(e as Error).message}\n`);
    process.exit(2);
  }
  const log = (level: string, event: string, detail?: Record<string, unknown>) =>
    process.stdout.write(`[beacon] ${level} ${event}${detail ? " " + JSON.stringify(detail) : ""}\n`);
  const worldLimits: WorldLimits = {
    ...DEFAULT_WORLD_LIMITS,
    ...(args.maxPlayers ? { maxPlayersPerWorld: args.maxPlayers } : {}),
  };
  const store = args.world && args.data ? new NodeFileWorldStore(args.data) : undefined;
  // Zone sharding adapter: worker threads (multi-core / multi-map engine
  // worlds), an in-process engine zone (single-map engine world), or the
  // default in-process player-layer factory.
  const zoneFactory = args.zoneWorkers
    ? workerZoneFactory({
        entry: new URL("./zone-worker.mjs", import.meta.url),
        projectJson: JSON.stringify(project),
        limits: worldLimits,
        engineRuntime: args.engineEvents,
        log,
      })
    : args.engineEvents
      ? engineZoneFactory({ project, limits: worldLimits, log })
      : undefined;
  // Room-mode (friend rooms) limits + the engine-room worker factory (E2·b,
  // D-9E-1). Engine rooms are the DEFAULT — one worker per room hosts the full
  // engine world (co-op parties + shared battles). `--no-engine-rooms` opts back
  // to MP5 player-layer rooms; `--max-rooms` caps the worker budget.
  const roomLimits: Partial<BeaconLimits> = {
    ...(args.maxPlayers ? { maxPlayersPerRoom: args.maxPlayers } : {}),
    ...(args.maxRooms ? { maxRooms: args.maxRooms } : {}),
  };
  const roomSimFactory =
    !args.world && args.engineRooms
      ? workerRoomFactory({
          entry: new URL("./room-worker.mjs", import.meta.url),
          projectJson: JSON.stringify(project),
          limits: { ...DEFAULT_LIMITS, ...roomLimits },
          log,
        })
      : undefined;
  const handle = args.world
    ? await startNodeWorldServer({
        project,
        port: args.port,
        host: args.host,
        trustProxy: args.trustProxy,
        limits: worldLimits,
        store,
        zoneFactory,
        log,
      })
    : await startNodeServer({
        project,
        port: args.port,
        host: args.host,
        trustProxy: args.trustProxy,
        limits: Object.keys(roomLimits).length ? roomLimits : undefined,
        roomSimFactory,
        log,
      });
  process.stdout.write(
    `[beacon] listening on :${handle.port} — hosting "${projectTitle(project)}"` +
    (args.world ? " (persistent world)" : "") + "\n" +
    (args.world && args.engineEvents
      ? `[beacon] engine events ON — NPCs/events/cutscenes run server-side` +
        (args.zoneWorkers ? " (one map per worker)\n" : " (single-map in-process; add --zone-workers for multi-map)\n")
      : "") +
    (!args.world
      ? (args.engineRooms
          ? "[beacon] engine rooms ON — co-op parties + shared battles (one worker per room)\n"
          : "[beacon] engine rooms OFF (--no-engine-rooms) — walk/emote/chat only, no server events\n")
      : "") +
    (store ? `[beacon] persisting world state to ${args.data} (flush every 30s + on shutdown)\n` : "") +
    (args.world && !store ? "[beacon] in-memory world (no --data): state resets on restart\n" : "") +
    `[beacon] players connect over ws://<host>:${handle.port} (wss:// behind TLS)\n`,
  );
  const stop = () => { handle.close().then(() => process.exit(0)); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Operator console (MP9·A): a world has no in-game owner — the operator
  // moderates from here (ban by passport, review reports). Interactive only, so
  // a daemonized / piped server (and the test harness) is unaffected.
  if (args.world && "world" in handle && process.stdin.isTTY) {
    startOperatorConsole((handle as { world: BeaconWorld }).world);
  }
}

/** The world operator's moderation console (MP9·A). Reads commands on stdin:
 *  `players`, `reports`, `ban <pid|fingerprint>`, `unban <fingerprint>`,
 *  `bans`, `help`. Ban-by-passport is the durable moderation tool (D3). */
function startOperatorConsole(world: BeaconWorld): void {
  const out = (s: string) => process.stdout.write(s + "\n");
  const rl = createInterface({ input: process.stdin });
  out(
    "[beacon] operator console ready — type `help` for moderation commands\n" +
    "         (players · reports · ban <pid|fingerprint> · unban <fp> · bans)",
  );
  /** Resolve a numeric pid OR a fingerprint prefix to a full fingerprint. */
  const resolveFingerprint = (arg: string): string | null => {
    if (/^\d+$/.test(arg)) {
      const p = world.playerList().find((x) => x.pid === Number(arg));
      return p ? p.fingerprint : null;
    }
    // A fingerprint or an unambiguous prefix of a live player's fingerprint.
    const matches = world.playerList().filter((x) => x.fingerprint.startsWith(arg));
    if (matches.length === 1) return matches[0].fingerprint;
    return arg; // ban a full fingerprint even if the player is offline
  };
  rl.on("line", (line) => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd) {
      case "":
        break;
      case "help":
        out(
          "  players            list connected players (pid · name · fingerprint · map)\n" +
          "  reports [n]        show the last n player reports (default 20)\n" +
          "  ban <pid|fp>       ban a passport (durable) — kicks the live session\n" +
          "  unban <fingerprint>  lift a passport ban\n" +
          "  bans               list active passport bans\n" +
          "  help               this list",
        );
        break;
      case "players": {
        const list = world.playerList();
        if (!list.length) { out("  (no players connected)"); break; }
        for (const p of list) out(`  #${p.pid}  ${p.name}  ${p.fingerprint}  map ${p.mapId}`);
        break;
      }
      case "reports": {
        const n = Number(arg) || 20;
        const list = world.recentReports(n);
        if (!list.length) { out("  (no reports)"); break; }
        for (const r of list)
          out(`  ${new Date(r.at).toISOString()}  ${r.fromName}(#${r.from}) → ${r.targetName}(#${r.target}) ${r.targetFingerprint}${r.reason ? "  \"" + r.reason + "\"" : ""}`);
        break;
      }
      case "ban": {
        if (!arg) { out("  usage: ban <pid|fingerprint>"); break; }
        const fp = resolveFingerprint(arg);
        if (!fp) { out(`  no live player #${arg}`); break; }
        world.ban(fp);
        out(`  banned ${fp}`);
        break;
      }
      case "unban":
        out(world.unban(arg) ? `  unbanned ${arg}` : `  ${arg} was not banned`);
        break;
      case "bans": {
        const bans = world.bannedFingerprints();
        if (!bans.length) { out("  (no bans)"); break; }
        for (const b of bans) out(`  ${b}`);
        break;
      }
      default:
        out(`  unknown command "${cmd}" — type help`);
    }
  });
}

function projectTitle(project: unknown): string {
  const p = project as { system?: { title?: string } } | null;
  return (p && p.system && p.system.title) || "Untitled";
}

main().catch((e) => {
  process.stderr.write(`beacon: fatal ${(e as Error).stack || e}\n`);
  process.exit(1);
});
