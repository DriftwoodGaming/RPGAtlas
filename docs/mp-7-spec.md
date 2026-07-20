# Phase MP7 Spec — Editor, Database, Event Commands, Plugin API, Docs ("Project Beacon")

**Status:** ✅ **BUILD COMPLETE (Opus) — awaiting Fable gate.** Stages A/B/C
landed 2026-07-19, stage D 2026-07-20. Commits: A `a9f19ee` · B `dc8aa9f` ·
C `fe6e73d` · D `2a5c275`. The MP7 GATE block is at the bottom of this file; the
Fable gate records the verdict + tags `beacon-7`.
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

---

## Stage C — Plugin API net surface (Opus, landed 2026-07-19)

The additive net surface — the 2.0 plugin-API unfreeze (D7). `atlas.mp` lets a
plugin build co-op mechanics on top of Beacon: presence hooks + an opaque
custom-message channel. **Custom messages are communication tier** (relayed like
emote/chat, no world sim), so — unlike parties/battles (D-6-0) — they work over
BOTH the local co-op bus AND the relay **today**.

### What landed

**Protocol (`src/shared/net/protocol.ts`):**

- `ClientCustom = { t: "custom"; data: JsonValue }` +
  `ServerCustom = { t: "custom"; from: PlayerId; data: JsonValue }`, added to the
  unions. `data` is opaque — the engine NEVER interprets it. Strict decoder arms
  both directions (client: `data` present; server: uint `from` + `data`);
  size bounded by the existing frame byte cap, rate by the message token bucket.

**Relay server (`server/`):**

- `server.ts` route lets `t:"custom"` through to the room in-room dispatch;
  `room.ts handleFrame` relays `{t:"custom", from: pid, data}` to every OTHER
  member (never back to the sender) — the emote/chat passthrough pattern, no
  world-sim involvement. The MP5 security posture is unchanged (opaque relay,
  scoped to the room, capped + rate-limited; no IP/PII).

**Engine transports:**

- `room-host.ts` (MP4-local): a client's `custom` frame broadcasts to other
  clients + fires `onCustom` for the host's own plugins; `sendCustom(data)`
  broadcasts the host's own message (from id 0). `broadcast` widened to
  `ServerMessage`.
- `room-client.ts` / `relay-client.ts`: handle the server `custom` frame →
  `onCustom({from, data})`; add `sendCustom(data)`. `active.ts ClientLike` gains
  `sendCustom`.

**Engine co-op + plugin runtime:**

- `co-op.ts`: `fns.mp` (sendCustom/isOnline/players/self, late-bound so the
  plugin runtime never imports the net tree) + presence join/leave fire the
  plugin hooks + `onCustom` wired into all three connect paths (host/client/
  relay). `myName` tracked for `self()`. All inert in solo.
- `plugin-runtime.ts`: `Plugins.hooks` gains `playerJoin`/`playerLeave`/`custom`
  (fired via the existing `Plugins.fire`); the `atlas.mp` bridge exposes
  `onPlayerJoin` / `onPlayerLeave` / `onCustom` / `sendCustom` / `isOnline` /
  `players` / `self`, delegating to `fns.mp`.

### API shape (frozen again after 2.0 — kept minimal)

```
atlas.mp.onPlayerJoin(fn)   // fn({ id, name })
atlas.mp.onPlayerLeave(fn)  // fn({ id, name })
atlas.mp.onCustom(fn)       // fn({ from, data })  — data is your JSON payload
atlas.mp.sendCustom(data)   // broadcast an opaque JSON payload to the room
atlas.mp.isOnline()         // true while in a room
atlas.mp.players()          // [{ id, name }, …] including self
atlas.mp.self()             // { id, name }
```

### Tests (+ new)

- `tests-unit/net-protocol.test.ts` (+3): custom client/server round-trips (any
  JSON-safe payload), and rejects (missing `data`, bad `from`, oversized frame).
- `tests-unit/beacon-server.test.ts` (+1): a client's custom message relays to
  every OTHER member tagged with the sender's id, never echoed to the sender.
- `tests-unit/coop-session.test.ts` (+1): over the real BroadcastChannel bus,
  custom messages relay client→host (+ to other clients, not the sender) and
  host→clients (from id 0).

### Live verification (vite dev)

