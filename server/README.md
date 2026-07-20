# RPGAtlas Beacon Server

The open-source multiplayer server for [RPGAtlas](../README.md) games — Project
Beacon. Host friend rooms (2–16 players) or your own persistent world. One
TypeScript core (`src/core`, shared with the game engine's `src/shared/`), two
deploy targets:

- **Node** (`src/node`) — one command, runs anywhere Node runs.
- **Cloudflare Durable Objects** (`src/cf`) — one room per DO, WebSocket
  hibernation, free-tier friendly.

It is **server-authoritative** (Project Beacon D1): clients send input intents,
the server owns the world and streams back positions. No P2P, no player-visible
IPs (D6). Room codes are unguessable capability tokens; empty rooms expire.

> **Scope (MP5).** The server simulates the *player layer* — movement with static
> **wall collision**, presence, emotes, late-join, resume. Autonomous NPCs,
> events, and encounters run in the browser today and become a headless per-zone
> runtime in a later phase (MP8). See [`docs/mp-5-spec.md`](../docs/mp-5-spec.md).

---

## Node (self-host in one command)

```bash
# from the repo root (needs `ws` — already a dev dependency there)
cd server
npm run build                       # → dist/beacon.mjs (esbuild bundle)
node dist/beacon.mjs --project ../Atlas_Quest.json --port 8787
```

Players connect over `ws://<host>:8787` (put it behind a TLS-terminating proxy
for `wss://`, which the browser client requires off localhost). Options:

| flag | meaning |
|------|---------|
| `--project, -p <path>` | game project JSON to host (**required**) |
| `--port <n>` | listen port (default 8787) |
| `--host <addr>` | bind address (default all interfaces) |
| `--max-players <n>` | players per room (default 16) |
| `--trust-proxy` | read `X-Forwarded-For` for the rate-limit source (only behind a proxy you control) |

`GET /` returns a JSON health snapshot (`{ ok, rooms, connections, players }`).

### Behind a TLS proxy (recommended)

Terminate TLS at nginx/Caddy/Cloudflare and proxy the WebSocket upgrade to the
Node server. Example nginx:

```nginx
location /rt { proxy_pass http://127.0.0.1:8787; proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
```

Run the server with `--trust-proxy` so join rate-limiting sees the real client IP.

---

## Cloudflare Durable Objects (free-tier relay)

One room per Durable Object, hibernating when idle. The game project lives in a
KV namespace (too large for a plaintext var).

```bash
cd server
npm i                                            # dev deps (wrangler via npx)
npx wrangler kv namespace create GAME            # copy the id into wrangler.jsonc
npx wrangler kv key put --binding=GAME project --path ../Atlas_Quest.json
npx wrangler deploy                              # deploys the Worker + DO
```

Client routes on the deployed Worker:

- `GET /new` → `{ "code": "BCDFGHJKM" }` — mint a fresh room code (a "create").
- `GET /rt?code=XXXXXXXXX` — WebSocket upgrade into that room.
- `GET /health` → `{ ok: true }`.

`npx wrangler dev` runs it locally against a real Workers runtime (miniflare).

> **MP5→MP8 note.** A Durable Object that is *evicted while idle* (hibernation)
> currently rebuilds an empty room on the next connection — world-state
> persistence across eviction (per-zone snapshots to DO storage) is MP8. Active
> friend rooms keep the isolate warm, so this is rare in practice.

---

## What ships on the wire (privacy)

Only what the game needs: a player is a server-assigned id + display name +
position + appearance key. No IP, no account, no PII — ever — in either
direction (Project Beacon D3/D6). The rate-limit source (an IP) is held
transiently in memory for abuse control and never crosses the wire or a log line
tied to a player.

## Development

```bash
npm run typecheck    # Node target (tsconfig.json) + CF target (tsconfig.cf.json)
```

The core's behaviour is covered from the repo root: `npx vitest run
tests-unit/collision.test.ts tests-unit/beacon-server.test.ts
tests-unit/beacon-ws.test.ts`.

Licensed GPL-3.0-or-later (see [`LICENSE`](../LICENSE)).
