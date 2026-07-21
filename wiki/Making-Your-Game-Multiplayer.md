# Making Your Game Multiplayer

RPGAtlas games can go online. Friends join each other with a short **room code**, walk the
same maps, wave and chat with emotes, party up, and fight battles side by side. It's the
feature RPG Maker never had — and turning it on takes one checkbox.

This page shows you how to switch it on, set it up safely, and use the new online event
commands. When you're ready to run a big persistent world for lots of players, see
**[Hosting a World](Hosting-a-World)**.

> **Single-player is untouched.** Until you tick the box below, your game plays exactly as
> before. Turning multiplayer on never changes how the game looks or feels offline.

---

## Try the co-op demo first

RPGAtlas ships a ready-made co-op scenario so you can *see* Play Together before you build
your own. It's the Atlas Quest showcase set up as a beach meet-up on **Driftwood Shore** —
friends spawn together, wave, use preset phrases, party up, and fight their first shared
battle: the sparkling crystal a few steps from the spawn is a **Practice Dummy**. Team Up
with a friend, walk up to it, and press the action key — the battle runs on the server and
you both fight it side by side (and both keep the full rewards).

Generate the demo project (it's derived from the sample game — no map is edited):

```
node scripts/build-coop-demo.mjs      # writes Atlas_Quest_Coop.json
```

**Host a demo room** two ways:

- **Run your own play server** *(works today).* Build the Beacon server and point it at the
  demo project — friend rooms run the full game engine by default, so co-op battles work out
  of the box:

  ```
  cd server && npm install && npm run build
  node dist/beacon.mjs --project ../Atlas_Quest_Coop.json --port 8787
  ```

  Put your server's `wss://` address in **Database ▸ Multiplayer ▸ Play server address** (or
  launch the game with `?relay=wss://…`), then pick **Play Together ▸ Create Room** for a code
  to share.
