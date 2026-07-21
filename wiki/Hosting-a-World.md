# Hosting a World

Most games only need the friend-room **Play Together** flow — friends share a code and play
(see **[Making Your Game Multiplayer](Making-Your-Game-Multiplayer)**). That runs on a
**Beacon server hosting your game** — you start one in a single command below. (Driftwood's
free relay is a Beacon server too, but it hosts Driftwood's demo game, so it can't run
yours.) And if you dream bigger — a persistent world with lots of players on a server *you*
control — the very same open-source server does that too.

This page explains the two ways games connect, how to run your own server, and exactly what
crosses the network (the part to show a parent or teacher).

---

## Two ways to play online

**Friend rooms (the easy way).** A player picks **Play Together ▸ Create Room** and gets a
code. Friends **Join a Room** with that code. Behind the scenes they all connect to a shared
**relay** — a Beacon server hosting the game. A relay hosts **one game**, so for your own
game that's a server you run with the one command below. (Driftwood's free relay hosts
Driftwood's demo game — the place to *try* Play Together, not to ship your game on.) On a
Node Beacon server every room is a **full engine world by default**, so parties and co-op
battles work out of the box. This is the right choice for almost everyone.

**Your own world (the powerful way).** You run the **Beacon server** yourself and point your
game at it. Now *you* own the world: it can hold far more players and persist as a living place
people return to (with `--data`, below). This is for ambitious creators.

To use your own server, put its address in **Database ▸ Multiplayer ▸ Play server address**.
It must start with `wss://` (a secure connection).

---

## Running the Beacon server

The Beacon server lives in the `server/` folder of the RPGAtlas source. It's one small
TypeScript program with two ways to run it.

### Option 1 — Node (a plain computer or VPS)

Good for a home machine, a Raspberry Pi, or a cheap virtual server.

```
cd server
npm install
npm run build
node dist/beacon.mjs --project path/to/game.rpgatlas --port 8787
```

Your game connects to `wss://your-machine-address:8787`. Useful flags:

- `--project <file>` — the game the server hosts.
- `--port <n>` — the port to listen on.
- `--max-players <n>` — a ceiling on room size (your game's own setting can only make rooms
  *smaller*, never bigger than this).
- `--max-rooms <n>` — how many rooms this server holds at once (default 1000). Each engine room
  is one worker, so this is also the worker budget; a create past it is refused and the player
  sees a friendly "the play server is full" message.
- `--no-engine-rooms` — make friend rooms the lighter **walk-and-chat** kind (no server-side
  events or battles). Engine rooms — with co-op parties and shared battles — are the default.

### Running a persistent WORLD (not just friend rooms)

Add `--world` to run one big shared world (with device passports) instead of code-based
friend rooms:

```
node dist/beacon.mjs --project path/to/game.rpgatlas --world --data ./world-data
```

- `--world` — one shared, persistent world instead of many code rooms. Players sign in with a
  **passport** (a key their device makes automatically — no signup).
- `--data <dir>` — save the world (player positions, progress, world state) to plain JSON
  files in `<dir>`, so players return to where they left off after a restart. Leave it off for
  a memory-only world that resets when you stop the server.
- `--engine-events` — run authored **NPCs, cutscenes, and triggers** on the server, so every
  player shares the same living world. Add `--zone-workers` for a multi-map world (one map per
  worker thread). Battles come from authored Battle **events**; random step encounters don't
  fire server-side yet (they stay single-player for now).

The crash-loss budget is small and honest: with `--data`, at most ~30 seconds of world state
and player movement can be lost in a hard crash (the server saves every 30 seconds and on a
clean shutdown).

### Option 2 — Cloudflare (free tier, no server to babysit)

Beacon also runs on **Cloudflare Durable Objects** — one room per object, with hibernation so
idle rooms cost nothing. Deploy with Cloudflare's `wrangler` tool from the same `server/`
folder:

