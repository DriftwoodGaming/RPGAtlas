# RPGAtlas Migration Roadmap — "Project Compass": RPG Maker MZ/MV → RPGAtlas

**Status:** ✅ **COMPLETE — RELEASED as RPGAtlas 1.1.0** (2026-07-05, tags `mig-0` … `mig-6` + `v1.1.0`;
M6·C release gate signed by Claude Fable 5 — audit verdict in `docs/mig-6-spec.md`)
**Authored:** 2026-07-04 by Claude Fable 5 (grand designer / orchestrator)
**Goal:** A first-class **Import from RPG Maker MZ/MV** path: point RPGAtlas at an MZ or MV
project folder and get a playable Atlas project — plus the engine features RPGAtlas needs to
reach *authoring parity* with what those projects actually use. Honest about the rest: what
can't convert produces a plain-language report, never a silent drop.

## Locked decisions (2026-07-04)

1. **Model choreography:** **Opus 4.8 does the large majority of the work** (settings per
   step: High / Extra High / Ultracode). **Sonnet is banned from RPGAtlas.** Fable 5 is used
   only at the two design gates (M0 contract sign-off, M6 release review).
2. **Git ritual — after EVERY step, no exceptions:** work on branch `mig-<phase><step>`
   (e.g. `mig-1b`), finish with vitest + Playwright + typecheck green, commit, push, merge
   to `main`, push `main`, delete the branch. Phase exit additionally tags `mig-N`.
3. **Hand-off protocol:** every step ends with the finishing conversation printing the
   *next step's kick-off prompt* (the fenced block in that step's section below) **verbatim,
   as the last thing in its final message**, so the user can paste it into a fresh
   conversation. This kills context bloat: each step is one conversation.
4. **Format policy:** the importer *writes* FORMAT_VERSION 2 projects. New engine features
   add **optional** schema fields only (old projects unaffected). If M0 finds a genuinely
   breaking need, it proposes FORMAT_VERSION 3 + migration-registry entry at the Fable gate
   — do not bump casually. Plugin API stays frozen for 1.x.
5. **Legal / assets:** no RPG Maker RTP or DLC assets ever enter this repo. Test fixtures
   are hand-authored JSON + tiny self-drawn/CC0 placeholder images. Decryption of
   `.rpgmvp/.rpgmvo/.png_/.ogg_` uses the key in the *user's own* `System.json` — importing
   your own project is the only supported flow, and docs say so.
6. **Audience rule (always):** import reports, wizard text, and errors are written for
   kids and first-time devs. "3 things couldn't come along — here's what they were and what
   to do instead", never a stack trace.

---

## Orchestration & hand-off

| Role | Model | Used for |
|---|---|---|
| Grand designer / gates | **Claude Fable 5** | This roadmap, M0 contract sign-off, M6 release review |
| Everything else | **Claude Opus 4.8** | All implementation steps; setting escalates with difficulty |

**Setting legend:** *High* = well-specified breadth work · *Extra High* = subsystem cores,
format conversion, interpreter features · *Ultracode* = the battle-math/traits phase and
anything the spec marks "hard core".

**Working agreement per step (bake into every conversation):**
1. Read this roadmap's step section + `docs/mig-N-spec.md` (create the spec from the phase
   section on the phase's first step; append a stage log entry every step).
2. Implement to the step's exit criteria. New engine behavior gets vitest coverage; anything
   user-visible gets a `js/patch-notes.js` entry (bump `help.ts` + `shims.d.ts` versions per
   AGENTS.md convention).
3. Never touch frozen map 1 (Driftwood Shore goldens). Baseline is **0** e2e failures.
4. Git ritual (locked decision 2). Then print the next step's kick-off prompt verbatim.

**The translation table is the spine.** One module —
`src/editor/importers/mz/translate-commands.ts` — owns the MZ-command-code → Atlas-command
mapping. Anything unmappable becomes a `mzTodo` placeholder command (raw code + params
preserved, renders as a friendly note in the event editor, no-ops in the engine) and a
report line. Phases M2–M4 ship engine features **and flip the corresponding table entries
from `mzTodo` to real translations in the same step** — the importer gets better as the
engine does, and re-importing a project picks up the improvements.

---

## What we already have (do NOT rebuild)

