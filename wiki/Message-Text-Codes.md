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
| `\g` | The **currency/gold** amount (or label) |

Messages also use **typewriter** display by default — text appears letter by letter.

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
> built-in `\v`, `\n`, `\g` codes keep working).

---

## Tips

- **Show Choices** supports the same codes — you can color or icon-label options.
- Keep lines short enough to fit your window; the **screen size and font size** in
  [Database ▸ System](The-Database#system) determine how much fits.
- Use `\n[id]` instead of hard-coding a name, so renaming an actor updates all their dialogue.

**Next:** [Plugins →](Plugins)
