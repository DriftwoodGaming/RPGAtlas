# Phase M0 Spec — Parity audit & conversion contract ("Project Compass")

**Status:** ✅ **COMPLETE — contract SIGNED** at the M0·C Fable gate 2026-07-04 (tag
`mig-0`). Decision log D1–D11 signed (D1 with two tightening amendments, D11 added at the
gate); matrix §11 bit correction (D10) applied. Phases M1–M5 build against this contract;
M6·C grades against it.
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

*Finalized in M0·B (2026-07-04). Each entry is a call M1+ builds against; the **M0·C Fable
gate signs (or amends) this list**. "Signed:" lines are filled at the gate. Decisions are
grounded against `main` @ `b30d5bc` and the fixtures in `tests/fixtures/{mv,mz}-project/`.*

### D1 — Formula-evaluator sandbox (M3·A)
**Decision:** a **purpose-built restricted-AST evaluator**, *not* `new Function`/`eval`. A tiny
recursive-descent parser accepts only: numeric/parenthesized expressions; `+ - * / %`, unary
minus, comparison + ternary operators; a **whitelisted** `Math.{min,max,floor,ceil,round,abs,
pow,sqrt,randomInt}`; and the identifiers `a`, `b`, `v` bound to **read-only facades**
(`a`/`b` → battler stat getters `atk/def/mat/mdf/agi/mhp/mmp/hp/mp/level`; `v[n]` → game
variables). No assignment, no statements, no member access outside the facade whitelist, no
function definitions. Unknown identifier/property → **reject at import, keep as `mzTodo` +
report** (never silently zero).
**Why stricter than the `script` command:** `src/engine/script-api.ts` hands plugins/`script`
a curated `game` surface via `new Function(...)`, trusting *project-author* code. Damage
formulas are bulk data lifted from a **foreign** project — executing them as code is a
different trust boundary, so formulas get parsed, never executed. This is consistent with the
`script`-command *policy* (curated read-only surface, no ambient globals) while being tighter
on the mechanism.
**Storage:** formula string stored **verbatim** at import in a new optional `formula?: string`
on the damage-bearing DB records (`Skill`, `Item`). Structured `power`/`hp`/`mp` stay as the
fallback for simple cases; `formula` wins when present (M3·A). Fixtures: `Skills[1/2/3].damage.
formula`, `Items[1/2].damage.formula`.
**Gate amendments (M0·C):** (a) `Math.randomInt` — and any randomness the evaluator ever
grows — must route through the engine's seedable RNG (`src/engine/util.ts` `rnd`/`rndf`,
`window.AtlasRng`), not raw `Math.random`, so imported combat stays reproducible under
`?rngseed=` and the M3·A reference-vector vitest is deterministic. (b) The parser enforces
input limits (formula length ≤ 512 chars, nesting depth ≤ 32) — over-limit → the same
reject path (`mzTodo` + report), so a pathological formula can't hang or blow the stack
during import.
**Signed:** ✅ Claude Fable 5, 2026-07-04 (M0·C) — approved with amendments (a)+(b) above.

### D2 — FORMAT_VERSION stance
**Decision:** stays **2**. Verified `RA.FORMAT_VERSION = 2` (`js/data.js:390`). Every migration
addition is an **optional** field on an existing type (`Skill.formula`/`Item.formula`,
`Enemy.drops[]`, TP fields, tile-behavior flags, the `mzTodo` command). Old projects load
unchanged (the migration guard only stamps, never rewrites). **No FORMAT_VERSION 3 proposed.**
**Signed:** ✅ Claude Fable 5, 2026-07-04 (M0·C) — verified `RA.FORMAT_VERSION = 2` at
`js/data.js:390`; approved as written.

### D3 — `mzTodo` command shape
**Decision (final):** `{ t: "mzTodo", code: number, params: unknown[], label: string }`
— additive to `AnyCommand` (confirmed discriminant is `t`, `schema.ts:496`). `code`+`params`
preserve the **raw MZ command** so re-import after a phase ships upgrades it in place; `label`
is the kid-friendly summary the editor shows ("📌 Show Picture — coming in an update"). Renders
as a yellow note node in the event editor, **no-ops in the engine**, emits **one** report line.
Nested openers that become `mzTodo` keep their child list translated where possible (the
placeholder wraps only the unmappable command, not the branch body).
**Signed:** ✅ Claude Fable 5, 2026-07-04 (M0·C) — approved; the `label` copy pattern
("📌 Show Picture — coming in an update") is the D11 house style. Discriminant `t` confirmed
(`schema.ts:496`).