Verified against the codebase 2026-07-04: vehicles + followers (Phase 5, `map-runtime.ts`),
weather/flash/shake commands, quests, common events, troop pages, enemy action conditions,
traits (`schema.ts Trait`), battle animations + anim player, regions, self-switches, shops,
script command, camera zoom, plugin manager (own API), 48px tileset pipeline + import
wizard slicers (`importers/import-wizard.ts`, `sheet-math.ts` — MV/MZ are 48px native, no
rescale needed), autotile registry, tile-flags, seedable RNG, Tauri FS access.

**Confirmed gaps (seed list — M0 produces the exhaustive matrix):** pictures suite (absent
from interpreter), screen tint, timer, labels/jump, input number / select item / scrolling
text, balloon icons, name-input scene, change-actor-data command family, formation,
menu/save access toggles, map scroll, get-location-info, JS damage-formula strings
(`a.atk * 4 - b.def * 2`), TP system (verify), full MZ trait/effect code coverage (verify
against matrix), A1–A5 47-pattern autotile conversion, MV animation sheets, asset
decryption.

---

## Phase M0 — Parity audit & conversion contract

*Nothing ships to users; everything after this is built against a signed contract instead
of vibes.* — **Opus 4.8 (High)**, gate by **Fable 5**

### M0·A — The parity matrix
- `docs/mz-mv-parity-matrix.md`: exhaustive tables mapping **every** MZ/MV data field and
  code to one of `= maps to <Atlas thing>` / `+ new feature (assigned phase M2/M3/M4)` /
  `− skip with report line`. Cover: all `data/*.json` files field-by-field; event command
  codes 101–657 (+ MV/MZ differences); move-route codes; trait codes 11–64; item/skill
  effect codes; message escape codes; System.json terms/options; tileset flag bits
  (ladder/bush/counter/damage/terrain-tag/passage); vehicle/follower semantics diff.
- Note MV vs MZ deltas explicitly (Effekseer vs sheet animations, TPBS, plugin command
  formats, `png_`/`rpgmvp` naming).
- Every `+` row names its phase — this is where M2–M4 scope becomes final.

```
>>> Switch model to: Opus 4.8 — High
You are starting Phase M0 Step A of the RPG Maker MZ/MV → RPGAtlas migration.
Read docs/MZ_MV_MIGRATION_ROADMAP.md (whole "Locked decisions" +
"Orchestration" sections, then the M0·A section) — it is the contract for
how you work, finish, and hand off. Create docs/mig-0-spec.md from the M0
phase section with a stage log. Your task: author the full parity matrix
per M0·A. When done: git ritual (branch mig-0a → merge to main → push),
stage-log entry, then print the M0·B kick-off prompt verbatim from the
roadmap as the last thing in your final message.
```

### M0·B — Fixture projects + decision log
- Hand-author minimal-but-representative fixture projects in `tests/fixtures/mv-project/`
  and `tests/fixtures/mz-project/` (own JSON, tiny CC0/self-drawn PNG/OGG placeholders;
  one encrypted-asset sample per project with its key in System.json). Fixtures must
  exercise: 2 maps + transfer, autotiles, all four DB "battler" record kinds, a troop with
  page conditions, a common event, a damage formula, a Show Picture, a plugin entry, an
  MV-format quirk (e.g. `Animations.json` sheet-based).
- `docs/mig-0-spec.md` gains the **decision log**: formula-evaluator approach (sandboxing
  strategy consistent with existing `script` command policy), FORMAT_VERSION stance,
  `mzTodo` command shape, Effekseer stance (expected: skip + auto-fallback to nearest Atlas
  animation + report), Script-command adapter scope (read-only `$gameVariables`/
  `$gameSwitches`/`$gameParty` shim — final call at gate).

```
>>> Switch model to: Opus 4.8 — High
Phase M0 Step A (parity matrix) is COMPLETE and merged to main. You are
starting M0·B of the MZ/MV migration. Read docs/MZ_MV_MIGRATION_ROADMAP.md
(Locked decisions, Orchestration, M0·B), docs/mig-0-spec.md, and skim
docs/mz-mv-parity-matrix.md. Your task: hand-authored MV + MZ fixture
projects and the decision log, per M0·B. No RTP assets — everything
self-made. When done: git ritual (branch mig-0b), stage-log entry, then
print the M0·C kick-off prompt verbatim from the roadmap.
```

