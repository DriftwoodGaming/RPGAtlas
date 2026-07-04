# Plugin & Script API Reference

The complete reference for code that runs *inside* your game: **plugins** (project JavaScript run
once at boot) and the **Script event command** (snippets run mid-event). For a gentler introduction
with examples, start at [Plugins](Plugins).

Every plugin function is called as `fn(atlas, game, dw)` — `atlas` is the engine bridge, `game` is
the same state API the Script command gets, and `dw` is a legacy alias of `atlas` kept for
pre-rebrand plugins. The Script event command receives `atlas` and `game` as globals.

---

## The `atlas` bridge

### Live state (read-only getters)

| Property | What you get |
|---|---|
| `atlas.project` | The whole project document (maps, actors, items, system…) |
| `atlas.map` | The currently loaded map (its tiles, events, `hd2d` settings, lights) |
| `atlas.player` | The player entity — position (`x`,`y`), facing (`dir`), movement state |
| `atlas.scene` | `"title"`, `"map"`, `"battle"`, or `"gameover"` |
| `atlas.SCREEN_W` / `atlas.SCREEN_H` | Game resolution in pixels (from Database ▸ System) |
| `atlas.TILE` | Tile size in pixels (48) |
| `atlas.stage` / `atlas.uiLayer` / `atlas.fader` | The stage DOM element, the UI overlay layer, and the fade-to-black element |

### Engine services

| Property | What it is |
|---|---|
| `atlas.Assets` | The asset registry — charsets, facesets, tiles, icons (e.g. `Assets.iconHtml(id)`) |
| `atlas.Sfx` | Sound effects — `Sfx.play(name)`, positional `Sfx.playAt(name, pan, vol)` |
| `atlas.Music` | Music — `Music.play(themeOrAssetKey, fadeMs?)`, `Music.stop()` |

`Sfx`/`Music` accept both procedural names (`"cursor"`, `"town"`…) and imported audio keys
(`"asset:audio/my-track"` — see [Audio](Audio)).

### Hooks

| Hook | Fires |
|---|---|
| `atlas.onMapLoad(fn)` | After a map finishes loading — `fn(map)` |
| `atlas.onUpdate(fn)` | Every logic tick (60/s) while on the map |
| `atlas.onRender(fn)` | Every rendered frame — `fn(ctx2d, info)` where `info` has `w`, `h`, `t` (tick), `map`, `camX`, `camY`, `cameraZoom`, `playerX`, `playerY`, `alpha` (sub-tick interpolation) |
| `atlas.onMessageText(fn)` | Before message HTML displays — `fn(html) → html` transforms it |

`onRender` draws onto the 2D overlay canvas above the scene in both classic and HD-2D modes.

### Extending the engine

| Call | Effect |
|---|---|
| `atlas.registerCommand(type, fn)` | Adds a new event command; `fn(cmd, interp)` may be `async` — the event waits for it. Registered commands are also usable from Atlas Graph pages (as command-list nodes) and are error-isolated per call. |
| `atlas.setTransition({ out, in })` | Replaces the map-transfer fade; each is `async () => {}` |
| `atlas.startBattle(troopId, canEscape)` | Starts a battle → `Promise<"win" \| "lose" \| "escape">` |
| `atlas.zonesAt(x, y)` | The current map's [gameplay zones](Advanced-Map-Editor#objects--gameplay-zones) covering a tile, in author draw order — **custom** zones carry whatever `props` you gave them, making this a "regions with data" system. Also on the Script API as `game.zonesAt(x, y)`. |

---

## The `game` script API

Available to plugins (second argument) and to every **Script** event command.

### Switches, variables & gold

| Call | Notes |
|---|---|
| `game.setSwitch(id, on)` / `game.getSwitch(id)` | Setting re-evaluates quest failure conditions |
| `game.setVar(id, value)` / `game.getVar(id)` | Same re-evaluation on set |
| `game.addGold(n)` | Clamped to 0…9,999,999; negative subtracts |

### Party & state

| Call | Notes |
|---|---|
| `game.party()` | The live party array (actors with `hp`, `mp`, `level`, equipment…) |
| `game.state()` | The whole mutable game state — switches, vars, inventory, position. The save file is this object; touch with care. |

### Quests

`game.quest(id)`, `game.questStatus(id)`, `game.startQuest(id)`, `game.completeQuest(id)`,
`game.failQuest(id)`, `game.abandonQuest(id)`, `game.advanceQuestObjective(id, index, amount)`,
`game.setQuestObjective(id, index, value)`.

### Camera, time & flow

| Call | Notes |
|---|---|
| `game.setCameraZoom(z)` / `game.getCameraZoom()` | 0.25–4 |
| `game.setTimeOfDay(h)` / `game.getTimeOfDay()` | 0–24; drives HD-2D day/night maps (dawn ≈ 6, dusk ≈ 17.5, night ≈ 22) |
| `game.callCommonEvent(id)` | Runs a common event (recursion-guarded); `await`-able |

---

## Where code can run

| Surface | When | Gets |
|---|---|---|
| **Plugin** (Plugin Manager) | Once at game boot, in load order | `(atlas, game, dw)` |
| **Script event command** | When its event runs | `atlas`, `game` globals |
| **Damage/stat formulas** (Database) | During battle calculations | formula-local variables (`a`, `b`, `v`) — see [Battles & States](Battles-and-States) |

## Compatibility promise

This surface is **frozen for 1.x**: existing properties and calls keep working across updates
(new ones may be added). Plugins and graphs written against it survive engine upgrades and ship
unchanged inside exported games — see the [Migration Guide](Migration-Guide).

**Next:** [Migration Guide →](Migration-Guide)