### D4 — Effekseer stance (M4·B)
**Decision:** the `.efkefc` particle file is a locked skip (`−`, proprietary binary). MZ
animations **auto-fallback** to the nearest Atlas `BattleAnimation` by a name/element heuristic
and emit a report line ("Fire → used Atlas's Flame animation"); `animationId` refs stay intact
so they resolve to the fallback. MV **sheet** animations convert for real in M4·B. Fixtures
encode both: MZ `Animations.json` = `effectName` (Effekseer), MV = `frames[][]` + `timings`.
**Signed:** ✅ Claude Fable 5, 2026-07-04 (M0·C) — approved; honesty-over-magic, and the
fallback keeps `animationId` refs playable rather than silent.

### D5 — Script-command adapter scope (M5·B)
**Decision:** a minimal **read-only** shim exposing exactly `$gameSwitches.value(n)`,
`$gameVariables.value(n)`, and `$gameParty` basics (`size()`, `gold()`, `members()` ids,
`hasItem(item)`). It runs under the **same sandbox as the Atlas `script` command** (curated
surface, no ambient globals). Anything referencing other globals, assignment to game state via
script, or `$game*` beyond the shim → `mzTodo` + report. Conditional-Branch "Script" conditions
use the same evaluator. Fixtures: `CommonEvents[2]` (`$gameVariables.setValue` — a **write**,
so it lands as `mzTodo` + report), `Map002` `Ambush` 355/655 (read of `$gameSwitches` +
write), move-route step 45 (script).
**Note:** the shim is **read-only by design** — the fixtures deliberately include *writes*
(`setValue`) to prove the "beyond scope → mzTodo + report" path, not to imply writes convert.
**Signed:** ✅ Claude Fable 5, 2026-07-04 (M0·C) — approved as the **final** M5·B scope
(read-only shim confirmed; no write surface will be added without a new gate decision).

### D6 — Non-class trait merge strategy
**Decision:** **(a) merge onto the actor's effective `ClassDef` at import**, with a report
line per merged source. Atlas carries `Trait[]` on `ClassDef` only; actor/weapon/armor/enemy/
state traits are folded onto the battler's effective class (weapon/armor traits are applied
while equipped in MZ, but since Atlas has no per-equip trait carrier yet, M1 merges the
directly-representable codes — 11/13/21/43/51/52 — onto the class and `mzTodo`-notes the rest
for M3·B). Rejected (b) per-actor synthetic hidden class (schema churn, confuses the DB editor)
and (c) report-only (loses gameplay-affecting element/state rates the engine already supports).
Enemies keep their own effective-battler merge (enemies have no class). Fixtures: `Actors[1]`
carries an actor-level Element Rate; `Weapons[1]`/`Armors[1]`/`States[1]`/`Enemies[1]` carry
trait codes across the `=`/`+` split.
**Signed:** ✅ Claude Fable 5, 2026-07-04 (M0·C) — approved: (a) preserves gameplay the
engine already supports, avoids schema churn. The per-merged-source report line is required,
not optional — a kid should be able to see *why* their hero resists fire.

