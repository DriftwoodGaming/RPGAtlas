/* RPGAtlas — server/src/node/main.ts
   Project Beacon MP5·A: the Beacon server CLI (plain-Node target). Loads a game
   project and serves friend rooms over WebSocket:

     node beacon.mjs --project path/to/game.json [--port 8787] [--trust-proxy]

   This is the open-source "host a world in one command" entry (roadmap D2).
   Driftwood's free relay is this, deployed with a featured game. GPL-3.0. */

import { readFile } from "node:fs/promises";
import { DEFAULT_WORLD_LIMITS, type WorldLimits } from "../core/config.js";
import { workerZoneFactory } from "./worker-zone.js";
import { NodeFileWorldStore } from "./file-store.js";
import { startNodeServer, startNodeWorldServer } from "./ws-server.js";

interface Args {
  project?: string;
  port: number;
  host?: string;
  maxPlayers?: number;
  trustProxy: boolean;
  world: boolean;
  zoneWorkers: boolean;
  data?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { port: 8787, trustProxy: false, world: false, zoneWorkers: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--project" || a === "-p") out.project = next();
    else if (a === "--port") out.port = Number(next()) || 8787;
    else if (a === "--host") out.host = next();
    else if (a === "--max-players") out.maxPlayers = Number(next()) || undefined;
    else if (a === "--trust-proxy") out.trustProxy = true;
    else if (a === "--world") out.world = true;
    else if (a === "--zone-workers") out.zoneWorkers = true;
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
    "  --world                Persistent-world mode (MP8): one shared world,\n" +
    "                         zone-per-map, passport sign-in — instead of\n" +
    "                         friend rooms with codes\n" +
    "  --zone-workers         With --world: run each zone on its own worker\n" +
    "                         thread (multi-core scale-out)\n" +
    "  --data <dir>           With --world: persist the world to JSON snapshot\n" +
    "                         files in <dir> (players rejoin where they left off\n" +
    "                         across restarts). Omit for an in-memory world.\n" +
    "  --port <n>             Port to listen on (default 8787)\n" +
    "  --host <addr>          Bind address (default all interfaces)\n" +
    "  --max-players <n>      Players per room (default 16); in world mode,\n" +
    "                         players per world (default 1200)\n" +
    "  --trust-proxy          Read X-Forwarded-For for rate-limit source\n" +
    "  --help, -h             Show this help\n",
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
  const handle = args.world
    ? await startNodeWorldServer({
        project,
        port: args.port,
        host: args.host,
        trustProxy: args.trustProxy,
        limits: worldLimits,
        store,
        zoneFactory: args.zoneWorkers
          ? workerZoneFactory({
              entry: new URL("./zone-worker.mjs", import.meta.url),
              projectJson: JSON.stringify(project),
              limits: worldLimits,
              log,
            })
          : undefined,
        log,
      })
    : await startNodeServer({
        project,
        port: args.port,
        host: args.host,
        trustProxy: args.trustProxy,
        limits: args.maxPlayers ? { maxPlayersPerRoom: args.maxPlayers } : undefined,
        log,
      });
  process.stdout.write(
    `[beacon] listening on :${handle.port} — hosting "${projectTitle(project)}"` +
    (args.world ? " (persistent world)" : "") + "\n" +
    (store ? `[beacon] persisting world state to ${args.data} (flush every 30s + on shutdown)\n` : "") +
    (args.world && !store ? "[beacon] in-memory world (no --data): state resets on restart\n" : "") +
    `[beacon] players connect over ws://<host>:${handle.port} (wss:// behind TLS)\n`,
  );
  const stop = () => { handle.close().then(() => process.exit(0)); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function projectTitle(project: unknown): string {
  const p = project as { system?: { title?: string } } | null;
  return (p && p.system && p.system.title) || "Untitled";
}

main().catch((e) => {
  process.stderr.write(`beacon: fatal ${(e as Error).stack || e}\n`);
  process.exit(1);
});