Importing `co-op.ts` installs `fns.mp` (inert in solo: `isOnline()` false,
`players()` = `[{id:0}]`, `sendCustom` a no-op that never throws); the plugin
hook arrays (`playerJoin`/`playerLeave`/`custom`) exist and `Plugins.fire`
delivers the right arg shape to registered hooks.

### Draw-conservation / byte-identity note (stage C)

No RNG, no render. Everything is gated on an active room (`active.host` /
`active.client`), null in solo. The new wire arm is additive within protocol v1
(the D-6-3 precedent); no PROTOCOL_VERSION bump.

### Cache-busts / versions (stage C)

Pure `src/` + `server/` + tests — **no `js/` file, no `?v=` bump**. Version
1.2.0; FORMAT_VERSION 2. (The plugin-API wiki page + the js/plugins.js header
doc land in stage D.)

---

## Stage D — i18n, wiki, docs-site, editor e2e (Opus, landed 2026-07-20)

Localizes the player-facing multiplayer strings, ships the two wiki pages,
rebuilds the docs-site, and adds the editor e2e for the Multiplayer tab.

### What landed

**Runtime i18n (`src/engine/mp-i18n.ts`, NEW):**

- The engine had **no runtime i18n** before (every player string was English).
  This is a small, self-contained table for the Beacon surface only: an English
  identity base (`MP_EN`, 33 keys) + the **ten** editor locales (`MP_PACKS`:
  es/fr/de/ja/zh-tw/zh-cn/pt/ko/it/ru). `mpText(key, params)` substitutes
  `{name}`/`{names}`/`{code}` placeholders and falls back English → key.
- Locale selection (best-effort, self-contained): the editor's saved locale
  (`localStorage rpgatlas_editor_locale`) → `navigator.language` prefix → English.
  A shipped game with no hint stays English (pre-MP7 behavior).
- **`co-op.ts`** routes every player-facing string through `mpText`: the Play
  Together modal (title/name/create/join/cancel/status), presence toasts, the
  friendly error + kick copy, party toasts, and the battle overlay/toasts.

**A genuine consistency fix surfaced by MP7 (`boot.ts`):**

- The fresh-project boot fallback ran `DataDefaults.newProject()` **without**
  `migrateProject` (only `loadStored()` migrated). So a brand-new game skipped
  the additive backfill (Types lists — and now `system.multiplayer`). Fixed:
  `loadStored() || RA.migrateProject(DataDefaults.newProject())` — migrateProject
  is the one boundary every entry path runs. Idempotent + additive; no golden is
  an editor fresh-project, so byte-identity holds.

**Wiki + docs-site:**

- **`wiki/Making-Your-Game-Multiplayer.md`** (NEW): turn it on, the Multiplayer
  settings, the online event commands, party/battle, and the kid-safety summary.
- **`wiki/Hosting-a-World.md`** (NEW): friend rooms vs self-hosted; running the
  Beacon server (Node + Cloudflare); the "what crosses the wire" parent/teacher
  page; moderation.
- **`wiki/Plugin-and-Script-API.md`**: the `atlas.mp` surface table + example.
- **`wiki/_Sidebar.md`** (new "Play together" section), **`Home.md`**,
  **`The-Database.md`** (the Multiplayer tab) updated.
- **docs-site rebuilt** (`node scripts/build-docs-site.mjs`): **25 → 27 pages**.

**Editor e2e (`tests-e2e/mp-database.spec.mjs`, NEW):**

- Boots the real editor, opens Database via the command palette, switches to the
  Multiplayer tab, ticks Enable + sets capacity / chat mode (asserts the D4
  safety note appears) / presets / a spawn point, and asserts they persist to the
  project document (localStorage) with FORMAT_VERSION still 2. Additive — no
  golden touched.

### Tests (+ new)

- `tests-unit/mp-i18n-parity.test.ts` (NEW, +34 vitest → 1194): every one of the
  ten packs defines EXACTLY the English key set (no missing, no orphans),
  non-empty values, placeholders preserved; `mpText` fallback + substitution.
- `tests-e2e/mp-database.spec.mjs` (NEW, +1 Playwright → 128): the tab round-trip.

### Live verification (vite dev)

`mpText` returns English by default, `Jugar juntos` (es), `いっしょに遊ぶ` (ja),
French error copy, with `{name}` substitution — confirmed by importing the module
and flipping `localStorage rpgatlas_editor_locale`.