### D7 — `luk` param — locked skip
**Decision:** unchanged locked skip (`−`). MZ has 8 params `[mhp,mmp,atk,def,mat,mdf,agi,luk]`;
Atlas has 7 (no `luk`). Dropped from class curves, equip params, enemy stats, and param traits
(code 21 dataId 7) with **one aggregated** report line ("Luck isn't a stat in Atlas — N places
used it"). Fixtures seed `luk` in all four places.
**Signed:** ✅ Claude Fable 5, 2026-07-04 (M0·C) — approved; the aggregated single report
line is exactly right for the audience (one clear sentence, not N warnings).

### D8 — MapInfos nesting → Atlas folders
**Decision:** MZ maps nest under parent **maps**; Atlas nests maps under `MapFolder`s. The
importer synthesizes **one `MapFolder` per parent map that has children**, named after the
parent, and sets each child's `folderId` to it; the parent map itself stays a map (placed at
the folder's top). Root maps (`parentId 0`) go to the map-list root. Exact folder-id scheme
finalized in M1·B; recorded here for the gate. Fixture: Cave `parentId = 1` (Harbor).
**Signed:** ✅ Claude Fable 5, 2026-07-04 (M0·C) — approved; folder-id scheme delegated to
M1·B as noted.

### D9 — Encryption detection by extension (M1·A) *(new, from fixture authoring)*
**Decision:** the importer decides a file is encrypted by **extension** (`.rpgmvp`/`.rpgmvo`/
`.png_`/`.ogg_`), not by the `System.hasEncryptedImages/Audio` flags. Real projects can carry
mixed plain+encrypted assets, and the flags describe editor state, not per-file truth. The
flags + `encryptionKey` are still read (key is required to decrypt; a missing key on an
encrypted file → plain-language report). Symmetric scheme: skip the 16-byte fake header, XOR
the next 16 bytes with the 16-byte key. Fixtures ship plain assets + one encrypted `Sign`
picture to prove both paths.
**Signed:** ✅ Claude Fable 5, 2026-07-04 (M0·C) — approved; extension-based detection is
the robust call (flags describe editor state, not per-file truth).

### D10 — Tileset flag **bit values** correction *(new, for the gate to apply to the matrix)*
**Finding from fixture authoring:** matrix §11 lists the tile-behavior bits one position low.
The **real** RPG Maker (rmmv/rmmz `Game_Map`) values, which the fixtures use, are:

| Behavior | Matrix §11 (as written) | **Real RM value (fixture uses this)** |
|---|---|---|
| Star / above-player | `0x1000` | **`0x10`** |
| Ladder | `0x10` | **`0x20`** |
| Bush | `0x20` | **`0x40`** |
| Counter | `0x40` | **`0x80`** |
| Damage floor | `0x80` | **`0x100`** |
| Terrain tag | `0x0F00` (bits 8–11) | **`flag >> 12`** (bits 12–14, 0–7) |
| Passage (4-dir) | bits 0–3 | bits 0–3 ✓ (unchanged) |

**Recommendation:** amend matrix §11's bit column to the real values at the gate (M4·A reads
these). No scope change — the *behaviors* and their phase assignments are unaffected; only the
bit constants were off. `scripts/build-migration-fixtures.mjs → Tilesets()` documents the real
values inline.
**Signed:** ✅ Claude Fable 5, 2026-07-04 (M0·C) — **verified and applied.** Cross-checked
against the real rmmv/rmmz `Game_Map` constants (star `0x10`, ladder `0x20`, bush `0x40`,
counter `0x80`, damage floor `0x100`, terrain tag `flags >> 12`) and against the committed
fixture `Tilesets.json` bytes. Matrix §11 table + the §16 M4·A roll-up line amended directly.

### D11 — Import-report copy style *(added at the M0·C gate)*
**Decision:** the parity matrix's quoted report lines are **engineering shorthand**, not
shippable copy. Every user-facing report line (M1·D builds the report; M6·B reviews the copy)
follows the locked-decision-6 pattern — **what it was → what happened → what you can do**,
in plain words a ten-year-old can read:
- Name the thing by *its* name, not ours: "the Luck stat", "your Fire animation" — never
  codes, hex, field names, or "§11".
