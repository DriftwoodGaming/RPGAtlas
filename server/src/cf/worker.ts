/* RPGAtlas — server/src/cf/worker.ts
   Project Beacon MP5·B: the Cloudflare Worker front for the Beacon DO relay. It
   turns a room code into a Durable Object (one room per DO) and forwards the
   WebSocket upgrade to it. Two client-facing routes:

     GET  /new            → { code } : mint a fresh room code (a create)
     GET  /rt?code=XXXX   → 101 WS   : connect to the room with that code

   `/new` exists because DO routing needs the room code BEFORE the first frame
   (this Worker picks the Durable Object from the URL), so the Node target's
   codeless-`join` create can never work here. The browser client dials the
   Node style first — a bare-URL socket, codeless/coded `join` — and falls back
   to this contract when that handshake fails at the socket level (the "/"
   health answer below is exactly that failure): GET /new mints the code for a
   create, then /rt?code=… connects for both create and join
   (src/engine/net/relay-dial.ts). GPL-3.0. */

import { BeaconRoomDO, type Env } from "./room-do.js";
import { BeaconWorldDO, type WorldEnv } from "./world-do.js";
import { generateRoomCode, isCanonicalRoomCode } from "../../../src/shared/net/room-code.js";

export { BeaconRoomDO, BeaconWorldDO };

/** The Worker env: friend-room DOs (BEACON_ROOM) + persistent-world DOs
 *  (BEACON_WORLD), both reading the game project from the GAME KV namespace. */
type WorkerEnv = Env & WorldEnv;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

/** World name → DO key. A deployment can host several named persistent worlds
 *  (default "main"); the name is sanitised to a bounded slug so it is a safe,
 *  stable DO id (idFromName). */
function worldKey(name: string): string {
  const slug = (name || "main").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 48);
  return "world:" + (slug || "main");
}

export default {
  async fetch(req: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "rpgatlas-beacon" });
    }

    // Mint a fresh room code (a "create"). The DO for it is created lazily on
    // the first /rt connection, so an abandoned /new costs nothing.
    if (url.pathname === "/new") {
      return json({ code: generateRoomCode() });
    }

    // WebSocket connect to a specific friend room.
    if (url.pathname === "/rt") {
      const code = url.searchParams.get("code") || "";
      if (!isCanonicalRoomCode(code)) return new Response("bad room code", { status: 400, headers: CORS });
      const id = env.BEACON_ROOM.idFromName(code);
      const stub = env.BEACON_ROOM.get(id);
      return stub.fetch(req);
    }

    // WebSocket connect to a persistent WORLD (MP8·B, D-8-1). One DO per named
    // world; the client sends a codeless `join` (a world has one shared room).
    if (url.pathname === "/wrt") {
      const id = env.BEACON_WORLD.idFromName(worldKey(url.searchParams.get("world") || "main"));
      const stub = env.BEACON_WORLD.get(id);
      return stub.fetch(req);
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...CORS },
  });
}
