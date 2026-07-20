# Phase MP7 Spec — Editor, Database, Event Commands, Plugin API, Docs ("Project Beacon")

**Status:** 🚧 IN PROGRESS (Opus build). Stage A landed 2026-07-19.
**Authored:** 2026-07-19 by Claude Opus 4.8, from the MP7 section of
`docs/MULTIPLAYER_ROADMAP.md` + `docs/mp-6-spec.md`.
**Workflow:** commit + push each stage to `main`; the frozen pixel goldens stay
**byte-identical at every stage** (every MP7 addition is additive + inert at its
default — a game with multiplayer OFF takes the exact pre-MP7 code path); log
deviations here.

## Objective

Multiplayer becomes a thing a kid can author, not a dev flag. Stage A is the
Database ▸ Multiplayer section (the enable toggle replacing the MP5 dev flag,
capacity, relay URL, chat mode with the D4 safety note, preset phrases, per-map
spawn points). Stage B adds the multiplayer event commands + conditional
operands. Stage C opens the plugin API's additive net surface (the 2.0
unfreeze). Stage D localizes the player-facing strings, ships the wiki pages,
rebuilds the docs-site, and adds the editor e2e.

## The governing reality (carried from MP6, read before the stages)

- **D-6-0 / D-7-0 (where multiplayer runs).** Battles + events execute on the
  world **authority**. In a relay room the authority is the headless Beacon
  server which, per D-5-0, runs **no events, no encounters, no battles** until
  MP8·A's per-zone runtime. So the LIVE multiplayer proof still runs on the
  **MP4-local co-op path** (BroadcastChannel; the host browser is the authority
  and has the full engine). MP7 builds the **authoring surface + solo-correct +
  headless semantics** the same way MP3/MP4 built structure ahead of the server
  runtime; full multi-player event effects over the relay ride MP8. This is the
  boundary the gate inherits, exactly like MP6's D-6-0.
- **D-6-1 (the G partition line).** party/inv/gold are per-player;
  switches/vars/selfSw/timeOfDay are world-shared. MP7·B's per-player switch
  scope is the first NEW per-player namespace on top of that partition.

---

## Stage A — Database ▸ Multiplayer section (Opus, landed 2026-07-19)

### What landed

**Schema + migration (`js/data.js`, the runtime data model):**

- `RA.defaultMultiplayer()` — the inert default:
  `{ enabled:false, maxPlayers:4, relayUrl:"", chatMode:"off", presets:[], spawns:{} }`.
  `enabled:false` keeps `multiplayerEnabled()` false → no "Play Together" title
  entry → byte-identical. `relayUrl:""` ⇒ the built-in Driftwood relay.
- `RA.normalizeMultiplayer(value)` — idempotent validate/clamp: maxPlayers
  clamped to 2–16, chatMode ∈ {off,presets,text} (else off), presets
  trimmed/blank-dropped/≤60 chars/≤24 entries, spawns keyed by non-negative int
  mapId with x/y clamped 0–999 and dir ∈ {down,left,right,up}. Unknown fields
  dropped; garbage → the full default.
- `migrateProject` now calls `p.system.multiplayer = RA.normalizeMultiplayer(...)`
  at the every-load-boundary tail (after the Types backfill, before the version
  stamp) — so already-current v2 projects and MZ/MV imports gain the inert block
  after they were saved, exactly like the Types-list backfill precedent.
  **FORMAT_VERSION stays 2** (additive).
- `src/shared/schema.ts` — `MultiplayerConfig` / `MultiplayerSpawn` interfaces +
  the optional `SystemData.multiplayer` field (type mirror for the sim/editor).

**Editor (`src/editor/database/`):**

