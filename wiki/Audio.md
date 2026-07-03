# Audio

RPGAtlas ships with **no audio files** — its built-in music and sound effects are generated
procedurally with the Web Audio API at runtime, free of licensing worries. Since the Asset & Audio
update you can also **import your own OGG/MP3/WAV files** (via [The Asset Browser](The-Asset-Browser))
and use them everywhere the procedural audio works; game exports embed only the audio your game
actually uses, so procedural-only games still ship without a single audio file.

---

## The Audio Manager

Open **Tools ▸ Audio Manager** to **preview every procedural sound effect and music theme** — and,
below them, your imported audio. Click around and listen; it's the menu you'll choose from when
assigning sounds to events and music to maps.

---

## Imported audio: the four roles

Audio imported in the Asset Browser gets a role (guessed from the file name, editable on its card):

| Role | Meaning | Where it shows up |
|---|---|---|
| **BGM** | Looping music, streamed with crossfades | Music pickers (maps, system themes, Change Music) |
| **BGS** | Looping ambience (rain, crowds, surf…) | **Map Properties ▸ Ambience layers** |
| **ME** | One-shot jingles that duck the music and restore it | Play Sound pickers |
| **SE** | One-shot effects | Play Sound pickers, system sounds, animation Sound items |

---

## Where audio is used

| Where | How to set it |
|---|---|
| **Map background music** | **Map Properties** — procedural themes and imported BGM; imported tracks crossfade |
| **Ambience layers** | **Map Properties** — stack looping BGS layers with per-layer volume; shared layers keep playing seamlessly across transfers |
| **System / UI sounds** | **Database ▸ System** — remap cursor, confirm, cancel, etc. (imported SEs allowed) |
| **Default music themes** | **Database ▸ System** — the title/battle themes |
| **In an event** | **Play Sound** plays an SFX (check **Positional** to pan/fade an imported sound by the event's distance from the player); **Change Music** switches the track (set the crossfade ms for imported music). See [Events](Events#battle-shops--audio) |

Players get a matching **Ambience Volume** slider in the in-game Options menu beside Master, Music,
and SFX.

---

## Practical tips

- **Give actions feedback.** A short sound on opening a chest, buying an item, or triggering a switch
  makes the game feel responsive.
- **Layer the world.** One rain BGS across a region's maps plays continuously while music changes per
  map — the layers are diffed, not restarted, on transfer.
- **Match music to mood.** Quiet themes for towns, driving themes for dungeons and bosses; switch
  with **Change Music** when the story turns.
- **Preview before you assign.** Use the Audio Manager so you know what each track sounds like rather
  than guessing from its name.
- **Mind licensing.** Only import audio you have the rights to distribute — exports embed it in your
  game file.

**Next:** [Message Text Codes →](Message-Text-Codes)
