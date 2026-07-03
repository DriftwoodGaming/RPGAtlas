# Make Your First Game

This is a guided tour. In about 30 minutes you'll build a tiny but *complete* playable game: a town
with a talking villager, a treasure chest, a doorway to a cave, and a monster battle — then you'll
export it so a friend can play. Every RPGAtlas concept you'll use again starts here.

> **Before you start:** make sure the editor is open in your browser. If it isn't, see
> [Installation & Setup](Installation-and-Setup).

---

## 1. Start a fresh project

1. **File ▸ New Project.** Confirm if it asks — this clears the sample game from the editor.
2. **File ▸ (Database) ▸ System tab**, or click the **Database** toolbar button and pick **System**.
   Set your **Game Title** (this is the name players see and the filename when you export).
3. Close the Database for now.

Your work auto-saves to the browser, but do **File ▸ Save Project** now and again to keep a `.json`
backup you control.

---

## 2. Paint your first map

You start with one empty map. Let's make it a small town.

1. Make sure you're in **Map mode** (the **Mode** menu, or it's the default).
2. Look at the **tile palette** on the side. Click a grass or dirt tile to select it.
3. With the **Auto layer** active (press `0`), just **click and drag** on the map to paint. Auto
   layer is the beginner's best friend: it figures out whether a tile is ground or a decoration and
   puts it on the correct layer for you.
4. Paint a field of grass across the whole map. Then pick a path tile and draw a road. Pick a tree
   or house tile and dot a few around.

**Useful while painting:**

| Action | How |
|---|---|
| Bigger area at once | Press `R` for the **Rectangle** tool, then drag |
| Pick a tile already on the map | **Right-click** it |
| Zoom | `+` / `-`, or `Ctrl` + mouse wheel; `Ctrl+0` resets to 1:1 |
| Made a mistake | `Ctrl+Z` to undo, `Ctrl+Y` to redo |

> Want a bigger or smaller town? **Map Properties** (right-click the map in the map list, or the
> **Map** menu) lets you rename and resize. See [Maps & Tiles](Maps-and-Tiles).

---

## 3. Decide where walls and water block the player

By default the engine guesses passability from your tiles, but let's see it.

1. Switch to **Passability mode** (the **Mode** menu).
2. Every tile now shows **○** (walkable) or **✕** (blocked). Click any tile to override it — it
   cycles **auto → force block → force pass**. Use this to wall off the edges of the map or make a
   pond impassable.
3. Switch back to **Map mode** when you're happy.

---

## 4. Set where the player starts

1. In **Event mode**, find the **Set Start Position** option (the **Game** menu, or right-click a
   tile). Click the tile where the hero should appear when the game begins.
2. That's your spawn point. Make sure it's on a walkable tile and not inside a tree!

---

## 5. Add a villager who talks

Events are how *things happen* in your game. Let's make an NPC.

1. In **Event mode**, **double-click** an empty tile where the villager should stand. The event
   editor opens.
2. Give the event a **graphic**: pick a character sprite so the villager is visible.
3. Set the **Trigger** to **Action Button** (the player presses Z/Enter while facing them).
4. In the command list, click **+** and choose **Show Text**.
   - Type what they say, e.g. `Welcome to Atlasville, traveler!`
   - Optionally pick a **face** portrait and a **name** for the speaker.
5. Click **OK** to save the event.

**Try it:** hit **▶ Playtest**, walk up to the villager, face them, and press **Z** or **Enter**.
They talk! Press **X** or **Esc**, or close the playtest, to come back.

> You can make dialogue fancier with icons, colors, and the hero's name — see
> [Message Text Codes](Message-Text-Codes).

---

## 6. Add a treasure chest (the classic switch trick)

A chest should give an item **once** and then stay open. This teaches the single most important
eventing pattern in any RPG maker: the **self-switch**.

