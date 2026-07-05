# Phase M1 Spec — Importer core: an MZ/MV project becomes an Atlas project

**Status:** 🚧 IN PROGRESS — M1·A landed; M1·B–M1·D pending.
**Authored:** 2026-07-04 by Claude Opus 4.8 (Extra High), from the M1 section of
`docs/MZ_MV_MIGRATION_ROADMAP.md`, the signed parity matrix
`docs/mz-mv-parity-matrix.md`, and the decision log in `docs/mig-0-spec.md`.
**Branch (per step):** `mig-1a`, `mig-1b`, `mig-1c`, `mig-1d` — each merges to
`main` (locked decision 2). Phase exit (M1·D) tags `mig-1`.
**Model:** Opus 4.8 (Extra High) for all four steps. Sonnet is banned from RPGAtlas.

## Objective (phase M1)

The end of this phase: **both fixtures import, boot, and playtest** — with `mzTodo`
markers standing in for future engine features. M1 turns an RPG Maker MV/MZ project
folder into an RPGAtlas `Project` document, built against the signed M0 contract.

- **M1·A** — project reader (intake / sniff / decrypt) + **database conversion**
  (System, Actors, Classes, Skills, Items, Weapons, Armors, Enemies, Troops+pages,
  States, CommonEvents → Atlas DB records per the matrix).
- **M1·B** — tilesets + maps (autotiles A1–A5, flag bits, layers→`layersAdv`,
  MapInfos tree→folders, encounters, notes).
- **M1·C** — events + the command **translation table** (`translate-commands.ts`):
  every MZ command code → Atlas command or `mzTodo`.
- **M1·D** — import wizard UX + plain-language report + end-to-end proof. Tag `mig-1`.

## Locked decisions inherited (roadmap + mig-0)

1. Opus 4.8 does the work; **Sonnet banned**; Fable gates only M0·C / M6·C.
2. Git ritual after every step: branch `mig-<phase><step>` → tests green → commit →
   push → merge to `main` → push `main` → delete branch. Phase exit tags `mig-N`.
3. Hand-off: each step ends by printing the next step's kick-off prompt verbatim.
4. Format: importer writes FORMAT_VERSION 2; new engine features are **optional
   schema fields only** (D2). No FORMAT_VERSION 3.
5. Legal: no RTP/DLC assets ever; fixtures self-made; decryption uses the user's own
   `System.json` key (D9 — detection by **extension**).
6. Audience: reports/wizard/errors are for kids / first-time devs (D11 copy style).

## The translation table is the spine

`src/editor/importers/mz/translate-commands.ts` is **built in M1·C**, not here. M1·A
therefore converts the two command-bearing DB record kinds — `CommonEvents` and
`Troops` battle-event pages — as **structural shells** (id / name / trigger / switchId;
troop `enemies[]`, page `cond` + `span`) and takes the command-list body through an
**injected translator seam**: `convertCommonEvents` / `convertTroops` accept an optional
`translate: CommandTranslator` argument that defaults to a no-op (`() => []`). M1·C
implements the real translator and injects it; nothing else about these converters
changes. This keeps M1·A from pre-empting M1·C's design of the command vocabulary while
still shipping the full record structure now.

---

## Module map — `src/editor/importers/mz/`

| File | Role |
|---|---|
| `raw-types.ts` | TypeScript shapes for the **input** RM data (`RmSystem`, `RmActor`, `RmClass`, `RmSkill`, `RmItem`, `RmWeapon`, `RmArmor`, `RmEnemy`, `RmTroop`, `RmState`, `RmCommonEvent`, `RmTrait`, `RmEffect`, `RmDamage`, `RmCommand`, …). Loosely typed — MV/MZ deltas are optional fields. |
| `slug.ts` | Stable string-key synthesis (elements/skillTypes) + the param-index → Atlas-param-key table (`luk` → dropped). |
| `report.ts` | `ImportReport` — a structured line collector (`area`/`kind`/`what`/`detail`/`count`/`code`). Copy is engineering shorthand; **M1·D** turns lines into kid-friendly text (D11). Aggregated counters (`count(key, make)`) power the single-line `luk` / SV-battler / face aggregates. |
| `decrypt.ts` | Pure asset (de)cryption: `parseEncryptionKey` (hex → 16 bytes), `isEncryptedAssetPath` / `restoredPath` (extension-based, D9), `decryptAsset` / `encryptAsset` (skip 16-byte fake header, XOR next 16 bytes). Uint8Array in/out — works in browser + Tauri + node/vitest. |
| `sniff.ts` | `sniffFormat(files)` → `{ format: "mv"\|"mz", reasons }` by marker file (`Game.rpgproject` vs `Game.rmmzproject`), falling back to data cues (Animations `effectName` vs `frames`, System `advanced`/`tileSize`). |
| `intake.ts` | `MzFileSource` interface + adapters: `objectSource(map)` (in-memory), `fileListSource(files)` (browser directory-picker / drag-drop via `webkitRelativePath`), `fsSource(root, fns)` (injected read fns — Tauri/node). `readRawProject(source, report)` loads + parses the 15 `data/*.json`, the `Game.*` marker, `js/plugins.js`, and discovers `img/`+`audio/` asset paths. **Tauri FS dialog + zip inflate are wired in M1·D** (the wizard); the interface + object/fileList/fs adapters are the testable core. |
| `traits.ts` | MZ trait-code (11/13/21/43/51/52) → Atlas `Trait` rows (value **× 100** — Atlas trait values are percentages, confirmed against the starter DB + `RA.traitRate`). Everything else → report. Shared by class/actor conversion. |
| `convert-system.ts` | `RmSystem` → `Partial<SystemData>` patch (types fully built). Downstream (M1·D) overlays it on `DataDefaults.newProject().system`. |
| `convert-battlers.ts` | Classes (curve fit + traits + learnings), Actors (equip reduction + actor-trait merge onto class), Enemies (stats + actions + condition mapping), States (restrict / turns / `hpTurn` from hrg trait). |
| `convert-items.ts` | Skills (type / element / scope / effects / **`formula` verbatim**), Items (hp/mp/revive + formula), Weapons/Armors (params, `luk` dropped). |
| `convert-events.ts` | CommonEvents + Troops(+pages) **shells** through the injected `CommandTranslator` seam (M1·C). |
| `index.ts` | Public API: `convertDatabase(raw, format, report)` → `MzDatabase`; `importMzDatabase(source)` (intake → sniff → convert); re-exports. |