```
cd server
npx wrangler deploy
```

The live deploy runs in **your** Cloudflare account (Driftwood never sees it). Your game
connects to your `wss://…workers.dev` address.

> **Co-op battles need the Node server for now.** Cloudflare rooms run the walk-and-chat layer;
> the engine rooms above — parties and shared battles — run on the Node target today. If your
> game leans on co-op battles, host the Node server; bringing engine rooms to Cloudflare is a
> post-2.0 step.

> The server shares the exact same world code the game uses — the same movement, collision,
> and rules — so what runs on your server behaves like what runs in the editor.

---

## What crosses the network (kid-safety details)

This is the part worth reading carefully, and worth showing a parent or teacher.

- **No player-to-player connections.** Every player connects only to the server, over a secure
  `wss://` link. No player ever learns another player's address or location.
- **No accounts, no email, no personal information.** A player is only ever a **display name**
  and a **room code**. In a persistent world, a device also makes a **passport** — a random
  key stored on the device so the same player is recognised on return. It contains **nothing
  personal** (no name beyond the nickname, no email, no location). Its file is the same trust
  tier as a save file: keep it, and you can carry your world identity to another device
  (**Play Together ▸ Save / Load Passport**).
- **Room codes are unguessable.** They're long enough that guessing one is hopeless, and join
  attempts are rate-limited. There is **no public list of rooms** — you play with people you
  give your code to.
- **Empty rooms disappear.** A room with nobody in it expires on its own, so nothing lingers.
- **The only things on the wire** are a player's name, their position on the map, and the
  emotes / preset phrases (or, if you turned it on, filtered chat text) they choose to send.
  Never an address, never a history, never anything private.
- **The free relay** keeps a player's network address only briefly, and only to stop abuse —
  never shown to anyone, never stored long-term.
- **Chat is off by default.** Free-text chat exists only if a game's creator turns it on, and
  even then it's filtered with mute and report built in. (The filter is a best-effort courtesy,
  not a guarantee — the real tools are mute, report, and kick/ban.)

> **Show a parent or teacher:** **[Online Safety (Parents & Teachers)](Online-Safety)** is a
> short, plain-language version of this section.

---

## Moderation (running your own world)

When you host a world, you have the tools to keep it friendly:

- **Every player** can **mute** anyone instantly (private, on their own screen) and **report**
  a problem to you.
- **Room owners** (in friend-room mode) can **kick** and **ban** a disruptive player from
  their room from the in-game "💬 Players & Chat" panel.
- **World operators** (you) moderate from the **server console** — the terminal where the
  server runs. In `--world` mode, type these commands:

  | Command | What it does |
  |---|---|
  | `players` | list everyone connected (id · name · passport fingerprint · map) |
  | `reports` | show recent player reports (with the reported player's passport) |
  | `ban <id or fingerprint>` | block a passport — kicks them now and refuses them at the door |
  | `unban <fingerprint>` | lift a ban |
  | `bans` | list active bans |
  | `help` | show the command list |

  A ban is **by passport**, so it's durable: with `--data`, it survives a restart. Because a
  passport carries **no personal information**, blocking one blocks that device's key — not a
  person's identity.

---

## Which should I choose?

- **Just curious how Play Together feels?** Try the co-op demo on Driftwood's free relay —
  no setup at all, though the demo's shared battle still needs a server you run (see
  **[Making Your Game Multiplayer](Making-Your-Game-Multiplayer)**).
- **Want friends to play *your* game together?** Run the one-command friend-room server
  (Option 1 above) with your project and put its address in **Play server address**. Rooms,
  codes, parties, and co-op battles all work out of the box. This is the answer for most
  games.
- **Want a big, persistent, you-control-it world?** Run the Beacon server with `--world`
  (Node or Cloudflare) and point your game at it.

---

*Back to the basics: **[Making Your Game Multiplayer](Making-Your-Game-Multiplayer)**.*
