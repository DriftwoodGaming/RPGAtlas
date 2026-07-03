# The Database

The Database is the brain of your game — all the numbers and definitions that maps and events draw
on. Open it from the **Tools ▸ Database** button. It uses a vertical tab rail down the left side;
click a tab to edit that category.

You don't have to fill in everything before you start. The default project already has working
actors, classes, skills, items, and enemies. Tweak as you go.

---

## The tabs

### Actors
The individual heroes the player controls. Each actor has a **name**, a **class**, a starting
**level**, a walking **sprite**, and **starting equipment**. Actors join and leave the party via the
**Change Party** event command.

### Classes
The template behind an actor: **base stats**, **per-level growth**, **traits** (stat boosts,
elemental resistances, skill bonuses), which **equipment** they may use, and the **skills they learn**
at each level. Two actors can share a class or each have their own.

### Skills
Actions used in battle (and sometimes the field). A skill has an **icon**, a type
(**physical / magical / heal**), a **power**, an **MP cost**, and a **scope** (one enemy, all enemies,
one ally, the whole party…). Skills can also **inflict or cure [states](Battles-and-States#states)**,
play a custom **[battle animation](#animations)**, and strike multiple times (**Hits**).

### Items
Consumables and key items. Like skills, they have effects, a scope, an icon, and a **price** (for
shops). Healing potions, antidotes, and quest keys all live here.

### Weapons
Equippable arms with parameters (attack power, etc.), an icon, and a price. Which classes can use
which weapons is set in **Classes**.

### Armors
Equippable defense — same idea as weapons (defense parameters, icon, price, class permissions).

### Enemies
The monsters you fight. Each enemy has **stats**, **rewards** (EXP and gold), a **weighted action
list** (what it tends to do each turn), and a **procedural sprite + color tint**. Twelve distinct
monster families ship with the engine. See [Battles & States](Battles-and-States).

### Troops
**Groups of enemies** that appear together in one battle. A fixed encounter or a random encounter
always references a *troop*, not a single enemy. A troop can be one slime or a whole pack.

### Animations
**Battle animations** (Phase 5): keyframed effect timelines built from timed items —
**particle bursts** (with ring / rain / spiral emitter shapes), **flashes** (over a battler or the
whole screen), **screen shake**, **sounds**, **source→target projectiles**, and **flipbooks**
(icon-strip or image-sheet frame playback). Item start times are in ticks (60 per second); drag the
chips on the timeline strip to retime them, and use the **preview arena** to play the animation with
the exact runtime the game uses. Assign animations to **skills** and **weapons** (the *Battle
animation* picker), or show one on the map with the **Play Animation** event command. A skill
without an animation keeps the engine's classic built-in effects.

### Common Events
Reusable event-command sequences that can be called from map events or scripts. They can also run
automatically as **Autorun** or **Parallel** processes, optionally gated by a switch. See
[Common events](Events#common-events).

### States
Status effects: poison, stun, regen, and the like. Each state has a **per-turn HP change (%)**, an
**action restriction**, a **duration**, whether it's **removed after battle**, and colors/icons.
Skills and items reference states to inflict or cure them. See
[Battles & States](Battles-and-States#states).

### Switches
The named **on/off flags** your events read and write. Naming them ("BridgeRepaired",
"MetTheKing") keeps your eventing readable. See [Events](Events#switches-vs-variables-vs-self-switches).

### Variables
The named **numbers** your events read and write — quest stages, counters, puzzle values.

### Types
The customizable **lists** that populate dropdowns elsewhere: **elements** (fire, ice…) and
**skill types**, plus the **weapon / armor / equip types**. Edit these to fit your world's flavor
(e.g. rename "Ice" to "Frost", add a "Holy" element) and they appear throughout the other tabs.

### System
Game-wide presentation and rules. This tab is worth a careful look:

| Setting | Effect |
|---|---|
| **Game Title** | Shown to players; used as the export filename |
| **Screen width / height** | The game's resolution |
| **UI area size & screen scale** | How big the playfield and interface are |
| **Message & menu fonts, font size** | Typography for all windows |
| **Window color & opacity** | The shared color and transparency of Show Text boxes and menus |
| **System sounds & music themes** | Remappable cursor/confirm/cancel sounds and default music |
| **Battle view** | **Side view** (animated party sprites) or classic **front view** |
| **Battle system** | **Turn-based**, **ATB** (active-time gauges), or **CTB** (turn-order timeline) — see [Battles & States](Battles-and-States#the-three-battle-systems) |
| **Party followers** | Party members trail the leader on the map |
| **Minimap** | Corner minimap + quest-tracker HUD in play (M / gamepad Select toggles; per-map opt-out in Map Properties) |
| **Vehicles** | Boat / ship / airship sprites and starting docks — see [Maps & Tiles](Maps-and-Tiles#movement-upgrades) |
| **Start transparent** | Begin with the player sprite hidden (great for intro cutscenes) |
| **Party, gold, currency name** | Starting party, starting money, and what you call money |
| **Switch / variable names** | (Also editable from their own tabs) |

> Your game's whole *feel* — its size, fonts, and battle style — comes from the System tab. Set it
> early so everything you build matches.

---

## Working with the lists

Every list tab (Actors, Items, Skills, Enemies, …) shares the same toolkit:

- **Search** — the box above the list filters by id or name as you type. Press **↑ / ↓** in the
  search box to walk the (filtered) list without touching the mouse.
- **Multi-select & bulk actions** — tick the checkbox on any rows to reveal the bulk bar:
  **Bulk Edit** a shared numeric field (set / add / multiply), **Duplicate**, **Copy**, or
  **Delete** the whole selection.
- **Copy / Paste between projects** — Copy uses a clipboard that survives switching projects:
  copy entries in one project, open another, and press **Paste**.
- **Undo** — every Database change (typing, New/Delete, bulk edits, pastes) commits to the same
  `Ctrl+Z` history as map painting, and `Ctrl+Z` / `Ctrl+Y` work right inside the dialog
  (text boxes keep the browser's native text undo while you're typing in them).

---

## A workflow that scales

1. Sketch your **classes** and the **stats** that define your game's math.
2. Add the **skills** and **items** the player will actually use.
3. Build **enemies**, then group them into **troops**.
4. Define **states** if you want status-effect depth.
5. Name **switches** and **variables** as your story needs them — don't pre-make hundreds.

**Next:** [Battles & States →](Battles-and-States)
