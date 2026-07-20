# Hosting a World

Most games only need the free **Play Together** rooms — friends share a code and play, with
zero setup (see **[Making Your Game Multiplayer](Making-Your-Game-Multiplayer)**). But if you
dream bigger — a persistent world with lots of players on a server *you* control — RPGAtlas
ships an open-source server you can run yourself.

This page explains the two ways games connect, how to run your own server, and exactly what
crosses the network (the part to show a parent or teacher).

---

## Two ways to play online

**Friend rooms (the easy way).** A player picks **Play Together ▸ Create Room** and gets a
code. Friends **Join a Room** with that code. Behind the scenes they all connect to a shared
**relay** — Driftwood runs a free one, and it's the default. Nothing to install, nothing to
configure. This is the right choice for almost everyone.

**Your own world (the powerful way).** You run the **Beacon server** yourself and point your
game at it. Now *you* own the world: it can hold far more players, and (in a later Beacon
phase) persist as a living place people return to. This is for ambitious creators.

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

> The server shares the exact same world code the game uses — the same movement, collision,
> and rules — so what runs on your server behaves like what runs in the editor.

---

## What crosses the network (kid-safety details)

This is the part worth reading carefully, and worth showing a parent or teacher.

- **No player-to-player connections.** Every player connects only to the server, over a secure
  `wss://` link. No player ever learns another player's address or location.
- **No accounts, no email, no personal information.** A player is only ever a **display name**
  and a **room code**. That's the whole identity.
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
  even then it's filtered with mute and report built in.

---

## Moderation (running your own world)

When you host a world, you have the tools to keep it friendly:

- **Room owners** can remove a disruptive player from their room.
- **World operators** (you) can block a player from a world.
- **Every player** can mute anyone instantly, and report a problem.

---

## Which should I choose?

- **Just want friends to play together?** Do nothing — leave the play server address blank and
  use the free rooms. This is the answer for most games.
- **Want a big, persistent, you-control-it world?** Run the Beacon server (Node or Cloudflare)
  and point your game at it.

---

*Back to the basics: **[Making Your Game Multiplayer](Making-Your-Game-Multiplayer)**.*
