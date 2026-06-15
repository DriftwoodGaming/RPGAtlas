# Plugins

Plugins are small pieces of **plain JavaScript** stored *inside your project* that run when the game
boots. They're how you extend the engine beyond what the event commands offer — custom message
effects, weather, screen transitions, new event commands, mini-systems.

**You don't need plugins to make a great game.** Skip this page if you're starting out. But if you're
curious or comfortable with a little code, they're powerful and self-contained.

> Plugins run real JavaScript with access to the engine. Only enable plugins you understand or trust,
> just as you would any code.

---

## The four built-in plugins

Every new project starts with these enabled (manage them in **Tools ▸ Plugin Manager**):

| Plugin | What it adds |
|---|---|
| **Atlas_Core** | Shared registry and helpers (colors, easing, tweens, RNG) that other plugins build on |
| **Atlas_TextCodes** | Inline icons `\i[n]`, color codes `\c[n]`, and BBCode in messages — see [Text Codes](Message-Text-Codes) |
| **Atlas_Transitions** | Transfer effects: fade, iris, curtain, slide (e.g. `Atlas.transition = 'iris'`) |
| **Atlas_Weather** | Rain, storm, snow, and fog overlays, per-map or scripted (e.g. `Atlas.weather('rain', 6)`) |

Reading their source in the Plugin Manager is the best way to learn the API by example.

---

## How plugins run

Plugins run **in order at game boot**. Each plugin receives the `atlas` engine bridge (and a `game`
script API). You register **hooks** — functions the engine calls at the right moments — rather than
taking over the loop yourself.

---

## The `atlas` bridge (API surface)

The bridge gives you the engine's state and the hooks to react to it:

**State & systems**
- `atlas.project`, `atlas.map`, `atlas.player`, `atlas.scene`
- `atlas.Assets`, `atlas.Sfx`, `atlas.Music`
- `atlas.SCREEN_W`, `atlas.SCREEN_H`, `atlas.TILE`
- `atlas.fader`, `atlas.stage`

**Hooks**
| Hook | Called when… |
|---|---|
| `atlas.onMapLoad(fn)` | A map finishes loading — `fn(map)` |
| `atlas.onUpdate(fn)` | Every frame, for logic |
| `atlas.onRender(fn)` | Every frame, for drawing — `fn(ctx, info)` |
| `atlas.onMessageText(fn)` | A message is about to display — `fn(html) → html` (transform it) |
| `atlas.setTransition({out, in})` | Define a custom transfer transition |
| `atlas.registerCommand(type, fn)` | Add a new event command — `fn(cmd, interp)` |
| `atlas.startBattle(troopId, canEscape)` | Begin a battle; returns `Promise<"win"｜"lose"｜"escape">` |

---

## A tiny example

A plugin that tints every message and reacts when a map loads:

```js
// MyFirstPlugin
(function () {
  // Make every line of dialogue a little warmer.
  atlas.onMessageText((html) => html.replace(/!/g, '!<span style="color:#ffd27f"></span>'));

  atlas.onMapLoad((map) => {
    console.log("Entered map:", map.name);
  });
})();
```

Add it in **Plugin Manager**, give it a name, paste the code, enable it, and playtest.

### Adding a custom event command

```js
atlas.registerCommand("shake", (cmd, interp) => {
  // cmd holds your command's data; do something dramatic here.
});
```

Once registered, a **Script** command (or your own UI) can invoke it. Use the built-in plugins as
working references for patterns like this.

---

## Good practices

- **Wrap each plugin in an IIFE** (`(function(){ ... })();`) so it doesn't leak variables.
- **Use `Atlas_Core` helpers** instead of reinventing easing, tweens, and RNG.
- **Keep plugins focused** — one feature per plugin is easier to enable/disable and debug.
- **Plugins are saved in your project**, so they export with your game automatically. Players need
  nothing extra.

**Next:** [Publishing Your Game →](Publishing-Your-Game)
