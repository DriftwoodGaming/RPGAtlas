# Phase M6 Spec — Wizard polish, docs, QA, release ("Project Compass")

**Status:** M6·A ✅ · M6·B ✅ · M6·C ✅ **RELEASED — RPGAtlas 1.1.0** (tags
`mig-6` + `v1.1.0`, 2026-07-05). Phase M6 is the *finish*: the migration works (M1–M5 landed the
conversion, parity, plugins, and the read-only Script adapter); M6 makes it
*friendly to use* (M6·A), *proven at scale* (M6·B), and *shipped* (M6·C, tag
`mig-6` + version **1.1.0**).

**Authored:** 2026-07-05 by Claude Opus 4.8 (High), from the M6 section of
`docs/MZ_MV_MIGRATION_ROADMAP.md` (phase M6 + locked decision 6) and the M1·D
wizard/report UI (`rm-import-wizard.ts`).
**Branch (per step):** `mig-6a`, `mig-6b`, `mig-6c` — each merges to `main`
(locked decision 2). Phase exit (M6·C) tags `mig-6` and `v1.1.0`.
**Model:** Opus 4.8 (High) for A/B; Fable 5 for the C release gate. Sonnet is
banned from RPGAtlas.

## Locked decisions inherited from the roadmap / mig-0

1. Opus 4.8 does the work; Fable gates M0·C and M6·C; **Sonnet banned**.
2. Git ritual after every step: branch `mig-<phase><step>` → tests green → commit
   → push → merge to `main` → push `main` → delete branch. Phase exit tags `mig-N`.
3. Hand-off: each step ends by printing the next step's kick-off prompt verbatim.
4. Format: importer writes FORMAT_VERSION 2; new fields are **optional additive**
   only. No FORMAT_VERSION bump without the Fable gate.
5. Legal: only the user's own project imports; plugin `.js` is never executed;
   fixtures are hand-authored.
6. **Audience rule:** wizard text, progress, reports, and errors are for kids and
   first-time devs — "here's what came along and what to do", never a stack trace.

## M6·A objective (this step)

Polish the wizard's **user face** and write the **"Coming from RPG Maker MZ/MV"**
documentation. Three UX deliverables from the roadmap (M6·A): **progress states**
(a live bar, not a frozen spinner), a **re-import flow** (re-run picks up table
entries that have since flipped from `mzTodo` to a real conversion — and *says*
how many), and **report export as text**. Plus the docs: a wiki guide, docs-site
rebuild, README mention, help.ts refresh, patch notes, version bumps.

### What M6·A does NOT do (guardrails)

- **No new conversion behavior.** The importer's coverage is exactly what M1–M5
  shipped; M6·A only changes how the *wizard* presents it. Re-import re-runs the
  same pipeline — it picks up newly-supported entries only because the *code* got
  better between imports, never because M6·A converts anything new.
- **No FORMAT_VERSION bump** (D4). No schema change at all — the report doc shape
  is untouched; the new helpers are pure functions over it.
- **Text export & delta stay pure** (src/shared pure-core trap): the wording lives
  in a node-testable module, not the DOM, so the vitest spec owns the copy.
- **Kid-safe copy** (D6): progress labels, the re-import banner, and the text
  report never leak a stack trace or code noise.

## Deliverables (M6·A)

1. **`src/editor/importers/mz/report-format.ts`** (new, pure) — `reportDocToText`
   (a saved `ImportReportDoc` → a plain-text file, same voice as the on-screen
   report), `reimportDelta(prev, next)` (compares todo-weight so the wizard only
   celebrates a genuine improvement), and `PLUGIN_VERDICT_WORD` (one source of
   truth for the verdict icon+word, shared by the text export and the DOM badge).
2. **`src/editor/importers/mz/import-run.ts`** — `runRmImport` gains an optional
   `onProgress` sink (`ImportProgress` / `ImportProgressFn`) awaited between the
   heavy stages (reading → assembling → report → done) so the wizard can repaint.