- **Driftwood's free relay** *(live!).* The free relay is a Beacon server Driftwood runs,
  and it hosts this very demo game — you run nothing at all: just **Play Together ▸ Create
  Room** for a code, and friends **Join a Room**. You'll need RPGAtlas **2.0.1 or newer**
  (older versions can't reach Cloudflare-hosted play servers). One honest limit for now:
  free-relay rooms are for meeting up — walking, waving, partying up, chatting. For the
  Practice Dummy *battle*, use the run-your-own server above. (A play server hosts one game —
  the relay runs the demo, so your *own* game still needs its own server; see **Play server
  address** below.)

Either way, the flow is: **Play Together → Create Room** (share the code) → a friend picks
**Join a Room** and enters it. You're both on the shore in seconds. On your own server, open
the 💬 panel, **Team Up**, and take on the Practice Dummy together. See
**[Hosting a World](Hosting-a-World)** for a bigger, persistent world.

---

## Turn it on

1. Open **Database** (the 🗄 button, or the Game menu).
2. Click the **Multiplayer** tab.
3. Tick **Enable Play Together**.

That's it. Now, when someone opens your game, the title screen shows a **Play Together**
button. They type a name and either **Create Room** (which gives them a code to share) or
**Join a Room** (by typing a friend's code).

Nobody makes an account. Nobody types an email. A player is just a name and a code.

---

## The Multiplayer settings

Everything lives on the **Database ▸ Multiplayer** tab.

### Friend room

- **Max players in a room** — how many friends can be in one room together (2–16). Smaller
  is cozier; bigger is a party. The default is 4.
- **Play server address** — where your game connects to play online. It must start with
  `wss://` (a secure connection). A play server hosts **one game**, so for your own game fill
  in the address of a Beacon server running *your* project — starting one is a single command
  (see **[Hosting a World](Hosting-a-World)**). Left blank, the game uses Driftwood's free
  relay, which hosts Driftwood's demo game — right for trying the demo, not for your game.

### Talking to each other

Pick how players communicate. This is a **safety** setting, so the safest option is the
default:

- **Emotes + preset phrases only** *(default, safest)* — players tap emotes and the ready-made
  phrases you write. No free typing at all. Perfect for younger players.
- **Filtered free-text chat** — players can also type their own short messages. These run
  through a bad-word filter, and every player can **mute** or **report** anyone. Only turn
  this on if you're comfortable with players typing whatever they like.

> Whatever you choose, emotes and your preset phrases always work.

**In-game, players get a "💬 Players & Chat" button** whenever they're online. It opens a small
panel with the emotes, your preset phrases, a chat box (only if you turned on free-text), and
a list of everyone in the room. Next to each player are **Team Up** (invite them to your party —
see below), **Mute** (instant and private — it only affects that player's own screen), **Report**
(flags them to the room owner), and, for the room owner, **Kick** and **Ban**. Once you're in a
party, **Leave Team** appears at the top of the panel.

> **About the bad-word filter — read honestly.** It's a helpful courtesy, not a guarantee. It
> catches the common cases (rude words, simple disguises like `sh1t`, stretched words like
> `fuuuck`), best in English and with a good effort in Spanish, French, German, Portuguese,
> and Italian. It does **not** catch every creative spelling or other alphabets. The tools
> that actually keep a room safe are **mute**, **report**, and the owner's **kick/ban** — see
> **[Online Safety](Online-Safety)** for the parent/teacher version.

### Preset phrases

Write short things players can say with one tap — one per line. For example:

```
Follow me!
Nice one!
Need healing!
Over here!
Let's go!
```

These always work, even with free-text chat off. Keep them friendly and useful.

### Where players appear

By default everyone joins at your game's normal **start position**. If you'd like joining
players to appear somewhere specific — a lobby, a town square, a hub map — add a **spawn
point**: pick a map and set the X, Y, and facing. Remove it to go back to the start position.

---

## Online event commands

When multiplayer is on, a few extra event commands and conditions become useful. They're all
safe to use in a single-player game too — they simply do the sensible offline thing.

| Command | What it does | Offline |
|---|---|---|
| **Wait for All Players** | Pauses the event until everyone in the room has gathered on this map (or a timeout you set). Great for "wait for the group before the boss door opens." | Instant — the event just continues. |
| **Show Text ▸ Show to: Everyone** | The message pops up for *every* player in the room, not just the one who triggered it. Set it on any Show Text command. | Shows to the one player, as normal. |
| **Control Switch ▸ Scope: This player** | Gives *each* player their own copy of a switch, so one player's progress doesn't flip it for everybody. | One player, so it behaves like a normal switch. |

And two new **Conditional Branch** checks:

- **Playing Online** — true while friends are in a room together, false in a normal
  single-player game. Handy for "only show this hint when playing solo."
- **Player Count** — how many players share the room (yourself included). Use it for
  "open the gate when 3 players are here."

> These work in local co-op today, and they run for real on a **world server** with authored
> events turned on (`--engine-events` — see **[Hosting a World](Hosting-a-World)**): NPCs,
> cutscenes, and triggers run on the server so every player sees the same living world.

---

## Party up and fight together

Two players who are near each other can **team up**. Open the **💬 Players & Chat** panel, find
your friend in the list, and tap **Team Up**; they get a friendly "NAME wants to team up!" prompt
and tap **Join!** to accept. Leave any time with **Leave Team** at the top of the panel. Party
members follow their leader through map changes, and when one of them starts a battle, nearby
party members **join the same fight**. Everyone picks commands for their own heroes; loot and
experience go to each player's own party. Nobody's game ends because a shared fight went badly —
everyone just gets back up.

A player who isn't in a party gets their **own** private battle, exactly as in a normal game.

> **Where co-op battles run — honestly.** A shared battle is the game engine running the fight
> on the server, so parties and battles work wherever the server runs your game's events:
> - **Friend rooms on a Beacon server** (`node dist/beacon.mjs --project …`) — **on by default.**
>   Every room is a full engine world, so Team Up and shared battles work out of the box. (Add
>   `--no-engine-rooms` for the lighter walk-and-emote rooms with no battles.)
> - **Persistent worlds** with authored events turned on (`--engine-events` — see
>   **[Hosting a World](Hosting-a-World)**).
> - **Driftwood's free relay** is live — but it runs on Cloudflare, so its demo rooms are
>   walk-and-chat only for now (next line). Your own game's battles run on a
>   server hosting *your* project — the one-liner in the demo section.
> - **Cloudflare-hosted rooms** are walk-and-chat only for now; parties and battles need the
>   Node server. A temporary limit we'll close after 2.0.
> - **Online battles start from Battle *events*** — fights you place with the Battle command
>   (an action-trigger monster, a boss, a cutscene fight). Random step encounters (a map's
>   walk-around encounter list) **don't fire on a server yet** — they stay single-player for
>   now — so give your online maps a battle event or two to fight. And in a friend room,
>   events (and so battles) run on your game's **starting map**; other maps are walk-and-chat
>   there, while a world server with `--zone-workers` runs events on every map.

---

## Keeping players safe

RPGAtlas multiplayer was built for kids first:

- **No accounts, no email, no personal information.** Ever.
- **Players never connect to each other** — only to a play server, over a secure connection.
  No one can see anyone else's location or address.
- **Room codes are private.** There's no public list of rooms; you play with people you share
  your code with. Empty rooms disappear on their own.
- **Free-text chat is off by default** and only exists if *you* turn it on. Even then, it's
  filtered, and every player can mute and report.
- **Room owners can kick and ban.** The player who created a room can remove a disruptive
  player from it. (Running a whole world? You get durable, passport-based blocking and an
  operator console — see **[Hosting a World](Hosting-a-World)**.)

For a plain-language page you can show a parent or teacher, and the full privacy details, see
**[Online Safety (Parents & Teachers)](Online-Safety)**.

---

## For plugin makers

Plugins can build their own online features on top of Beacon. The `atlas.mp` API lets a plugin
react when players join or leave and send small custom messages between everyone in the room.
See **[Plugin & Script API](Plugin-and-Script-API)** for the full surface.

---

*Next: run a big world of your own — **[Hosting a World](Hosting-a-World)**.*
