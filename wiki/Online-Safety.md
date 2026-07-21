# Online Safety (for Parents & Teachers)

RPGAtlas games can let friends play together online. This page explains — in plain
language — exactly what that means, what connects to what, and what information is (and
isn't) collected. It's written to be read by a parent, guardian, or teacher, and it's short
on purpose.

**The one-sentence version:** players connect only to a game server (never to each other),
no accounts or emails or personal information are ever collected, and free-text chat is
**off unless a game's creator turns it on** — with instant muting and reporting built in.

---

## Is online play even on?

For most games, **no** — a game is single-player until its creator ticks a box. If a game
never turned on "Play Together," there is nothing online to worry about: it plays entirely on
the device, offline.

When a game *does* have Play Together, a **Play Together** button appears on its title screen.
A player types a display name (whatever they like — a nickname is fine) and either creates a
room, joins a friend's room with a short code, or connects to a world by address.

---

## What connects to what

- **Players never connect to each other.** Every player connects only to a **game server**,
  over a secure `wss://` (encrypted) link — the same kind of secure connection a bank website
  uses. There is no peer-to-peer, so **no player ever learns another player's IP address or
  location.**
- Friends in a **room** all connect to a shared **relay** server — usually one the game's
  creator runs themselves; for Driftwood's own demo game, that's Driftwood's free relay.
- A **world** (a bigger, persistent server) is one that a creator runs and controls.

---

## What information is collected

**None of the usual stuff.** Specifically:

- **No accounts.** Nobody signs up. There is no username-and-password.
- **No email address.** Ever. It's never asked for.
- **No personal information.** A player is only a **display name** they choose. That's the
  whole identity in a friend room.
- For a **world**, a device also creates a **passport** — a small security key stored on the
  device so the same player is recognised when they come back. **It contains no personal
  information** (no name-beyond-the-nickname, no email, no location, nothing about the
  person). It's a random cryptographic key, like a house key that only fits one lock.

**What actually travels over the network** is only: the player's display name, where their
character is standing on the map, and the emotes / phrases (or, if the creator enabled it,
filtered chat) they choose to send. Never an address, never a browsing history, never
anything private.

The **free relay** keeps a player's network address (IP) only briefly and only to stop abuse
(like blocking someone who floods it) — it is never shown to anyone and never stored
long-term. A self-hosted server is run by the creator, on their own machine or account.

---

## Room codes are private

- Room codes are **long and unguessable**, and join attempts are rate-limited, so nobody
  stumbles into a room by luck.
- There is **no public list of rooms** — you play with the people you *give* your code to.
- **Empty rooms disappear** on their own, so nothing lingers.

---

## Chat: off by default, and honest about the filter

How players talk to each other is a **safety setting the game's creator chooses**:

- **Emotes + preset phrases only** — the default, and the safest. Players tap emotes (👋 👍 ❤️)
  and ready-made phrases the creator wrote ("Follow me!", "Need healing!"). **No free typing
  at all.** Ideal for younger players.
- **Filtered free-text chat** — players can also type short messages. These are run through a
  bad-word filter.

**Please read this about the filter, honestly:** a word-list filter is a helpful courtesy,
**not** a guarantee. It catches the common cases (rude words, simple disguises like `sh1t`,
stretched-out words like `fuuuck`), and it works best in English with a decent effort in
Spanish, French, German, Portuguese, and Italian. It does **not** catch every creative
spelling, brand-new slang, or messages in other alphabets. That's why the *real* safety tools
don't rely on the filter at all:

- **Mute** is instant and private. Any player can mute anyone with one tap — that person's
  messages and emotes simply stop appearing on their screen. It happens entirely on the
  device; the muted person is never told.
- **Report** lets any player flag someone to the person running the room or world.
- **Kick / block** — the person who created a room (the "owner"), and the operator of a
  world, can remove a disruptive player.

If you're setting up a game for young children, the simplest safe choice is to **leave chat
on the default** (emotes + preset phrases). Then there is no free typing to worry about.

---

## The tools, at a glance

| Anyone can… | A room owner / world operator can… |
|---|---|
| **Mute** any player instantly (private, on-device) | **Kick** a disruptive player from the room |
| **Report** a player to the owner/operator | **Block** a player (in a world, durably, by their passport) |
| Turn off chat by not turning it on | Review reports and run moderation commands |

---

## For a self-hosted world

A creator who runs their own **world server** keeps everything above, plus durable tools:

- They can **block a player's passport** — the random key that identifies that player. The
  blocked key can't rejoin, even across restarts. (Because the passport lives on the player's
  own device, a determined player could start over with a brand-new one — but only by wiping
  their old key and losing all of that world's progress, which is a real deterrent.)
- The server saves each player's position and game progress, keyed by that random passport
  key. **No personal information is stored** — just "this key was last here, with this
  progress." (See **[Hosting a World](Hosting-a-World)** for the technical details.)

---

## A quick checklist for a parent or teacher

1. **Is online play even on?** If there's no "Play Together" button, it's single-player —
   nothing to set up.
2. **Who can they play with?** Only people they share a room code (or a server address) with.
   There's no public matchmaking or stranger lobby.
3. **Can they type freely to others?** Only if the game's creator enabled free-text chat. If
   you're unsure, the safest choice is emotes + preset phrases.
4. **What if someone is unkind?** The child can mute them instantly and report them; the room
   owner can remove them.
5. **What's collected?** No account, no email, no personal information — a chosen display name
   and (for worlds) a random device key with nothing personal in it.

---

*Related: **[Making Your Game Multiplayer](Making-Your-Game-Multiplayer)** ·
**[Hosting a World](Hosting-a-World)**.*
