# Dialogue & Cutscenes

Open **Tools ▸ Dialogue & Cutscenes** to author conversations as reusable assets instead of
assembling every exchange inside a map event page.

## The workspace

Each dialogue asset has a conversation tree made from four node types:

- **Line** — speaker, portrait override, voice cue, dialogue text, localization key, condition,
  and the next node.
- **Choice** — an optional spoken prompt plus any number of player choices. Every choice has its
  own localization key, destination node, and **show condition**.
- **Topic Hub** — one list of everything the player can ask about right now. See
  [Topic hubs](#topic-hubs-ask-them-about) below.
- **Cutscene** — a normal event-command list inside the conversation. Use movement, camera,
  pictures, screen effects, audio, waits, switches, battles, or any other event command here.

Use **Speakers…** to define the names and default portraits shared by the asset. A line can override
the portrait without changing the speaker. Voice cues can use built-in effects or imported audio
from the Asset Browser; referenced portraits and audio are included automatically when the game is
exported.

The tree begins at the card marked **START**. Select any card to edit it, make it the start node,
or link it to another node. Unlinked nodes stay visible in a separate section so drafts are not
lost.

## Conditions

Every condition in the workspace — on a node, on a single choice option, or on a topic — opens the
same picker Conditional Branch uses, so switches, self-switches, variables (including comparing one
variable against another), quest states, item counts, party members and equipment, gold and other
currencies, map region, time of day, and online state all work in conversations.

A condition can be a **list** of conditions, each edited on its own line, with a picker at the top
deciding how they combine:

- **ALL of these are true (AND)** — "in the Mage guild *and* has met Ravel".
- **ANY one of these is true (OR)** — "is a Mage *or* is carrying the guild seal".

**+ Add group** adds brackets with their own ALL/ANY choice, so `A AND (B OR C)` is authorable, and
a plain-language line reads the whole thing back to you as you build it. See
[Combining conditions](Events#combining-conditions) for the full tour. Leaving the list empty means
"always". A gate with exactly one condition is stored exactly as it always was, so older projects
are unchanged.

### Conditions on choices

Each option in a **Choice** node has its own **Only if…** button. An option whose condition is not
met is simply left out of the list when the conversation runs, and the options that remain keep
their own destinations — hiding "Use the Rusty Key" can never send the player down the "Leave"
branch by mistake. If every option is hidden, the node falls through to its fallback node instead
of showing an empty window.

## Topic hubs ("ask them about…")

A **Topic Hub** is the other way to write a conversation. Instead of wiring every question into a
branch, you fill the dialogue's **topic pool** and the hub offers every topic whose condition is met
— all in one list. The player picks one, hears the answer, and comes straight back to the list until
they choose to leave. This is the shape most story-heavy games want from an NPC: everything you can
currently ask, in one place.

Each topic has:

- **Topic** — the line shown in the list.
- **Goes to** — the node that answers it. When that branch ends, the player returns to the hub.
- **Priority** — higher numbers are listed first; equal priorities keep the order you authored.
- **Ask once** — retires the topic once it has been used, for the rest of that save.
- **Offer this topic** — the condition (or list of conditions) that makes it available.

The hub itself has an optional prompt, a **"Stop asking" option** whose label you choose (clear it
to remove the exit entirely), a **Show at most** cap that keeps only the highest-priority topics,
and **Also offer topics from**, which pulls in another dialogue's pool. That last one is how one
shared "Guild topics" asset can hang off every guild member — a borrowed topic runs inside the
dialogue that owns it and then returns to the hub, and an "Ask once" topic stays spent no matter
which NPC it was asked of.

Topics live on the dialogue asset rather than on a node, so every hub in that dialogue offers the
same pool. Adding a topic never means re-shaping the branches around it: write the line, give it a
condition, and it appears when it should.

## Preview and localization

Click **Preview** to read through the current tree and choose branches without starting a map
playtest. Cutscene nodes are summarized in the preview; their event commands run in the real game.
The preview assumes conditional nodes, choices, and topics are available — conditional entries are
marked `(if…)` — while playtest evaluates them against live game state. A hub's topics are previewed
in the same priority order the player would see.

Localization keys are stable author-owned identifiers stored beside each line, choice, and topic.
Enter them manually or click **Generate keys** to fill only the missing keys. The current text remains the
runtime fallback, so a localization pipeline can extract keys without making unfinished content
disappear.

## Use a dialogue in an event

Add **Play Dialogue** to any event command list and choose the reusable asset. The same command is
available as an **Atlas Graph** node. Dialogue assets can also be started from Script commands with
`return game.callDialogue(id)` when later commands must wait for the conversation to finish.

Because Cutscene nodes contain ordinary event commands, they behave the same in playtest, saved
games, plugins, Atlas Graph flows, and standalone exports.

**Next:** [Events →](Events)