### M0·C — Fable contract gate
- Fable 5 reviews matrix + fixtures + decision log for: phase assignments sane, schema
  additions additive, sandbox approach safe, report language kid-friendly. Amendments made
  directly. Tag `mig-0`.

```
>>> Switch model to: Claude Fable 5 (design gate)
Phase M0 Steps A+B are COMPLETE and merged. You are the design gate for the
MZ/MV migration contract. Read docs/MZ_MV_MIGRATION_ROADMAP.md, then review
docs/mz-mv-parity-matrix.md, tests/fixtures/{mv,mz}-project/, and the
decision log in docs/mig-0-spec.md. Check: phase assignments, additive-only
schema stance, formula-sandbox safety, report tone (kids/beginners). Apply
amendments yourself, sign the decision log, git ritual (branch mig-0c),
tag mig-0, push tag. Then print the M1·A kick-off prompt verbatim from the
roadmap.
```

---

## Phase M1 — Importer core: an MZ/MV project becomes an Atlas project

*The end of this phase: both fixtures import, boot, and playtest — with `mzTodo` markers
standing in for future engine features.* — **Opus 4.8 (Extra High)**

### M1·A — Project reader & database conversion
- `src/editor/importers/mz/` module family: folder/zip intake (Tauri FS dialog + browser
  drag-drop via Asset Dropbox), format sniffing (MV vs MZ), asset decryption.
- Convert: System (switches/variables/terms/types/options), Actors, Classes (exp curves,
  learnings), Skills, Items, Weapons, Armors, Enemies (drops, actions), Troops (+pages),
  States, CommonEvents → Atlas DB records per the matrix. Formula strings stored verbatim
  in the (M0-decided) field for M3 to consume.
- Vitest: fixture DB round-trips, decryption unit tests.

```
>>> Switch model to: Opus 4.8 — Extra High
Phase M0 is COMPLETE (tag mig-0). You are starting M1·A of the MZ/MV
migration: the importer core's project reader + database conversion. Read
docs/MZ_MV_MIGRATION_ROADMAP.md (Locked decisions, Orchestration, phase M1),
docs/mz-mv-parity-matrix.md (DB tables), and the decision log in
docs/mig-0-spec.md. Create docs/mig-1-spec.md with a stage log. Build
src/editor/importers/mz/ per M1·A against tests/fixtures/{mv,mz}-project/.
When done: vitest green, git ritual (branch mig-1a), stage-log entry, then
print the M1·B kick-off prompt verbatim from the roadmap.
```

### M1·B — Tilesets & maps
- A1–A5 autotiles → Atlas autotile registry entries (47-pattern → Atlas pattern set);
  B–E sheets through the existing 48px slicer; flag bits → tile-flags + terrain kinds;
  ladder/bush/counter/damage-floor mapped per matrix.
- Maps: layers → `layersAdv` composite, MapInfos tree → Atlas map list order/nesting,
  encounters (+region-scoped), parallax settings, BGM/BGS autoplay, notes preserved into a
  map-notes field.
- Vitest on conversion math; a Playwright boot of an imported fixture map.

```
>>> Switch model to: Opus 4.8 — Extra High
M1·A (DB conversion) is COMPLETE and merged. You are starting M1·B of the
MZ/MV migration: tileset + map conversion. Read
docs/MZ_MV_MIGRATION_ROADMAP.md (M1·B), docs/mig-1-spec.md, and the tileset/
map tables in docs/mz-mv-parity-matrix.md. Key existing code:
src/shared/autotile*.ts, tile-flags.ts, layer-composite.ts, and the 48px
slicer in src/editor/importers/. When done: tests green (0 e2e failures
baseline), git ritual (branch mig-1b), stage-log entry, then print the M1·C
kick-off prompt verbatim from the roadmap.
```

### M1·C — Events & the translation table
- Event conversion: pages (conditions/graphics/triggers/priority/through), move routes,
  and `translate-commands.ts` — every MZ command code either translates to Atlas commands
  (all ~35 existing ones per the matrix) or becomes `mzTodo` (schema addition: optional
  command type; friendly render in event editor; engine no-op).