- **`multiplayer-tab.ts`** (NEW) — the "Multiplayer" DB tab: Play Together enable
  toggle (with a plain-language intro), max players (2–16), play-server address
  (blank = Driftwood's relay, shown by literal), chat mode select with the D4
  safety note that turns emphatic on "text", preset-phrase textarea (one per
  line), and a per-map spawn-point editor (add a map → x/y/facing row; remove to
  fall back to the start position). Field labels go through `field()`'s `t()` and
  fall back to English — **DB field labels are i18n-exempt by precedent**, so the
  tab adds no keys to the i18n parity set.
- **`index.ts`** — registers the tab between Types and Switches in `dbTabs()`.

**Sim + server wiring:**

- **`src/shared/sim/players.ts` `resolveSpawn`** — when the resolved map has an
  authored spawn point (`system.multiplayer.spawns[mapId]`) and the caller didn't
  pin x/y/dir, the spawn point overrides the project start. Absent (or an
  unmigrated project) falls straight through — byte-identical to pre-MP7. Pure,
  still lint-walled (reads project data only, no new imports).
- **`server/src/core/room.ts`** — a new `capacity` getter: the project may author
  a SMALLER cap (`system.multiplayer.maxPlayers`); it can only ever LOWER the
  ceiling, so the operator's `maxPlayersPerRoom` stays the authoritative maximum
  (a hostile project can't inflate capacity). `isFull` reads `capacity`.

### Tests (+ new + extended)

- `tests/mp-project.test.js` (NEW, node --test vm harness): defaultMultiplayer
  shape, normalizeMultiplayer clamping (maxPlayers bounds, unknown chatMode,
  preset trim/cap, spawn validation + bad-dir/negative-mapId drops, garbage →
  default), migrateProject backfill on a v2 project (enabled stays false),
  authored-config survival, idempotency.
- `tests-unit/sim-players.test.ts` (+3): resolveSpawn honors an authored per-map
  spawn point, falls back to start on maps without one, and explicit x/y/dir
  still win.
- `tests-unit/beacon-server.test.ts` (+2): an authored `maxPlayers` caps the room
  below the server ceiling; it can never exceed the operator's ceiling.

### Live verification (vite dev)

The tab was mounted via ESM import against a synthetic project (screenshots time
out on this app, per the editor-preview-verification memory): all six fields
render, the enable toggle / max-players / relay-URL / chat-mode / presets /
spawn-add all write to `system.multiplayer`, the "text" chat mode reveals the
safety note, and presets are trimmed with blanks dropped. Zero console errors.

### Draw-conservation / byte-identity note (stage A)

Nothing in stage A draws RNG or renders in play. `enabled:false` (the migrated
default) means `multiplayerEnabled()` is false → the title screen has no "Play
Together" entry → the frozen fixtures render byte-identically. The
`system.multiplayer` block added by migration is inert data the renderer never
reads.

### Cache-busts / versions (stage A)

- `js/data.js` changed → `?v=35` → **`?v=36`** in `index.html` + `play.html`.
- No `editor.css` / `patch-notes.js` change (the tab reuses existing `.dbform` /
  `field` / `row` chrome; inline styles only). Version stays **1.2.0**;
  FORMAT_VERSION stays **2**.

---

## Stage B — Event commands & conditional operands (Opus, landed 2026-07-19)

Four additive authoring surfaces, each **solo-inert** (a command that never uses
the new field runs the exact pre-MP7 path → goldens byte-identical, determinism
hash **46633057** unchanged). Full multi-player event effects over the relay ride
MP8's server-run events (D-7-0); MP7·B is the authoring + solo-correct +
headless semantics, exactly how MP3/MP4 built structure ahead of the runtime.

### What landed

**Wait for All Players (`waitPlayers`):**

- `src/engine/interpreter/commands/flow.ts` — a co-op sync barrier: solo
  (`mpOnline()` false) returns **instantly**; online it polls every 6 world ticks
  until every roster peer has gathered on the event's map (`mpAllOnMap`), or a
  `timeout` (seconds, default 10, capped 60) releases it so one wandering friend
  can't freeze the event forever.
- `command-defs.ts` — the "Wait for All Players" command def (timeout field,
  summary, help). Pickable in the command picker (CMD_DEFS auto-lists).

**Show Message To (trigger / everyone):**

- `command-defs.ts` — the `text` form gains a "Show to" select; stored as
  `to:"all"` only when Everyone (absent = the classic single message).
- `flow.ts` — the `text` handler passes `to:"all"` into the message directive.
- `src/shared/sim/directives.ts` — `roomPlayersOf(world)` (`[local, ...peers]`)
  + the presentation port's `message` broadcasts a `to:"all"` message to every
  OTHER room player **fire-and-forget** (their client dismisses its own copy; a
  disconnect is swept by `autoResolveDirectivesFor`) and awaits **only the
  origin's reply** — so the event never hangs on an absent peer. Solo has no
  peers ⇒ the broadcast collapses to the single local message.

**Per-player vs world switch scope:**

- `command-defs.ts` — the `switch` command AND the `if`-switch condition gain a
  Scope select (World shared / This player); stored as `scope:"player"` only when
  per-player (world scope keeps the pre-MP7 shape).
- `state.ts` — the `switch` handler writes a per-player switch to the origin
  player's own namespace (`G.pSwitches[pid][id]`); world scope is unchanged.
- `interp.ts` — `testCond` reads the origin player's `pSwitches` for a
  `scope:"player"` switch condition.
- `world.ts` (`createInitialGameState`) + `title.ts` (`newGame`) + `save.ts`
  (build/apply) — `G.pSwitches` initialized `{}`, reset on New Game, and
  round-tripped in saves (old saves load `{}`, the wallet/vehicles precedent).
  The determinism hash excludes switches, so the empty namespace is inert.

**Is Online / Player Count conditions:**

- `command-defs.ts` — two new `if` operands ("Playing Online" boolean, "Player
  Count" numeric with a comparator).
- `interp.ts` `testCond` — `online` reads `EngineServices.mpOnline()` (solo
  false), `playerCount` reads `EngineServices.mpPlayerCount()` (solo 1).
- `boot.ts` — `EngineServices.mpOnline` / `mpPlayerCount` / `mpAllOnMap`, reading
  `active` (host/client refs) + the authority world's roster. All three are inert
  in solo (no room ⇒ offline, count 1, empty roster ⇒ everyone trivially "on the
  map" so Wait for All Players returns at once).

### Tests (+ new)

- `tests-unit/directives-broadcast.test.ts` (NEW, +5 vitest): `roomPlayersOf`
  (solo `[0]`; local + peers), and the `to:"all"` broadcast — solo → single
  message, co-op → reaches every room player and awaits only the origin (silent
  peers leave their fire-and-forget copies pending, the event resolves), and a
  plain message carries no broadcast flag.
- `tests/mp-commands.test.js` (NEW, +1 node → 48): the real interpreter registry
  + `Interp.testCond` (esbuild-bundled): switch scope player/world isolation,
  per-player switch read, online true/false, playerCount comparator, waitPlayers
  solo-instant + bounded online barrier + timeout release, text `to:"all"` flag.
- `tests-unit/sim-world.test.ts` — the boot-time G shape assertion gains
  `pSwitches: {}`.

### Draw-conservation / byte-identity note (stage B)

No new RNG draw. Every new field is absent on existing commands (`scope`, `to`,
the two new operands, `pSwitches`), so migrated projects run the identical code
path; the determinism canary **46633057** is re-verified green after the
`createInitialGameState` addition (the hash excludes switches/pSwitches).

### Cache-busts / versions (stage B)

Pure `src/` (TS) + tests — **no `js/` file, no `?v=` bump**. Version 1.2.0;
FORMAT_VERSION 2.
