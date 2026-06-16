# Events

Events are how your game *does* anything: a villager talks, a chest opens, a door unlocks, a cutscene
plays, a battle begins. If maps are the stage, events are the actors and the script. Master events
and you can build almost any RPG.

> New to eventing? Walk through [Make Your First Game](Your-First-Game) first — it builds an NPC, a
> chest, a transfer, and a battle step by step. This page is the deeper reference.

---

## The anatomy of an event

Create an event by **double-clicking a tile in Event mode**. An event has:

- A **position** on the map (drag to move it).
- One or more **pages**.

Each **page** has:

- **Conditions** — when this page is the active one.
- A **graphic** — how the event looks (a sprite, a chest, nothing/invisible).
- A **trigger** — what makes its commands run.
- A **command list** — the sequence of things that happen.

---

## Pages and conditions

An event can have several pages, but only **one is active at a time**. The engine checks pages
**top to bottom and uses the last page whose conditions are all met.** Order matters: put your
"default" page first and more-specific states later.

Page conditions can require:

- A **Switch** is ON (a game-wide on/off flag).
- A **Variable** meets a value (a game-wide number).
- A **Self-Switch** (A/B/C/D) is ON — a flag *local to this one event*.

**This is the core of stateful eventing.** A chest's page 2 ("opened") activates once its self-switch
A is ON. A drawbridge lowers once switch `12` is ON. A boss vanishes once `BossDefeated` is ON.

---

## Triggers — what starts an event

| Trigger | Fires when… |
|---|---|
| **Action Button** | The player faces the event and presses Z/Enter. *(Talking to NPCs, opening chests.)* |
| **Player Touch** | The player steps onto the event's tile. *(Doorways, traps, transfer tiles.)* |
| **Autorun** | Automatically, locking player control until it finishes. *(Forced cutscenes.)* |
| **Parallel** | Continuously in the background, alongside the player. *(Ambient effects, timers, watchers.)* |

> **Careful with Autorun and Parallel:** an Autorun page with no end condition freezes the game. The
> usual pattern is for the page to flip a switch/self-switch at the end so a *different*, empty page
> becomes active and the event stops running.

---

## Action Combat events

Event pages can also act as real-time map enemies. In the page's **Action Combat** section:

- Turn **Enabled** on.
- Pick an **Enemy** from the Database. HP 0 uses that enemy's database HP.
- Set optional **Touch damage**, **Knockback**, and **Invuln frames**.
- Choose a **Defeat switch** if you want the event to change pages when defeated; otherwise it erases
  for the current play session.

During play, press **J** on the map to swing the sword. A swing checks the short-lived collider in
front of the player, damages each enemy once, flashes the target, and applies knockback when the next
tile is open. Defeated action-combat enemies also count for Kill quest objectives that target the
same enemy.

---

## Command reference

Add commands with **+** inside a page. Each picker page holds up to 24 command buttons; use the
numbered page tabs across the top to jump directly between pages. Commands run top to bottom.

The final picker page includes **+Add New**. It creates a named, project-saved JavaScript button for
tasks you reuse across many events. Clicking a saved button inserts its script command; right-click
the button to edit or delete it.

### Messages & flow
| Command | What it does |
|---|---|
| **Show Text** | Display a message window. Optional speaker **name** and **face** portrait. Supports [text codes](Message-Text-Codes). |
| **Show Choices** | Offer the player options, each branching to its own sub-list of commands. |
| **Conditional Branch** | Run commands only **if** a condition is true (switch, self-switch, variable…), with an optional **else**. |
| **Wait** | Pause for a number of frames. |
| **Script** | Run raw JavaScript for anything the commands don't cover (advanced — see [Plugins](Plugins)). |

### Game state
| Command | What it does |
|---|---|
| **Control Switch** | Turn a named on/off flag ON or OFF (affects the whole game). |
| **Control Self-Switch** | Turn this event's local A/B/C/D flag ON or OFF. |
| **Control Variable** | Set, add, subtract, or randomize a named number. |

### Party, items & money
| Command | What it does |
|---|---|
| **Gain/Lose Item** | Give or take an item, weapon, or armor (with a quantity). |
| **Change Gold** | Give or take currency. |
| **Change Party** | Add or remove an actor from the party. |
| **Heal / Recover** | Restore HP/MP by an amount, or fully recover the party. |

### Movement & the world
| Command | What it does |
|---|---|
| **Transfer Player** | Move the player to a tile on any map (with a facing direction). |
| **Set Move Route** | Make the player *or* this event walk a scripted path. |
| **Camera Zoom** | Zoom the map camera out or in over a chosen number of frames. `1.0` is normal, lower values zoom out, and higher values zoom in. |
| **Change Transparency** | Hide or show the player sprite (the player still moves and triggers events). |
| **Erase Event** | Remove this event for the rest of the play session. |

### Battle, shops & audio
| Command | What it does |
|---|---|
| **Start Battle** | Begin a fight with a troop; choose escape allowed and what losing does. |
| **Open Shop** | Open a buy/sell shop stocked with chosen goods. |
| **Play Sound** | Play a procedural sound effect. |
| **Change Music** | Switch the background music theme. |

### Scene control
| Command | What it does |
|---|---|
| **Save Screen** | Open the save menu. |
| **Game Over** | Send the player to the game-over screen. |
| **Return to Title** | Go back to the title screen. |

---

## Switches vs. Variables vs. Self-Switches

| Tool | Scope | Holds | Use it for |
|---|---|---|---|
| **Switch** | Whole game | ON / OFF | Story flags: "met the king", "bridge repaired" |
| **Variable** | Whole game | A number | Counts and progress: gold goals, quest stages, puzzle states |
| **Self-Switch** | One event | ON / OFF (A–D) | Per-event memory: this chest is opened, this NPC already spoke |

Name your switches and variables (in the [Database](The-Database)) so your logic stays readable.

---

## Recipes

### Talking NPC
Graphic: a sprite. Trigger: **Action Button**. One command: **Show Text**. Done.

### Treasure chest (one-time)
Page 1 (closed chest, Action Button): **Play Sound** → **Gain Item** → **Show Text** "You found…" →
**Control Self-Switch A = ON**. Page 2 (open chest, condition Self-Switch A is ON): empty. *Full
walkthrough in [Your First Game](Your-First-Game#6-add-a-treasure-chest-the-classic-switch-trick).*

### Locked door that needs a key
Page 1 (door, Action Button): **Conditional Branch** — *if party has the Key item* → **Play Sound**,
**Show Text** "The door opens.", **Control Self-Switch A = ON**; *else* → **Show Text** "It's locked."
Page 2 (condition Self-Switch A is ON): make the tile passable / show an open door.

### Healing spring (inn substitute)
Trigger: **Action Button** or **Player Touch**. Commands: **Show Text** "You feel rested." →
**Heal / Recover All**.

### A simple cutscene
Trigger: **Autorun**, with a page **condition** of a switch that's OFF at first. Commands: move
characters with **Set Move Route**, **Show Text** dialogue, then **Control Switch = ON** at the very
end. Add an empty page whose condition is that switch being ON, so the scene plays exactly once.

### Branching conversation
Trigger: **Action Button**. **Show Text** a question → **Show Choices** ("Yes" / "No") → put
different commands under each choice's branch.

### Random encounters
You usually don't need an event — turn on encounters in **Map Properties**. See
[Maps & Tiles](Maps-and-Tiles#random-encounters).

---

## Finding things later

As your game grows, use the **Event Searcher** (Tools menu) to locate message text, event names, or
everywhere a particular switch or variable is used. Indispensable once you have dozens of events.

**Next:** [The Database →](The-Database)
