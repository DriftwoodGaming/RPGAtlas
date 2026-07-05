# Project Compass — Phase M3 spec: Engine parity II (battle math & traits)

**Phase:** M3 · **Model:** Opus 4.8 (Ultracode) · **Tags:** `mig-3` at phase exit (M3·C)
**Roadmap:** `docs/MZ_MV_MIGRATION_ROADMAP.md` (phase M3) · **Contract:** `docs/mz-mv-parity-matrix.md`
**Governing decisions:** D1 (formula sandbox, signed with amendments a+b), D2 (FORMAT_VERSION
stays 2), D6 (traits on `ClassDef` only), D7 (`luk` locked skip).

The hard core: MZ-formula-compatible combat without breaking Atlas-native projects. Every
schema addition is **optional-only** — FORMAT_VERSION stays 2, Atlas-native skills are
untouched (absent fields ⇒ byte-identical native behavior, zero extra RNG draws), and the
Playwright suite must stay at 0 regressions.

---

## M3·A — Damage-formula evaluator (matrix §7 + §6 code 11 + §5 code 22 hit/eva/cri)

**Scope (matrix "M3·A — formula" bill):** the sandboxed `a`/`b`/`v[n]` formula-string
evaluator, `variance`, `critical`, drain types (5/6), %-based HP/MP recover (effect
value1), and hit/eva/cri ex-params feeding the battle path.

### The evaluator — `src/shared/formula.ts` (new, pure, dependency-free)

A purpose-built **restricted-AST recursive-descent parser + AST-walking evaluator**,
exactly per decision D1. Formulas are **parsed, never executed** — no `new Function`,
no `eval`, no ambient globals.

Accepted grammar (everything else is a parse error):

- numeric literals (int/float), parenthesized expressions;
- `+ - * / %`, unary minus, comparisons (`< <= > >= == != === !==`), ternary `?:`;
- `a.<stat>` / `b.<stat>` where `<stat>` ∈ `atk def mat mdf agi mhp mmp hp mp level`
  (read-only facades supplied by the caller);
- `v[<expr>]` — game variables (read-only lookup function supplied by the caller);
- `Math.<fn>(…)` where `<fn>` ∈ `min max floor ceil round abs pow sqrt randomInt`
  (arity-checked; `min`/`max` variadic).

No strings, no assignment, no statements, no `&&`/`||` (outside the D1 whitelist — a
formula using them rejects with an honest report; widening needs a new gate decision),
no member access beyond the whitelists above (`a["atk"]`, `a.constructor`, `v.length`,
`a.luk` all reject — D7 keeps `luk` a locked skip). Gate amendments enforced: **(a)**
`Math.randomInt` draws from an **injected** `randomInt(n)` — the engine wires the
seedable `rnd` from `src/engine/util.ts`, so imported combat is reproducible under
`?rngseed=` and the reference-vector vitest is deterministic; **(b)** input limits —
formula length ≤ 512 chars, nesting depth ≤ 32 — over-limit takes the same reject path.