- One line per thing (aggregate repeats: "Luck appeared in 12 places — Atlas doesn't have a
  Luck stat, so those numbers were left out").
- Always end with a next step or a reassurance: "…you can pick a new animation in the
  Database tab" / "…your game still plays fine without it."
- Never a stack trace, never a warning tone for expected conversions. The report celebrates
  what *did* come along first, then lists the leftovers.
Example — matrix shorthand "region N exceeds Atlas's 63 → clamp + report" ships as:
"One map spot used region number 64 — Atlas regions go up to 63, so it became region 63.
You can repaint it in the map editor if that spot needs its own number."
**Signed:** ✅ Claude Fable 5, 2026-07-04 (M0·C) — authored at the gate.

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

### M0·B — Fixture projects + decision log — ✅ 2026-07-04 (branch `mig-0b`)

**Delivered:**
1. **`scripts/build-migration-fixtures.mjs`** — deterministic, idempotent generator (rerun ⇒
   byte-identical) that emits both fixture trees + placeholder/encrypted assets. It is the
   readable source of truth for the fixtures; the emitted files are committed so tests/CI never
   run it. Everything self-made (locked decision 5): no RTP, no DLC, no RM-exported data.
2. **`tests/fixtures/mv-project/`** (RPG Maker **MV** 1.6.x) and **`tests/fixtures/mz-project/`**
   (RPG Maker **MZ** 1.x) — the same micro-game "Cove Test" in both formats, so the importer's
   MV-vs-MZ delta handling is tested against a controlled diff. Each: `Game.{rpgproject,
   rmmzproject}` marker, full `data/*.json` (System, Actors, Classes, Skills, Items, Weapons,
   Armors, Enemies, Troops, States, Animations, Tilesets, CommonEvents, MapInfos, Map001,
   Map002), plain placeholder assets, **one encrypted `Sign` picture** (+ key in System.json),
   and `js/plugins.js`.
3. **`tests/fixtures/README.md`** — requirement→element map + the MV/MZ delta table + the list
   of deliberately-hard cases seeded for later phases.
4. **Decision log** (above) — D1–D10 finalized; D9 (encryption-by-extension) and D10 (tileset
   flag **bit-value** correction to the real RM constants) are new findings surfaced by
   authoring the fixtures, flagged for the gate.

**Every M0·B-required exercise present** (verified by a parse/shape check — all JSON valid,
map `data` length = `w·h·6`, tileset `flags` length 8192 with real behavior bits, class params
8×100, encrypted sample round-trips to a valid PNG magic): 2 maps + transfer · A1–A5 autotiles
with island/peninsula/edge ugly cases · Actors/Classes/Enemies/States as trait-carrying battler
kinds · a troop with turn + enemy-HP page conditions and a hidden member · common events ·
damage formulas · Show Picture (→ the encrypted asset) · a plugin entry + plugin command
(356 MV / 357 MZ) · the MV sheet-vs-MZ-Effekseer `Animations.json` quirk · encrypted-asset
sample with its key.

**MV vs MZ deltas encoded (§0):** marker file · Animations model · plugin command code ·
encryption extension · MZ-only System fields (`locale`/`tileSize`/`advanced`/`optAutosave`/
`optKeyItemsNumber`/`itemCategories`/`menuCommands`) · Show Text param count.

**No engine/user-visible change** (fixtures + docs + a build script only; nothing under `src/`
or `js/`). Not collected by any runner: `node --test` globs `tests/*.test.js`, vitest globs
`src/**` + `tests-unit/**`, Playwright `tests-e2e/**` — none match `tests/fixtures/**`, so the
443/59 baselines are untouched. No patch-notes / version bump per the working agreement.

**For the gate (M0·C):** sign D1–D10; apply the §11 bit-value amendment (D10) directly in
`docs/mz-mv-parity-matrix.md`; confirm formula-sandbox strictness (D1) and report tone.

**Next:** M0·C — Fable contract gate (tags `mig-0`).

### M0·C — Fable contract gate — ✅ 2026-07-04 (branch `mig-0c`, tag `mig-0`)

**Gate review (Claude Fable 5) — all four checks passed, contract SIGNED:**
1. **Phase assignments** — sane. §16 roll-up cross-checked against the roadmap's phase
   intents (Labels/Jump → real support in M2·C, enemy drops → M3·C, tile behaviors → M4·A,
   the honest `−` skip list). No re-bucketing.
2. **Additive-only schema** — holds. D2 verified against `js/data.js:390`
   (`RA.FORMAT_VERSION = 2`); `mzTodo` (D3), `Skill.formula`/`Item.formula`,
   `Enemy.drops[]` are all optional additions. No FORMAT_VERSION 3.
3. **Formula-sandbox safety (D1)** — approved **with two amendments**: (a) evaluator
   randomness routes through the engine's seedable RNG (`src/engine/util.ts` `rnd`/`rndf`,
   `window.AtlasRng`) for `?rngseed=` reproducibility + deterministic M3·A reference
   vectors; (b) parser input limits (512-char / depth-32) with over-limit falling into the
   existing reject path. The parse-never-execute stance is correctly *stricter* than the
   `script`-command trust boundary (`script-api.ts` `new Function` is for project-author
   code; imported formulas are foreign bulk data).
4. **Report tone** — D3's label copy is on-key; the matrix's shorthand report examples are
   not shippable as-is, so **D11** (new) locks the "what it was → what happened → what you
   can do" copy pattern for M1·D to build and M6·B to review.

**Verification performed:** all 15 fixture `data/*.json` per project parse; MZ `Map001`
`data.length = w·h·6`; `Tilesets.flags` length 8192 with the **real** RM behavior bits
(`0x10` star / `0x20` ladder / `0x40` bush / `0x80` counter / `0x100` damage floor /
`0x3000` terrain-tag sample) — confirming D10 against the fixtures, then applied to matrix
§11 + the §16 M4·A line. Encrypted `Sign.{rpgmvp,png_}` present in both trees with
`encryptionKey` in System.json. Formula strings present in `Skills[1/2/3]`.

**Amendments applied at the gate:** matrix §11 bit table + §16 M4·A roll-up corrected
(D10); matrix status header → SIGNED; D1 amendments (a)+(b); D11 authored; D1–D11 all
carry signature lines.

**Docs-only step** (no `src/`/`js/` change) → no patch notes / version bump; test baselines
untouched (vitest 443, Playwright 59/59).

**Phase M0 is COMPLETE.** Next: M1·A — importer core: project reader + database conversion
(Opus 4.8, Extra High).
