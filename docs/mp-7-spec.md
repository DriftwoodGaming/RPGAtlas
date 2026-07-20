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
