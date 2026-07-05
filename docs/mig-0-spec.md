# Phase M0 Spec — Parity audit & conversion contract ("Project Compass")

**Status:** IN PROGRESS — Step A (parity matrix) landed 2026-07-04. Stage log accumulates
below (phase-N-spec style) as steps land. Next: M0·B (fixtures + decision log), then M0·C
(Fable contract gate, tags `mig-0`).
**Authored:** 2026-07-04 by Claude Opus 4.8 (High), from the M0 section of
`docs/MZ_MV_MIGRATION_ROADMAP.md`.
**Branch (per step):** `mig-0a`, `mig-0b`, `mig-0c` — each merges to `main` (locked
decision 2). Phase exit (M0·C) tags `mig-0`.
**Model:** Opus 4.8 for A+B; Fable 5 for the C gate. Sonnet is banned from RPGAtlas.

## Objective

*Nothing ships to users in M0.* Produce a **signed conversion contract** so every later phase
is built against a document, not vibes:

1. **M0·A** — `docs/mz-mv-parity-matrix.md`: exhaustive field-by-field / code-by-code mapping
   of **every** MZ/MV data structure to `=` (maps to an existing Atlas thing) / `+ Mn` (new
   feature, phase assigned) / `−` (skip with report line). Every `+` names its phase — this is
   where M2–M4 scope becomes final.
2. **M0·B** — hand-authored MV + MZ **fixture projects** (`tests/fixtures/{mv,mz}-project/`,
   no RTP — self-made JSON + tiny CC0/self-drawn PNG/OGG, one encrypted sample each) and the
   **decision log** (formula-evaluator sandbox strategy, FORMAT_VERSION stance, `mzTodo`
   command shape, Effekseer fallback, Script-adapter scope).
3. **M0·C** — Fable 5 reviews matrix + fixtures + decision log (phase assignments sane, schema
   additions additive, sandbox safe, report language kid-friendly), amends directly, tags
   `mig-0`.

## Locked decisions inherited from the roadmap

1. Opus 4.8 does the work; Fable gates M0·C and M6·C; **Sonnet banned**.
2. Git ritual after every step: branch `mig-<phase><step>` → tests green → commit → push →
   merge to `main` → push `main` → delete branch. Phase exit tags `mig-N`.
3. Hand-off: each step ends by printing the next step's kick-off prompt verbatim.
4. Format: importer writes FORMAT_VERSION 2; new engine features are **optional schema fields
   only**. A genuinely breaking need → FORMAT_VERSION 3 proposal at the Fable gate (not
   casual). Plugin API frozen for 1.x.
5. Legal: no RTP/DLC assets ever; fixtures self-made; decryption uses the user's own
   `System.json` key — "import your own project" is the only supported flow.
6. Audience: import reports, wizard text, errors are for kids / first-time devs — "3 things
   couldn't come along, here's what and what to do instead", never a stack trace.

## The translation table is the spine

One module — `src/editor/importers/mz/translate-commands.ts` — owns MZ-command-code →
Atlas-command mapping. Unmappable → `mzTodo` placeholder (raw code + params preserved,
friendly editor render, engine no-op) + report line. Phases M2–M4 ship engine features **and
flip the matching table entries from `mzTodo` to real** in the same step; re-importing picks
up the improvement. §8 of the matrix is that table's spec; the M1·C vitest is table-driven,
one assertion per MZ code.

## Decision log

*(Populated in M0·B; signed by Fable in M0·C. Placeholders below record the questions M0·B
must answer and the matrix's provisional expectations so M1+ isn't blocked.)*

- **Formula-evaluator sandbox** (M3·A) — *TBD in M0·B.* Provisional: a restricted expression
  evaluator over `a`/`b`/`v[n]`/`Math`, **no `Function`/`eval` on arbitrary strings**,
  consistent with the existing `script` command's sandbox policy (`src/engine/script-api.ts`).
  Formula strings stored verbatim in a new optional `Skill.formula` field at import.
- **FORMAT_VERSION stance** — remains **2**. All migration features are additive optional
  fields (`Skill.formula`, `Enemy.drops[]`, `mzTodo` command, TP fields, tile-behavior flags,
  etc.). No breaking need identified in M0·A → no FORMAT_VERSION 3 proposed. *Confirm at gate.*
- **`mzTodo` command shape** — provisional `{ t: "mzTodo", code: number, params: any[],
  label: string }`; additive to `AnyCommand`, friendly yellow-note render in the event editor,
  engine no-op, one report line. *Finalize in M0·B.*
- **Effekseer stance** (M4·B) — skip the `.efkefc` particle file (`−`), auto-fallback to the
  nearest Atlas `BattleAnimation` by name/element heuristic, emit a report line. *Confirm.*
- **Script-command adapter scope** (M5·B) — minimal **read-only** shim:
  `$gameSwitches.value(n)`, `$gameVariables.value(n)`, `$gameParty` basics; everything beyond
  → `mzTodo` + report. Sandbox rules identical to the Atlas `script` command. *Final call at
  gate.*
