# Publishing Your Game

When your game is ready for other people, you **export** it into a single self-contained file.
Players don't need RPGAtlas, the editor, a local server, or your project file — just the export.

---

## Export from the editor

Choose **File ▸ Export Standalone Game** and pick a format:

| Format | What it is | Best for |
|---|---|---|
| **Windows EXE** | A small launcher with your entire game bundled inside it. Double-clicking it extracts the game and opens it in the player's default browser. | Sharing with Windows players who want a "real app" to double-click |
| **Standalone HTML** | One cross-platform file that opens directly in any modern browser. | Everyone else — Mac, Linux, Chromebooks, itch.io, the web |

Both bundle the engine runtime and **only the custom assets your project actually uses**, so the file
stays as small as possible.

---

## What players experience

- They **don't install anything** beyond having a modern browser (the EXE just opens their default
  one).
- **Save slots** (the game has three) are stored in the **player's own browser**. Saves are per
  browser/computer — that's normal for browser games.
- Nothing phones home; the game runs entirely on their machine.

---

## The unsigned-EXE warning

The exported Windows launcher is **unsigned** (code-signing certificates cost money). Windows
SmartScreen may show a security warning for downloaded builds — players click **More info ▸ Run
anyway**. If that worries your audience, the **Standalone HTML** export sidesteps it entirely.

---

## Distribution ideas

- **itch.io** — upload the **HTML** build and itch can host it as a playable-in-browser game, or offer
  the EXE/HTML as a download. The most popular home for indie RPG-maker games.
- **A zip download** — share the HTML (or EXE) directly via your site, Discord, or cloud storage.
- **Game jams** — the single-file HTML build is ideal for quick judging.

---

## Before you ship: a quick checklist

- [ ] **Game Title** set in [Database ▸ System](The-Database#system) (it names the file).
- [ ] **Start position** set, on a walkable tile.
- [ ] Playtested from a **fresh start** to the end.
- [ ] Every **Transfer** has a matching way back (no soft-locks).
- [ ] **Autorun cutscenes** end by flipping a switch (so they don't loop or freeze the game).
- [ ] Saved a **`.json` backup** of the project (your master copy — keep it safe).
- [ ] Tested the **actual export**, not just the in-editor playtest.

---

## Licensing, briefly

The engine is GPL-3.0, but **your content is yours** — sell your games, no credit required. Because
exports are plain, readable HTML/JS, the engine's source-availability requirement is satisfied by the
export itself. More in [Resources & Glossary](Resources-and-Glossary#licensing-in-plain-language).

**Next:** [Troubleshooting & FAQ →](Troubleshooting-and-FAQ)