API: `parseFormula(src)` → AST or plain-language error; `getFormula(src)` — cached
compile, returns `null` for rejects (runtime callers fall back, never crash);
`evalFormula(compiled, env)` with `env = { a, b, v(n), randomInt(n) }` → number,
`NaN → 0`, clamped ≥ 0 (MZ's `Math.max(eval, 0)` + `isNaN` guard). Plus the pure MZ
damage pipeline, byte-order-faithful to `Game_Action`:

- `mzApplyVariance(damage, variancePct, randomInt)` — `amp = floor(|damage|·var/100)`;
  `v = randomInt(amp+1) + randomInt(amp+1) − amp`; `damage ≥ 0 ? damage+v : damage−v`.
- `mzDamageValue({ base, elementRate, critical, variance, guarding, randomInt })` —
  `value = base × elementRate` → (pdr/mdr/rec = 1 until M3·B) → crit ×3 → variance →
  guard ÷ 2 (MZ `applyGuard`, `grd` = 1 until M3·B, damage > 0 only) → `Math.round`.
- `mzHitRoll({ hitPct, evadePct, rndf })` — MZ order (miss roll, then evade roll),
  **consuming a draw only when the corresponding chance is real** (`hitPct == null`
  ⇒ no miss roll; `evadePct ≤ 0` ⇒ no evade roll) so native projects' RNG streams
  never shift.

Conscious deviations (kid-friendlier than MZ's raw `eval`, recorded for the M6·C grade):
`v[n]` of an untouched variable reads 0 (MZ reads raw `_data` → `undefined` → the whole
formula NaNs to 0); `b.level` on an enemy reads 0 (MZ throws → whole formula 0);
division by zero → `Infinity` → NaN-guarded to 0 at the boundary.

### Schema (all optional — FORMAT_VERSION stays 2, D2)

- `Skill`: `variance?: number` (0–100), `critical?: boolean` (can crit ×3, MZ),
  `dmgType?: "mp" | "hpDrain" | "mpDrain"` (MZ damage type 2/5/6; absent = plain HP),
  `powerPct?: number` (heals add this % of the target's max HP — MZ effect 11 value1).
- `Item`: `variance?: number`, `hpPct?: number`, `mpPct?: number` (effect 11/12 value1).
- `Skill.formula` / `Item.formula` already exist (stored verbatim since M1·A, D1).

### Importer flips (`convert-items.ts`, `traits.ts`)

- **Skills:** `damage.variance` → `variance` (when a formula is stored), `damage.critical`
  → `critical`, `damage.type` 2→`dmgType:"mp"`, 4→heal + `dmgType:"mp"`, 5→`"hpDrain"`,
  6→`"mpDrain"`; effect 11 `value1` → `powerPct` (rounded ×100). Formulas are now
  **parsed at import**: parseable → stored, works, and the old blanket "formulas turn on
  in a later update" todo line is gone; reject → formula kept verbatim (re-import
  upgrades it if a later phase widens the grammar) + **one aggregated `partial` report
  line** — the skill honestly falls back to simple damage (never silently zero, D1).
- **Items:** same formula validation; effect 11/12 `value1` → `hpPct`/`mpPct`; an
  *offensive* item formula (damage type 1/2/5/6) reports — Atlas's battle has no
  use-item-on-enemy flow yet.
- **Traits (`code 22` ex-params):** dataId 0/1/2 (hit/eva/cri) → Atlas `special` traits
  `hitChance`/`evadeChance`/`critChance` (percent, MZ-additive via `RA.traitSum`;
  `critChance` is the key the engine already reads). dataIds 3–9 stay on the
  "advanced battler bonuses" report until M3·B. Enemies still have no trait carrier
  (matrix: enemy `traits[]` → M3·B) — enemy-side element/eva/cri stay neutral this step.

### Battle glue (`battle.ts` + `menus.ts` — native paths byte-identical)

- Read-only facades: `actorFacade` via `param()`/live `hp`/`mp`/`level`;
  `enemyFacade` via `d.stats` + live battler `hp` (enemy `mp` lazily seeded from
  `stats.mmp` **outside** the extracted troop-setup statement pinned by
  `tests/battle-index.test.js`); `v(n)` → `G.vars[n] || 0`; `randomInt` → `rnd`.
- `resolveAction`, all four damage/heal branches: when the acting skill has a
  **compilable** `formula`, damage runs the MZ pipeline (element rate from the target
  class's element traits where a carrier exists; crit gated on `skill.critical` rolled
  against the attacker's `critChance` sum; `variance`; guard ÷2 for a guarding target);
  Atlas's row scale (front = ×1) still applies after, like every battle action. A
  formula that fails to compile at runtime (hand-edited JSON) falls back to the
  structured-power path — with `power` now `|| 0`-guarded, which also fixes the latent
  NaN for imported formula skills that had no flat effect (they dealt NaN damage since
  M1; unkillable-enemy bug).
- **Hit/evade:** physical actions roll MZ-style miss (attacker `hitChance` sum) and
  evade (defender `evadeChance` sum) — *only when the traits exist*, so Atlas-native
  battles consume zero extra draws and never miss, exactly as before. MISS/EVADE float
  text + plain log lines.
- **Drains & MP damage:** `dmgType:"hpDrain"` — dealt = `min(target hp, dmg)` (MZ
  clamp), attacker gains it; `"mpDrain"` — same over MP; `"mp"` — damage lands on MP
  (no KO from MP). Heal-type + `dmgType:"mp"` restores MP (MZ type 4).
- **Heals:** formula heals = MZ pipeline (variance; crit ×3 if flagged) **+** flat
  `power` (M1's effect-11 mapping) **+** `floor(mhp × powerPct/100)`; the powerPct term
  also joins the native heal path (absent = 0 = unchanged).
- **Items (`useItemOn`):** `hpPct`/`mpPct` add %-of-max recovery; a heal-type item
  formula evaluates with `a = b = target` (Atlas item use has no "user" battler —
  documented approximation) + `variance`.
- Basic **Attack** keeps the Atlas curve — MZ wires normal attacks to `Skills[1]` via
  trait 35 (attack skill), which is M3·B; hit/eva/cri traits *do* already apply to it.
- Pure-MZ pipeline scope note: Atlas's native `damageTaken`/`guardDamage`/
  `skillPowerRate` trait hooks do **not** fold into the formula path (no MZ trait maps
  to them; pdr/mdr/rec/grd arrive in M3·B).

### Editor

Skills form ("Effects & preview" sub-tab) gains an **Advanced damage** section: an
optional MZ-style formula input (live-validated by the shared parser with a
plain-language verdict — never scary output), Variance 0–100, and a "Can critical"
checkbox. Absent fields = the exact classic behavior; the preview note says the formula
overrides Power when set.

### Tests

- **vitest** `tests-unit/formula-eval.test.ts` (new, the flagship): grammar
  acceptance/rejection table (sandbox escapes: assignment, `constructor`/`__proto__`,
  bracket access on `a`/`b`, string literals, `Math.random`, unknown identifiers,
  `a.luk`, `&&`, statements); the D1-amendment limits (513-char formula, 33-deep
  nesting); determinism — same mulberry32 seed twice ⇒ identical damage;
  **hand-computed MZ reference vectors** for the full pipeline (fixture formulas
  `a.atk * 4 - b.def * 2` and `a.mat * 2 - b.mdf + v[3]` among them) with stubbed
  `randomInt` sequences, covering variance/crit/element/guard combinations and the
  variance boundary cases (0%, 20%, 100%); `mzHitRoll` draw-conservation (no
  traits ⇒ zero draws).
- **vitest** `mz-import-db.test.ts` extended: variance/critical/dmgType/powerPct/
  hpPct/mpPct stored from the fixtures; parse-reject → formula kept + partial report;
  class code-22 dataId 0 → `hitChance` special trait (fixture Wanderer has it); Slime's
  code-22 dataId 6 still reports (no enemy carrier).
- **node --test**: existing suites stay green — notably `battle-index.test.js`
  (troop-setup statement untouched) and `action-combat.test.js`.
- **Playwright**: full suite, **0 regressions** (map 1 goldens untouched). Formula
  combat itself is vitest-proven; the full-battle e2e lands with M3·C per the roadmap.

### Stage log

- **2026-07-05 — M3·A started (branch `mig-3a`).** Read roadmap phase M3, decision D1
  (+ gate amendments), matrix §5/§6/§7 + the "M3·A — formula" bill, `battle.ts`,
  `convert-items.ts`/`traits.ts`, and the fixture formulas. Wrote this spec. Design
  locked: pure `src/shared/formula.ts` (restricted-AST parser + MZ pipeline with
  injected RNG), optional-only schema fields, import-time formula validation with
  honest fallback, trait-gated hit/evade rolls (zero native RNG drift), drains/MP
  damage, %-recover, editor formula field. Implementation next.

- **2026-07-05 — M3·A complete (branch `mig-3a`).** Shipped the sandboxed
  damage-formula evaluator with MZ-compatible combat math:
  - **Evaluator:** new `src/shared/formula.ts` — restricted-AST recursive-descent
    parser + AST-walk evaluator exactly per D1 (whitelisted grammar, facades,
    `v[n]`, nine Math fns; strings/assignment/`&&`/`||`/unknown members all reject
    with plain-language errors), amendments enforced (injected `randomInt`; 512-char
    / 32-depth limits), plus the pure MZ pipeline `mzApplyVariance` /
    `mzDamageValue` (element → crit ×3 → variance → guard ÷2 → round) / `mzHitRoll`
    (draw-conserving miss-then-evade). Compile cache; rejects/`"0"` → `null` →
    structured-power fallback.
  - **Schema (optional-only, FORMAT_VERSION stays 2):** `Skill.{variance, critical,
    dmgType, powerPct}`, `Item.{variance, hpPct, mpPct}`.
  - **Importer:** formulas parse-validated at import — parseable ⇒ works (the old
    blanket "turn on in a later update" line is gone); reject ⇒ kept verbatim + one
    aggregated `partial` line + structured fallback. variance/critical travel with
    the formula; damage types 2/4/5/6 → `dmgType`; effect 11/12 `value1` →
    `powerPct`/`hpPct`/`mpPct`; offensive/MP-recover item formulas report honestly.
    `traits.ts` code 22 dataId 0/1/2 → `special` hitChance/evadeChance/critChance.
  - **Engine:** `battle.ts` formula path in all four damage/heal branches (facades
    snapshot `param()`/live HP/MP; enemy MP lazily seeded outside the pinned
    troop-setup statement), MZ order with guard ÷2, trait-gated MISS/EVADED rolls,
    HP/MP drains + MP damage, heal crits, `powerPct` %-of-max on both heal paths;
    `menus.ts` `useItemOn` returns the applied amounts and adds `hpPct`/`mpPct` +
    recovery-formula healing (a = b = target). Native paths byte-identical — the
    `Number(power) || 0` guards only change the previously-NaN case.
  - **Editor:** the skill form's Effects & preview tab gained an "Advanced damage"
    box (formula with live plain-language verdicts from the shared parser,
    Variance %, Can critical). Wiki `Battles-and-States.md` documents it;
    docs-site regenerated (also picking up M2's pending wiki edits).
  - **Tests:** new `tests-unit/formula-eval.test.ts` (55 tests: grammar table, 26
    sandbox rejects, amendment limits, mulberry32 determinism, hand-computed MZ
    reference vectors A1–C for variance/crit/element/guard/rounding, `mzHitRoll`
    draw-conservation, importer companions incl. drains + reject report);
    `mz-import-db.test.ts` extended (companions, hitChance trait, zero reject
    lines on the fixtures). **All green:** typecheck, eslint, 18 node suites,
    742 vitest, **69/69 Playwright (0 regressions, map 1 untouched)**.
  - **Fixture amendment (recorded like D10):** the Wanderer class ex-param hit
    trait `0.05 → 0.95` in both fixtures — the trait became *real* this step, and
    0.05 (a 95% miss rate, authored when code 22 was report-only) made the
    imported fixture battle unplayable; 0.95 is the MZ-default actor hit rate.
    Conversion coverage is unchanged (`hitChance 95` asserted in vitest).
  - **Latent-bug find:** pre-M3·A, imported formula skills had no `power`, so the
    enemy skill path dealt **NaN damage** — the import-boot battle e2e only
    "passed" because the party's HP went NaN and the battle insta-lost. With
    honest 0-damage math the troop-page message now really opens mid-battle, so
    the spec's Enter-driver also dismisses `.msgwin` (like player.spec's save
    confirmation). Both effects are the fix working, not regressions.
  - Patch notes added; `patch-notes.js?v=48→49` bumped in `help.ts` + `shims.d.ts`.
  - Scope notes for M3·B: enemies still have no trait carrier (enemy-side
    element/eva/cri neutral); basic Attack keeps the Atlas curve until trait 35;
    pdr/mdr/rec/grd sp-params fixed at 1; `&&`/`||` stay outside the D1 grammar
    without a new gate decision.

---

## M3·B — Trait & effect code coverage (matrix §5 codes 12,14,22,23,31–35,41,42,44,53–55,61,62 · §6 codes 13,21(0),31–34,42,43 · TP · state timing)

**Scope (matrix "M3·B — traits/effects" bill):** every remaining `+ M3·B` trait/effect
code, the TP system (commands 326/342, `tpCost`, `optDisplayTp`, gain-TP), state timing
(walk-off, damage-removal, restriction-removal, battle-end), buffs/debuffs, grow/learn.
Party abilities (trait 64) stay M3·C per the matrix bill — the roadmap's M3·B blurb lists
them, but the matrix is the contract. Everything optional-only (D2, FORMAT_VERSION 2);
Atlas-native projects keep byte-identical behavior **and RNG streams** (every new roll is
gated on the trait/field existing).

### Trait carriers (D6-faithful)

- `ClassDef.traits` stays the actor-side carrier. **Weapon/armor trait rows now merge
  onto the class of each actor initially equipping them** (D6 (a), flipping M1's A3
  report-only stance) with the required per-source report line; a trait-bearing equip
  nobody starts with reports honestly instead.
- **`Enemy.traits?: Trait[]`** (new, optional) — "enemies keep their own effective-battler
  merge" (D6). Slime's element/cnt rows become real.
- **`StateDef.traits?: Trait[]`** (new, optional) — states are *dynamic*; folding onto a
  class is impossible, so they ride the state and join the battler's effective traits
  while afflicted (this is how Silence/Blind-style states work in MZ).
- Engine reads go through an **effective-trait carrier**: class-or-enemy traits + traits
  of currently-active states, reusing `RA.traitRate`/`RA.traitSum` on a synthetic
  `{traits}` object. Native projects: states/enemies carry no traits ⇒ identical values,
  zero extra draws.

### Trait-code map (Atlas `Trait` shapes; value = percent per house convention)

| MZ code | Atlas trait | Engine effect |
|:--:|---|---|
| 12 Debuff Rate | `param` / `debuff:<stat>` | chance multiplier when an Add-Debuff effect rolls |
| 14 State Resist | `state` / `resist:<id>` | full immunity — checked inside addState (no extra draw) |
| 22.3 cev | `special` / `critEvade` | crit% × (1 − cev/100), MZ order |
| 22.4 mev | `special` / `magicEvade` | evade roll vs magical actions (gated on presence) |
| 22.5 mrf | `special` / `magicReflect` | magical action bounces to the caster (gated roll) |
| 22.6 cnt | `special` / `counterAttack` | physical hit negated + basic counterattack (gated roll) |
| 22.7 hrg | `special` / `hpRegen` | ±% max HP at round end (state-carried hrg still → `hpTurn`) |
| 22.8 mrg | `special` / `mpRegen` | % max MP at round end |
| 22.9 trg | `special` / `tpRegen` | TP at round end (with TP active) |
| 23.0 tgr | `special` / `targetRate` | multiplies enemy-targeting weight (same single draw) |
| 23.1 grd | `special` / `guardEffect` | MZ applyGuard ÷(2·grd) while guarding |
| 23.2 rec | `special` / `recovery` | heals received × rec (both heal paths + items) |
| 23.3 pha | `special` / `itemEffect` | item recovery × pha |
| 23.4 mcr | `special` / `mpCost` | **existing Atlas key** — direct map |
| 23.5 tcr | `special` / `tpCharge` | TP charged from damage × tcr |
| 23.6 pdr | `special` / `physDamage` | physical damage taken × pdr (formula + structured paths) |
| 23.7 mdr | `special` / `magicDamage` | magical damage taken × mdr |
| 23.8 fdr | `special` / `floorDamage` | stored now; floor damage itself is M4·A |
| 23.9 exr | `special` / `expRate` | victory EXP × exr per actor |
| 31 Attack Element | `element` / `attack:<key>` | basic attacks (and elementless formula skills flagged `attackElement`) use MZ `elementsMaxRate` |
| 32 Attack State | `state` / `attack:<id>` | rolled per basic-attack hit (and `attackStates` skills), × target state rate |
| 33 Attack Speed | `special` / `attackSpeed` | added to AGI for turn order when basic-attacking |
| 34 Attack Times+ | `special` / `attackTimes` | +value/100 basic-attack repeats (MZ floor of the sum) |
| 35 Attack Skill | `special` / `attackSkill` (value = skill id) | the Attack command casts that skill (costs paid, MZ) |
| 41 Add Skill Type | `skill` / `addType:<stypeKey>` | with any `addType` present, un-granted types are unusable (native: none ⇒ ungated) |
| 42 Seal Skill Type | `skill` / `sealType:<stypeKey>` | skills of the type disabled (menu + battle) |
| 43 Add Skill | `skill` / `add:<skillId>` | **flip from M1's inert numeric key** — now grants for real |
| 44 Seal Skill | `skill` / `seal:<skillId>` | that skill disabled |
| 51/52 | unchanged | equip-type whitelists (already real) |
| 53 Lock Equip | `equip` / `lock:weapon\|armor` | slot can't be changed in the equip menu |
| 54 Seal Equip | `equip` / `seal:weapon\|armor` | slot forced empty / can't hold an item |
| 55 Slot Type | — | dual wield is unmappable (single weapon slot) → report, locked |
| 61 Action Times+ | `special` / `actionTimes` | value% chance of an extra action, rolled per row (gated) |
| 62.0 autoBattle | `special` / `autoBattle` | stored + report — behavior lands with M3·C battle flow |
| 62.1 guard | `special` / `guardFlag` | battler counts as always guarding (real now) |
| 62.2 substitute | `special` / `substitute` | stored + report — M3·C battle flow |
| 62.3 preserveTp | `special` / `preserveTp` | TP carries between battles (no init draw) |
| 63 / 64 | — | collapse = locked skip; party abilities = M3·C (matrix bill) |

MZ heal-type skills lose their original skill type to Atlas's `"heal"`, so type-based
add/seal gating gets a new optional **`Skill.stype`** (the imported MZ skill-type key);
gating reads `stype || type`. Without it, an imported Silence (seal Magic) could never
silence a healing spell.

### Effect-code map (§6)

- **13 Gain TP** → `gainTp?: number` (Skill+Item).
- **21 Add State dataId 0** ("normal attack") → `attackStates?: true` — applies the
  attacker's `attack:<id>` state traits on hit (the real MZ default-Attack behavior).
- **31–34 buffs/debuffs** → `buffs?: { stat, op: buff|debuff|removeBuff|removeDebuff,
  turns? }[]` (Skill+Item). MZ model: level −2…+2 per param, ±25% each, turns tick at
  round end, cleared after battle. Debuffs roll against the target's `debuff:<stat>`
  trait; buffs always land (MZ).
- **42 Grow** → `grow?: { stat, amount }[]` — permanent, lands on `a.paramPlus` (the
  M2·C Change-Parameters carrier). Enemy targets: skipped (no paramPlus; MZ games grow
  actors).
- **43 Learn Skill** → `learn?: number[]` — pushes onto `a.skills` (M2·C carrier).
- **Item state add/remove** (effects 21/22 on items — M1 stored them for skills only) →
  `Item.stateId`/`stateChance`/`stateOp`; the Antidote fixture finally cures for real.

### TP system (per D2's "TP fields")

- `Skill.tpCost?: number` (import stores it — M1 dropped it), `Item.gainTp`,
  `SystemData.displayTp?: boolean` (from `optDisplayTp`).
- **Mechanics gate (`tpActive`)**: TP runs when `system.displayTp` is set **or any skill
  carries `tpCost`/`gainTp`**. Atlas-native projects: gate closed ⇒ zero draws, zero UI
  change. The gauge itself shows only with `displayTp` (exactly MZ's flag semantics).
- Battle start: `tp = randomInt(25)` per battler (a draw — behind the gate); `preserveTp`
  battlers keep their carried TP. Damage taken charges `floor(50 × dmg/mhp × tcr)`;
  round end adds `tpRegen`; skills pay `tpCost` (battle command disabled when short —
  the field menu deliberately doesn't gate on TP, kid-friendly) and grant `gainTp`;
  enemy action rows gate on TP the same way.
- Commands: **326 → `changeTp`** `{ actorId, op, value }` (works anywhere, like MZ);
  **342 → `changeEnemyTp`** `{ enemyIndex, op, value }` through a small battle bridge
  (the battle scene registers its live enemy list while running; outside battle the
  command no-ops) — both flipped in the translation table.

### State timing

- `StateDef.stepsToRemove?: number` + `removeByWalking?: boolean` — the map's
  step hook ticks a per-instance counter on party states; at 0 the state falls off.
- `removeByDamage?: number` (chance %) — rolled when the afflicted battler takes HP
  damage (gated: no field ⇒ no roll).
- `removeByRestriction?: boolean` — shed when a restricting state lands on the battler.
- `removeAtBattleEnd` (the MZ field) now also maps → `removeAtEnd` (M1 only mapped
  auto-removal timing 2).
- **Latent M2·C fix:** the `changeState` interpreter command pushed plain **numbers**
  into `a.states` while the battle scene stores `{id, turns}` objects — map-applied
  states were invisible in battle (stateDef(undefined) → filtered out). `changeState`
  now writes `{id, turns: maxTurns}` (deterministic, no draw) and handles object
  removal; `statesOf` normalizes stray numeric entries from old saves.

### Engine notes (native paths byte-identical)

- Buffs live on the battler (`buffs[stat] = {level, turns}`), applied as a battle-local
  wrapper over `param()`/enemy stats and inside the formula facades; ×1 when absent.
- `mzDamageValue` gains optional `dmgRate` (pdr/mdr or rec) and `grd` args — additive,
  defaults keep every M3·A vector byte-identical.
- MZ apply order kept: counter → reflect → hit/evade (now incl. `magicEvade`) → element
  (now `elementsMaxRate` for attack elements) → pdr/mdr/rec → crit (× (1−cev/100)) →
  variance → guard ÷(2·grd, incl. `guardFlag`) → round.
- Victory: EXP × `expRate`; targeting: weight × `targetRate` (same draw count).

### Editor

- The class Traits editor is extracted into a shared builder and now also lives on
  **Enemies** (new Traits sub-tab) and **States** (traits + removal timing fields, on
  new sub-tabs). Key dropdowns grow grouped, plain-language entries ("Attack element:
  Fire", "Resist: Poison", "Seal skill: Firebolt", "Lock weapon slot"…);
  `RA.TRAIT_SPECIALS` gains labels for every new key (including M3·A's
  hitChance/evadeChance, which had none). `special`/`attackSkill` renders a skill picker.
- Skills form: TP cost + Gain TP fields; an "Extra effects" list (buff/debuff/remove,
  grow, learn) on the Effects sub-tab. Items form: state add/remove (cures) + the same
  extra-effects list. System tab: "Show TP in battle" toggle.

### Importer flips

- `traits.ts` handles every code above (`bumpAdvTrait` shrinks to 55/63-and-64-only);
  code 43 emits the new `add:` key shape (old numeric rows were inert by design).
- `convert-battlers.ts`: enemy + state trait carriers, state timing fields.
- `convert-items.ts`: `tpCost`/`gainTp`/`stype`/`attackStates`/`attackElement`
  (elementId −1 on formula skills), buffs/grow/learn, item states; weapon/armor traits
  convert + merge onto initially-equipping actors' classes (orchestrated in `index.ts`).
- `convert-system.ts`: `optDisplayTp` → `displayTp`.
- `translate-commands.ts`: 326/342 out of the TODO table → real commands.

### Fixture amendments (recorded like D10)

Both fixtures (MV+MZ, kept identical where formats allow): Attack (skill 1) gains MZ's
real default effect `[21, 0, 1, 0]` (attack states); new skill 5 "War Chant" (allies,
ATK buff 5 turns + Gain TP 10) and new item 3 "Sage Tonic" (MAT grow +3, learns skill 2,
removes a DEF debuff) seed effect codes 31/33/13/42/43 across the import; System
`optDisplayTp` flips to `true` in the **MZ** fixture only (both gate paths covered —
the MV project still activates TP through Guard's `tpCost 25`).

### Tests

- **vitest** `formula-eval.test.ts`: `mzDamageValue` pdr/mdr/rec/grd hand vectors (M3·A
  vectors untouched); new `battle-logic` unit coverage: buff rate/stacking/expiry, TP
  charge math, action-times rolls (injected RNG), target-rate weighting.
- **vitest** `mz-import-db.test.ts`: every fixture trait row asserted in its new shape
  (Slime's ice ×200 + counter 10, Scout's addType, Wanderer's guardFlag + `add:3` flip,
  Cutlass/Leather-Vest merge + Sailor's-Charm unworn report, Poison/Sleep timing
  fields, Antidote cure, Guard tpCost, War Chant/Sage Tonic effects, displayTp);
  the "advanced battler bonuses" and "enemy resistances" todo lines are **gone**.
- **node --test**: `battle-index.test.js` (pinned statement untouched) +
  `action-combat.test.js` stay green.
- **Playwright**: full suite, 0 regressions on native projects; the import-boot battle
  e2e re-verified (TP + guardFlag legitimately change imported-battle dynamics — driver
  adjusted if needed, exactly like M3·A's `.msgwin` note).

### Stage log

- **2026-07-05 — M3·B started (branch `mig-3b`).** Read roadmap M3·B, matrix §5/§6 +
  the "M3·B — traits/effects" bill, D2/D6/D7, `traits.ts`/`convert-battlers.ts`/
  `convert-items.ts`/`translate-commands.ts`, `battle.ts`/`battle-logic.ts`/
  `game-state.ts`/`menus.ts`, `battler-tabs.ts`/`shared.ts`, and both fixtures. Wrote
  this spec. Design locked: effective-trait carrier (class/enemy + state traits),
  prefixed trait keys inside the existing six types, optional-only schema
  (Enemy/StateDef traits, TP fields, buffs/grow/learn, state timing), gated rolls for
  RNG-stream stability, D6-faithful equip-trait merge, TP behind a usage gate,
  326/342 flips, fixture amendments recorded. Found + will fix the M2·C
  `changeState` number-vs-object mismatch. Implementation next.

- **2026-07-05 — M3·B complete (branch `mig-3b`).** Full trait & effect coverage
  shipped exactly per the table above:
  - **Importer:** `traits.ts` converts every matrix `+` code (12/14/22×10/23×10/
    31–35/41/42/44/53/54/61/62 + the 43 `add:` flip); 55 dual-wield and 63 collapse
    are honest locked-skip lines; 64 keeps the aggregated todo until M3·C.
    Enemy/state trait carriers, state removal timing, item states, buffs/grow/learn/
    gainTp/tpCost/stype/attackElement/attackStates, `optDisplayTp → displayTp`,
    equip-trait merge onto initially-equipping classes (D6, dedup + unworn report),
    translate flips 326→`changeTp` / 342→`changeEnemyTp`.
  - **Engine:** effective-trait reads (class/enemy + active states) behind
    `effCarrier`; buffs (±25%/level, round ticks, battle-end clear); the full TP loop
    (usage-gated init/charge/costs/regen/commands + gauge behind `displayTp`);
    counter/reflect/magic-evade/crit-evade rolls (all presence-gated); attack
    elements (elementsMaxRate) + on-attack states; attack times/speed/skill;
    action times (turn + timed modes); seal/grant gating in battle, menus, and enemy
    action picks; equip lock/seal (menu + `param()` seal); pdr/mdr/rec/grd through
    `mzDamageValue`'s new optional `dmgRate`/`grd` args AND the structured paths;
    tgr targeting; exr victory EXP; hpRegen/mpRegen/tpRegen ticks; walk-off states
    on the map step hook; damage/restriction state shedding.
  - **Latent-bug fix (M2·C):** the `changeState` command pushed bare numbers into
    `a.states` while battle stores `{id, turns}` — map-applied states were invisible
    in battle. Now writes objects (turns = maxTurns, no draw); battle normalizes
    stray numeric entries from old saves; `useItemOn` can add/cure states anywhere.
  - **Editor:** shared traits editor (grouped plain-language keys incl. a skill
    picker for `attackSkill`) on Classes + **Enemies** + **States** (with a new
    Removal panel); Skills gained TP cost/gain + an Extra-effects list (buff/grow/
    learn — shared with Items); Items gained state cure/inflict + TP; System gained
    "Show TP in battle"; `RA.TRAIT_SPECIALS` labels for every key (incl. M3·A's
    hit/evade which had none); Change TP / Change Enemy TP command forms;
    `traitDescription` speaks all the new keys.
  - **Fixtures (amended like D10, both MV+MZ):** Attack gained MZ's real default
    effect `[21,0,1,0]`; Firebolt a DEF debuff (32); new skill 5 "War Chant"
    (31/34/13) and item 4 "Sage Tonic" (42/43); MZ `optDisplayTp` flipped true
    (both TP-gate paths covered — MV activates via Guard's `tpCost 25`).
  - **Tests:** vitest 762 (was 742): importer flips asserted per fixture row
    (Slime's ice ×200 + counter, Scout's addType, guardFlag, `add:3`, equip merge +
    Sailor's-Charm unworn line, Poison/Sleep timing, Antidote cure, War Chant/Sage
    Tonic, displayTp; the "advanced battler bonuses"/"enemy resistances" lines
    asserted GONE); new battle-logic suites (buff stack/expiry, MZ tpDamageCharge,
    action-times draw-conservation, tgr weighting); `mzDamageValue` sp-param
    vectors B1–B4 + an M3·A byte-identity check; translate rows flipped to real
    commands; node interpreter test updated off the pinned M2·C bug + registers the
    TP pair. **All green:** typecheck, eslint, 18 node suites, 762 vitest,
    **69/69 Playwright (0 regressions — the import-boot battle e2e held with TP +
    guardFlag active, no driver changes needed)**.
  - Patch notes added; `patch-notes.js?v=49→50`; wiki `Battles-and-States.md`
    rewritten (traits/buffs/TP/removal sections) + docs-site regenerated.
  - Conscious deviations (for the M6·C grade): the Attack command never charges the
    attack-skill's MP/TP costs; enemy Attack-Times+ strikes re-roll their target
    (extra pushed commands); effect 21·0's `value1` folds to the boolean
    `attackStates` (fixtures use 1.0, exact); item buffs applied on the map persist
    into the next battle; mrf reflection recomputes the hit against the caster's
    own defenses. Scope notes for M3·C: party abilities (64), escape effect (41),
    substitute/autoBattle behaviors, enemy commands 331–340, `fdr` waits for M4·A
    floors.

## M3·C — Troop & enemy battle parity *(not started — spec lands with the step)*