- **Actor/weapon/armor/enemy/state traits → Atlas** — Atlas carries `Trait[]` on `ClassDef`
  only. M0·A provisionally **merges** non-class traits onto the effective battler at import
  with a report line; M0·B decides whether to (a) merge onto the actor's class, (b) synthesize
  a per-actor hidden class, or (c) report-only for actor-level traits. *Decide in M0·B.*
- **`luk` param** — **locked skip** (`−`). No Atlas home; dropped from class curves, equip
  params, enemy stats, and param traits with one aggregated report line.
- **MapInfos nesting → Atlas folders** — MZ maps nest under parent *maps*; Atlas nests maps
  under `MapFolder`s. Importer synthesizes a folder per parent map (or maps parent→`folderId`).
  *Finalize the exact scheme in M1·B; recorded here for the gate.*

---

## Stage log

### M0·A — The parity matrix — ✅ 2026-07-04 (branch `mig-0a`)

**Delivered:** `docs/mz-mv-parity-matrix.md` — the exhaustive MZ/MV → RPGAtlas conversion
contract. 16 sections:

0. MV vs MZ top-level deltas (tile size, animations, plugin-command format, encryption
   extensions, autosave opts, side-view).
1. `System.json` field-by-field (title/currency/switches/variables/party/types/terms/window
   tone/vehicles/music/sounds/title/start/opts/advanced).
2. Database record shapes: Actors, Classes, Skills, Items, Weapons, Armors, Enemies, Troops,
   States, Animations(→§10), Tilesets(→§11/§12b), CommonEvents, MapInfos, Map### (+ map
   fields + event-page conditions/images/triggers).
5. Trait codes 11–64 (each → `Trait` type or `+ M3·B`; `luk` locked-skip).
6. Item/skill effect codes 11–44 (→ existing fields or `+ M3·B`/`M3·A`).
7. Damage object + `formula` string (→ `+ M3·A` evaluator, stored verbatim in M1).
8. Event command codes 101–657 — **the translation-table spec**, grouped
   (messages/flow/party/system/movement/screen/pictures/audio/scene/actor-data/enemy/script),
   each code `=`/`+ Mn`/`−`, continuation codes folded.
9. Move-route codes 1–45 → `CmdMove.steps` vocabulary.
10. Animations: MV sheet converter (`+ M4·B`) vs MZ Effekseer fallback (`≈ + M4·B`).
11. Tileset flag bits: passage (≈ whole-tile), Ladder/Bush/Counter/Damage-Floor/Terrain-Tag
    (`+ M4·A`), ★-priority, region 1–63 clamp.
12. Vehicle/follower semantics diff; A1–A5 autotile → `Autotile.kind` (blob47/a1/a3/a4 + plain).
13. Message escape codes (current Atlas_TextCodes support `=`; full parity `+ M2·B`).
14. Plugins/notetags/script (`+ M5·A`/`M5·B`, honest `−` for `.js`).
15. Assets & decryption (XOR-with-System-key, `.rpgmvp`/`.png_` etc.; movies/Effekseer `−`).
16. **Phase assignment roll-up** — every `+` row bucketed by phase (M2·A…M5·B) + the locked
    `−` skip list. This roll-up is the scope contract graded at M6·C.

**Grounding:** matrix written against `main` @ `6cb48a9` — verified the Atlas vocabulary in
`src/shared/schema.ts` (`Project`/`AnyCommand` [33 commands]/`Trait`), `command-defs.ts` (built-in
commands, move-route steps, text-code legend), `tile-flags.ts` + `map-runtime.ts` (`passOv`
0/1/2/3 passability model — **no native ladder/bush/counter/damage/terrain-tag today**, hence
those are the M4·A gaps), `autotile-registry.ts` (`kind` blob47/edge16/corner16/a1/a3/a4),
`sheet-math.ts` (48px slicer). MZ/MV side: MV 1.6 / MZ 1.x `rmm[vz]_*` data formats.

**Key scoping calls (for the gate to sanction):**
- `luk` is a **locked skip**, not a feature — Atlas has 7 params, MZ has 8.
- Damage **formula strings** are the M3·A flagship; stored verbatim in a new optional
  `Skill.formula` in M1·A so nothing is lost before the evaluator exists.
- Labels/Jump (118/119) get **real support** in M2·C (not flattened) — recorded as such.
- Actor-level traits merge-onto-battler provisionally; final scheme is an M0·B decision.
- No FORMAT_VERSION 3 needed — every addition is an optional field (decision-log stance).

**No engine/user-visible change** in M0·A (docs only) → no patch-notes / version bump per the
working agreement. vitest/Playwright untouched; typecheck n/a (no source edits).

**Next:** M0·B — hand-authored MV + MZ fixture projects + the decision log.
