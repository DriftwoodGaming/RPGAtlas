# RPGAtlas Wiki (source)

This folder holds the RPGAtlas user manual as plain Markdown, written to GitHub Wiki conventions.
Keeping it in the repo means the docs are versioned and reviewable alongside the code; from here you
can publish it as the project's **GitHub Wiki** (or any Markdown site).

## Pages

| File | Page |
|---|---|
| `Home.md` | Landing page |
| `_Sidebar.md` | Navigation (shown on every wiki page) |
| `_Footer.md` | Footer (shown on every wiki page) |
| `Installation-and-Setup.md` | Getting RPGAtlas running |
| `Your-First-Game.md` | The flagship 30-minute tutorial |
| `The-Editor-Interface.md` | Menus, tools, modes, shortcuts |
| `Maps-and-Tiles.md` | Layers, passability, shadows, HD-2D |
| `Events.md` | Pages, triggers, full command reference, recipes |
| `The-Database.md` | Every database tab explained |
| `Battles-and-States.md` | Combat, enemies, troops, states |
| `Characters-and-Custom-Assets.md` | Character Generator, custom art |
| `Audio.md` | Procedural music & SFX |
| `Message-Text-Codes.md` | Icons, colors, variables in dialogue |
| `Plugins.md` | Extending the engine with JavaScript |
| `Publishing-Your-Game.md` | Exporting EXE/HTML and distribution |
| `Troubleshooting-and-FAQ.md` | Common fixes and FAQ |
| `Resources-and-Glossary.md` | Glossary, primers, licensing, links |

Links between pages use the page name without `.md` (e.g. `[Events](Events)`), which is what GitHub
Wiki expects.

## Publishing to the GitHub Wiki

A repository's wiki is its own git repo at `<repo>.wiki.git`. To publish these pages:

1. **Enable the Wiki** for the repo on GitHub (Settings ▸ Features ▸ Wikis) and create the first page
   in the web UI once, so the wiki repo exists.
2. Clone it and copy these files in:

   ```sh
   git clone https://github.com/DriftwoodGaming/RPGAtlas.wiki.git
   cp path/to/RPGAtlas/wiki/*.md RPGAtlas.wiki/
   cd RPGAtlas.wiki
   git add .
   git commit -m "Add RPGAtlas user manual"
   git push
   ```

3. Visit `https://github.com/DriftwoodGaming/RPGAtlas/wiki` — the manual is live, with the sidebar and
   footer applied automatically.

To update later, edit the Markdown here, recopy, and push again (or edit on the wiki and copy back).

## Alternative: host as a static site

The same Markdown works with zero-build doc tools if you'd rather have a standalone site:

- **Docsify** or **MkDocs** can serve this folder. (They expect a lowercase `_sidebar.md` and an
  `index.html`/config; rename/adjust as needed.)
- Or drop the files into a `docs/` folder and enable **GitHub Pages**.

The content doesn't change — only the wrapper does. Ask if you'd like this converted to a specific
site generator.
