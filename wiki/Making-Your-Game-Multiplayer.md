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
- **Play server address** — leave this **blank** to use Driftwood's free play server. Only
  fill it in if you're running your own world server (see
  **[Hosting a World](Hosting-a-World)**). It must start with `wss://`.

### Talking to each other

Pick how players communicate. This is a **safety** setting, so the safest option is the
default:

- **Emotes + preset phrases only** *(default, safest)* — players tap emotes and the ready-made
  phrases you write. No free typing at all. Perfect for younger players.
- **Filtered free-text chat** — players can also type their own short messages. These run
  through a bad-word filter, and every player can **mute** or **report** anyone. Only turn
  this on if you're comfortable with players typing whatever they like.

> Whatever you choose, emotes and your preset phrases always work.

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

> These build the *authoring* side of online events. Full online event effects run once your
> game is on a world server that runs events (a later Beacon phase) — but everything you set up
> now is ready and works today in local co-op testing.

---

## Party up and fight together

Two players who are near each other can **team up**: one invites, the other accepts a friendly
"NAME wants to team up!" prompt. Party members follow their leader through map changes, and when
one of them starts a battle, nearby party members **join the same fight**. Everyone picks
commands for their own heroes; loot and experience go to each player's own party. Nobody's
game ends because a shared fight went badly — everyone just gets back up.

A player who isn't in a party gets their **own** private battle, exactly as in a normal game.

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

For a plain-language page you can show a parent or teacher, and the full privacy details, see
**[Hosting a World](Hosting-a-World)**.

---

## For plugin makers

Plugins can build their own online features on top of Beacon. The `atlas.mp` API lets a plugin
react when players join or leave and send small custom messages between everyone in the room.
See **[Plugin & Script API](Plugin-and-Script-API)** for the full surface.

---

*Next: run a big world of your own — **[Hosting a World](Hosting-a-World)**.*
