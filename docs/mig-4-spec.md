# Project Compass — Phase M4 spec: Engine parity III (map features & audio-visual)

**Phase:** M4 · **Model:** Opus 4.8 (Extra High) · **Tags:** `mig-4` at phase exit (M4·B)
**Roadmap:** `docs/MZ_MV_MIGRATION_ROADMAP.md` (phase M4) · **Contract:** `docs/mz-mv-parity-matrix.md`
**Governing decisions:** D2 (FORMAT_VERSION stays 2 — every schema addition optional-only),
D10 (real RM flag-bit values), D11 (aggregated, kid-friendly report lines), locked decision 6
(honest no-silent-drop).

Draw-conservation stays THE contract: every new behavior is presence-gated (a map without
the feature takes the exact pre-M4 code path — byte-identical rendering, movement, and RNG
draws; the frozen Driftwood Shore goldens gate it).

---

## M4·A — Remaining map-feature gaps

**Scope (matrix "M4·A — map features" bill):** tile flags Ladder/Bush/Counter/Damage-Floor
(§11 bits 5–8), Terrain Tag (bits 12–14), region-scoped encounters (§2 `encounterList`
`regionSet`), looping maps (`scrollType`), parallax (284 + map parallax fields), per-map
battlebacks (283 + map/System), Change Tileset (282), vehicle commands (202/206/323),
floor-death opts (`optFloorDeath`/`optSlipDeath`).

### What M1 already stored (this step makes the engine consume it)

- `Tileset.tileProps[assetKey] = { pass, flag, terrain }` — flag byte bit0 bush · bit1
  ladder · bit2 counter · bit3 damage (matches the Database ▸ Tilesets tab exactly);
  terrain 0–7. Written by `convert-tilesets.ts` since M1·B.
- Autotile groups: `Autotile.props.terrainTag` (base-shape tag). **Gap found:** groups never
  stored the behavior flag byte — an MZ bush/ladder A-sheet autotile (tall grass!) lost its
  behavior. M4·A adds `Autotile.props.flag` (same byte convention, optional).
- `MapEncounters.byRegion` already exists in schema + engine roll (Phase 5) — region
  encounters are an importer flip plus one engine gate fix (below).
- The fixtures already exercise everything: World tileset flags (terrain 3 on grass, damage
  A5 lava, ladder A4 wall, bush B t16, counter B t32), harbor `parallaxName:"Sea"` +
  `regionSet:[1,5]`, cave `scrollType:2` + `specifyBattleback:"Cave"`, System
  `optFloorDeath`/`optSlipDeath` fields present. `img/parallaxes/Sea.png` ships.

### Design decisions (locked at step start)

**D-M4A-1 — Tile-behavior cache** (new `src/engine/scenes/tile-behavior.ts`): rebuilt per
`loadMap` from `proj.tilesets` (byId `map.tilesetId`, tileProps keyed by `Assets.tiles[i].key`)
+ `proj.autotiles` `props.flag`/`props.terrainTag` (reserved id via `tileIdOf`). Exposes
`bushAt/ladderAt/counterAt/damageFloorAt/terrainTagAt(x,y)` reading all four role layers
(flags = union, terrain = topmost non-zero — MZ `layeredTiles`/`terrainTag` order), plus
per-map presence booleans so maps without a behavior pay zero per-step cost.

**D-M4A-2 — Ladder:** on step arrival (and transfer landing) onto a ladder tile, facing
snaps up (dir 3) — player and events. Presence-gated visual; no RNG.

**D-M4A-3 — Bush:** characters standing on a bush tile draw their bottom 12px at 50%
alpha (MZ bush depth). Canvas-2D path: two-pass clipped `Assets.drawChar`. HD path: a
processed sprite canvas copy with the faded band (imported maps default to classic
rendering, so HD is best-effort). Presence-gated.

**D-M4A-4 — Counter:** `checkActionTrigger` gains a third probe: if the facing tile is a
counter tile, also check the tile one beyond it (MZ talk-over-counter). Presence-gated.

