# Coming from RPG Maker MZ / MV

Already made a game in **RPG Maker MV** or **MZ**? You can bring it straight into RPGAtlas. The
importer reads your own project, converts the maps, database, and events into RPGAtlas's own format,
and hands you a plain-language **report** of what came along and what to do next. Nothing is ever
thrown away silently, and your original project isn't touched.

This page is the friendly guide to that move: what to expect, how to do it, and where the two
engines line up.

> **Only your *own* project works.** RPGAtlas unlocks encrypted artwork with the key stored in your
> own project, exactly as RPG Maker does. There's no way to import a game you don't have the project
> for — and that's on purpose.

---

## How to import

1. In RPGAtlas, choose **File ▸ Import from RPG Maker…**.
2. Point it at your game. Two ways:
   - **Choose Folder…** — pick the game's project folder (the one with a **`data`** folder inside).
   - **Choose .zip File…** — pick a `.zip` of that folder. Handy for moving a project between computers.
3. Watch the little progress bar — reading, converting, building, done.
4. Read the **import report** when it pops up, then press **▶ Playtest (F5)** to try your game.

Your current RPGAtlas project is **replaced** by the import, so if you have unsaved work, use
**File ▸ Export Project As File…** to back it up first.

---

## The import report

When the import finishes you get a report — and you can reopen it any time from
**File ▸ Import Report**. It's written in plain words, not error codes, and it's organized as:

- **🎉 Everything that came along** — a quick count of maps, heroes, skills, items, enemies,
  battle groups, common events, switches, and variables.
- **✏️ Came in a little differently** — things that converted but aren't a perfect 1:1 match.
- **⏳ Saved for a later update** — things RPGAtlas can't convert *yet*. They're kept, not deleted.
- **📦 Left out on purpose** — things RPGAtlas deliberately does differently.
- **🔌 Add-ons (plugins)** — every plugin from your game, with honest guidance (see below).

**Save it or copy it.** The report has **💾 Save as Text…** and **📋 Copy** buttons, so you can
keep a checklist of anything you want to touch up by hand, or paste it into a question if you get
stuck.

---

## What comes across

| In RPG Maker | Becomes in RPGAtlas |
|---|---|
| Maps, layers, and their events | Maps with their layout, passability, and events |
| Tilesets (passability, terrain tags, bush/ladder/counter/damage flags) | RPGAtlas tilesets with the same tile behaviors |
| Actors, Classes, Skills, Items, Weapons, Armors | The matching **Database** entries |
| Enemies and Troops | Enemies and battle groups |
| States (poison, stun, buffs…) | **States** |
| Common Events | Common Events |
| Switches and Variables (with their names) | Switches and Variables |
| System settings (title, party, starting position, sounds) | **Database ▸ System** |
| Animations (MV sheet animations) | Real flipbook battle animations |
| Sounds & music (BGM, BGS, ME, SE, volume/pitch/pan) | The RPGAtlas audio system |
| The Luck stat (LUK) | The eighth battle stat — nudges ailment/debuff odds, just like RM |
| Dual wield (two-weapon fighting) | A second weapon slot on dual-wield heroes |
| Autosave | The dedicated Autosave slot (written after map moves and won battles) |
| Menu commands & item categories | The pause menu shows your picks; the item menu gets Items / Weapons / Armor / **Key Items** tabs |
| Key items | Real key items — their own tab, and they can't be used up by accident |

A **terminology cheat-sheet**, if the words are new:

| RPG Maker word | RPGAtlas word |
|---|---|
| Actor | Hero / character in the Database |
| Troop | Battle group |
| Tileset A/B/C… | Tileset (one sheet per set) |
| Region ID | Zone / region (used for encounters) |
| Plugin | Add-on |
| Note tag | (not used — RPGAtlas uses fields, not note boxes) |

---

## Add-ons (plugins)

RPG Maker plugins are little JavaScript programs. RPGAtlas **can't run them** — but it doesn't just
drop them, either. The report lists every add-on from your `js/plugins.js`, remembers whether it was
on or off and how many settings it had, and tells you, in plain words, one of four things:

- **✅ Atlas already does this** — e.g. a quest journal → the built-in **Quests** panel.
- **🔷 Atlas has something close** — e.g. a message or battle add-on.
- **▫️ Atlas doesn't do this — your game still plays** — e.g. pixel movement, lighting, custom HUDs.
- **❔ Settings kept, but it won't run** — an add-on RPGAtlas doesn't recognize.

RPGAtlas **never runs plugin code** — it only reads the list as text. If a plugin was doing
something important to your game, the report points you at the closest built-in feature.

---

## Script snippets

Some RPG Maker events use tiny bits of JavaScript — a **Script** command, or a **Conditional
Branch** that asks its question in code. RPGAtlas understands the most common, **read-only** ones:

- `$gameSwitches.value(n)` — is a switch on?
- `$gameVariables.value(n)` — a variable's value.
- `$gameParty.size()` / `.gold()` / `.members()` / `.hasItem(id)` — party facts.

Those convert and **run for real**, so a branch like *"is switch 3 on and variable 1 above 5?"*
picks the right path in your game. For your safety, imported scripts only ever **read** game data —
a snippet that *changes* data (like `setValue` or `gainGold`), or reads something RPGAtlas doesn't
have yet, is listed honestly in the report and left out. Your game keeps playing either way.

---

## Bringing in your artwork

Your maps keep their **shapes, layout, and events** on import. To see your own **tile artwork**,
bring the tileset images in with the **Asset Browser** (Tools ▸ Asset Browser) and
**Import Autotile Sheet** — see [The Asset Browser](The-Asset-Browser) and
[Maps & Tiles](Maps-and-Tiles). Character and battler images import the same way.

---

## Re-importing later

RPGAtlas keeps getting better at converting RPG Maker projects. If you imported a game a while ago
and something was **"saved for a later update"**, just run **File ▸ Import from RPG Maker…** on the
same folder again. The new report has a **🔁 banner** that tells you how many of those waiting
things now come across — a re-import is a safe way to pick up whatever RPGAtlas has newly learned.

(Re-importing replaces the project, so export a backup first if you've done hand-editing you want to
keep.)

---

## If something looks off

- **A map is blank or grey?** Its tiles imported by position, but the *artwork* comes in through the
  Asset Browser — see [Bringing in your artwork](#bringing-in-your-artwork) above.
- **An event does nothing at a certain step?** Check the report's **⏳ Saved for a later update**
  list — that command may be waiting on a future update. It's kept, so it'll light up when support
  lands and you re-import.
- **The import didn't work at all?** RPGAtlas says so plainly and changes nothing on your computer.
  Make sure you picked the folder with a **`data`** folder inside (or a `.zip` of it). More help in
  [Troubleshooting & FAQ](Troubleshooting-and-FAQ).

---

**See also:** [Migration Guide](Migration-Guide) (how RPGAtlas upgrades its *own* project files) ·
[The Database](The-Database) · [Events](Events) · [Plugins](Plugins)

**Next:** [Make Your First Game →](Your-First-Game)
