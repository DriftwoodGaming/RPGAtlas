# Dialogue & Cutscenes

Open **Tools ▸ Dialogue & Cutscenes** to author conversations as reusable assets instead of
assembling every exchange inside a map event page.

## The workspace

Each dialogue asset has a conversation tree made from three node types:

- **Line** — speaker, portrait override, voice cue, dialogue text, localization key, condition,
  and the next node.
- **Choice** — an optional spoken prompt plus any number of player choices. Every choice has its
  own localization key and destination node.
- **Cutscene** — a normal event-command list inside the conversation. Use movement, camera,
  pictures, screen effects, audio, waits, switches, battles, or any other event command here.

Use **Speakers…** to define the names and default portraits shared by the asset. A line can override
the portrait without changing the speaker. Voice cues can use built-in effects or imported audio
from the Asset Browser; referenced portraits and audio are included automatically when the game is
exported.

The tree begins at the card marked **START**. Select any card to edit it, make it the start node,
or link it to another node. Unlinked nodes stay visible in a separate section so drafts are not
lost. Conditions use the same switches, variables, quest states, inventory, party, region, gold,
and time-of-day checks as Conditional Branch.

## Preview and localization

Click **Preview** to read through the current tree and choose branches without starting a map
playtest. Cutscene nodes are summarized in the preview; their event commands run in the real game.
The preview assumes conditional nodes are available, while playtest evaluates them against live
game state.

Localization keys are stable author-owned identifiers stored beside each line and choice. Enter
them manually or click **Generate keys** to fill only the missing keys. The current text remains the
runtime fallback, so a localization pipeline can extract keys without making unfinished content
disappear.

## Use a dialogue in an event

Add **Play Dialogue** to any event command list and choose the reusable asset. The same command is
available as an **Atlas Graph** node. Dialogue assets can also be started from Script commands with
`return game.callDialogue(id)` when later commands must wait for the conversation to finish.

Because Cutscene nodes contain ordinary event commands, they behave the same in playtest, saved
games, plugins, Atlas Graph flows, and standalone exports.

**Next:** [Events →](Events)
