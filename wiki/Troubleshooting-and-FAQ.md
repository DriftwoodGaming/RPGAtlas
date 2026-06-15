# Troubleshooting & FAQ

Quick fixes for the snags people hit most. If your problem isn't here, check the
[Resources & Glossary](Resources-and-Glossary) or the project's `README.md`.

---

## Starting up

### Nothing happens / the editor won't load when I double-click `RPGAtlas.exe`
- Make sure `RPGAtlas.exe` is **inside the RPGAtlas folder**, next to `index.html`. It serves the
  folder it lives in; moved on its own, it can't find the engine.
- Look at the little black window — it prints the address (usually `http://localhost:8080/`) and any
  error. Open that address in your browser manually if a tab didn't pop up.

### "Windows protected your PC" / unknown publisher
Expected — the launcher is **unsigned**. Click **More info ▸ Run anyway**. It only starts a local
server and opens your browser. See [Installation & Setup](Installation-and-Setup#windows-protected-your-pc--unknown-publisher).

### "Could not open a local port"
Another copy of RPGAtlas (or another program) is using the port. Close other RPGAtlas windows and try
again — the launcher tries ports 8080–8099 automatically.

### I opened `index.html` directly and it's broken
Browsers block `localStorage` and asset scanning on `file://` pages. You **must** serve the folder —
use `RPGAtlas.exe` (Windows) or `python -m http.server 8080`. See
[Installation & Setup](Installation-and-Setup).

---

## My work

### Where is my project saved? Will I lose it?
The editor **auto-saves to your browser** (`localStorage`). That's convenient but fragile: it's tied
to one browser on one computer, and clearing browser data erases it. **Always keep a `.json` backup**
via **File ▸ Save Project**. Treat the `.json` as your real save file.

### I switched browsers/computers and my game is gone
The auto-save doesn't travel between browsers. Use the **`.json`** you exported (**File ▸ Open
Project** to load it). If you never saved one, the work only exists in the original browser's storage.

### Undo only goes back so far
Undo/redo is generous (full-map history for tiles, shadows, heights, passability, and events) but not
infinite. Save `.json` checkpoints at milestones.

---

## Maps & assets

### My custom art doesn't appear in the editor
- Confirm files are in the **correct `img` subfolder** (`characters`, `facesets`, `enemies`,
  `tilesets`, `system`) and are valid PNG/WebP/JPG. See
  [Characters & Custom Assets](Characters-and-Custom-Assets).
- **Reload the editor** after adding files.
- If you're hosting the engine somewhere **without directory listings**, the scan can't see the
  files — run `tools/update-assets.ps1` to write a manifest, then reload. (The bundled `RPGAtlas.exe`
  and `python -m http.server` both provide listings, so this is only for unusual hosts.)

### The player can walk through a wall (or can't cross a bridge)
Passability comes from the topmost tile, but you can fix any cell directly: switch to
**Passability mode** and click the tile to cycle auto → block → pass. For custom tiles, filename
suffixes like `.pass` and `.terrain` set defaults. See
[Maps & Tiles](Maps-and-Tiles#passability--where-the-player-can-walk).

### My HD-2D map looks flat / like normal 2D
HD-2D is **opt-in per map** (enable it in Map Properties) and **falls back to flat 2D** on devices
that can't run WebGL2. Heights only extrude in HD-2D maps. See
[Maps & Tiles](Maps-and-Tiles#hd-2d-heights).

---

## Events

### My event does nothing / the wrong page runs
- Check the **trigger** — Action Button needs the player to face it and press Z/Enter; Player Touch
  needs them to step on it.
- Remember pages resolve **last-match-wins**. If a later page's conditions are met, it overrides
  earlier ones. See [Events](Events#pages-and-conditions).

### The game froze during a cutscene
An **Autorun** page with no end condition runs forever. Make the page flip a **switch/self-switch** at
its end, and add an empty page whose condition is that flag, so the event stops. See
[Events](Events#triggers--what-starts-an-event).

### A chest gives its item every time
You're missing the **self-switch**. Set Self-Switch A = ON after the reward, and add a second page
conditioned on Self-Switch A being ON. See
[Events](Events#recipes).

---

## Battles

### Battles are too hard / too easy
Tune enemy **stats and rewards** and your **class growth** in the [Database](The-Database). Playtest a
fresh party through the area. See [Battles & States](Battles-and-States#tips-for-fun-fair-combat).

### Random encounters never happen (or happen constantly)
Encounters and their **rate** live in **Map Properties**, and the map needs **troops** assigned. A
lower rate means *more* frequent battles. See [Maps & Tiles](Maps-and-Tiles#random-encounters).

---

## Publishing

### My exported EXE triggers a virus/security warning
The launcher is unsigned, so SmartScreen/antivirus may flag downloaded builds. Players use **More
info ▸ Run anyway**, or distribute the **Standalone HTML** build instead. See
[Publishing Your Game](Publishing-Your-Game#the-unsigned-exe-warning).

### Players say their saves disappeared
Browser saves are **per browser/computer**. If a player switches browsers or clears data, their saves
go with it — that's inherent to browser games, not a bug.

---

## Frequently asked

**Do I need to know how to code?** No. Maps, events, and the database cover full games. Code (via
[Plugins](Plugins) or the Script command) is optional.

**Does it cost anything?** No. RPGAtlas is free and open-source (GPL-3.0).

**Can I sell games I make?** Yes — your content is yours, no credit required.

**Does it work offline?** Yes. Once you have the folder, nothing needs the internet.

**Can I use my own music or art?** Yes for art (drop files in `img/`). Audio is procedural; custom
audio tracks aren't a built-in feature, but plugins can extend the engine.

**Where do old Driftwood Engine projects go?** They open and migrate automatically — autosaves, save
slots, and bundled plugins all carry forward.

**Next:** [Resources & Glossary →](Resources-and-Glossary)