- Nested structure fidelity: branches/loops/labels flattened per matrix rules; Script
  commands per decision log.
- Vitest: table-driven translation tests (one per MZ code — the table IS the test spec).

```
>>> Switch model to: Opus 4.8 — Extra High
M1·B (tilesets/maps) is COMPLETE and merged. You are starting M1·C of the
MZ/MV migration: event conversion + the command translation table (the
spine of the whole migration — see "The translation table is the spine" in
docs/MZ_MV_MIGRATION_ROADMAP.md). Read that roadmap section, M1·C, the
event-command tables in docs/mz-mv-parity-matrix.md, and
src/editor/event-editor/command-defs.ts + src/shared/schema.ts (AnyCommand)
for the target vocabulary. mzTodo design is in the mig-0 decision log. When
done: table-driven vitest per MZ code, git ritual (branch mig-1c),
stage-log entry, then print the M1·D kick-off prompt verbatim.
```

### M1·D — Import report + wizard integration
- Wizard flow: pick folder/zip → detect MV/MZ → progress → **plain-language report**
  (what came along, what didn't, what to do next — kid-friendly per locked decision 6),
  report saved into the project so it can be reopened.
- e2e: both fixtures import → editor opens → playtest boots → battle runs → save/load.
- Patch notes + help entry ("Import from RPG Maker"). Tag `mig-1`.

```
>>> Switch model to: Opus 4.8 — Extra High
M1·C (event translation) is COMPLETE and merged. You are starting M1·D of
the MZ/MV migration: the import wizard UX + report + end-to-end proof. Read
docs/MZ_MV_MIGRATION_ROADMAP.md (M1·D + locked decision 6 — report tone is
for kids/beginners), docs/mig-1-spec.md, and the existing wizard in
src/editor/importers/import-wizard.ts. Playwright e2e: import both
fixtures, boot, playtest, battle, save/load. Patch-notes + help + shims
version bumps. When done: git ritual (branch mig-1d), tag mig-1, stage-log
entry, then print the M2·A kick-off prompt verbatim.
```

---

## Phase M2 — Engine parity I: interpreter, messages, actors

*Every step here ships engine features AND flips their translation-table entries.* —
**Opus 4.8 (Extra High)**

### M2·A — Presentation: pictures, tint, timer, scroll, balloons
- New commands (schema + interpreter + editor forms + engine render): Show/Move/Rotate/
  Tint/Erase Picture (ids, easing, blend, pin-to-map option), Tint Screen, Timer
  (start/stop + HUD + expiry branch/common event), Scroll Map, Balloon Icon, Scrolling
  Text. Wire into save/load state.
- Flip table entries; add vitest + a pixel e2e for pictures over the map scene.

```
>>> Switch model to: Opus 4.8 — Extra High
Phase M1 is COMPLETE (tag mig-1): MZ/MV projects import with mzTodo
placeholders. You are starting M2·A: pictures/tint/timer/scroll/balloons/
scrolling-text as real engine features. Read docs/MZ_MV_MIGRATION_ROADMAP.md
(phase M2 intro + M2·A — note: every feature step ALSO flips its
translate-commands.ts entries from mzTodo to real translations), the
matching matrix rows, and src/engine/interpreter/ +
src/engine/interpreter/commands/presentation.ts for the house pattern.
Create docs/mig-2-spec.md with a stage log. Schema additions optional-only.
When done: tests green, patch notes, git ritual (branch mig-2a), stage-log,
then print the M2·B kick-off prompt verbatim.
```

### M2·B — Message system parity
- Escape-code parity per matrix (\V \N \P \G \C \I \{ \} \$ \. \| \! \> \< \^ and MZ
  extras), message position/background options, Input Number, Select Item, name-input
  scene. Verify/extend name-box support.
- Flip table entries; vitest for the escape-code renderer.

```
>>> Switch model to: Opus 4.8 — Extra High
M2·A (presentation commands) is COMPLETE and merged. You are starting M2·B:
message-system parity (escape codes, input number, select item, name-input
scene, message options). Read docs/MZ_MV_MIGRATION_ROADMAP.md (M2·B), the
message rows of docs/mz-mv-parity-matrix.md, docs/mig-2-spec.md, and
src/engine/message.ts. Flip the translate-commands.ts entries you unlock.
When done: tests green, patch notes, git ritual (branch mig-2b), stage-log,
then print the M2·C kick-off prompt verbatim.
```

### M2·C — Actor/party command family + flow control
- Change: level/exp/params/skills (learn/forget)/equipment/name/class/nickname/profile;
  Change State + Recover All outside battle; formation; menu/save-access toggles; window
  color; Get Location Info; Labels + Jump-to-Label (if matrix marked them for real support
  rather than flatten).
- Flip table entries. Tag `mig-2`.

```
>>> Switch model to: Opus 4.8 — Extra High
M2·B (messages) is COMPLETE and merged. You are starting M2·C: the
change-actor-data command family, flow control, and system toggles. Read
docs/MZ_MV_MIGRATION_ROADMAP.md (M2·C), matching matrix rows,
docs/mig-2-spec.md, and the interpreter command modules under
src/engine/interpreter/commands/. Flip translate-commands.ts entries. When
done: tests green, patch notes, git ritual (branch mig-2c), tag mig-2,
stage-log, then print the M3·A kick-off prompt verbatim.
```

---

## Phase M3 — Engine parity II: battle math & traits

*The hard core. MZ-formula-compatible combat without breaking Atlas-native projects.* —
**Opus 4.8 (Ultracode)**

### M3·A — Damage-formula evaluator
- Sandboxed evaluator for `a`/`b`/`v[n]` formula strings (approach fixed in the mig-0
  decision log), variance/crit/guard order matching MZ, hit/evade/crit chances from
  traits, element rates with Atlas's element keys. Atlas skills gain an optional
  `formula` field; structured heal/damage skills keep working untouched.
- Heavy vitest: MZ-reference vectors (hand-computed) must match.

```
>>> Switch model to: Opus 4.8 — Ultracode
Phase M2 is COMPLETE (tag mig-2). You are starting M3·A — the hardest step:
the sandboxed damage-formula evaluator with MZ-compatible combat math. Read
docs/MZ_MV_MIGRATION_ROADMAP.md (phase M3), the sandbox decision in
docs/mig-0-spec.md, formula/element rows in docs/mz-mv-parity-matrix.md,
and src/engine/scenes/battle.ts. Create docs/mig-3-spec.md with a stage
log. Optional schema fields only; Atlas-native skills must be untouched
(0 e2e regressions). Hand-computed MZ reference vectors in vitest. When
done: git ritual (branch mig-3a), stage-log, then print the M3·B kick-off
prompt verbatim.
```

### M3·B — Trait & effect code coverage
- Implement every matrix `+` trait/effect code: params/ex-params/sp-params, attack
  element/states/speed/times, skill types add/seal, equip lock/seal/fix, party abilities,
  state resist, TP (per M0 decision), state timing/auto-removal/restrictions/damage
  removal. Editor UI in the existing traits editors.
- Flip table entries (item/skill effects).

```
>>> Switch model to: Opus 4.8 — Ultracode
M3·A (formula evaluator) is COMPLETE and merged. You are starting M3·B:
full trait & effect code coverage per the matrix. Read
docs/MZ_MV_MIGRATION_ROADMAP.md (M3·B), trait/effect rows in
docs/mz-mv-parity-matrix.md, docs/mig-3-spec.md, src/shared/schema.ts
(Trait), and src/editor/database/battler-tabs.ts for the editor surface.
Flip the effect entries in translate-commands.ts and the DB converters.
When done: tests green, patch notes, git ritual (branch mig-3b), stage-log,
then print the M3·C kick-off prompt verbatim.
```

### M3·C — Troop & enemy battle parity
- Enemy action ratings + condition types per matrix; troop battle-event spans
  (battle/turn/moment) and remaining page conditions; preemptive/surprise; escape
  formula; battle-processing branches (win/escape/lose) verified against imports.
- Full-battle e2e on both fixtures. Tag `mig-3`.

```
>>> Switch model to: Opus 4.8 — Ultracode
M3·B (traits/effects) is COMPLETE and merged. You are starting M3·C: troop
and enemy battle parity (action ratings, battle-event spans,
preemptive/surprise, escape). Read docs/MZ_MV_MIGRATION_ROADMAP.md (M3·C),
matching matrix rows, docs/mig-3-spec.md, and
src/engine/scenes/battle.ts + the troop schema. Full-battle Playwright e2e
on both fixtures. When done: tests green, patch notes, git ritual (branch
mig-3c), tag mig-3, stage-log, then print the M4·A kick-off prompt
verbatim.
```

---

## Phase M4 — Engine parity III: map features & audio-visual

**Opus 4.8 (Extra High)**

### M4·A — Remaining map-feature gaps
- From the matrix: terrain-tag gameplay hooks, counter tiles, bush/ladder behavior,
  damage floors, region-scoped encounters (verify vs existing zones), looping maps (if
  marked `+`), per-map battlebacks, any event-page condition gaps. Flip table entries.

```
>>> Switch model to: Opus 4.8 — Extra High
Phase M3 is COMPLETE (tag mig-3). You are starting M4·A: the remaining
map-feature gaps from the matrix (terrain tags, counters, bush/ladder,
damage floors, region encounters, looping maps, battlebacks — exact list is
whatever the matrix assigned to M4). Read docs/MZ_MV_MIGRATION_ROADMAP.md
(phase M4), those matrix rows, and src/engine/scenes/map-runtime.ts +
src/shared/tile-flags.ts. Create docs/mig-4-spec.md with a stage log. Flip
translate/convert entries. When done: tests green, patch notes, git ritual
(branch mig-4a), stage-log, then print the M4·B kick-off prompt verbatim.
```

### M4·B — Animations & audio conversion
- MV sheet-based `Animations.json` → Atlas `BattleAnimation` converter (frames, timings,
  flashes, SEs). MZ Effekseer entries → decision-log fallback + report line.
- Audio semantics: BGM/BGS/ME/SE channel behavior, pitch/pan application, fadeout
  commands, "ME interrupts BGM then resumes" if matrix marked it. Audio files convert
  through the existing audio pipeline. Tag `mig-4`.

```
>>> Switch model to: Opus 4.8 — Extra High
M4·A (map features) is COMPLETE and merged. You are starting M4·B:
MV animation-sheet conversion + audio semantics parity. Read
docs/MZ_MV_MIGRATION_ROADMAP.md (M4·B), animation/audio matrix rows, the
Effekseer fallback decision in docs/mig-0-spec.md, docs/mig-4-spec.md, and
src/shared/anim-player.ts + audio-deck.ts. When done: tests green, patch
notes, git ritual (branch mig-4b), tag mig-4, stage-log, then print the
M5·A kick-off prompt verbatim.
```

---

## Phase M5 — Plugins, scripts & the honest no-list

*JS plugins cannot auto-convert. What we owe users is clarity, not magic.* —
**Opus 4.8 (High)**

### M5·A — Plugin manifest & guidance
- Parse `js/plugins.js` → report section: each plugin, its params, ON/OFF, and a guidance
  table for the top ~20 community plugins ("Atlas has this built in: → Quests panel" /
  "not supported — here's the closest thing"). Guidance data lives in a maintainable
  JSON/TS table, not prose in code.

```
>>> Switch model to: Opus 4.8 — High
Phase M4 is COMPLETE (tag mig-4). You are starting M5·A: the plugins.js
manifest parser + guidance table in the import report. Read
docs/MZ_MV_MIGRATION_ROADMAP.md (phase M5 — tone: honest, kid-friendly, no
magic promises), docs/mig-0-spec.md decisions, and the report UI from M1·D.
Create docs/mig-5-spec.md with a stage log. When done: tests green, patch
notes, git ritual (branch mig-5a), stage-log, then print the M5·B kick-off
prompt verbatim.
```

### M5·B — Script-command adapter
- Per the mig-0 decision: minimal read adapter (`$gameVariables.value`,
  `$gameSwitches.value`, `$gameParty` basics) so the most common imported Script snippets
  and Conditional-Branch-Script conditions run; everything beyond scope → `mzTodo` +
  report. Sandbox rules identical to the Atlas `script` command. Tag `mig-5`.

```
>>> Switch model to: Opus 4.8 — High
M5·A (plugin guidance) is COMPLETE and merged. You are starting M5·B: the
minimal Script-command compatibility adapter (read-only $gameVariables/
$gameSwitches/$gameParty per the mig-0 decision log — nothing more). Read
docs/MZ_MV_MIGRATION_ROADMAP.md (M5·B), docs/mig-5-spec.md, and
src/engine/script-api.ts for the sandbox pattern. When done: tests green,
patch notes, git ritual (branch mig-5b), tag mig-5, stage-log, then print
the M6·A kick-off prompt verbatim.
```

---

## Phase M6 — Wizard polish, docs, QA, release

**Opus 4.8 (High)** · release gate by **Fable 5**

### M6·A — UX polish + "Coming from RPG Maker" docs
- Wizard: progress states, re-import flow (project improved since M1? re-run picks up
  flipped table entries), report export as text. Docs-site + wiki guide "Coming from RPG
  Maker MZ/MV" (rerun `scripts/build-docs-site.mjs`), README mention, help.ts section,
  patch notes, version bumps.

```
>>> Switch model to: Opus 4.8 — High
Phase M5 is COMPLETE (tag mig-5). You are starting M6·A: wizard UX polish +
the "Coming from RPG Maker MZ/MV" documentation. Read
docs/MZ_MV_MIGRATION_ROADMAP.md (phase M6 + locked decision 6), and the
wiki/docs-site convention (rerun scripts/build-docs-site.mjs after wiki
edits). Create docs/mig-6-spec.md with a stage log. When done: tests green,
git ritual (branch mig-6a), stage-log, then print the M6·B kick-off prompt
verbatim.
```

### M6·B — Round-trip QA & scale test
- Import both fixtures + a synthetic "community-scale" project (script-generated: 50+
  maps, 500+ events, full DB) — e2e import → edit → playtest → battle → save/load; import
  time budget on the scale project; bug bash on findings; report copy review against the
  audience rule.

```
>>> Switch model to: Opus 4.8 — High
M6·A (polish + docs) is COMPLETE and merged. You are starting M6·B:
round-trip QA — both fixtures plus a script-generated community-scale
project (50+ maps, 500+ events, full DB; generator lives in scripts/). Full
e2e chain, import-time perf budget, bug bash, report-copy review. Read
docs/MZ_MV_MIGRATION_ROADMAP.md (M6·B) and docs/mig-6-spec.md. When done:
tests green, git ritual (branch mig-6b), stage-log, then print the M6·C
kick-off prompt verbatim.
```

### M6·C — Fable release gate
- Fable 5: full review pass (code-review, matrix vs shipped reality — every `+` row
  landed or consciously re-scoped with a report line), release notes, tag `mig-6` +
  version release (proposed **1.1.0** — importer + parity features are additive).

```
>>> Switch model to: Claude Fable 5 (release gate)
M6·B (QA) is COMPLETE and merged. You are the release gate for the MZ/MV
migration ("Project Compass"). Read docs/MZ_MV_MIGRATION_ROADMAP.md, audit
docs/mz-mv-parity-matrix.md against what shipped (every "+" row landed or
consciously re-scoped with a report line), run /code-review on anything
that concerns you, review release notes + patch notes, then: version bump
to 1.1.0, git ritual (branch mig-6c), tags mig-6 and v1.1.0, push tags.
Update the project memory file for the migration with the final state.
Announce completion to the user with a summary of what an MZ/MV user now
gets.
```

---

## Risk register

| Risk | Mitigation |
|---|---|
| MZ battle math subtly differs from Atlas-native combat | Formula path is additive/opt-in; MZ reference vectors in vitest; Atlas-native goldens must stay 0-fail |
| Autotile 47-pattern → Atlas pattern mismatch on edge cases | M1·B conversion math is pure + vitest-covered; fixture maps include the ugly cases |
| Scope creep via "just one more plugin shim" | M5 guidance table is data, not code; anything beyond the mig-0 adapter scope is a report line |
| Context bloat across 17 steps | One step = one conversation; hand-off prompts embedded here; specs carry state |
| Schema drift breaking 1.0 projects | Optional fields only; FORMAT_VERSION bump requires Fable gate approval |
| Legal (RTP assets, decryption) | Locked decision 5; fixtures self-made; docs frame import as "your own project" |