**D-M4A-5 — Damage floors + floor-death opts:** stepping onto a damage tile (on foot)
deals `floor(10 × traitRate("special","floorDamage"))` to each party member (MZ basic 10 ×
fdr sp-param, already imported), red screen flash, HP floored at 1 unless
`system.optFloorDeath`; all-dead → game over. **Map slip tick:** under
`system.mzBattleFlow` only, every 20 party steps applies hp/mp regen traits on the map
(MZ `turnEndOnMap`), slip damage floored at 1 HP unless `system.optSlipDeath`. Both opts
are optional System fields set by the importer; native projects (absent fields, no
mzBattleFlow) take the exact pre-M4 path.

**D-M4A-6 — Terrain tags:** `locationInfo(x,y,"terrain")` returns the real tag (was an
honest 0); translator 285 keeps its shape, its "no terrain" caveat comment/report goes.

**D-M4A-7 — Region encounters (importer flip + one engine gate):** `convertEncounters`
builds `byRegion[r]` = global troops ∪ troops whose `regionSet` ∋ r (MZ validity =
regionSet empty or containing the region); `troops` = global-only list. The engine roll
gate `enc.troops.length` widens to `(enc.troops.length || byRegion non-empty)`; an empty
resolved pool resets the counter and skips battle. Native maps (no byRegion) keep the
identical gate and draw stream. The "enc-region" todo report line flips to nothing;
weighted encounters keep their honest "equal chance" partial line.

**D-M4A-8 — Looping maps:** `GameMap.loop?: { h?: boolean; v?: boolean }` (importer:
scrollType 1 V / 2 H / 3 both). Wrap-aware tile reads (`tilePassable`, behaviors, regions,
ledges) via `wrapX/wrapY`; movement normalizes coordinates on arrival (render coords shift
by ±width so interpolation never sweeps); the Canvas-2D camera unclamps on the looping
axis and the map buffers draw wrapped (repeat ±map px); entities near the seam draw at the
camera-nearest alias. HD-2D path does not loop (imported maps are classic; documented).
Pathfinding/minimap stay bounded (honest limitation, spec-logged). Fully presence-gated on
`map.loop`.

**D-M4A-9 — Parallax:** `GameMap.parallax?: { key, loopX?, loopY?, sx?, sy? }` (key =
`asset:pictures/<slug>`, same "add the art and it appears" report pattern as M2 pictures).
Runtime: loaded at `loadMap` (missing art ⇒ draws nothing, never a crash); when present,
the prerender skips the opaque base fill and the 2D render paints the parallax under the
lower buffer — MZ origin semantics: `!`-prefixed name = locked to the map (1:1 camera),
loop axis = half-speed camera + `s×/2` px-per-tick drift, non-loop = screen-fixed.
Command 284 swaps it at runtime (until the next map load). HD path: skipped (classic maps
only), documented.

**D-M4A-10 — Battlebacks:** `GameMap.battleback?: { back1?, back2? }` +
`system.battleback` default (asset:pictures keys; importer applies map fields only under
`specifyBattleback`). `Battle.run` resolves override (283 command, cleared on map load) →
map → System default and sets the `.battlewin` background (back2 over back1); missing art
⇒ the classic battle backdrop. RM's overworld terrain-based auto-battlebacks stay a report.

**D-M4A-11 — Vehicle commands:** new Atlas commands (schema + CMD_DEFS + interpreter):
`setVehiclePos` (202, direct or by-variables designation), `vehicle` (206 board/exit
toggle through the existing `tryVehicleAction`/disembark path), `vehicleImage` (323 →
`G.vehicleImages[type]` charset-key override read by `refreshPlayerCharset` +
`vehicleDrawables`, persisted with the save like `G.vehicles`).

**D-M4A-12 — Change Tileset (282) = locked skip.** Atlas maps bake resolved tile ids +
art at import; a runtime whole-tileset swap has nothing honest to swap. Matrix row flips
to `−` ("M4·A decision"); 282 moves from the TODO table to the SKIP table with a friendly
line. Re-import keeps working (SKIP lines never round-trip as placeholders by design).

**Editor affordances:** Map Properties gains Loop checkboxes + parallax key/scroll fields
+ battleback keys (existing tabbed dialog); the Tilesets tab already edits every behavior
this step ships (its tooltips promised them). Patch-notes entry + version bumps per
AGENTS.md.

### Test plan