### Gate snapshot (stage D)

| Gate | Result |
|---|---|
| vitest (test:unit) | **1194** (79 files; +34 over stage C's 1160) |
| vitest (test:net) | **7** |
| node --test | **48** (determinism hash 46633057 green) |
| Playwright | golden/editor/mp subset (43) green · `git diff beacon-6..HEAD -- "*.png"` **EMPTY** · mp-database new |
| tsc / eslint | **0 / 0** (root + server Node/CF) |
| i18n parity | editor 31 green + **Beacon mp-i18n 34 green (10 locales, both directions)** |
| docs-site | **27 pages** (+2) |
| versions / FV / cache-busts | 1.2.0 · 2 · none (all `src/` + docs; no `js/` `?v=` file touched) |

---

## Phase gate (Fable, after D)

Template gates + i18n parity (both the editor's 10 locales AND the new Beacon
`mp-i18n` 10) + migrateProject round-trip + the new editor e2e + old-project
byte-identity + a minimality review of the plugin net surface (it re-freezes
after 2.0). Verdict recorded here + the roadmap status table; tag `beacon-7`.

**MP7 GATE kickoff (paste into a new Fable conversation):**
```
Project Beacon — MP7 GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP7) + docs/mp-7-spec.md (all of it — stages A DB section · B event commands · C plugin API · D i18n/wiki/docs-site, plus the deviations D-7-0 and the boot.ts migrate fix).
Independently re-run the template gates: npm run test:unit (expect 1194) · npm run test:net (7) · node --test tests/ (48 — the determinism hash 46633057 must hold) · cargo test (26, Rust untouched by MP7) · npx tsc --noEmit + the server typechecks (server/ tsconfig.json AND tsconfig.cf.json, both 0) · npx eslint src --ext .ts (0, and prove the sim wall still FIRES on a probe import into src/shared/sim/) · FULL npx playwright test (128/128; perf within ±10%). Solo byte-identity: `git diff beacon-6..HEAD -- "*.png"` must be EMPTY. Flake bar: run tests-e2e/mp-database.spec.mjs 3× consecutively.
i18n parity (both directions, all locales): tests-unit/i18n-parity.test.ts (editor chrome, 31) AND tests-unit/mp-i18n-parity.test.ts (the Beacon player strings — every one of the 10 packs defines EXACTLY the English key set, no missing, no orphans, placeholders preserved). Confirm the DB-tab field labels are i18n-EXEMPT by precedent (they never enter the parity set).
migrateProject round-trip (additive backfill): verify tests/mp-project.test.js — an old v2 project with no `system.multiplayer` gains the inert default (enabled:false → multiplayerEnabled() false → byte-identical), the normalizer clamps every field, and it's idempotent. Verify the boot.ts fresh-project fallback now migrates (RA.migrateProject(DataDefaults.newProject())) so a brand-new game is consistent.
Plugin net surface minimality (it re-freezes after 2.0): review atlas.mp (onPlayerJoin/onPlayerLeave/onCustom/sendCustom/isOnline/players/self) — confirm it is minimal, versioned within protocol v1 (no PROTOCOL_VERSION bump), and that the `custom` wire arm is opaque + capped by the frame byte cap + rate-limited by the message bucket + scoped to the room (relayed like emote/chat, never a world-sim surface), and that the MP5 security posture is unchanged (no IP/PII on the wire; sender never gets its own echo).
Semantics review against the spec: A the DB block + resolveSpawn per-map spawns + the server capacity cap (authored maxPlayers only LOWERS the operator ceiling); B waitPlayers solo-instant + Show-Message-To broadcast (fire-and-forget to peers, awaits only the origin) + per-player switch scope (G.pSwitches, save round-trip) + Is Online/Player Count (solo false/1); C the custom channel both directions on the local bus AND the relay; D the runtime i18n + the two wiki pages + docs-site 27 pages. Confirm the deferral D-7-0 as the intended boundary (relay runs no events until MP8·A; MP7·B builds the authoring surface + solo-correct + headless semantics — the MP3/MP4 precedent).
Record the verdict here + the roadmap status table, tag beacon-7, push with tags, and end with the MP8 BUILD hand-off block.
```

### VERDICT — ⏳ PENDING (Fable gate)

_The Fable gate records the verdict here, updates the roadmap status table, and
tags `beacon-7`._
