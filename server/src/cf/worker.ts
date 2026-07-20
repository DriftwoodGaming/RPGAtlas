/* RPGAtlas — server/src/cf/worker.ts
   Project Beacon MP5·B: the Cloudflare Worker front for the Beacon DO relay. It
   turns a room code into a Durable Object (one room per DO) and forwards the
   WebSocket upgrade to it. Two client-facing routes:

     GET  /new            → { code } : mint a fresh room code (a create)
     GET  /rt?code=XXXX   → 101 WS   : connect to the room with that code

   `/new` exists so the browser client stays uniform across targets: it asks for
   a code, then connects to /rt?code=… for both create and join (the Node target
   accepts a codeless `join` instead — the client handles both, MP5·C). GPL-3.0. */

import { BeaconRoomDO, type Env } from "./room-do.js";
import { generateRoomCode, isCanonicalRoomCode } from "../../../src/shared/net/room-code.js";

export { BeaconRoomDO };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
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

    // WebSocket connect to a specific room.
    if (url.pathname === "/rt") {
      const code = url.searchParams.get("code") || "";
      if (!isCanonicalRoomCode(code)) return new Response("bad room code", { status: 400, headers: CORS });
      const id = env.BEACON_ROOM.idFromName(code);
      const stub = env.BEACON_ROOM.get(id);
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
