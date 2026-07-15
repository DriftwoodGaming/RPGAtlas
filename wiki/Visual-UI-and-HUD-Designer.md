# Visual UI and HUD Designer

Open **Database ▸ System ▸ Visual UI / HUD**, then choose **Open Visual UI / HUD Designer…**.
The designer shows the game screen at the project's real aspect ratio. Drag a widget to move it;
drag its lower-right corner to resize it. Positions and sizes are saved as percentages, so the same
layout remains aligned when the game resolution changes.

## Widgets

- **Minimap** shows the live map, event and vehicle markers, and the player. It still respects the
  System minimap switch and each map's **Show on the minimap** option.
- **Quest tracker** shows active visible quests. Set how many quests each tracker can display.
- **Bound text** combines a label with a live variable, switch, gold, party-leader stat, step count,
  or map-name value.
- **Gauge** turns those same numeric bindings into a labeled fill bar. Actor HP, MP, and TP use their
  live maximum automatically; variables and gold use the maximum you enter.
- **Custom menu** adds clickable on-map commands. A command can open the regular pause menu or run
  any authored Common Event through the normal blocking event interpreter.

Use **HUD visible** to disable the authored layer without deleting its layout. Players can still use
the project's named **HUD** input action (M by default) to hide and restore the whole layer.

## Message-window layouts

Select the dashed **Message window** rectangle in the preview. Turn on **Use custom layout**, then
drag or resize it and set its padding and text alignment. When enabled, this authored rectangle is
used for dialogue instead of the classic top, middle, and bottom message positions. Turn it off to
keep the classic per-message position behavior.

## Theme presets

**Atlas**, **Parchment**, and **Neon** apply coordinated HUD colors and the matching shared window
palette. The chosen border, text, accent, and muted colors flow through HUD widgets, gauges, menus,
speaker labels, and message windows in playtests and exported games.