- vitest: tile-behavior cache (layer union, topmost terrain, autotile flag byte, presence
  gates), wrap math, encounter-pool selection incl. byRegion gate, floor-damage/slip
  clamps, importer flips (byRegion shape, loop/parallax/battleback fields, group
  `props.flag`, 202/206/323 translations, 282 skip line, dropped todo lines), report-line
  diffs in `mz-import-maps.test.ts`/`mz-translate-commands.test.ts`.
- node + Playwright suites stay at 0 failures (frozen map 1 untouched; imported-fixture
  e2e re-runs).
- Fixture generator: amendments (if any) go into `scripts/build-migration-fixtures.mjs`
  FIRST, then regenerate — the generator is the source of truth (f2ba661 lesson).

### Stage log

- **2026-07-05 — M4·A started (branch `mig-4a`).** Read roadmap phase M4, the matrix
  "M4·A — map features" bill (§1 opts/battlebacks, §2 map fields, §8.5/§8.7 commands
  202/206/282/283/284/323, §11 flag bits, §12a vehicles), `map-runtime.ts`/`map.ts`/
  `render-glue.ts`/`battle.ts` (DOM battle win), `presentation-runtime.ts` (picture asset
  pattern), `convert-tilesets.ts`/`convert-maps.ts`/`tile-ids.ts`/`convert-system.ts`/
  `translate-commands.ts`, `tilesets-tab.ts`, the fixture generator, and the existing
  importer tests. Wrote this spec. Found: fixtures already exercise the whole bill;
  `byRegion` engine roll exists (Phase 5) but its gate skips byRegion-only maps; autotile
  groups never stored behavior flags (new `props.flag`). Design locked above (D-M4A-1…12);
  282 decided as a locked skip. Implementation next.

- **2026-07-05 — M4·A complete (branch `mig-4a`).** Shipped, per the locked design:
  **engine** — pure `src/shared/tile-behavior-core.ts` + glue
  `src/engine/scenes/tile-behavior.ts` (flag/terrain cache, painted-presence gate, wrap
  math); ladder facing on arrival/jump-land; bush 12px feet-fade in both render paths;
  counter third-probe in `checkActionTrigger`; damage floors (10 × floorDamage sp-param,
  optFloorDeath cap) + the mzBattleFlow-gated 20-step map regen tick (optSlipDeath cap) in
  `onPlayerStep`; terrain tags feed `locationInfo`; looping maps (wrapped tile reads,
  arrival normalization with interp-coherent coord shifts, unclamped loop-axis camera +
  wrapped buffer/sprite draws, Canvas-2D only); parallax underlay (transparent-base
  prerender, MZ origin semantics: lock 1:1 / loop half-camera + s×/2·tick drift /
  screen-fixed); battlebacks in `Battle.run` (override → map → System, back2 over back1,
  `.battlewin.hasbb`); byRegion-only encounter gate widening + empty-pool return; five new
  commands (setVehiclePos/vehicle/vehicleImage/battleback/parallax) through the registry,
  `G.vehicleImages` in saves. **Importer** — 202/206/283/284/323 flipped to real commands,
  282 → locked-skip line (matrix row amended to `−`); regionSet → `byRegion` (MZ validity:
  region pool = global ∪ region troops); scrollType → `loop`; map/System battlebacks +
  parallax (incl. `!`-lock) as `asset:pictures/…` keys with one "add the art" line each;
  autotile groups store `props.flag`; behavior/terrain report lines dropped (live now),
  partial-passage line kept; optFloorDeath/optSlipDeath onto System. **Editor** — Map
  Properties: loop checkboxes, parallax key/loop/drift/lock, battleback keys; five CMD_DEFS
  with forms. **Tests** — new `tests-unit/tile-behavior.test.ts` (8), SPEC-table flips + an
  M4·A command describe block, map-import expectations flipped (byRegion shape, group flag,
  parallax/loop/battleback fields, dropped report lines): 794 vitest · 18 node · 70/70 e2e,
  frozen map 1 untouched. Patch notes ?v=52, play.css v26. Honest limitations logged:
  HD-2D path neither loops nor draws parallax (imported maps are classic); 284 on a map
  imported without its own parallax stays invisible (opaque prerender base); pathfinding/
  minimap stay bounded on looping maps; battleback/parallax command overrides reset on map
  load (MZ-faithful for battlebacks). Fixtures already exercised the whole bill — no
  generator amendment needed.