3. **`src/editor/importers/mz/index.ts`** — re-exports the new helpers + types.
4. **`src/editor/importers/rm-import-wizard.ts`** — live progress modal (label +
   bar, driven by `onProgress` with a paint yield); the report modal grows a
   custom footer with **💾 Save as Text…** / **📋 Copy** (which don't dismiss);
   `renderReportDoc(doc, prev?)` renders the 🔁 re-import banner; the launcher
   nudges toward re-import when the project already carries a report; the plugin
   badge now builds on the shared `PLUGIN_VERDICT_WORD`.
5. **Docs** — new `wiki/Coming-from-RPG-Maker.md` (how-to, the report, a
   term-by-term cheat sheet, add-ons, script snippets, re-import, artwork,
   troubleshooting); `_Sidebar.md` entry; cross-links from `Home.md` and
   `Migration-Guide.md`; README mention; `docs-site/` rebuilt
   (`node scripts/build-docs-site.mjs`).
6. **help.ts** — "Coming from RPG Maker" section gains the progress/save/re-import
   bullets; **patch notes** entry; `?v=` bump 55→56 (help.ts import + shims.d.ts).
7. **Tests** — `tests-unit/mz-report-format.test.ts` (text export shape + kid-safe
   copy + delta math incl. count-weighting and singular/neutral copy);
   `tests-unit/mz-import-wizard.test.ts` gains a progress-order assertion.

---

## Stage log

### M6·C — Fable release gate — ✅ 2026-07-05 (branch `mig-6c`, tags `mig-6` + `v1.1.0`)

**Gate:** Claude Fable 5 (release review, per locked decision 1).

**Parity-matrix audit (§16 scope contract) — PASSED.** Method: read the roadmap +
matrix in full, then verified the spine directly against
`translate-commands.ts` — every flagship `+` code dispatches to a real
translation (M2·A 105/124/204/213/221–223/231–235 · M2·B 103/104/303 · M2·C
118/119/285/313–325 · M3·C 331–340 · M4·A 202/206/283/284/323 · M4·B
243–246/249/251 · M5·B 355/655 read-subset → `mzScript`), and the DB-side `+`
rows exist in `schema.ts` (`formula`/`variance`/`critical`, `tpCost`, `buffs`,
`Enemy.drops`). The residual `mzTodo` set is exactly the conscious-re-scope
list, every entry with an aggregated report line: **356/357** (plugin commands —
listed in the Add-ons report, never run, by design), **132/140/203** (`≈` rows
re-scoped to honest todos), and the variable-operand forms of
122/125–128/201/301/change-family ("resolve or report" per the matrix). Script
*writes* stay todo per the M5·B read-only contract. All locked skips (`−`) emit
friendly lines from the `SKIP` table. **Nothing drops silently.**

**Code review:** no findings that block release. The newest surface (M6·A
`report-format.ts`, M6·B scale generator + tests) was read directly at the gate
— pure, node-tested, kid-safe copy asserted by vitest. Main still carries its 3
pre-existing eslint errors (lint is not a phase gate, unchanged since M4).

**Release notes review:** the eight Project Compass patch-note entries
(M1·D → M6·A) read correctly and kid-friendly; a capstone **"RPGAtlas 1.1"**
entry was added on top (`?v=` 56→57). The wiki "Coming from RPG Maker" guide
matches shipped behavior.

**Version bump 1.0.0 → 1.1.0** (additive release — importer + parity features;
FORMAT_VERSION stays 2, plugin API stays frozen): `package.json`,
`package-lock.json` (root — was stale at 0.1.0), README badge, `help.ts` About
box, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` + `Cargo.lock`.

**Gates green at the gate:** `tsc --noEmit` clean · vitest **875** · node
`--test tests/` **18** · Playwright **70/70** · patch-notes `?v=57`.

**Project Compass final tally:** 17 steps, 7 phases, tags `mig-0`…`mig-6`,
+424 vitest across the migration (451→875), zero e2e regressions throughout, FORMAT_VERSION
2 preserved, schema additions optional-only.

### M6·B — Round-trip QA & scale test — ✅ 2026-07-05 (branch `mig-6b`)

**Objective:** prove the importer at *community scale* (the M0·B fixtures prove
*coverage*; this proves *volume*): a script-generated project the size a real
community game reaches — 50+ maps, 500+ events, a full DB — imports clean, inside
an import-time budget, and survives the full chain the wizard promises. Plus a
bug bash on messy real-world inputs and a report-copy review against the audience
rule (D6). **No new conversion behavior** — QA re-runs the M1–M5 pipeline.

**Delivered:**
1. **`scripts/build-migration-scale-fixture.mjs`** (new) — a deterministic
   (seeded mulberry32), idempotent generator that synthesizes a "community-scale"
   RPG Maker project from the same self-made building blocks as the M0·B fixtures
   (locked decision 5 — no RTP/DLC/exported data). Default **60 maps / 595
   events / full DB** (12 actors · 8 classes · 40 skills · 30 items · 24 weapons ·
   24 armors · 30 enemies · 20 troops · 20 states · 24 common events · 12
   animations · 6 tilesets · 50 switches · 50 variables). Events cycle through six
   templates built from the exact RM command shapes the M1·C translator already
   converts (show-text+choices+call, chest self-switch, transfer, ugly move-route,
   battle-processing with win/escape/lose + script branch, the M4·B audio bill),
   so volume exercises the whole command set rather than adding a novel path.
   Exports **`buildScaleProject({format, maps, seed})` → `{ files, stats }`** (the
   object-map shape `objectSource()` wants) so tests build it in memory; the CLI
   (`node scripts/build-migration-scale-fixture.mjs [--format mv|mz] [--maps N]
   [--out DIR]`) writes a tree to disk for manual inspection. Supports both MV
   (sheet animations) and MZ (Effekseer + `advanced`/`locale`/autosave).
2. **`tests-unit/mz-scale-import.test.ts`** (new, 14 tests) — the round-trip QA:
   - **Scale targets** — 60 maps, ≥500 imported events, full DB carried through.
   - **Bootable-clean** — `isProjectLike` + `validateProject(_, "import")`,
     format sniffed `mz`, `formatVersion` 2.
   - **Import-time budget** — the whole 60-map/595-event convert+assemble runs in
     **~55 ms** (budget 8 s, a generous regression tripwire; the real number is
     logged). Bug-bash perf probe (not committed) showed sub-linear scaling —
     **0.28 ms/map at 200 maps / 1989 events** — fixed overhead dominates, no
     quadratic blow-up.
   - **Full chain** — map-load invariant (every imported page carries a `cond`
     object); **save/load** round-trip (serialize → parse → `validateProject(_,
     "load")` → same shape); **battle-data integrity** (every troop member and
     enemy action references an in-range enemy/skill id — the "battle" leg,
     asserted at the data level).
   - **Report copy at scale (D6)** — no stack-trace / code-noise in any line's
     `what`/`detail`, the saveable text export is clean, leads with the good news,
     and never dumps a raw `code NNN`.
   - **Re-import idempotency** — deterministic generator + deterministic importer
     ⇒ identical report shape; `reimportDelta` reports `improved:false`,
     `resolved:0` ("nothing new yet") — the banner never falsely celebrates.
   - **MV parity at scale** — the MV variant imports to the same map/DB shape.
   - **Robustness (bug bash)** — messy inputs the M0·B fixtures never contain all
     degrade to a bootable-clean project (kid-safe, no crash): a **transfer to a
     non-existent map**, a **circular MapInfos parent** (1↔2), a **self-parenting
     map**, one **oversized 120×120 world map** (imports in ~33 ms), and an
     **enemy action citing an out-of-range skill id**.
3. **`.gitignore`** — `tests/fixtures/scale-project/` (the CLI's disk output —
   large + regenerable; tests build it in memory, so nothing bloats the repo).

**Bug bash — findings:** **zero functional bugs.** The importer is correct, fast,
and robust at 60–200 maps and on hand-broken inputs (dangling refs, circular/
self-parent trees, giant maps, out-of-range ids) — all import to a bootable-clean,
`validateProject`-passing project. One *test-side* assumption bug was caught and
fixed during authoring (Atlas `Troop.enemies: number[]`, not RM's `.members`).

**Report-copy review (audience rule, D6):** read the full 60-map text export.
Every line is honest and kid-safe — good-news summary first, then sectioned
caveats ("Came in a little differently" / "Saved for a later update" / "Left out
on purpose"), a dated provenance line, no code noise. High-frequency caveats
already aggregate by count (event movement paths ×120, script snippets ×124, Luck
×71, message portraits ×60, enemy tints ×29). **Known limitation (documented, not
a bug):** some per-record caveats (per-class equip restriction, per-equip "special
effects moved onto class", per-hero extra-equipment, per-animation Effekseer
fallback) stay one-line-per-record, so a very large DB yields a long "Came in a
little differently" section. This is the D6 "nothing dropped silently" contract
working as designed — per-record specificity (which class each bonus moved onto)
is valuable at normal scale; collapsing it is deferred as presentation-only polish
(no converter change), out of M6·B's QA scope.

**Guardrails held:** no new conversion behavior (QA re-runs the M1–M5 pipeline);
no FORMAT_VERSION bump / no schema change (D4); the generator is self-made
(decision 5); no giant fixture committed (in-memory + gitignored).

**Gates green:** `tsc --noEmit` clean · vitest **875** (was 861, +14) · node
`--test tests/` **18** · Playwright **70/70** · eslint clean on all changed files
(main's 3 pre-existing errors untouched — lint is not a phase gate).

**Next:** M6·C — Fable 5 release gate (parity-matrix audit, release notes, tag
`mig-6` + version **1.1.0**).

### M6·A — UX polish + "Coming from RPG Maker" docs — ✅ 2026-07-05 (branch `mig-6a`)

**Delivered:**
1. **`src/editor/importers/mz/report-format.ts`** (new, pure — no DOM/`window`):
   - **`reportDocToText(doc)`** renders the report as a saveable `.txt` in the
     same order as the on-screen version — header (MV/MZ + game title), the
     good-news summary counts (zeros omitted), the honest caveat buckets
     (partial → "Came in a little differently", todo → "Saved for a later
     update", skipped → "Left out on purpose", converted → "Notes"), the add-ons
     section, "What next?" (incl. the re-import tip), and a dated provenance line.
   - **`reimportDelta(prev, next)`** compares **todo weight** (sums each todo
     line's aggregate `count`, so "damage formulas — seen 7 times" counts as 7),
     returning `{ improved, prevTodo, nowTodo, resolved, headline }`. Headline is
     green + celebratory only when `next` has strictly fewer todos than `prev`
     (singular/plural aware), neutral "nothing new yet" when unchanged, and
     `null` when there's no previous report — so the banner never nags.
   - **`PLUGIN_VERDICT_WORD`** — the verdict → {icon, word} table, now the single
     source of truth (the wizard's colored badge composes tint onto it).
2. **`import-run.ts`** — `runRmImport(source, base, onProgress?)`; `ImportProgress`
   = `{ stage: "reading"|"assembling"|"report"|"done", label, step, total }`;
   `onProgress` is **awaited** between stages, so the wizard's sink can yield a
   macrotask and repaint before the synchronous convert blocks. Omitting it is
   the silent test/legacy path — the existing two-arg callers are unaffected.
3. **`index.ts`** — re-exports `reportDocToText`, `reimportDelta`,
   `PLUGIN_VERDICT_WORD`, `ReimportDelta`, `ImportProgress`, `ImportProgressFn`.
4. **`rm-import-wizard.ts`** — progress modal (label + green fill bar) fed by an
   `onProgress` that sets width `step/total` and `await setTimeout(0)` to paint;
   `importFromSource` remembers the project's prior report **before** commit and
   passes it to `showReport(doc, prev)`; `renderReportDoc(doc, prev?)` prepends a
   🔁 banner from `reimportDelta` (green when improved, grey when neutral); the
   report modal uses a **custom footer** (Save-as-Text + Copy must NOT dismiss, so
   they're their own buttons with a late-bound `close`); the launcher shows a
   re-import nudge when `hasImportReport()`; `PLUGIN_BADGE` now derives icon+word
   from `PLUGIN_VERDICT_WORD` (only `PLUGIN_TINT` stays local).
5. **Docs** — `wiki/Coming-from-RPG-Maker.md` (new, kid-friendly on-ramp: how to
   import, the report, a "what comes across" table + a RPG-Maker→Atlas term
   cheat-sheet, add-ons guidance, the read-only script subset, artwork via the
   Asset Browser, the re-import flow, and an "if something looks off" section);
   `_Sidebar.md` gains it under Getting started; `Home.md` + `Migration-Guide.md`
   cross-link it (and Migration-Guide now disambiguates "project-format upgrade"
   from "coming from RPG Maker"); README doc block gains a 🎮 line; `docs-site/`
   rebuilt (20 pages — the new page + every page's nav).
6. **help.ts** — the "Coming from RPG Maker MZ / MV?" section gains the
   progress-bar / Save-as-Text / Copy / re-import bullets; **patch notes** entry
   ("Smoother RPG Maker imports"); `?v=` bump 55→56 (help.ts import + shims.d.ts).
7. **Tests** — `tests-unit/mz-report-format.test.ts` (11: text export leads with
   counts + omits zeros, MV/MZ naming, clean-vs-caveat headings, add-ons verdict
   words + on/off + settings, next-steps + dated provenance + kid-safe scan; delta
   neutral-with-no-prev, celebrate-fewer, singular copy, count-weighting,
   nothing-new-when-equal). `tests-unit/mz-import-wizard.test.ts` gains a
   progress-order assertion (stages `reading→assembling→report→done`, steps 1–4,
   total 4, still imports "Cove Test").

**Guardrails held:** no new conversion behavior (re-import re-runs the same M1–M5
pipeline; the delta only reflects code that improved between imports); no
FORMAT_VERSION bump and no schema change (D4); the copy lives in a pure
node-tested module (src/shared pure-core discipline); kid-safe scan asserts no
stack-trace noise in the text report (D6).

**Gates green:** `tsc --noEmit` clean · vitest **861** (was 849, +12) · node
`--test tests/` **18** · Playwright **70/70** · eslint clean on all changed files
(main's 3 pre-existing errors untouched — lint is not a phase gate).
patch-notes `?v=56`.

**Next:** M6·B — round-trip QA & scale test (both fixtures + a script-generated
50+ map / 500+ event / full-DB community-scale project; full e2e chain,
import-time perf budget, bug bash, report-copy review).
