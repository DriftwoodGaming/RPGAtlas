# Audio

RPGAtlas has **no audio files** — all of it, music and sound effects alike, is generated
procedurally with the Web Audio API at runtime. That keeps the engine tiny and every sound free of
licensing worries, and it means your exported games carry their soundtrack without shipping a single
`.wav` or `.mp3`.

---

## The Audio Manager

Open **Tools ▸ Audio Manager** to **preview every procedural sound effect and music theme** the
engine can produce. Click around and listen — it's the menu you'll choose from when assigning sounds
to events and music to maps.

---

## Where audio is used

| Where | How to set it |
|---|---|
| **Map background music** | **Map Properties** for each map — set its music theme |
| **System / UI sounds** | **Database ▸ System** — remap cursor, confirm, cancel, buzzer, etc. |
| **Default music themes** | **Database ▸ System** — the title/battle/etc. themes |
| **In an event** | **Play Sound** plays an SFX; **Change Music** switches the theme. See [Events](Events#battle-shops--audio) |

So a typical game sets calm music on town maps, tense music in dungeons, and uses **Play Sound** for
chests, doors, and other feedback — all from the menus, no files required.

---

## Practical tips

- **Give actions feedback.** A short sound on opening a chest, buying an item, or triggering a switch
  makes the game feel responsive.
- **Match music to mood.** Quiet themes for towns, driving themes for dungeons and bosses; switch
  with **Change Music** when the story turns.
- **Preview before you assign.** Use the Audio Manager so you know what each theme sounds like rather
  than guessing from its name.
- **Mind window opacity and pacing, not just sound.** Audio pairs with the message speed and window
  settings in [Database ▸ System](The-Database#system) to set your game's overall feel.

**Next:** [Message Text Codes →](Message-Text-Codes)