1. Double-click an empty tile and give the event a **chest** graphic (closed chest).
2. Trigger: **Action Button.**
3. Add these commands in order:
   - **Play Sound** (a chime, optional, for feedback)
   - **Gain Item** → choose an item and a quantity (e.g. 1 Potion). *No items yet? See
     [The Database](The-Database) to add one, or pick **Gain Gold** instead.*
   - **Show Text** → `You found a Potion!`
   - **Control Self-Switch** → set **A** to **ON**.
4. Now make a **second page** for this event (the **New Page** button in the event editor):
   - **Page Condition:** Self-Switch **A** is ON.
   - **Graphic:** an *open* chest.
   - Leave its command list empty (or add a "It's empty." message).

**Why this works:** pages are checked top to bottom, and the **last page whose conditions are met**
becomes active. Once self-switch A is ON, page 2 takes over — so the chest shows as open and can't be
looted again. You'll reuse this pattern constantly (opened doors, defeated bosses, finished quests).

---

## 7. Build a second map and connect it

1. In the **map list**, add a **New Map**. Name it `Cave` and paint some cave/rock tiles.
2. Back on your **town** map, double-click the tile in front of a cave entrance or doorway.
   - Trigger: **Player Touch** (it fires when the player steps on it).
   - Command: **Transfer Player** → choose the **Cave** map and click the destination tile.
3. On the **Cave** map, make a matching **Transfer Player** event that sends the player back to town.

**Try it:** playtest and walk between your two maps.

---

## 8. Add a monster battle

1. Open the **Database** and look at **Enemies** — there are ready-made monsters. Note one you like.
2. Go to **Troops** and make a troop (a group for one battle) containing that enemy.
3. Back on the **Cave** map, double-click a tile and add a **Start Battle** command:
   - Choose your **troop**.
   - Decide whether the player **can escape**, and whether **losing** ends the game or continues.
4. Want random battles instead of a fixed one? Open **Map Properties** for the Cave and turn on
   **random encounters**, then add troops and an encounter rate. See [Battles & States](Battles-and-States).

**Try it:** playtest, enter the cave, and fight. Combat, leveling, and rewards all just work.

---

## 9. Playtest the whole thing

Hit **▶ Playtest** and play from the start:

- Walk around. Talk to the villager. Open the chest (then confirm it stays open).
- Travel to the cave and back.
- Win a battle.

Controls while playing: **Arrows/WASD** move, **Shift** dashes, **Z/Enter** confirm/interact,
**X/Esc** open the menu or cancel. The mouse works too.

Found a problem? Close the playtest, fix the event or tile, and playtest again. This loop —
**edit, playtest, repeat** — is the whole craft of making a game.

---

## 10. Share it with the world

When you're proud of it:

1. **File ▸ Export Standalone Game.**
2. Choose:
   - **Windows EXE** — a single file your friend double-clicks. No RPGAtlas needed.
   - **Standalone HTML** — one file that opens in any modern browser, on any platform.
3. Send them the file. They play; their saves live in their own browser.

Full details and distribution tips: [Publishing Your Game](Publishing-Your-Game).

---

## Tour the HD-2D showcase

The bundled sample game doubles as the engine's showcase. Take the back passage in the
**Whispering Cave** (east wall, past the crystals) out to **Driftwood Shore**: a dusk day/night sun
with long soft shadows, animated water with a lantern-lit dock, auto-textured cliffs, bloom + warm
color grade, and the full post stack — every effect is a per-map toggle you can inspect in
**Game ▸ Map Properties…** and reuse in your own maps.

---

## You did it 🎉

You've used maps, tiles, passability, events, pages, self-switches, transfers, the database, and a
battle — the core of every RPG. From here:

- Deepen any topic from the **sidebar**.
- Read [Events](Events) for a full command reference and more recipes (locked doors, shops, healing
  springs, cutscenes).
- Make it *yours* with the [Character Generator and custom art](Characters-and-Custom-Assets).

**Next:** [The Editor Interface →](The-Editor-Interface)
