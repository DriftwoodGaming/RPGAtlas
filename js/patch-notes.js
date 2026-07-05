/* RPGAtlas - patch-notes.js
   Keep newest entries first. See AGENTS.md for the update policy. */
"use strict";

export const PATCH_NOTES = [
  {
    date: "July 5, 2026",
    title: "Fancier messages: text codes, number & item prompts, and a name-entry screen",
    summary:
      "Show Text learned the classic message tricks, and three new commands let the player type things back. Make text \\{bigger\\} or \\}smaller\\}, pause the typing with \\. and \\|, show the current gold with \\$, and more — plus you can now ask the player for a number, let them pick an item, or let them name a hero. Games imported from RPG Maker MV/MZ bring all of this across.",
    items: [
      "New message text codes in Show Text and Show Choices: \\p[n] (a party member's name), \\$ (show the current gold), \\{ … \\} (bigger / smaller text), \\. and \\| (short pauses while typing), \\! (wait for a button), \\> … \\< (type the rest instantly), and \\^ (close without waiting). The little “Text codes” panel under the box lists them all.",
      "Show Text now has Window (Window / Dim / Transparent) and Position (Top / Middle / Bottom) options, so a message can sit at the top of the screen or fade into a dim backdrop.",
      "Input Number: pop up a little number pad the player dials in; the number is saved to a variable — great for “enter the code” puzzles.",
      "Select Item: let the player pick one of the items they're carrying; the item's id is saved to a variable.",
      "Name Input: open an on-screen keyboard so the player can name a hero (works with keyboard and gamepad).",
      "Importing an RPG Maker MV/MZ game now converts all of these — re-import an older import to pick them up.",
    ],
  },
  {
    date: "July 5, 2026",
    title: "Pictures, screen tint, a timer & more — new event commands for cutscenes",
    summary:
      "Ten new event commands land the classic “presentation” toolkit: show and move pictures on the screen, tint or fade the whole screen, run a count-down timer, scroll the map for a reveal, pop a speech-balloon over a character, and roll full-screen scrolling text. Games imported from RPG Maker MV/MZ that used these now bring them across automatically.",
    items: [
      "Pictures: Show Picture, Move Picture, Rotate Picture, Tint Picture, and Erase Picture — place an image (from your Assets library or an image URL) anywhere on screen, then slide, spin, recolour, or fade it. Point it at a slot number 1–100.",
      "Tint Screen: colour-wash the whole screen — pick a preset (Dark, Night, Sepia, Sunset) or dial in your own red/green/blue/gray. Fade-outs and fade-ins from imported games map to this too.",
      "Control Timer: a count-down clock shows at the top of the screen; when it hits 0 it can fire a common event — perfect for “escape before time runs out!” puzzles.",
      "Scroll Map: pan the camera in a direction for a cutscene reveal (it slides back when the player moves).",
      "Show Balloon Icon: pop a “!”, “?”, heart, music note and more over the player or any event.",
      "Show Scrolling Text: full-screen credits-style text the player can speed up by holding OK or skip with Cancel.",
      "Pictures, screen tint, and the timer are remembered in your save file, so a saved game looks exactly as you left it.",
      "Importing an RPG Maker MV/MZ game now converts all of these — re-import an older import to pick them up. (Picture art needs adding to your Assets library; the import report tells you which.)",
    ],
  },
  {
    date: "July 5, 2026",
    title: "Import from RPG Maker MZ / MV — bring your own game into RPGAtlas",
    summary:
      "Made a game in RPG Maker MV or MZ? File ▸ Import from RPG Maker… brings it in — maps, database, common events, and event pages all convert, and you get a friendly report of what came along and what didn't. Nothing is ever dropped silently.",
    items: [
      "New File ▸ Import from RPG Maker… wizard: pick your game's project folder (the one with a “data” folder) or a .zip of it, and RPGAtlas converts it into a playable project.",
      "Works with both RPG Maker MV and MZ, and unlocks your project's own encrypted artwork using its own key (only your own project is supported).",
      "Maps keep their shapes, layout, encounters, and events; the whole database — heroes, classes, skills, items, weapons, armor, enemies, battle groups, states, switches, variables, and common events — comes across.",
      "Anything that can't convert yet is kept, not thrown away: it appears as a plain-language “coming in a later update” note so you always know what happened.",
      "A plain-language Import Report opens when the import finishes — what came along, what changed a little, and what to do next. Reopen it any time from File ▸ Import Report.",
    ],
  },
  {
    date: "July 4, 2026",
    title: "Add art & sound by copying files into a folder — the Asset Browser picks them up",
    summary:
      "No more guessing where your pictures and sound files should go. On the desktop app the Asset Browser now has an import folder with a labelled sub-folder for each kind of asset — copy files in with Windows Explorer (or your file manager) and they show up in the editor on their own.",
    items: [
      "New “Add your own pictures & sounds” banner at the top of the Asset Browser with an “Open Folder” button that opens the import folder in Explorer/Finder, and the full folder path shown so you can find it yourself.",
      "Drop files into the matching sub-folder — characters, facesets, enemies, tilesets, or audio — and they import automatically: when you open the Asset Browser, when you switch back to the app after adding files, or when you click “Scan for New Files”.",
      "Imported pictures immediately appear in the same pickers and palettes as the built-in art, and sounds appear in the Audio Manager and event sound/music lists.",
      "Each file you add is copied into your library and then tucked into an “Imported” folder so the drop folders stay tidy — nothing is ever deleted, and adding the same file twice is harmless.",
      "A plain-language READ ME is created in the folder explaining what goes where.",
    ],
  },
  {
    date: "July 4, 2026",
    title: "Bring fallen heroes back: a Revive mechanic, the Phoenix Feather & four new states",
    summary:
      "When a party member's HP hits 0 they're out of the fight — and now you can bring them back. New projects start with a Revive skill and a Phoenix Feather item that raise a fallen ally, plus four fresh status effects to spice up battles. Ordinary Potions and heals still can't touch the fallen, so reviving means something.",
    items: [
      "Revive skill: a heal skill that targets a fallen ally and restores them to life (the Cleric and Sage learn it). Tick the new “Revives fallen ally” box on any heal skill in the Skills tab to make your own.",
      "Phoenix Feather item: sold at the village merchant, it revives one fallen ally with 80 HP and does nothing on the living. The Items tab has a matching “Revives fallen ally” box.",
      "Only revive items and revive skills can select a fallen ally — regular restoratives are refused, so the mechanic actually matters.",
      "Four new states: Burn and Bleed deal damage each round, Sleep makes a battler skip its turns, and Blessing steadily heals. They're wired into existing skills — Flame Slash/Inferno burn, Bone Crush bleeds, Moonbeam sleeps, and Sanctuary grants Blessing.",
    ],
  },
  {
    date: "July 4, 2026",
    title: "Six more Quick Events: Door, Save Point, Healing Crystal, Monster, Gift NPC & Quest Giver",
    summary:
      "The New Quick Event menu keeps growing. Right-click an empty tile in Event mode and six more RPG staples are one dialog away — answer a couple of plain questions and the finished, playable event drops onto the map. As always, open one afterwards in the event editor to see exactly how its pages and commands fit together.",
    items: [
      "Door: a press-to-open door — pick where it leads and it plays the door sound, then transfers the player (great alongside the walk-on Transfer).",
      "Save Point: a glowing crystal that opens the Save screen, and can fully heal the party first.",
      "Healing Crystal: touch it to restore the whole party's HP and MP, with your own message.",
      "Monster: a guardian that blocks the way and fights (no escape); beat it and it hands over an optional gold reward and vanishes for good.",
      "Gift NPC: hands the player an item, weapon, armor, or gold once — then only repeats its farewell line.",
      "Quest Giver: speaks, starts a quest you pick, and afterwards just repeats its follow-up line.",
    ],
  },
  {
    date: "July 4, 2026",
    title: "Four new Quick Events: Villager, Shopkeeper, Innkeeper & Locked Door",
    summary:
      "Right-click the map in Event mode and the New Quick Event menu now builds four more classics for you — answer two or three plain questions and the finished event appears, ready to play. Open it afterwards in the event editor to see exactly how it works: every template is made of ordinary pages and commands, so they double as little lessons.",
    items: [
      "Villager: pick a look, type what they say, and choose whether they wander — done.",
      "Shopkeeper: pick a look, a greeting, and the goods; talking to them opens a shop stocked with your wares.",
      "Innkeeper: set the price per night — they take the gold, the screen fades to black, and the party wakes up fully rested (and they politely turn you away if you can't afford it).",
      "Locked Door: choose the key item and the destination; the door blocks the way and says it's locked until the player has the key, then works like a normal door forever after. Optionally the key is used up.",
      "The Villager, Shopkeeper, and Innkeeper dialogs show a live preview of the chosen look, and their spoken lines automatically use that face.",
    ],
  },
  {
    date: "July 4, 2026",
    title: "Advanced Map Editor — polish, docs & a showcase village",
    summary:
      "The Advanced Map Editor is finished! A new Advanced menu on the menu bar gathers everything in one place, the sample game ships a showcase map built with the new tools, and the wiki has a full guide. The bundled sample game also got a repair: a recent update accidentally overwrote it — your adventure starts in Meridian Village again, and Driftwood Shore is back on the map.",
    items: [
      "New Advanced menu: the panel (F4), Terrain & Autotile Studio, Automap rules with Preview/Apply, brush flip/rotate, and stamps — every advanced action is now one click away (they're all in the command palette too).",
      "New sample map “Meridian Village — Advanced”: the familiar village rebuilt with extra layers (a lantern glow and an evening haze), one gameplay zone of every kind, two ready-to-run Automap rules, and a reusable stamp — open it and press F4 to explore.",
      "The Keyboard Shortcuts dialog now lists the Advanced editor's keys.",
      "New wiki guide: Advanced Map Editor — layers, terrain brushes, stamps, zones, and Automap rules, all in one page; the Plugin & Script API page now documents atlas.zonesAt(x, y).",
      "Sample game restored: start position back in Meridian Village, Driftwood Shore and the cave's shore passage back, the Cottage's cozy HD-2D interior back.",
      "Big maps stay fast: a new automated benchmark keeps a 64×64 map with 8 layers and 50 zones at a locked 60 fps.",
    ],
  },
  {
    date: "July 4, 2026",
    title: "Advanced Map Editor — automap rules",
    summary:
      "The Advanced tab gets a bottom Automap drawer: write simple IF/THEN rules that reshape your map with one click, no scripting. Say “IF this tile is grass AND it's next to water, THEN scatter reeds 35% of the time” and the editor fills in the detail for you. Press Preview to see exactly what will change (highlighted right on the map), then Apply — and it all undoes in a single step. Rules are an editor tool only; they're saved with the map but never run in the finished game, so exports are byte-for-byte the same.",
    items: [
      "Build a rule from plain conditions — terrain is / tile is / near / not near / region is / passable — all ANDed together, and actions that place a tile, drop a saved stamp, or set a region.",
      "Pick terrains and tiles straight from the palette (🎯) or from your terrain brushes; choose the layer, radius, and a percentage chance for scatter.",
      "Preview paints the pending changes as a green (tiles) / magenta (regions) overlay so you see the result before committing; Apply writes them as one undoable step.",
      "Every rule has an on/off switch and a 🎲 to reshuffle its random scatter; the same seed always previews and applies identically.",
      "Reach it from the Advanced panel's Automap drawer or the command palette (Automap Rules, Preview, Apply).",
    ],
  },
  {
    date: "July 4, 2026",
    title: "Terrain & Autotile Studio",
    summary:
      "Turn any tile sheet into a smart terrain brush with a five-step wizard (open it from the Advanced tab or the command palette). Pick your sheet, let the Studio guess how it's laid out, name the terrain, and paint — the tiles automatically pick the right edge, corner, and inside pieces for you. Water and lava can animate, and you can add extra sheets so the ground looks less repetitive. Old projects that don't use it are saved exactly as before.",
    items: [
      "Five steps — Source, Layout, Terrain Types, Rules, Preview — with a live preview that paints exactly like the real map.",
      "Auto-detection guesses the arrangement (A2 terrain, A1 animated, fences, corners, walls, roofs) from the sheet's size; change it any time.",
      "Animate a terrain by setting frames + speed — water and lava now flow in the editor, the HD-2D viewport, and play-testing.",
      "Add weighted variations: drop in alternate sheets and each cell randomly picks one, so large fields of grass stop tiling obviously.",
      "Pattern-completion flags fill in shapes you didn't draw by mirroring or rotating the ones you did.",
      "Save Draft keeps your work-in-progress; the classic one-click A2 import is still there as the Quick path.",
    ],
  },
  {
    date: "July 4, 2026",
    title: "Advanced Map Editor — stamps, flip & rotate, searchable tiles",
    summary:
      "The Advanced tab gets three big painting upgrades. Flip or rotate the tile you're painting (X, Y, and R keys, or the toolbar buttons) so one tile can face any direction. Save any selection as a reusable Stamp and drop it anywhere — with a random-scatter mode for quickly sprinkling grass, rocks, or props. And the new right-hand tile palette is searchable and sorted into simple categories (Terrain, Water, Floor, Walls, Nature, Objects). A map that uses none of this saves exactly as before.",
    items: [
      "Press X to flip the brush left-right, Y to flip up-down, R to rotate 90° — the little indicator by the zoom shows the current brush transform. Flipped and rotated tiles look right in the editor, in play-testing, and in exported games.",
      "Select an area in the Map view, then Save Selection as Stamp to add it to the Stamps tab; click 📌 and place it anywhere. Undo works on stamp placement like any other paint.",
      "Turn on 🎲 random scatter to sprinkle a stamp across your brush with an adjustable chance per spot — great for foliage and rubble.",
      "The Advanced editor's Tiles tab has a search box and category chips, so you can find the tile you want without scrolling the whole sheet.",
      "Autotile terrain brushes keep resolving their own shape — flip/rotate applies to ordinary tiles.",
    ],
  },
  {
    date: "July 4, 2026",
    title: "Advanced Map Editor — objects & gameplay zones",
    summary:
      "The Advanced tab gains an Objects palette: draw gameplay zones straight onto the map and give them behaviour. Fence off an area that spawns tougher monsters, a doorway that warps the player elsewhere, a grove that loops birdsong, a storm that only rains in one valley, or invisible walls and walkways — no scripting. Each zone kind has its own little inspector, and a map with no zones plays exactly as before.",
    items: [
      "Switch the right rail to Objects, pick a zone kind, and draw a Rectangle, Ellipse, Polygon, or Point on the canvas (double-click finishes a polygon). Select tool drags the corner handles to reshape a zone.",
      "Encounter zones replace the map's random-battle pool while you stand inside — with a one-click “Test Encounter in This Area” that playtests right there and forces a battle.",
      "Transfer zones warp the player on entry; Sound zones loop an ambience (with optional distance falloff); Weather zones apply weather while inside and restore it on exit.",
      "Collision zones make tiles solid and Navigation zones make them walkable — baked in at load, so movement stays fast.",
      "Custom zones do nothing on their own but are readable by plugins and Script through atlas.zonesAt(x, y) — build whatever you like on top.",
      "Everything round-trips through save/load and Undo (Ctrl+Z), and a map you never give a zone is byte-for-byte identical to before.",
    ],
  },
  {
    date: "July 4, 2026",
    title: "Advanced Map Editor — paintable layers",
    summary:
      "The Advanced tab's layer list is now fully editable. Add your own tile layers on top of the classic four, paint straight onto whichever layer is selected, and give each one an opacity, a blend mode (add / multiply / screen), or a colour tint. Everything you build shows up identically in the regular editor, in play-testing, and in exported games — and a map you never touch here is saved exactly as before.",
    items: [
      "Add Layer (＋) makes a new tile layer; paint it with the Pen, Eraser, Fill, or Rectangle tools using the same tile palette as the Map view.",
      "Set each layer's Opacity, Blend (Normal / Add / Multiply / Screen), and Tint in the properties box below the list.",
      "Group layers together, reorder with ▲ / ▼, toggle the 👁 eye to hide a layer or the lock to protect it, and double-click to rename.",
      "Tile layers draw below or above the characters — your pick — so you can build overhead canopies and ground overlays.",
      "The four base layers (Ground, Decor, Decor 2, Overhead) are always kept and shared with the regular editor; Undo (Ctrl+Z) works across both.",
    ],
  },
  {
    date: "July 4, 2026",
    title: "Advanced Map Editor — first look",
    summary:
      "A new Advanced tab opens next to the Map view (View menu or F4). It shows the same map as the regular editor — nothing moves or changes — with a map tree you can organize into folders, a layer list, and its own zoom. This is the foundation for terrain brushes, zones, stamps, and auto-mapping coming in the next updates.",
    items: [
      "View ▸ Advanced Map Editor (or press F4) opens the new tab beside Map.",
      "Map Tree: press ＋ to make folders, then drag maps onto a folder to file them. Double-click a folder to rename it.",
      "Folders only organize the tree — your maps and games are untouched.",
      "The Layers panel lists this map's layers top to bottom, with Events and Collision rows on top.",
      "Everything you paint in the regular editor shows up here instantly, and clicking a map here switches the regular editor too.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Map Properties gets tabs",
    summary:
      "The Map Properties window grew into one very long scroll as HD-2D picked up features. Its settings now live on four tabs — General, Encounters, HD-2D, and Effects — so each screen shows one topic at a time. Same settings, nothing removed.",
    items: [
      "General: name, size, tileset, music, ambience layers, minimap, and author notes.",
      "Encounters: encounter rate, the troop list, region pools, and the night pool together on one page.",
      "HD-2D: the on/off switch, camera tilt, lights, shadows, water, materials, and cliffs.",
      "Effects: bloom, depth of field, fog, weather, color grading, and the day/night cycle.",
      "The window remembers which tab you were on while the editor stays open.",
      "OK and Cancel still apply or discard everything at once, across all tabs — and one Undo reverts the whole edit, same as before.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Database list toolbar no longer overlaps the form",
    summary:
      "On the Database's Quests tab, the list toolbar had one button too many for its column — the Delete button slid under the Title box and the sub-tab strip. The toolbar now wraps neatly instead of overlapping.",
    items: [
      "Toolbar buttons that don't fit the list column wrap onto a second row instead of spilling under the form.",
      "The Quests tab's reorder buttons are now labeled \"↑ Move up\" and \"↓ Move down\" and sit together on their own row.",
      "Delete moved next to + New and Paste, so the main list actions stay grouped.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Exports start in your Downloads folder",
    summary:
      "Exporting a project file now opens the save window in your Downloads folder instead of Documents — the same place your browser puts every other download.",
    items: [
      "The browser editor's Export Project save window starts in Downloads (it follows your system's Downloads location, even if you've moved it to another drive).",
      "The desktop app's Save As / Export dialog starts in Downloads too.",
      "Standalone game exports (HTML, Windows EXE, web zip) are unchanged — they already go wherever your browser saves downloads.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Twice the icons, twice the starting database",
    summary:
      "The icon sheet doubles from 64 to 128 icons, and new projects now start with twice as many classes, skills, items, weapons, and armors — more ready-made pieces to build with before you add your own.",
    items: [
      "64 new icons (numbers 64–127): class emblems, elemental sigils, enchanted and tiered weapons, more armor, elemental scrolls, tomes, consumables, status marks, and treasure — derived from the original art so everything stays in one style.",
      "Four new starting classes: Paladin (stalwart defender), Ranger (swift archer), Dark Knight (all-out attacker), and Sage (magic and healing hybrid), each with their own stat curves, traits, and learned skills.",
      "Twelve new starting skills, including Blizzard, Inferno, Chain Lightning, Meteor, Holy Smite, Sanctuary, Regrowth (applies Regen), and Venom Volley.",
      "Four new starting items (Herbal Tonic, Golden Apple, Mega Ether, Life Elixir), weapons (Hunting Bow, Battle Axe, Flame Sword, Gale Bow), and armors (Iron Shield, Steel Helm, Golden Mail, Swift Boots).",
      "Reskinning note: img/system/icon_set.png is now 256×512 (8×16 grid of 32×32 cells). Existing projects keep their icon numbers — the original 64 icons are unchanged.",
      "Existing projects aren't touched: the new database entries only appear in newly created projects.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Database sub-tabs — big tabs, digestible pages",
    summary:
      "The Database's busiest tabs now split their settings across sub-tabs inside the main panel, so each screen shows one topic at a time. Nothing moved out of its tab and nothing was removed — same settings, better organized.",
    items: [
      "System is now five pages: General (title, start position, party, battle system), Map systems (followers, minimap, vehicles), Screen, Windows & fonts, and Audio (system sounds & music).",
      "Classes: Stats & curve, Traits, and Skills learned each get their own page; the name and icon stay on top.",
      "Skills: General on one page; the optional state effect and the live damage preview on Effects & preview.",
      "Enemies: Stats & rewards and Actions (AI) split, with the sprite preview always visible.",
      "Troops: Members and Battle events are now separate pages.",
      "Quests: General, Objectives, Requirements, Failure, and Rewards & next — with the live warnings list always visible above the sub-tabs.",
      "The editor remembers which sub-tab you were on: switching entries, hopping to another tab, or undoing an edit won't bounce you back to the first page.",
      "Compact tabs (Items, Weapons, Armors, Actors, States, and friends) stay exactly as they were — they already fit at a glance.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Seven new interface languages",
    summary:
      "The editor now speaks Japanese, Traditional Chinese, Simplified Chinese, Portuguese, Korean, Italian, and Russian — eleven languages in total. Pick yours in Help ▸ Interface Language.",
    items: [
      "New in the language selector: 日本語 (Japanese), 繁體中文 (Traditional Chinese), 简体中文 (Simplified Chinese), Português (Portuguese), 한국어 (Korean), Italiano (Italian), and Русский (Russian), joining English, Español, Français, and Deutsch.",
      "First launch now auto-detects these languages from your browser or system locale too — including picking the right Chinese script for zh-TW, zh-HK, and zh-Hant tags.",
      "Same scope as always: menus, panels, buttons, and status lines are translated; your project's content never is.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "The Console — a command line for power users",
    summary:
      "A new Console tab sits beside the Map view: type commands to inspect, search, build, and steer playtests. Completely optional — everything it does also lives in the menus — but much faster once you know it.",
    items: [
      "New Console tab, first in the map area's tab strip (close it freely; View ▸ Console Panel brings it back). Type help to see everything; Tab completes command names and ↑ recalls history.",
      "validate checks the whole project for broken references (transfers to deleted maps, missing common events, troops, items, and assets) — problem lines are clickable and jump straight to the map.",
      "find searches maps, events, dialogue text, and every database table at once, with clickable results; stats sizes up the project at a glance.",
      "build web / build html / build exe export the game without touching a dialog.",
      "Playtest superpowers: playtest 2 5 7 starts the game directly on map 2 at (5,7) — no title screen; while a playtest runs, give potion 3, switch 5 on, var 2 100, and goto 3 10 8 act on the live game.",
      "data export/import moves database tables as JSON, assets import batch-loads images or audio into the library, i18n check audits the editor translations.",
      "For toolmakers: window.AtlasConsole.run(\"stats --json\") drives every command programmatically with structured results — the groundwork for future AI assistance.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Sample maps — a dozen ready-made maps, one click away",
    summary:
      "The Maps panel gains a 🗺 button that opens a library of twelve hand-crafted starter maps — villages, caves, castles, beaches, and more — each added to your project with a single click.",
    items: [
      "New 🗺 button in the Maps panel (next to ＋, −, and 🎲) opens the Sample Maps browser.",
      "Twelve themed layouts: Cozy Cottage, Village Square, Sunny Cove, Deep Forest Clearing, Desert Oasis, Snowy Outpost, Crystal Cavern, Lava Depths, Murky Swamp, Castle Great Hall, General Store, and Mountain Pass.",
      "Every card shows a live tile-rendered preview; Add to project drops a fresh copy into your map list (add the same one as often as you like) and selects it for editing.",
      "Sample maps arrive event-free on purpose — they're clean scenery, ready for your own stories.",
      "Under the hood: layouts are stored as readable ASCII art, and an automated test keeps every layout rectangular, every tile reference real, and every map shaped exactly like a hand-made one.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "RPGAtlas 1.0 — the Atlas HD overhaul is complete",
    summary:
      "Eight phases, one goal: a modern HD-2D RPG maker that stays true to what made RPGAtlas special. Version 1.0 caps it with a documentation site, an API reference, a migration guide, and a full release QA pass.",
    items: [
      "New docs site: the whole manual rendered as a fast static site (docs-site/, GitHub Pages-ready), generated straight from the project wiki — including two new reference pages: the frozen Plugin & Script API and the Migration Guide.",
      "The 1.0 promise: every project ever saved by RPGAtlas (Driftwood included) opens and auto-migrates; the plugin/script API is frozen for 1.x; exported games are forever self-contained.",
      "The overhaul in one breath — modern toolchain and test safety net; the engine split into typed modules; a three.js HD-2D renderer with shadows, water, materials, day/night, weather, and a full post stack; a dockable editor with live viewport, autotiles, world view, and command palette; Atlas Graph node scripting; animation, ATB/CTB battles, pathfinding, followers, vehicles, minimap; a real asset pipeline with importers, streamed audio, and starter packs; and this release's performance, accessibility, translation, showcase, and export work.",
      "Thank you for making games with RPGAtlas. Chart your world. Tell your story.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Export upgrades — itch.io-ready zip, installable offline PWA & native EXE packaging",
    summary:
      "Publishing gets three big upgrades: a one-click web zip shaped for itch.io that doubles as an installable offline app, and a repo script that packages any game as a real native desktop executable.",
    items: [
      "File ▸ Export Standalone Game… ▸ Web / itch.io (.zip): your game as index.html at the zip root (exactly what itch.io's HTML5 uploader wants) plus a web-app manifest, generated icons, and a service worker — players on any static host can install the game like an app and replay it fully offline.",
      "The offline promise is machine-checked: an automated test exports the zip through the real menu, installs the service worker, cuts the network, and replays the game.",
      "node scripts/package-game-exe.mjs <project.json> builds a true native desktop EXE (own window, no browser) from any exported project, reusing the same desktop shell as RPGAtlas itself. Needs the Rust toolchain; the classic no-toolchain launcher EXE remains.",
      "Under the hood the standalone HTML template moved to a module shared by the editor export and the native packager, so the formats can never drift apart.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Atlas Quest HD — the sample game becomes the showcase",
    summary:
      "The bundled sample game now shows off the whole HD-2D toolbox, capped by a brand-new dusk map: Driftwood Shore.",
    items: [
      "New map — Driftwood Shore: a golden-hour beach with a day/night dusk sun and long soft shadows, animated water with a lantern-lit wooden dock, auto-textured cliffs, bloom, ACES + warm color grade, vignette, SSAO, and FXAA all on at once. Find the back passage on the Whispering Cave's east wall.",
      "The Cottage interior gets the HD-2D treatment: firelight and window light, auto materials, and a cozy vignette.",
      "The Whispering Cave gains two more crystal glows plus SSAO and ACES tone mapping.",
      "Rebuildable by design: scripts/build-atlas-quest-hd.mjs regenerates the showcase deterministically (Meridian Village is intentionally untouched — it anchors the renderer's golden-image tests).",
      "A new automated check keeps the showcase loading with its full feature set.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Editor translations catch up — Spanish, French & German cover everything",
    summary:
      "The editor's Spanish, French, and German translations now cover every menu, panel, and tool added since the overhaul began — and an automated check keeps them complete from here on.",
    items: [
      "Newly translated chrome: the View menu, World View, HD-2D Viewport, Region Mode, Command Palette, Asset Browser, autotile import, keyboard-shortcut dialog, dock panel tabs and layout commands, the autotile palette section, and the updated status-bar hints.",
      "Dock tabs (Maps / Tiles / Map / HD-2D / World) now localize like the rest of the interface.",
      "Help ▸ Interface Language… gained the UI Font Size row in all languages.",
      "Under the hood: a locale-parity test extracts the chrome key set from the editor source and fails the build if any language is missing a translation (or carries a stale one).",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Accessibility — reduced motion, colorblind assist & text scaling",
    summary:
      "Every RPGAtlas game now ships with player-side accessibility options, and the editor gains an adjustable UI font size.",
    items: [
      "Options ▸ Reduced Motion (Auto/On/Off): stills screen shake, battle sprite bobbing and lunges, and HUD flashes, halves full-screen flash intensity, and thins weather particles. Auto follows the player's system-wide reduce-motion setting live.",
      "Options ▸ Text Size (Small/Normal/Large/Huge): scales dialogue and menu text over the game's authored base size.",
      "Options ▸ Colorblind Assist: HP/MP gauges switch to a colorblind-safe orange/sky-blue palette; damage and heal popups already carry explicit −/+ signs so color is never the only signal.",
      "Editor: Help ▸ Interface Language… now also sets a UI Font Size (90–125%) for the editor on this device.",
      "All three options persist per player, per game, like the volume sliders.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Performance pass — perf overlay, load budgets & a leak-free bill of health",
    summary:
      "The engine gets an in-game performance overlay and the project gains automated load-time, big-map stress, and memory-stability gates, keeping RPGAtlas fast as 1.0 approaches.",
    items: [
      "Press F3 during play (or add ?perf=1 to the player URL) to toggle the new performance overlay: fps, frame time (average and p95), per-frame work time, HD-2D draw calls/triangles, live GPU resource counts, and JS heap use where the browser reports it.",
      "New automated budgets: editor and player boot-to-interactive times, a 160×160-map / 200-event / 16-light stress scene, and a map-transfer memory canary that fails if the renderer ever starts leaking GPU resources.",
      "Audit result: repeated map transfers hold GPU geometry/texture counts exactly at their baseline — no disposal leaks.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Starter packs — one-click asset bundles in the Asset Browser",
    summary:
      "The Asset Browser gains a Packs tab: install curated asset bundles into your library with one click, starting with the bundled CC0 “Driftwood Starter” pack (terrain recolors, villagers, battlers, and a small chiptune soundtrack).",
    items: [
      "Asset Browser ▸ Packs: browse packs with license and size info, Install/Reinstall (downloads are content-deduped, so retrying or reinstalling is always safe), and Uninstall (with in-use warnings).",
      "Driftwood Starter (bundled, CC0): 12 recolored terrain tiles, 4 generated villagers, 3 battlers, 2 music loops, rain ambience, a victory fanfare, and a chime — generated from RPGAtlas's own procedural art, no attribution needed.",
      "Add your own registries: point the Packs tab at any hosted index.json to install third-party packs; the registry list is a device setting.",
      "Pack assets are tagged pack:<id> in the library, so they're easy to filter, audit, and remove as a set.",
    ],
  },
  {
    date: "July 3, 2026",
    title: "Audio v2 — streamed music, ambience layers, jingles & positional sound",
    summary:
      "Imported OGG/MP3/WAV files now play everywhere the procedural chiptunes do: maps can stream real music with crossfades, layer looping ambience, duck for victory jingles, and pan sound effects by distance.",
    items: [
      "Imported music appears in every music picker (Map Properties, System themes, the Change Music command) and crossfades between tracks — set the fade length on the Change Music command.",
      "Ambience layers: Map Properties gains looping background-sound layers (rain, crowds, surf…) with per-layer volume, crossfaded seamlessly across map transfers.",
      "Jingles: audio imported as ME (victory fanfares etc.) automatically ducks the music while it plays and restores it after.",
      "Positional sound: the Play Sound command's new Positional toggle pans and fades an imported sound by the event's distance from the player.",
      "Options ▸ Ambience Volume: a new mixer slider for the ambience bus, saved per player like the rest.",
      "The Audio Manager previews your imported audio next to the procedural sets; system sounds and animation Sound items can use imported effects too.",
      "Game exports embed the imported audio your game actually uses — procedural audio remains zero-file, zero-copyright.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Importers — tileset slicer, sprite sheets with frame tags, Aseprite",
    summary:
      "The Asset Browser learned to slice: any-grid tilesets become 48px tiles, odd-shaped sprite images become tagged flipbook sheets for battle animations, and Aseprite JSON exports import with their animation tags intact.",
    items: [
      "Tileset slicer: drop a tileset image on the Asset Browser's Tiles tab and pick the source grid (16/24/32/48px + offset/gap) — click cells to choose which become 48px tiles, with passable/terrain naming applied per batch.",
      "Sprite-sheet importer: images that aren't 3×4 walking charsets can import as flipbook sheets with named frame ranges (walk 0–3, cast 4–7…).",
      "Aseprite support: import a .json + .png export pair and its frame tags arrive as ready-to-use animation ranges (frame rate derived from your frame durations); non-uniform (trimmed) exports are repacked automatically.",
      "Animations tab: the Flipbook item's Sheet field is now a picker — built-in icons, your imported sheets (with a Frame tag dropdown that fills From/To/FPS), or a custom URL.",
      "Game exports now embed animation flipbook sheets, plus faces shown by common events and troop battle events.",
      "RPG-Maker A2 autotile blocks keep their dedicated importer under Tools ▸ Import Autotile Sheet…",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Asset library & Asset Browser — import your own art and audio",
    summary:
      "RPGAtlas gains a real asset pipeline: drop PNG and OGG/MP3/WAV files into the new Asset Browser and they join the same pickers as the built-in procedural sets, stored in a per-device library that escapes the browser storage ceiling.",
    items: [
      "Tools ▸ Asset Browser: drag-drop or pick files to import; browse by type with search, tags, and thumbnails; rename (project references update automatically), retag, export, and delete with in-use warnings.",
      "Used/unused audit: every asset shows whether the current project references it, with an “Unused only” filter and a size summary.",
      "Per-device asset library: imports persist in IndexedDB in the browser and in the app-data folder on the desktop app — no more project-size ceiling for art.",
      "Project files carry their assets: saving/exporting a .json embeds the imported assets it uses, and opening it on another machine imports them into that machine's library automatically.",
      "Imported character sheets, facesets, battlers, and tiles appear everywhere the img/ folder assets do; audio imports land in the library ready for the upcoming audio update.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Player HUD & day/night — minimap, quest tracker, fullscreen, time gates",
    summary:
      "Games get a player-facing polish pass: a corner minimap with a live quest tracker, a fullscreen toggle in Options, and day/night gameplay — event pages and encounter pools that change with the in-game clock.",
    items: [
      "Minimap (Database ▸ System ▸ Map systems): a corner map rendered from the real map art with live dots for the player, NPCs, and parked vehicles. Maps can opt out individually in Map Properties.",
      "Quest tracker: the HUD lists up to three active quests with live objective progress, flashing when anything advances. The new Minimap/HUD action (default M, gamepad Select — rebindable like everything else) toggles the whole HUD.",
      "Options ▸ Fullscreen: players can toggle fullscreen from the pause menu.",
      "Day/night gameplay: event pages gain a Time of day condition (morning/day/evening/night) — a shop that closes at night is just a night page; the Conditional Branch command and graphs gain a Time of Day clock-window condition; Map Properties gains a night encounter pool (21:00–5:00).",
      "The in-game clock still only moves when you move it (scripts, the HD-2D day/night pin) — these are the gameplay hooks for it.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Movement & world — click-to-move, followers, vehicles, jumps & regions",
    summary:
      "The map got a movement overhaul: click/tap anywhere to pathfind there, party members can follow the leader, boats/ships/airships sail and fly, characters jump ledges, and paintable region tags drive zoned encounters and event conditions.",
    items: [
      "Click or tap the map to walk there — A* pathfinding routes around obstacles (and walks up to blocked targets); clicking an NPC walks over and talks to it. Any arrow press cancels the route.",
      "Party followers (Database ▸ System ▸ Map systems): the rest of the party trails the leader across the map and through transfers.",
      "Vehicles: configure a boat (shallow water), ship (all water), and airship (flies anywhere) with sprites and starting docks in Database ▸ System. Face one and press the action key to board; press it again to land. Three new built-in object sprites: Boat, Ship, Airship.",
      "Jumping: the new “jump” move-route step hops 2 tiles with an arc, and ledge tiles (the new ⌒ value in Passability mode's click cycle) auto-jump the player across cliff edges.",
      "Regions: a new Region paint mode tags tiles with numbered zones (0–63). Zones drive per-region encounter pools (Map Properties) and the new “Player Region” event condition — zone your world map without invisible event walls.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Battle systems — ATB, CTB, battle events, smarter enemies & rows",
    summary:
      "Choose your battle flow: beside the classic turn-based rounds, battles can now run as ATB (active-time gauges) or CTB (a turn-order timeline). Troops gain mid-battle event pages, enemies gain conditional AI, and the party gains front/back rows.",
    items: [
      "Database ▸ System ▸ Battle system: Turn-based (unchanged default), ATB — agility fills each battler's gauge and they act when it's full (gauges shown on party rows and under enemies), or CTB — one battler acts at a time in an agility-driven order previewed in a strip at the top of the battle.",
      "Troop battle events (Database ▸ Troops): pages of ordinary event commands that run mid-battle when their condition hits — on a turn (a + b·x), when an enemy's or actor's HP drops below a threshold, or while a switch is ON; spans control refiring (once per battle / per turn / each time it becomes true). Perfect for boss dialogue and phase changes.",
      "Smarter enemy AI: each action row can carry a condition (turn pattern, own HP above/below %, random chance, has-state) — invalid rows drop out of the weighted pick that turn.",
      "Formation: a new pause-menu entry toggles each member between front and back row. Back row deals and takes 25% less physical damage and is targeted less often (▽ marks back-row members in battle).",
      "Skills can now run a common event after resolving in battle (Database ▸ Skills ▸ After-use common event) — the action-sequence hook, graph-authorable.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Battle animations — keyframed skill FX with a timeline editor",
    summary:
      "A new animation engine: author keyframed particle/flash/shake/projectile/flipbook animations on a timeline in Database ▸ Animations, assign them to skills and weapons, and play them on the map with the new Play Animation event command.",
    items: [
      "Database ▸ Animations: build animations from timed items — particle bursts (plus ring/rain/spiral emitters), target or screen flashes, screen shake, sounds, source→target projectiles, and icon/sheet flipbooks — with a draggable timeline strip and a live preview arena that runs the real player.",
      "Skills and weapons gain a Battle animation picker; a skill with an animation plays it in battle instead of the default effects (skills without one look exactly as before). Skills can also strike multiple times via the new Hits field.",
      "New event command: Play Animation — show any battle animation over the player, this event, or the screen center on the map (works in graphs too).",
      "Sample project: Fireball, Heal, and Power Strike now ship with showcase animations (Fire Burst, Healing Light, Slash).",
      "Multi-target skills fan the animation out over every target; enemy skills with animations use them as well.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Atlas Graph — node-based visual scripting",
    summary:
      "Event pages can now be authored as node graphs: a full visual-scripting canvas that compiles into the exact same event commands your game already runs, so graphs work everywhere — playtest, saves, plugins, and exported games — with zero runtime cost.",
    items: [
      "Open any event and press the new Graph toggle above the command list to convert the page to a graph (lossless, and reversible with Convert to list…). Wire nodes by dragging from output ports; drop a wire on empty canvas to add-and-connect a new node in one motion.",
      "Every event command is a node — the same Add Command picker, edit dialogs, and inline inspector work on nodes, including your saved Script command buttons (which is also how plugin commands become nodes).",
      "Branching flows visually: Conditional Branch and Show Choices nodes expose one output per branch plus an After port for what runs once the branch completes.",
      "New Loop and Break Loop commands (usable in classic lists too): Loop repeats its body until Break Loop fires — the graph's cycle answer, and a long-requested command in its own right.",
      "Comments, resizable frames, and reroute dots keep big graphs tidy; a minimap in the corner jumps around large canvases; pan with drag, zoom with the mouse wheel.",
      "Live validation flags cycles, unreachable nodes, and disconnected Starts as you edit — errors keep the last good compile, so your page never breaks mid-edit.",
      "Ctrl+Z / Ctrl+Y inside the event editor undo graph edits and their compiled commands together.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Unified undo & UI polish",
    summary:
      "Undo now spans everything: map painting, event edits, Map Properties, and every Database change share one Ctrl+Z history, and the editor got a consistency pass — labeled undo steps, keyboard list navigation, visible focus rings, and a unified dark palette.",
    items: [
      "Database edits are undoable: typing, New/Delete/Duplicate, bulk edits, and pastes commit to the same history as map painting. Ctrl+Z / Ctrl+Y work inside the Database and Map Properties dialogs too (text boxes keep the browser's native text undo while you type).",
      "Map Properties changes (name, size, HD-2D settings, notes) undo as a single step, including resizes.",
      "The Edit menu, command palette, and toolbar tooltips now name the next step — e.g. \"Undo — Paint\", \"Redo — Database edit\".",
      "Database lists: press ↑/↓ in the search box to walk the (filtered) list without touching the mouse.",
      "UI polish: one shared dark-theme palette and type scale across every panel and dialog, visible gold focus rings when tabbing through controls, and thin themed scrollbars everywhere.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "World View & database upgrades",
    summary:
      "A new bird's-eye World View draws your whole game as a map-connection graph parsed live from Transfer commands, and every Database list gains search, multi-select bulk editing, and cross-project copy/paste.",
    items: [
      "View ▸ World View (F3) opens a dockable map graph: each map is a node, each Transfer-Player command an arrow. Drag maps to arrange them (positions are saved per map), click to select, double-click to open, and add per-map notes in the inspector. Drag the ↻ handle on an arrow onto another map to re-link every transfer behind that connection. Broken links to deleted maps are flagged.",
      "Every Database list (Actors, Items, Skills, Enemies, …) now has a search box, per-row checkboxes for multi-select, and a bulk bar: Bulk Edit a shared numeric field (set / add / multiply), Duplicate, and Delete across the whole selection.",
      "Copy and Paste move entries between projects through a shared clipboard — copy your enemies in one project, open another, and paste them in.",
      "The Classes tab shows a live stat-curve preview (levels 1/25/50/99) and the Skills tab an interactive damage preview, both using the exact engine formulas — purely editor-side, no change to how the game runs.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Cliff auto-texturing — sculpted rock faces in HD-2D",
    summary:
      "Raised terrain blocks can now render as proper cliffs in the HD-2D scene: their exposed walls get a top-down light gradient, a sunlit crest, and shaded vertical corners instead of a single flat tint. Off by default, per map.",
    items: [
      "Map Properties ▸ HD-2D ▸ Cliff auto-texturing turns it on for a map. Any tile you raise in Height mode now reads as a carved cliff — darker toward the base, brighter along the top edge, with chiselled corners where the wall turns.",
      "The look is derived from the same neighbour connectivity as the floor autotiles, and updates live in the HD-2D Viewport as you paint heights.",
      "Purely a rendering option: it changes no map data, and leaving it off keeps the exact previous flat-shaded walls.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Autotiles — paint connected terrain with RPG-Maker sheets",
    summary:
      "Terrain now autotiles: import an RPG-Maker A2 autotile sheet and paint whole regions of grass, water, or path that automatically pick the right edges and corners as you draw. Comes with resizable terrain brushes.",
    items: [
      "Tiles panel ▸ Autotiles ▸ Import… (or Tools ▸ Import Autotile Sheet…) brings in a standard RPG-Maker A2 sheet — each 2×3 block becomes a terrain brush swatch. Click a swatch, then paint like any tile; the 47-blob engine resolves borders and inner corners from the neighbours automatically.",
      "Brush sizes: pick 1×1, 3×3, or 5×5 in the Tiles panel (or press [ and ] ) to paint broad strokes of terrain at once.",
      "Autotiles resolve live everywhere — the 2D map, the HD-2D viewport, and playtest — and right-clicking a swatch deletes the group. Maps stay plain tile data, so existing projects and saves are unchanged.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Live HD-2D viewport — edit your map inside the 3D scene",
    summary:
      "The HD-2D preview is now a full dockable viewport panel: the game's three.js renderer runs live inside the editor, with its own camera you can fly around and drag-to-place point lights right in the 3D scene.",
    items: [
      "Press F2 (or use View ▸ HD-2D Viewport) to dock the live renderer as a panel — split it beside the map, tab it, or float it like any other panel; it updates instantly as you paint tiles, edit heights, or change Map Properties.",
      "A viewport camera decoupled from the game: drag to pan across the map, scroll the wheel to zoom toward the cursor, and Shift-drag (or right-drag) to change the camera tilt — none of it touches the map's own HD-2D settings.",
      "Point lights are now editable with drag gizmos: double-click empty space to drop a light, drag its handle to reposition it in the scene, and tweak its colour and radius live — the first way to place per-map lights without light-named events.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Dockable workspace — arrange the editor your way",
    summary:
      "The editor's panels (Maps, Tiles, Map) are now a fully dockable workspace: drag panels by their tabs to re-dock, split, tab, or float them, resize with draggable dividers, and save named layouts.",
    items: [
      "Drag any panel's tab to rearrange it: drop on the center of a region to add it as a tab, drop near an edge to split, or drag it out to float it in its own window (floating windows move and resize).",
      "Drag the dividers between panels to resize; your arrangement is remembered automatically between sessions.",
      "New View menu: show/hide the Maps and Tiles panels, Focus Map, Focus Next Panel (F6), Reset Panel Layout, and Save/Load named layouts — every one also reachable from the Command Palette.",
      "The map and tile-palette views now live inside dockable panels while keeping all their existing behavior.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Command Palette — press Ctrl+P and type what you want",
    summary:
      "Phase 3 of the Atlas overhaul (the editor platform) begins: a fuzzy-searching Command Palette puts every editor action one keystroke away, backed by a new command registry and a declarative keyboard map.",
    items: [
      "New Command Palette — open with Ctrl+P, Ctrl+Shift+P, or Tools ▸ Command Palette…, type a few letters of any command (save, playtest, database, height mode, zoom…), and press Enter to run it.",
      "Every palette entry shows where the command lives in the menus and its keyboard shortcut; commands that can't run right now (like Undo with nothing to undo) are hidden.",
      "All existing shortcuts behave exactly as before; under the hood they now run through one declarative key map that upcoming editor features (dockable panels, live HD-2D viewport) will extend.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Weather, stairs, drop shadows — and the HD-2D overhaul is complete",
    summary:
      "Phase 2 of the Atlas HD overhaul wraps up: GPU weather particles fall inside the 3D scene, stairs tiles become real ramps, characters get soft drop shadows, and the renderer is tuned to hold 60 fps at 1080p with every effect enabled.",
    items: [
      "New 'Weather particles' setting in Map Properties: Rain, Snow, or floating Ambient motes, rendered inside the HD-2D scene (they fall behind buildings and in front of the ground, not as a flat overlay).",
      "New 'Soft character drop shadows' toggle: a gentle blob grounds every character even without sun shadows.",
      "Stairs tiles now render as real sloped ramps between terrain heights in HD-2D.",
      "Performance: chunk-level view culling plus a CI-enforced frame budget — the sample map with every feature on (shadows, water, materials, rain, day/night, full post stack) holds 60 fps at 1080p on ordinary hardware.",
      "The Whispering Cave in the sample project is now an HD-2D showcase: point-light shadows off the rock formations, glowing lava and crystal, dust motes, night color grade.",
      "The old pre-three.js renderer has been retired (?renderer=classic no longer switches); two driver-strict shader bugs found on real GPUs (water at dusk, weather particles) were fixed on the way out.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Cinematic post stack and a day/night cycle",
    summary:
      "HD-2D maps gain a film-grade finishing stack — ACES tone mapping, color grades, vignette, ambient occlusion, FXAA — plus a real day/night cycle where the sun arcs across the sky, shadows stretch and fade, and windows light up after dark.",
    items: [
      "New Map Properties toggles: ACES filmic tone mapping, FXAA anti-aliasing, SSAO ambient occlusion, vignette, and a color-grade preset (Warm, Cool, Night, Sepia, Noir) — all per map, combinable with bloom/depth-of-field/fog.",
      "New 'Day/night cycle' toggle: the map's lighting follows an in-game clock — golden dawns and dusks, blue moonlit nights, the sun (and its shadows) sweeping east to west, and emissive windows/torches igniting at night with Auto materials.",
      "Set each map's 'Time of day on entry', and drive the clock from scripts/plugins with game.setTimeOfDay(hours) / game.getTimeOfDay(); the clock is saved with the game.",
      "All effects render in the editor's HD-2D preview and in exported games.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Living water and auto materials for HD-2D maps",
    summary:
      "Ponds, rivers, and swamps come alive with animated waves, real reflections, and shore foam — and a new auto-material system gives tiles light-reactive relief, specular sparkle, and windows that glow at night.",
    items: [
      "New 'Water surface' toggle in Map Properties: water/deep-water/swamp tiles get an animated surface with planar reflections (characters and terrain mirror in the water), refraction ripples, sun glints, and foam along shores.",
      "New 'Auto materials' toggle: normal maps are auto-generated from every tile's artwork so point lights reveal relief; wet/icy/crystal tiles get specular highlights; windows, torches, lava, and crystals glow as ambient light drops (they ignite automatically with the upcoming day/night cycle).",
      "Both effects are per-map, off by default, and cost nothing when disabled.",
      "Works in the editor's live HD-2D preview and in exported games.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Point lights now cast shadows on HD-2D maps",
    summary:
      "Torches, lamps, and any other point light can now cast real-time shadows: walls block lamplight and characters throw flickering shadows away from nearby flames.",
    items: [
      "New 'Point-light shadows' toggle in Map Properties (HD-2D section); off by default, existing maps are unchanged.",
      "The 4 lights nearest the camera cast omnidirectional soft shadows (raised terrain, overhead tiles, and characters all occlude).",
      "Advanced: map.hd2d.pointShadows accepts a 0–1 strength for partially-soft occlusion instead of full darkness.",
      "Works in the editor's live HD-2D preview and in exported games.",
    ],
  },
  {
    date: "July 1, 2026",
    title: "Real-time sun shadows for HD-2D maps",
    summary:
      "HD-2D maps can now cast real-time shadows: terrain blocks, overhead tiles, and characters all cast and receive soft sun shadows — the first new rendering capability unlocked by the three.js port.",
    items: [
      "New 'Sun shadows' toggle in Map Properties (HD-2D section); off by default, so existing maps look exactly as before.",
      "Characters cast soft moving drop shadows; buildings, cliffs, and trees shade the ground realistically (3×3 PCF soft edges).",
      "Advanced: map.hd2d.shadows accepts a 0–1 strength, and map.hd2d.sun { azimuth, elevation } aims the sun (defaults: NE sky, 55° up) — groundwork for the upcoming day/night cycle.",
      "Shadows render in the editor's live HD-2D preview too.",
    ],
  },
  {
    date: "July 1, 2026",
    title: "Atlas HD Phase 2 begins — HD-2D renderer now runs on three.js",
    summary:
      "The HD-2D renderer has been ported to the three.js engine with strict visual parity — games look identical (golden-image tests prove it), and the new scene graph is the foundation for upcoming real-time shadows, water, weather, and richer lighting.",
    items: [
      "HD-2D maps and the editor's live HD-2D preview now render through three.js by default; visuals, per-map settings (tilt, bloom, depth of field, fog, lights, ambient), and performance are unchanged.",
      "Temporary escape hatch: add ?renderer=classic to the player URL to run the previous raw-WebGL2 renderer until the parity sign-off retires it.",
      "New golden-image tests pin the bloom / depth-of-field / fog post-processing stack so both renderers provably match.",
    ],
  },
  {
    date: "July 1, 2026",
    title: "Standalone Export Fix",
    summary:
      "Exported games (Standalone HTML and Windows EXE) work again — a long-standing packaging gap made every exported game crash on startup before showing the title screen.",
    items: [
      "Exports now include the quest runtime, quest journal view, and input system the engine requires at startup; exported games boot to the title screen and play normally.",
      "An automated export smoke test now boots a freshly exported game on every change, so exports can't silently break again.",
    ],
  },
  {
    date: "July 1, 2026",
    title: "Atlas HD Phase 0 — Stability & Foundations",
    summary:
      "First phase of the Atlas HD overhaul: several crash fixes players could hit in normal use, versioned project files, and a modern engine-development toolchain (using and playing RPGAtlas still needs no install).",
    items: [
      "Fixed a battle crash when a troop contained a deleted enemy before a surviving one — attacks and enemy AI now target correctly.",
      "Deleting a map now reassigns the game's starting map if needed and lists any events whose Transfer Player commands still point at the deleted map.",
      "Continue and Load no longer crash on saves that reference a deleted map — the game falls back to an existing map and keeps the player inside its bounds.",
      "In-game saving now shows 'Could not save — storage is full or unavailable.' instead of freezing the event that opened the save menu.",
      "HD-2D now survives a lost graphics context: the game falls back to classic 2D rendering and automatically rebuilds and resumes HD-2D when the browser restores the GPU.",
      "Alt-tabbing or losing window focus while holding a key no longer leaves the player walking on their own.",
      "Project files now carry a formatVersion with a proper migration registry, protecting projects opened across engine versions (newer projects are left untouched by older engines).",
      "New contributor toolchain: Vite dev server, TypeScript, ESLint, Vitest, Playwright smoke and golden-image render tests, and CI — see the README's 'Developing the engine' section. Exports and the zero-install workflow are unchanged.",
    ],
  },
  {
    date: "June 29, 2026",
    title: "Plugin Metadata Foundation",
    summary: "Plugins now have formal metadata fields, clearer validation, and a more flexible Plugin Manager layout.",
    items: [
      "Plugin Manager now exposes plugin ID, version, author, description, and dependency fields above the code editor.",
      "The Plugin Manager window and plugin list divider can now be resized.",
      "Bundled plugins now carry metadata, and older projects are migrated with safe defaults for custom plugins.",
      "Playtests now record plugin load status in window.AtlasPluginStatus and skip duplicate or missing-dependency plugins with console warnings.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "Project Export Save As",
    summary: "Export Project As File now opens a Save As destination picker when the editor is running in a capable desktop browser or desktop app.",
    items: [
      "File -> Export Project As File opens a native Save As picker so the project file can be named and saved to a chosen folder.",
      "Browsers without the save-picker API still fall back to the standard .json download.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "Action Combat Chase Spacing",
    summary: "Chasing action-combat enemies now avoid stacking on each other unless their event page has Through enabled.",
    items: [
      "Enemy chase AI now treats another same-priority event's current tile or reserved movement destination as blocked.",
      "Turning on Through for an event still allows that chaser to overlap other events when the project needs pass-through behavior.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "Playtest and Event Marker Sync",
    summary: "Editor event markers now stay visible while painting, and browser playtests launch from a fresh player URL.",
    items: [
      "Events remain visible as faint map pins outside Event mode, so they no longer look deleted when switching back to tile painting.",
      "The Playtest command now opens browser playtests with a cache-busting play.html URL while still saving the current project first.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "Action Combat AI Picker",
    summary: "Action Combat events now expose enemy AI directly and the default Attack binding includes F again.",
    items: [
      "The Action Combat section now has an Enemy AI picker with None and Chase player options.",
      "Existing random touch-damage enemies keep their chase behavior through migration, but new enemies choose it explicitly.",
      "The default Attack action now responds to F as well as J unless the project has a custom attack binding.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "HD-2D Toggle Respects Map Properties",
    summary: "Maps now return to the flat 2D renderer when HD-2D is switched off in Map Properties.",
    items: [
      "The Map Properties Enabled checkbox now controls the runtime renderer even when camera tilt, ambient light, fog, bloom, point lights, or saved map lights remain configured.",
      "Older projects that had HD-2D settings before the explicit toggle still opt into HD-2D until the map is saved with the checkbox off.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "Action Combat Follow-Up",
    summary: "Map action combat now reliably hits the adjacent tile and gives touch-damage enemies a simple way to pressure the player.",
    items: [
      "Sword swings now check the tile in front of the player as well as the visual slash collider, so adjacent enemies are hit and knocked back reliably.",
      "Touch damage now works as an adjacent melee strike for action-combat enemies instead of requiring an impossible same-tile overlap.",
      "Random-moving action-combat enemies with Touch damage now chase nearby players before resuming random wandering.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "True 3D HD-2D Rendering",
    summary: "HD-2D now renders through a real perspective camera again, so the Camera tilt control actually tilts the view. The PIXI dependency was removed in favor of a dependency-free WebGL renderer.",
    items: [
      "Camera tilt (25–89 degrees) leans the camera back through a genuine 3D perspective: raised blocks reveal their walls and the world foreshortens, instead of the slider doing nothing.",
      "Restored the full HD-2D feature set on the 3D path — height-extruded blocks with shaded cliff faces, billboard characters that stand at their elevation, 3D point lights with ambient, plus bloom, depth of field, and distance fog.",
      "Removed the bundled PIXI library; the renderer is now raw WebGL2 with no third-party dependency and a smaller download.",
      "The in-editor HD-2D Preview and exported games use the same renderer, so what you see while editing matches the game.",
    ],
  },
  {
    date: "June 22, 2026",
    title: "Live HD-2D Editor Preview",
    summary: "The HD-2D Preview now uses the current PIXI renderer directly and stays synchronized with map edits.",
    items: [
      "Game -> HD-2D Preview opens a working draggable preview panel again, including elevation, map characters, ambient lighting, event lights, and map lights.",
      "Blocked and elevated tiles cast bounded point-light shadows in both the preview and game runtime.",
      "The Map Properties Point lights toggle now consistently controls event and map lights during playtests and previews.",
      "Closing and reopening the preview reuses its renderer safely without accumulating per-frame lighting graphics.",
    ],
  },
  {
    date: "June 19, 2026",
    title: "HD-2D Height Extrusion",
    summary: "Elevation painted with the map editor's Height tool now renders as raised blocks with shaded cliff faces in the HD-2D view, instead of being ignored.",
    items: [
      "Tiles with a non-zero height paint as raised platforms — the tile's own art lifts into a top, with a shaded south-facing wall showing the exposed step over lower terrain.",
      "Taller terrain correctly hides what stands behind it, and characters pass in front of or behind elevation based on where their feet are.",
      "Block height scales with the painted 0–9 value (about a third of a tile per step), so stepped ridges, plateaus, and pillars read as real depth.",
      "Replaces the previous placeholder that simply nudged the overhead layer up by a few pixels and otherwise discarded the height layer at render time.",
    ],
  },
  {
    date: "June 19, 2026",
    title: "Fixed Message Windows in Exported Games",
    summary: "Standalone HTML/EXE exports now load the message system correctly, so Show Text boxes and other dialog work in exported games.",
    items: [
      "The standalone export now ships runtime/messages.js as a regular script (matching the editor and playtest), instead of an unused import map that left createMessageSystem undefined.",
      "Added a continuous-integration test workflow and an npm test script so the full test suite runs automatically on every change.",
    ],
  },
  {
    date: "June 18, 2026",
    title: "Reusable Common Events",
    summary: "The Database now includes Common Events for reusable command sequences, explicit calls, and switch-controlled automatic processing.",
    items: [
      "Added Database -> Common Events with Name, Trigger, Activation switch, and the full event-command list editor.",
      "Added the Call Common Event command to event content lists and game.callCommonEvent(id) to the Script API.",
      "Common Events support None, Autorun, and Parallel triggers, with optional switch gating for automatic execution.",
      "Recursive common-event calls are safely skipped to prevent an immediate infinite call loop.",
    ],
  },
  {
    date: "June 18, 2026",
    title: "Custom Window Colors",
    summary: "Projects can now set a shared window color for Show Text boxes, menus, and battle information panels from the System tab.",
    items: [
      "Added a Window color picker beside the existing font size and opacity settings in Database -> System.",
      "The selected color is applied to message boxes, speaker-name labels, standard menus, and battle log and party panels.",
      "Existing projects receive the original dark-blue window color automatically, while custom colors persist through saves and exports.",
    ],
  },
  {
    date: "June 18, 2026",
    title: "Remappable Map Attack Prompts",
    summary: "Map action combat and its guidance now consistently use the remappable Attack action instead of assuming the default J key.",
    items: [
      "Map sword attacks are covered by a regression test that verifies a replacement Attack binding works and the old key no longer triggers it.",
      "The Action Combat editor hint now points authors to the remappable Attack action and the \\input[attack] message prompt.",
      "Action Combat and message text-code documentation now show input-aware attack instructions for keyboard and gamepad players.",
    ],
  },
  {
    date: "June 17, 2026",
    title: "Options: Audio Mixer & Game Settings",
    summary: "The in-game Options menu is now a full settings screen with separate volume sliders and gameplay/accessibility toggles.",
    items: [
      "Independent Master, Music, and Sound Effects volume sliders replace the old single Music on/off toggle.",
      "New Text Speed setting (Slow / Normal / Fast / Instant) controls how quickly message text reveals.",
      "New Dash setting: Hold to run, Toggle to latch running on/off, or Always On.",
      "New Screen Shake setting (Off / Reduced / Full) scales combat and event camera shake.",
      "Adjust any option with the mouse (click the arrows, or click along a volume bar), keyboard, or gamepad; settings persist per game.",
    ],
  },
  {
    date: "June 16, 2026",
    title: "Quest Editor Validation Warnings",
    summary: "The Quests database tab now warns authors about broken quest references and other common setup mistakes while editing.",
    items: [
      "Quest warnings now flag missing next quests, duplicate follow-up links, and self-referencing quest chains.",
      "Objective warnings catch missing enemies, missing fetch items, and invalid turn-in map or event targets.",
      "Requirement and failure warnings catch missing referenced quests, troops, enemies, and quest lock/unlock targets.",
    ],
  },
   {
     date: "June 17, 2026",
     title: "Gamepad Support & Remappable Controls",
     summary: "Full gamepad support with a unified keyboard/gamepad input layer, in-game and in-editor rebinding, and input-prompt glyphs you can drop into messages.",
     items: [
       "Play with a gamepad: movement, Confirm/Cancel, dash, and attack map to the W3C Standard Gamepad, including left-stick movement with a configurable stick deadzone.",
       "In-game Options -> Controls lets players rebind keyboard and gamepad inputs, with conflict detection and a guard that stops Confirm/Cancel from being left unbound.",
       "The in-game Controls menu now shows the same procedural glyphs as the editor, auto-skinned to the controller in your hands, instead of plain text labels.",
       "New dedicated \"Controls\" tab in the editor sets the default key/gamepad bindings a new player starts with, shown as button/key glyphs (no more console snippet).",
       "Gamepad glyphs auto-detect the player's controller and relabel for Xbox (A/B/X/Y), PlayStation (Cross/Circle/Square/Triangle), and Nintendo Switch (B/A/Y/X); the editor Controls tab has a per-brand preview.",
       "Distinct procedural icons for the D-Pad, analog stick, and stick-clicks (L3/R3), so on-screen directions no longer all look the same.",
       "New \\input[action] message code shows the glyph for a bound control (e.g. \"Press \\input[ok] to continue\"), matching keyboard or gamepad to the device in use when the message opens.",
       "Show Text and Show Choices now include a built-in \"Text codes\" reference, so you can recall every code (including \\input[...]) without leaving the message editor.",
       "Input-prompt glyphs are generated procedurally, so they need no extra art and carry into standalone exports automatically.",
     ],
   },
   {
     date: "June 16, 2026",
     title: "Map Action Combat",
     summary: "Events can now become Zelda-style map enemies that take sword damage, flash, knock back, and update kill quests on defeat.",
     items: [
       "Added an Action Combat section to event pages for enabling map enemies, choosing an enemy, and tuning HP, touch damage, knockback, invulnerability frames, and defeat self-switches.",
       "Press J during map play to swing the player's sword with a directional hit collider.",
       "Sword hits damage each enemy once per swing, show slash and damage feedback, and apply tile knockback when space is available.",
       "Defeated action-combat enemies erase or flip their configured self-switch and count toward matching Kill quest objectives.",
     ],
   },
   {
     date: "June 15, 2026",
     title: "Abandoned Quest Tracking",
     summary: "The Journal now separates abandoned quests from failed ones so players can review dropped quests independently.",
     items: [
       "Added an Abandoned Quests tab to the Journal.",
       "Player-abandoned quests now use their own abandoned state instead of being mixed into Failed Quests.",
       "Quest status pickers now include abandoned for page conditions and quest prerequisites.",
     ],
   },
   {
     date: "June 15, 2026",
     title: "Split-Panel Quest Journal",
     summary: "The in-game Journal now opens as a full-size split panel with quest browsing on the left and live details on the right.",
     items: [
       "Replaced the old Journal popup flow with a dedicated full-screen-style panel.",
       "Browse Active, Completed, and Failed quests from tabs across the top of the Journal.",
       "See the selected quest's title, description, objectives, and failure outcome in a persistent detail pane.",
       "Opening the Journal now hides the party panel so the quest screen has room to breathe.",
     ],
   },
   {
     date: "June 15, 2026",
     title: "Built-In Quest System",
     summary: "Added a built-in quest framework with editor tools, runtime tracking, objective progress, branching outcomes, and an in-game Journal.",
     items: [
       "New Database -> Quests tab for creating and editing quests, objectives, rewards, prerequisites, failure rules, and follow-up quest chains.",
       "Added Event, Kill, and Fetch objectives with progress tracking, optional fetch item turn-in consumption, and objective-aware event page conditions.",
       "New event commands: Start Quest, Complete Quest, Fail Quest, Advance Quest Objective, and Set Quest Objective Progress.",
       "Added an in-game Journal with Active, Completed, and Failed quest lists, objective progress display, outcome text, and optional quest abandonment.",
       "Quest rewards now support XP, gold, and items, with save/load support, restart/abandon policies, branching failures, and automatic follow-up quest unlocking.",
     ],
   },
  {
    date: "June 14, 2026",
    title: "Event editor: 3-pane layout + live command inspector",
    summary:
      "Reorganized the event editor into a three-pane workspace and added an inline inspector that edits the selected command without opening a dialog.",
    items: [
      "Event editor now uses a 3-pane layout: Conditions, Appearance, and Behaviour on the left; the command list in the center; and a command inspector on the right.",
      "The Conditions section shows an \"N active\" badge when page conditions are set.",
      "Single-click a Show Text command to edit its speaker, face, and message live in the right-hand inspector; double-click any command to open the full editor dialog as before.",
      "Command list is easier to scan with alternating row shading and a running command count next to the \"Commands\" heading.",
      "Event name and page tabs moved into a single header bar; the map position now sits in the footer beside OK / Cancel.",
    ],
  },
  {
    date: "June 14, 2026",
    title: "Lighting polish: smoother lights, shadows disabled",
    summary:
      "Improve radial light visuals and temporarily disable shadow generation while debugging.",
    items: [
      "Smoothed radial gradient for more natural light falloff (less burnt centers).",
      "Removed the ambient overlay sprite in favor of a single ambient background color.",
      "Temporarily disabled per-tile shadow generation to prevent visual artifacts.",
      "Fixed PIXI v8 compatibility: string blend modes and linear scaleMode usage.",
      "Credits: Kiro (Dirgefall Studio) — PIXI integration and lighting polish",
    ],
  },
  {
    date: "June 14, 2026",
    title: "PIXI v8 HD-2D Lighting System",
    summary:
      "Replaced basic circle-based light rendering with a GPU-efficient radial gradient light map for PIXI v8.",
    items: [
      "Lights now use radial gradient sprites with smooth falloff instead of hard-edged circles.",
      "Ambient darkness overlay darkens unlit areas; lights pierce through via ADD blend mode.",
      "Fixed TILE size mismatch (32 to 48) for correct sprite and light positioning.",
      "Camera zoom is now applied to the PIXI scene container.",
      "Light sprites are pooled and reused each frame (zero GC pressure).",
      "Editor GLRender alias added for HD-2D preview compatibility.",
      "Credits: Kiro (Dirgefall Studio) — PIXI integration and lighting polish",
    ],
  },
  {
    date: "June 14, 2026",
    title: "Desktop App (Tauri)",
    summary: "RPGAtlas can now be packaged as a lightweight cross-platform desktop application using the system WebView, alongside the existing local-server build.",
    items: [
      "Added a Tauri wrapper (src-tauri/) that runs the editor in a native window on Windows, macOS, and Linux.",
      "RPGAtlas-Desktop.exe opens the editor directly in the desktop app; the original RPGAtlas.exe still opens it in your browser.",
      "Playtest opens in its own dedicated desktop window instead of a browser tab.",
      "Project export uses a native Save dialog when running as a desktop app.",
      "Build with: npm install, then npm run dev (live) or npm run build (installer). Requires the Rust toolchain.",
    ],
  },
  {
    date: "June 14, 2026",
    title: "Name & Manage Event Pages",
    summary: "Name an event's pages and reorder, duplicate, or jump between them by drag, right-click menu, or number keys.",
    items: [
      "Name a page: double-click its tab (or right-click → Rename) to label it, e.g. “Greeting” instead of “Page 3”. Clear the name to return to the default.",
      "Drag a page tab left or right to reorder it.",
      "Right-click a page tab for Add page, Rename, Move, Copy, Paste, and Delete.",
      "Copy a page and paste it — within an event or into another event — as a full duplicate.",
      "Press 1–9 to jump straight to that page.",
    ],
  },
  {
    date: "June 14, 2026",
    title: "Undo, Redo & Delete-Key for Event Commands",
    summary: "The event editor gains its own undo/redo and Delete-key shortcuts — conveniences RPG Maker never offered inside event editing.",
    items: [
      "Undo and redo adding, editing, deleting, moving, copy/cut/paste, and drag-reordering of commands, including multi-selected blocks and commands nested inside If/Choices branches.",
      "Ctrl+Z undoes; Ctrl+Y or Ctrl+Shift+Z redoes — anywhere in the event editor, not only when the list is focused.",
      "Each event page keeps its own command history, so undo never disturbs another page or your page condition/appearance settings.",
      "Press Delete to remove the selected command(s) from the Commands list — and Ctrl+Z brings them back.",
      "Press Delete to remove the highlighted page, or use the − button; pages that still hold commands ask to confirm first.",
      "Command history lasts while the event editor is open; clicking OK still commits the whole event as a single undo step on the map.",
    ],
  },
  {
    date: "June 14, 2026",
    title: "Multilingual Editor Interface",
    summary: "Added a persistent interface-language module so creators can use the editor chrome in English, Spanish, French, or German.",
    items: [
      "Added Help → Interface Language for switching languages without reloading the editor.",
      "Translated the main menus, toolbar labels, map sidebar, status text, and common dialog controls.",
      "Language selection follows the browser by default, is saved locally, and never changes project-authored names or content.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Smoother Movement",
    summary: "Reworked the play-test movement loop so walking is fluid and runs at a consistent speed on every display.",
    items: [
      "Removed the brief pause that occurred at each tile during grid movement, for both the player and NPCs.",
      "Game logic now runs on a fixed timestep, so movement speed is identical on 60 Hz, 120 Hz, and high-refresh screens (no more fast-forward on fast monitors).",
      "Added frame interpolation so motion stays smooth on high-refresh displays.",
      "Event 'Wait' and camera-zoom timing is now frame-rate independent, matching real time even when the frame rate dips.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Select Multiple Event Commands",
    summary: "Shift+click a range of commands in the event editor and copy, cut, paste, delete, move, or drag them as one block.",
    items: [
      "Click a command, then Shift+click another to select the whole run between them.",
      "Copy/Cut/Paste/Delete and the ↑/↓ buttons act on the entire selection at once.",
      "Drag a selected block to a new spot, including into another branch.",
      "Selection stays within one branch level; selecting across an If/Choices carries the whole block along.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Copy & Paste Event Commands",
    summary: "Copy, cut, and paste commands in the event editor — within an event or from one event to another.",
    items: [
      "Select a command and use Ctrl+C / Ctrl+X / Ctrl+V (or the Copy/Cut/Paste buttons) in the Commands list.",
      "Paste works across events, so you can copy a command in one event and paste it into another.",
      "Container commands (If / Choices) copy with everything nested inside them.",
      "Right-click a command for a menu with all the list actions (add, edit, cut, copy, paste, move, delete).",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Drag-to-Reorder Event Commands",
    summary: "Reorder commands in the event editor by dragging them, not just the ↑/↓ buttons.",
    items: [
      "Click and drag a command in the Commands list to move it anywhere in the event.",
      "Drag commands into or out of If/Choices branches, not just within a single list.",
      "A drop line shows where the command will land; the ↑/↓ buttons still work too, and now keep the command selected so you can tap them repeatedly.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Cinematic and Control Event Command Expansion",
    summary: "Added new visual effects commands and advanced branching controls to map events.",
    items: [
      "Shake Screen - shakes the game viewport horizontally and vertically in both 2D and HD-2D modes.",
      "Flash Screen - overlays a fading color overlay for thunder strikes, hit impacts, or magical bursts.",
      "Change Weather - triggers map weather changes visually without requiring JavaScript Script blocks.",
      "Actor Conditional Branch - checks party membership and specific weapon/armor equipment in event branches.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Faster Event Command Navigation",
    summary: "Increased the Add Command menu from 12 to 24 buttons per page and added direct numbered page tabs.",
    items: [
      "Each Event Command page now displays up to 24 buttons.",
      "Page tabs appear above the command grid for one-click access without cycling through pages.",
      "Saved custom command buttons and +Add New remain at the end of the picker.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Patch Notes",
    summary: "Added an easily digestible Patch Notes menu under Help so players and creators can review feature updates.",
    items: [
      "Patch notes are shown newest-first and older entries remain available by scrolling.",
      "Added a project instruction requiring future AI-assisted features and major changes to include a short patch note.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Event Command Expansion",
    summary: "Expanded Event Commands into multiple pages with 12 buttons per page and the ability to add reusable event buttons on demand.",
    items: [
      "Camera Zoom - zoom the player camera in or out immediately or over time.",
      "+Add New - create project-saved JavaScript command buttons for reusable event flow and scene-management tasks.",
      "Saved command buttons can be inserted with one click, or edited and deleted with right-click.",
    ],
  },
];
