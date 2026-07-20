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

### Multiplayer — `atlas.mp`

The online surface (see **[Making Your Game Multiplayer](Making-Your-Game-Multiplayer)**). A
plugin can react to players coming and going and exchange small custom messages with everyone
in the room — enough to build shared mini-games, cooperative puzzles, or synced world effects.
Everything here is **inert in single-player**: `isOnline()` is `false`, `players()` is just the
local player, and `sendCustom` does nothing. So a plugin using `atlas.mp` is safe in an offline
game.

| Call | Effect |
|---|---|
| `atlas.mp.isOnline()` | `true` while the game is in a room, `false` in single-player |
| `atlas.mp.players()` | The players in the room as `[{ id, name }, …]`, including yourself |
| `atlas.mp.self()` | This player as `{ id, name }` |
| `atlas.mp.onPlayerJoin(fn)` | `fn({ id, name })` when someone joins the room |
| `atlas.mp.onPlayerLeave(fn)` | `fn({ id, name })` when someone leaves |
| `atlas.mp.sendCustom(data)` | Broadcast a small JSON value to everyone else in the room |
| `atlas.mp.onCustom(fn)` | `fn({ from, data })` when another player's `sendCustom` arrives (`from` is their id) |

```js
// A plugin that shows a heart over a friend when they wave.
atlas.mp.onPlayerJoin(p => console.log(p.name + " arrived!"));
atlas.mp.onCustom(({ from, data }) => {
  if (data && data.kind === "wave") showHeartOver(from);
});
function wave() { atlas.mp.sendCustom({ kind: "wave" }); }
```

`data` is any JSON-safe value (object, array, string, number). Keep it small — it travels the
same wire as everything else — and always check what you receive, since it comes from another
player's game. `sendCustom` reaches everyone in the room except you; the messages are relayed
through the play server (the same tier as emotes), so they work in friend rooms today.

---

## The `game` script API

Available to plugins (second argument) and to every **Script** event command.

Reusable conversations can be awaited with `game.callDialogue(id)`, just like
`game.callCommonEvent(id)`. It returns a Promise that resolves when the dialogue tree ends.

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

This surface is **frozen for 2.x**: existing properties and calls — including the multiplayer
surface `atlas.mp` added in 2.0 — keep working across updates (new ones may be added). Plugins and
graphs written against it survive engine upgrades and ship unchanged inside exported games — see the
[Migration Guide](Migration-Guide).

> **2.0 note.** The online-multiplayer additions (`atlas.mp` — join/leave hooks + `sendCustom`) are
> now part of the frozen surface. `sendCustom` payloads are opaque to the engine and travel on the
> communication tier (like an emote), size-capped and rate-limited; they never carry a player's
> address or any personal information.

**Next:** [Migration Guide →](Migration-Guide)
