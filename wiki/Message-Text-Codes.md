# Message Text Codes

Message windows (**Show Text** and **Show Choices**) aren't limited to plain words. You can weave in
the player's data, icons, colors, and formatting using short **text codes**. Type them right into the
message text.

---

## Built-in codes

These work out of the box:

| Code | Inserts |
|---|---|
| `\v[n]` | The current value of **variable** number `n` |
| `\n[id]` | The **name** of actor `id` (so dialogue can say the hero's name) |
| `\p[n]` | The **name of the nth party member** (1 = the leader) |
| `\g` | The **currency/gold** amount (or label) |
| `\$` | Shows the **current gold** right where the code sits |
| `\input[action]` | The **button glyph** for a bound control, auto-matched to the player's keyboard or gamepad |

The `\input` action is one of the input actions from **Database ▸ Controls**: `up`, `down`, `left`,
`right`, `ok`, `cancel`, `dash`, `attack`. The glyph follows whatever the player has bound and which
device they're using — e.g. `Press \input[ok] to continue` shows the **Z** key-cap on a keyboard, or
**A** / **✕** / **B** on an Xbox / PlayStation / Switch pad. It's chosen when the message opens.
Action-combat tutorials should likewise use `Press \input[attack] to swing` rather than naming the
default attack key, since players can remap that action.

Messages also use **typewriter** display by default — text appears letter by letter.

### Size and pacing codes

These shape *how* the text looks and types out:

| Code | Effect |
|---|---|
| `\{` … `\}` | Make the following text **bigger** (`\{`) or **smaller** (`\}`) — they stack |
| `\.` | **Pause** ¼ second while typing |
| `\|` | **Pause** 1 second while typing |
| `\!` | **Wait for a button press** before continuing |
| `\>` … `\<` | Type the rest of the line **instantly** (`\>`) until `\<` turns it back off |
| `\^` | **Close without waiting** for input at the end of the message |

These are handy for dramatic timing — `That was\| ...unexpected.` pauses a beat before the reveal.
(Coming from RPG Maker? These are the same `\{ \} \. \| \! \> \< \^` codes, and MZ's `\PX`/`\PY`/`\FS`
are understood too.)

### Window look and position

**Show Text** has two dropdowns beside the message box:

- **Window** — *Window* (the normal frame), *Dim* (a soft shaded backdrop), or *Transparent* (just the
  text, no frame).
- **Position** — *Top*, *Middle*, or *Bottom* (the default) of the screen.

**Example**

```
\n[1]: I've saved up \v[5] \g already!
```

…might render as *"Rowan: I've saved up 250 gold already!"* depending on your data.

---

## Rich text from the Atlas_TextCodes plugin

Every new project ships with the **Atlas_TextCodes** plugin enabled, which adds inline icons, color
codes, and BBCode-style formatting:

| Code | Effect |
|---|---|
| `\i[n]` | Inline **icon** number `n` from the icon sheet |
| `\c[n]` | Switch text **color** to palette color `n` |
| `[b]…[/b]` | **Bold** |
| `[i]…[/i]` | *Italic* |
| `[color=#ff8800]…[/color]` | Custom **color** |
| `[size=20]…[/size]` | Custom **font size** |

**Example**

```
You received \i[12] [b]Mythril Sword[/b]! [color=#7fd]Its edge gleams.[/color]
```

> Because this is a plugin, it's also a great model for [writing your own](Plugins). If you ever
> disable Atlas_TextCodes in the Plugin Manager, the `\i`, `\c`, and BBCode features turn off (the
> built-in `\v`, `\n`, `\p`, `\g`, `\$` and the size/pacing codes keep working).

---

## Asking the player for input

Three commands (under **Add Command**, near the bottom of the list) pause the game and let the player
answer back:

- **Input Number** — pops up a little number pad the player dials in with the arrow keys; the number is
  saved to a **variable**. Great for "enter the code" locks.
- **Select Item** — shows the items the player is carrying and stores the **id** of the one they pick in
  a variable (0 if they cancel).
- **Name Input** — opens an on-screen keyboard so the player can **rename a hero**. Works with the
  keyboard and a gamepad.

---

## Tips

- **Show Choices** supports the same codes — you can color or icon-label options.
- Keep lines short enough to fit your window; the **screen size and font size** in
  [Database ▸ System](The-Database#system) determine how much fits.
- Use `\n[id]` instead of hard-coding a name, so renaming an actor updates all their dialogue.

**Next:** [Plugins →](Plugins)
