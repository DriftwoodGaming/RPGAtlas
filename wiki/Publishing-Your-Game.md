# Publishing Your Game

When your game is ready for other people, you **export** it into a single self-contained file.
Players don't need RPGAtlas, the editor, a local server, or your project file — just the export.

---

## Export from the editor

Choose **File ▸ Export Standalone Game** and pick a format:

| Format | What it is | Best for |
|---|---|---|
| **Windows EXE** | A small launcher with your entire game bundled inside it. Double-clicking it extracts the game and opens it in the player's default browser. | Sharing with Windows players who want a "real app" to double-click |
| **Standalone HTML** | One cross-platform file that opens directly in any modern browser. | Direct sharing — Mac, Linux, Chromebooks, Discord, game jams |
| **Web / itch.io (.zip)** | The game plus a web-app manifest, icons, and an offline service worker, zipped with `index.html` at the root — exactly the layout itch.io's HTML5 uploader expects. Hosted anywhere, players can **install it like an app** and **replay offline**. | itch.io, your own website, any static host |

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

- **itch.io** — upload the **Web (.zip)** build as an HTML5 game ("This file will be played in the
  browser" → done), or offer the EXE/HTML as downloads. The most popular home for indie RPG-maker
  games.
- **Your own site / any static host** — unzip the Web build onto GitHub Pages, Netlify, or any
  web server. Visitors on Chrome/Edge/Android get an "install app" option, and the game keeps
  working offline after the first visit.
- **A direct file** — share the single HTML (or EXE) via Discord or cloud storage.
- **Game jams** — the single-file HTML build is ideal for quick judging.

### A proper native desktop app

Working from the RPGAtlas repo with the Rust toolchain installed, you can package any exported
project as a **real native executable** (its own window, no browser at all):

```
node scripts/package-game-exe.mjs MyGame.json
```

It reuses the exact same game build as the in-editor exports, wraps it in the desktop shell
RPGAtlas itself uses (Tauri), sizes the window to your game's screen settings, and drops
`My_Game.exe` at the repo root. Export the project **as a file** from the editor first — file
exports embed the imported assets your game uses.

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