## M1·A design decisions (extending the signed contract where the schema forces a call)

These refine — never contradict — the matrix/decision-log. Each is a call M1·B–M1·D
and later phases build on.

- **A1 · Trait value scale = percent.** Atlas trait `value` is a percentage
  (`RA.traitRate` divides by 100; starter DB uses `param 110` for ×1.1, `element 80`
  for ×0.8). So MZ multipliers/probabilities convert as `round(mz × 100)`: element
  rate `0.5` → `50`, param rate `1.1` → `110`, state rate `0` → `0`.
- **A2 · Which trait codes M1·A emits (D6 "directly-representable" set).** Only the six
  D6 codes are emitted as real Atlas trait rows, and only the three the engine actually
  reads change gameplay: **11 Element Rate** (`element`), **13 State Rate** (`state`),
  **21 Parameter** (`param`, `luk`/index 7 dropped). The other three are **preserved but
  inert** by design (Atlas semantics differ, so they can't wrongly change combat):
  **43 Add Skill** → `{skill, key:<id>, value:100}` (Atlas `skill` traits are damage-rate
  amps keyed by skill-**type**, so an id-keyed row is a harmless no-op + report);
  **51/52 Equip Type** → `{equip, key:"weaponType"\|"armorType", value:<typeId>}` (Atlas
  `canEquip` keys on `"weapon"`/`"armor"` with item-**id** values, so a `*Type` key never
  matches → equipment stays unrestricted + report). All other codes → report (`mzTodo`
  for M3·B).
- **A3 · Equip / enemy / state trait carriers (refines D6).** D6 says merge non-class
  traits "onto the effective class." M1·A applies that **only for actor-level traits**
  (merged onto the actor's `ClassDef`, one report line per source — Mara's Fire resist →
  Wanderer class). **Weapon / Armor / Enemy / State traits are report-only in M1·A**:
  Atlas has no per-equip trait carrier and `Enemy`/`StateDef` have no `traits` field, so
  anchoring an equip trait to a class would make it *permanent* (a real behavior change)
  and enemy/state resistances have literally nowhere to live. The mechanical stat blocks
  still convert (`Weapon.params`/`Armor.params`/`Enemy.stats`); only the trait **rows**
  are reported, honestly, for M3·B to carry. This is the safe reading of D6's "Atlas has
  no per-equip trait carrier yet."
- **A4 · Class curve linearization (matrix §Classes `≈`).** MZ `params[8][100]` →
  Atlas `base` (= level-1 value, index 1) + linear `growth`
  (= `(params[p][99] − params[p][1]) / 98`, rounded to 0.01). The engine reads
  `floor(base + growth·(level−1))`. Reported once as "stat curves were simplified."
- **A5 · `formula` schema fields (D1/D2).** New **optional** `Skill.formula?: string` and
  `Item.formula?: string` — the only schema additions in M1·A. The MZ damage formula
  string is stored **verbatim**; the M3·A evaluator consumes it later. Structured
  `power`/`hp`/`mp` still carry from recover-effect codes as the M1 fallback. Both fields
  are inert today (nothing reads them), so old projects are unaffected (FORMAT_VERSION
  stays 2).
- **A6 · System is a `Partial<SystemData>` patch.** `convert-system.ts` returns only the
  fields it derives (plus a fully-built `types`); M1·D overlays it on
  `newProject().system` so input bindings / screenScale / logical sound + music maps keep
  their engine defaults. Title/currency/switches/variables/party/start/opts convert;
  `windowTone` RGB → `windowColor` hex (gray dropped, report); MZ `advanced{}` →
  screen/ui/font sizes; vehicles → `VehicleDef`. Imported BGM (`titleBgm`/`battleBgm`) →
  `asset:audio/<name>` keys; the 24-slot SE array + ME channels stay on Atlas defaults +
  one report line (audio files convert in M1·B/M4·B).
- **A7 · Charset key placeholder.** `characterName`+`characterIndex` → a synthesized
  `charset` key (`slug(name)` + index suffix when > 0). Real sheet slicing rides the
  existing asset pipeline in a later step; the key is stable now so events/actors resolve.
- **A8 · Command bodies deferred to M1·C** via the injected translator seam (above).
  M1·A `commonEvents[*].commands` and `troops[*].pages[*].commands` are `[]` until M1·C.

## Matrix rows realized in M1·A (the `= M1·A` / `≈ M1·A` set)

System §1 (title/currency/switches/variables/party/types/window-tone/vehicles/BGM/
start/opts/advanced) · Actors §2 (id/name/class/level/charset/equip-reduction/actor-trait
merge; nickname/profile/maxLevel/SV-battler → report) · Classes §2 (curve fit / learnings
/ traits 11·13·21·43·51·52) · Skills §2+§6+§7 (type/element/scope/mp/icon/hits/anim/state
+ commonEvent effects / **formula** verbatim) · Items §2 (hp/mp/revive/desc + formula;
key-item/non-consumable/state-cure → report) · Weapons/Armors §2 (params `luk`-dropped;
traits → report) · Enemies §2 (stats/exp/gold/actions+condition kinds; drops/traits →
report) · Troops §2 (enemies/pages cond+span; members x·y/hidden → report/M3·C) · States
§2 (restrict/turns/`hpTurn`/removeAtEnd; SV motion/removeByX → report) · CommonEvents §2
(trigger/switchId) · `luk` §5/§7 (single aggregated report) · decryption §15 (D9).

Deferred by design: maps/tilesets/autotiles (M1·B), command bodies + `translate-commands`
+ `mzTodo` command schema (M1·C), wizard + report UI + e2e boot (M1·D).

---

## Stage log

### M1·A — Project reader & database conversion — ✅ 2026-07-04 (branch `mig-1a`)

**Delivered — `src/editor/importers/mz/` (11 modules):** the project-reader + DB-conversion
core listed in the module map above. Pure, dependency-light, node/vitest-testable; the
DB converters take parsed RM JSON and emit Atlas records + an `ImportReport`. Intake ships
the `MzFileSource` abstraction with object / fileList / injected-fs adapters and
`readRawProject`; the Tauri dialog + zip inflate land with the wizard in M1·D.

**Schema:** two optional additive fields — `Skill.formula?`, `Item.formula?` (A5/D1/D2).
Nothing reads them yet; FORMAT_VERSION stays 2; old projects unaffected.

**Vitest (new specs under `tests-unit/`):**
- `mz-decrypt.test.ts` — key parse, extension-based detection + restored paths (D9),
  encrypt/decrypt symmetry, and decrypting the committed fixture `Sign.{rpgmvp,png_}`
  to a valid PNG magic.
- `mz-sniff.test.ts` — MV vs MZ by marker file and by data cues (Animations model,
  System `advanced`/`tileSize`).
- `mz-import-db.test.ts` — **fixture DB round-trips** against
  `tests/fixtures/{mv,mz}-project/`: system types/switches/variables/party/window-color/
  vehicles/advanced; actor equip-reduction + actor-trait merge + report lines; class
  curve fit + trait rows + `luk` aggregation; skill type/element/scope/`formula`/effects;
  item hp/revive/reports; weapon/armor params (`luk` dropped); enemy stats/actions;
  state restrict/`hpTurn`/turns; troop enemies + page cond/span; common-event
  trigger/switch; the MV/MZ delta (both fixtures convert to the same DB modulo format).

**Baselines:** vitest 451 → **490** (+39 across `mz-decrypt`/`mz-sniff`/`mz-import-db`);
typecheck green; legacy `node --test` 16/16; **Playwright 59/59** (baseline intact — the
importer is editor-side pure logic, not wired to a scene yet). Lint: the new `mz/` modules
+ specs are clean; the one pre-existing `eslint .` error (`scripts/build-migration-fixtures
.mjs:561` — an unused `mz` param on the map generator, byte-identical to `main`) is M1·B
scaffolding, untouched here. No `js/patch-notes.js` / `help.ts` / `shims.d.ts` bump —
nothing user-visible ships until the M1·D wizard (working agreement step 2: user-visible ⇒
patch notes; M1·A has no user surface).

**Next:** M1·B — tilesets & maps.
