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

- **Conditions** — when this page is the active one (switches, variables, self-switches, quest
  status/objectives, and a **time of day** band — morning/day/evening/night — so a shop can simply
  have a night page that says it's closed).
- A **graphic** — how the event looks (a sprite, a chest, nothing/invisible).
- A **trigger** — what makes its commands run.
- A **command list** — the sequence of things that happen.

---

## Quick Events — ready-made templates

Don't want to build it by hand? **Right-click an empty tile in Event mode ▸ New Quick Event** and
pick a template. Each one asks two or three plain questions and places a finished, working event:

| Template | What it asks | What you get |
|---|---|---|
| **Sign** | The text | An action-triggered sign that shows your message |
| **Chest** | What's inside (item/weapon/armor/gold) | A one-time chest that opens, gives the loot, and stays open (self-switch A) |
| **Transfer** | The destination (with a map picker) | A walk-on doorway that moves the player there |
| **Villager** | A look, what they say, whether they wander | A talking NPC with their own face in the message |
| **Shopkeeper** | A look, a greeting, the goods | An NPC whose shop opens stocked with your wares |
| **Innkeeper** | A look and the price per night | Pays gold → screen fades to black → party wakes fully rested; refuses politely if you're short |
| **Locked Door** | The key item, the destination, whether the key is used up | Blocks the way and says it's locked until the player has the key — then it's a normal door forever |
| **Door** | The destination (with a map picker) | A press-to-open door that plays the door sound, then takes the player across |
| **Save Point** | Whether it also heals | A glowing save point — press it to open the Save screen (optionally waking fully restored) |
| **Healing Crystal** | The message shown | A glowing crystal that fully restores the party's HP and MP each time it's touched |
| **Monster** | A look, the enemy troop, an optional gold reward | Blocks the way and fights (no escape); once beaten it hands over the reward and vanishes for good |
| **Gift NPC** | A look, the gift (item/weapon/armor/gold), the lines | Hands over the gift once, then only repeats the afterward line (self-switch A) |
| **Quest Giver** | A look, the quest to start, the lines | Speaks and starts the quest, then only repeats the afterward line (self-switch A) |

Quick Events are ordinary events — open one in the event editor afterwards to see exactly how its
pages, conditions, and commands fit together. They're the fastest way to *learn* eventing, not just
skip it.

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
- Pick an **AI** behavior. **None** keeps the normal event movement; **Chase player** makes the
  enemy close distance when the player is nearby.
- Set optional **Touch damage**, **Knockback**, and **Invuln frames**.
- Choose a **Defeat switch** if you want the event to change pages when defeated; otherwise it erases
  for the current play session.

During play, use the remappable **Attack** action on the map to swing the sword. A swing checks the
tile in front of the player plus its short-lived visual collider, damages each enemy once, flashes
the target, and applies knockback when the next tile is open. Enemies with **Touch damage** can
strike from the adjacent tile; assign **Chase player** AI when you want them to actively pursue the
player.
Defeated action-combat enemies also count for Kill quest objectives that target the same enemy.

For player-facing instructions, write text such as `Press \input[attack] to swing.` The prompt shows
the player's current keyboard or gamepad binding instead of assuming a specific key.

---

## Common events

**Database ▸ Common Events** stores reusable command sequences that are not tied to one map event.
Use **Call Common Event** in any event command list to run one immediately, or call
`game.callCommonEvent(id)` from a Script command. The script API returns a Promise; use
`return game.callCommonEvent(id)` when later event commands must wait for the common event to finish.

Each common event has a trigger:

- **None** — runs only when explicitly called.
- **Autorun** — repeatedly runs as a blocking event while its activation switch is ON.
- **Parallel** — repeatedly runs in the background while its activation switch is ON.

The activation switch controls only Autorun and Parallel behavior. Direct calls still run when that
switch is OFF. Use a Control Switch command inside an Autorun common event to turn off its activation
switch, or it will continue to restart and hold player control.

---

## Dialogue & cutscene assets

**Tools ▸ Dialogue & Cutscenes** is the dedicated conversation workspace. Build reusable trees from
speaker lines, player choices, and Cutscene nodes containing ordinary event commands. Each line can
carry a portrait override, voice cue, condition, and localization key; the built-in preview lets you
read through branches before starting a map playtest.

Use **Play Dialogue** in an event list or Atlas Graph to run the asset. See the full
[Dialogue & Cutscenes guide](Dialogue-and-Cutscenes).

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
| **Call Common Event** | Run a reusable command sequence from Database ▸ Common Events. |
| **Play Dialogue** | Run a reusable conversation or cutscene from Tools ▸ Dialogue & Cutscenes. |
| **Show Choices** | Offer the player options, each branching to its own sub-list of commands. |
| **Conditional Branch** | Run commands only **if** a condition is true (switch, self-switch, variable, quest, item, gold, actor, [player region](Maps-and-Tiles#regions--numbered-zone-tags), time-of-day clock window…), with an optional **else**. |
| **Loop** | Repeat its body until a **Break Loop** command runs inside it. |
| **Break Loop** | Exit the innermost enclosing Loop and continue after it. |
| **Label** | Mark a named spot in this command list. |
| **Jump to Label** | Leap to the matching **Label** in this list (great for building your own loops and skips). |
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
| **Change Gold** | Give or take currency — a fixed amount, or an amount read from a [variable](#switches-vs-variables-vs-self-switches) when the command runs. |
| **Change Party** | Add or remove an actor from the party. |
| **Heal / Recover** | Restore HP/MP by an amount, or fully recover the party. |

### Actors & progression
Each of these targets one hero or the **Entire Party**.
| Command | What it does |
|---|---|
| **Change EXP** | Add or subtract experience (levels rise as EXP crosses each threshold). |
| **Change Level** | Add or subtract levels directly. |
| **Change Parameters** | Add a permanent bonus to a base stat (Max HP/MP, Attack, Defense, M.Attack, M.Defense, Agility). |
| **Change Skills** | Teach (learn) or remove (forget) a skill. |
| **Change Equipment** | Force-equip a weapon or armor slot (or clear it). |
| **Change Name / Nickname / Profile** | Rename a hero or set their nickname / profile text. |
| **Change Class** | Switch a hero's class (they keep their level). |
| **Change Actor Image** | Swap a hero's map sprite + menu face (one charset covers both). |
| **Change State** | Add or remove a status effect outside battle. |

### Movement & the world
| Command | What it does |
|---|---|
| **Transfer Player** | Move the player to a tile on any map (with a facing direction). |
| **Set Move Route** | Make the player *or* this event walk a scripted path (steps include `jump` — a 2-tile arc hop). |
| **Camera Zoom** | Zoom the map camera out or in over a chosen number of frames. `1.0` is normal, lower values zoom out, and higher values zoom in. |
| **Change Transparency** | Hide or show the player sprite (the player still moves and triggers events). |
| **Change Followers** | Show or hide the party members trailing behind the leader. |
| **Get Location Info** | Read a map tile's region id, event id, or tile id into a variable. |
| **Erase Event** | Remove this event for the rest of the play session. |

### Battle, shops & audio
| Command | What it does |
|---|---|
| **Start Battle** | Begin a fight with a troop; choose escape allowed and what losing does. |
| **Open Shop** | Open a buy/sell shop stocked with chosen goods. |
| **Play Sound** | Play a procedural sound effect. |
| **Change Music** | Switch the background music theme. |
| **Play Animation** | Play a [battle animation](The-Database#animations) over the player, this event, or the screen center. |

### Scene control
| Command | What it does |
|---|---|
| **Save Screen** | Open the save menu. |
| **Game Over** | Send the player to the game-over screen. |
| **Return to Title** | Go back to the title screen. |

### System
These are remembered in the save file.
| Command | What it does |
|---|---|
| **Change Access** | Turn the pause **Menu**, **Saving**, random **Encounters**, or the **Formation** option on or off (locked entries are greyed out in the menu). |
| **Change Window Color** | Recolour the message and menu windows for the rest of the game. |

---

## Atlas Graph — visual scripting

Every event page can also be authored as a **node graph**. Above the command list sits a
**List | Graph** toggle: pressing **Graph** on a classic page converts it to a graph — losslessly,
one node per command, already wired in order.

The graph is an authoring view, not a different engine: it **compiles into the exact command list**
the game already runs. Playtest, saves, plugins, and exported games see only the compiled commands,
so a graph page behaves identically to the same page written as a list (and costs nothing at
runtime).

Working on the canvas:

- **Wire** flow by dragging from a node's output port onto another node. Drop a wire on empty
  canvas to pick a command and add-and-connect it in one motion. Branch nodes (Conditional Branch,
  Show Choices, Loop) expose one port per branch plus an **After** port — what runs once the branch
  completes.
- **Add** nodes from the right-click menu (or double-click empty canvas): every command in the Add
  Command picker is a node, including your saved Script buttons — which is also how plugin commands
  join the graph.
- **Edit** a node with a double-click (the command's normal dialog) or the inspector on the right.
- **Navigate**: drag the background to pan, mouse-wheel to zoom, use the corner minimap to jump.
  Comments, resizable frames, and reroute dots keep large graphs readable.
- **Validation** runs live: cycles (use a Loop node instead), unreachable nodes, and a disconnected
  Start are flagged in a banner. Errors keep the page's last good compile, so it never breaks
  mid-edit.
- **List** view shows the compiled commands read-only while a graph owns the page;
  **Convert to list…** removes the graph and returns the compiled commands to normal editing.

Ctrl+Z / Ctrl+Y inside the event editor undo graph edits and their compiled commands as one step.

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
