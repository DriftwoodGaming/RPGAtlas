# Phase MP9 Spec — Safety, Chat, Moderation, Packaging, Release 2.0 ("Project Beacon")

**Status:** BUILD ✅ (Opus, 4 stages) → **RELEASE GATE ❌ NO-GO 2026-07-20 (Fable)
— `beacon-9` + `v2.0.0` NOT tagged.** All numeric/safety gates re-verified PASS;
the fresh-eyes playthrough fails its co-op-battle leg (D5 unreachable by
players). See §RELEASE GATE at the end of this file for the full verdict,
findings F-1…F-5, and the fix fork. Prior: `beacon-8` tagged (MP8 LOAD GATE
PASS 2026-07-20).

**Authored:** 2026-07-20 by Claude Opus 4.8, from the MP9 section of
`docs/MULTIPLAYER_ROADMAP.md` + `docs/mp-8-spec.md`.
**Workflow:** commit + push each (sub)stage to `main`; the frozen pixel goldens
stay byte-identical (every MP9 player-facing surface is gated behind
`multiplayerEnabled()` / an active session, absent in the frozen fixtures);
log deviations here.

## Objective (roadmap MP9)

- **A — chat + moderation.** Opt-in filtered text chat (D4): the dev toggle is
  already in the DB (MP7); add the filter engine (word-list, English full +
  best-effort other locales, documented honestly), instant client-local mute,
  report → room-owner / world-operator inbox, chat rate limits. Moderation:
  room-owner kick/ban, operator ban-by-passport, operator CLI + log.
- **B — packaging + safety docs.** web/itch PWA zip + game EXE exports carry Play
  Together; the `npx`/`wrangler` "Hosting a World" quickstart; the parent/teacher
  plain-language safety page (wiki + docs-site).
- **C — showcase.** Driftwood Shore co-op demo scenario (NOT editing frozen
  map 1 — follow the build-atlas-quest derived-map pattern) + a hosted demo flow.
- **D — release.** version → 2.0.0 across the 7 sites, patch note, cache-busts,
  README, docs-site rebuild, plugin API re-frozen for 2.x, roadmap header
  verdict, memory-file update. (Tags are the RELEASE gate's job.)

---

## Stage A — chat + moderation (Opus)

### A1 — Chat filter engine + moderation protocol surface ✅ landed 2026-07-20

**`src/shared/net/chat-filter.ts`** (NEW, pure, DOM-free — the SERVER imports it
as the authority; the client imports it to pre-mask its own outgoing bubble, so
the sender sees exactly what everyone else will). A per-token word-list filter:

- **Honest scope, documented in the file header + the MP9·B wiki safety page.** A
  word-list filter is a courtesy layer, NOT a safety guarantee — the real
  protections are structural (chat OFF by default per game, instant client-local
  mute, report + owner/operator kick/ban). It catches the common cases well:
  case, punctuation/spacing WITHIN a token (`F.U.C.K`, `sh!t`), light leetspeak
  (`sh1t`, `@ss`), letter elongation (`fuuuck`), and accents/diacritics
  (`coño`→`cono`, `Scheiß`→`scheiss`). It does NOT defeat single letters spaced
  with whole words between them, novel slang, or non-Latin scripts (Cyrillic/CJK
  aren't letter-normalized) — asserted AS tests so the limits can't drift.
- **Two match tiers** (the Scunthorpe tradeoff, made explicit): `SEVERE` roots
  match as a leet+elongation-tolerant SUBSTRING (curated to words with near-zero
  innocent substrings; an `ALLOW_CORES` set rescues classics like "scunthorpe",
  "shiitake", "assassin"), while `WORDS` match as a WHOLE token (elongation +
  simple-plural tolerant) so `ass` flags but `assassin`/`class`/`grass` do not
  and `cock` flags but `cockpit`/`peacock` do not. English is the fullest list;
  es/fr/de/pt/it get a best-effort whole-token set; other locales documented as
  unfiltered.
- `censorChat(text) → { clean, changed }` masks each offending token's
  letters/digits with `*`, preserving punctuation, length, and whitespace
  exactly (the sentence shape is unchanged; the word never leaks). The server
  MASKS (never rejects) free text — friendlier + keeps conversation flowing —
  and only rejects when `chatMode !== "text"` (`chat-disabled`, unchanged).
- Proof: `tests-unit/chat-filter.test.ts` (14) — masking cases, no over-masking
  (Scunthorpe rescue), whitespace fidelity, and the honest-limit assertions.

**Protocol (`src/shared/net/protocol.ts`) — additive within v1** (the
MP7-custom / MP8-passport precedent; no `PROTOCOL_VERSION` bump):

- `ClientMod = { t: "mod"; action: "kick" | "ban" | "report"; target; reason? }`
  — `report` is available to any player; `kick`/`ban` are enforced server-side
  (owner-only in a friend room, operator-only in a world). **Mute is NOT on the
  wire** — it is instant + client-local, so it never leaves the device (D6).
- `ServerReport = { t: "report"; from; target; name?; reason? }` — the owner's
  inbox frame. Carries exactly the two public player ids + display name + an
  optional short hint — no IP, no PII (D6).
- Error code `not-allowed` (a non-owner tried to kick/ban). Constant
  `MAX_REPORT_LEN = 120`.
- Strict decoders for both, and `tests-unit/net-protocol.test.ts` extended (now
  34) — round-trips + hostile-input rejection for `mod`/`report`/`not-allowed`.

**Gate slice (A1):** root tsc 0 · server tsc Node 0 / CF 0 · chat-filter 14/14 ·
net-protocol 34/34. No `js/` `?v=` touched; no golden touched (shared/protocol
only, no runtime path reaches it yet — server + client wiring is A2/A3).

### A2 — Server enforcement: chat gate, moderation, operator CLI ✅ landed 2026-07-20

The authority side of chat + moderation, wired identically into the friend-room
path (server.ts + room.ts) and the world path (beacon-world.ts + zone.ts) via a
shared helper.

**`server/src/core/chat.ts` (NEW):** `chatModeOf(proj)` (reads
`system.multiplayer.chatMode`, defaults `"off"` — the MP5 posture for any
project that never touched the toggle) + `resolveSay(proj, msg)` (presets always
pass; free text passes ONLY under `chatMode:"text"`, then `censorChat`-masked —
the server MASKS, never rejects, so chat keeps flowing). A tick-based
`SocialBucket` (burst 6, ~2/s refill) caps the visible say/emote bubble-spam
vector beyond the connection's general 40/s message bucket; exhausting it drops
the say/emote silently (never strikes a kid off the link for chatting).

**Friend room (`room.ts` + `server.ts`):**
- **Owner** = the first player admitted (`ownerPid`); promoted to the
  earliest-joined remaining member when the owner leaves (kick/ban removal AND
  resume-grace reaping in `sweep`).
- **Chat:** `resolveSay` + the social bucket replace the blanket free-text
  rejection; presets + emotes still gated by the social bucket.
- **`mod`:** `report` (any player) → the owner's inbox as a `report` frame;
  `kick`/`ban` are **owner-only** — a non-owner gets `not-allowed`. A friend
  room is anonymous (D3) so `ban` is **name-based** (the display name can't
  rejoin until the room ends; evadable by renaming — documented honestly;
  durable identity bans require a WORLD/passport). `server.enter` refuses a
  banned name at the door (`not-allowed`).
- `server.route` now passes `mod` through to the room like the other in-room
  frames.

**World (`beacon-world.ts` + `zone.ts`):** the zone chat handler uses the same
`resolveSay` + social bucket. `mod` is handled at the **world** level (the zone
doesn't know operators): a world has no in-game owner, so clients may only
`report` (→ the operator inbox + a `warn` log line, carrying the reported
passport **fingerprint** so the operator can ban durably); `kick`/`ban` from a
client are refused `not-allowed`. New operator surface on `BeaconWorld`:
`unban`, `bannedFingerprints`, `recentReports`, `playerList` (all no-PII —
fingerprints + public names only).

**Operator CLI (`server/src/node/main.ts`):** in `--world` mode an interactive
stdin console (TTY-gated, so daemonized servers + the test harness are
unaffected) exposes `players`, `reports`, `ban <pid|fingerprint>`, `unban`,
`bans`, `help`. Ban-by-passport is the durable moderation tool (D3); it persists
in the WorldSnapshot with `--data`.

**Proof:**
- `tests-unit/beacon-moderation.test.ts` (8): chat off → free text rejected /
  preset passes; `chatMode:text` → free text accepted + masked; social bucket
  caps emote spam; first player = owner; non-owner kick → not-allowed; owner
  kick (kick frame + leave); name-ban rejoin refusal; report → owner inbox;
  owner promotion on owner-leave.
- `tests-unit/beacon-world.test.ts` (+5, now 17): world client kick/ban →
  not-allowed; report → operator inbox with the target fingerprint; operator
  ban-by-fingerprint kicks the live session + refuses the door + `unban` clears
  it; world chat obeys `chatMode` (off rejects, text masks).

**Gate slice (A2):** root tsc 0 · server tsc Node 0 / CF 0 · eslint 0 · fast
`test:unit` **1282** (90 files; +30 over beacon-8's 1252: chat-filter 14 ·
beacon-moderation 8 · net-protocol +4 · beacon-world +5) · net `test:net`
**11/11** · both server bundles build + `beacon.mjs --help` evaluates headless.
No golden touched (server-only + protocol); no `js/` `?v=` touched.

### A3 — Client: mute, social/chat panel, moderation UI, i18n ✅ landed 2026-07-20

The player-facing half: the always-on social layer + the moderation tools,
mounted only while a session is live (solo byte-identical).

**Chat policy shared (refactor):** `chatModeOf` + `resolveSay` MOVED from
`server/src/core/chat.ts` to the shared `src/shared/net/chat-filter.ts`, so the
local co-op HOST (RoomHost) enforces the exact same D4 gate as the relay/world
without importing `server/`. `server/src/core/chat.ts` re-exports them + keeps
the server-only `SocialBucket`.

**Client-local mute — `src/engine/net/moderation.ts` (NEW):** a `Set<pid>` with
`isMuted`/`toggleMute`/`setMuted`/`clearMuted`. Muting is instant and never
crosses the wire (D6) — it only decides whether a player's bubbles draw on THIS
device. `render-glue.ts` `drawRemotePresence` now skips a muted player's
emote/say bubble and resolves a **preset** say to its authored phrase
(`sayText`) — both changes live INSIDE the remote-player loop, which never runs
in solo (`remotePlayers` is empty), so the frozen goldens are byte-identical.

**The social panel — `src/engine/net/social-ui.ts` (NEW):** a floating
"💬 Players & Chat" button (mounted on room/world entry, removed on leave) opens
an inline-styled panel: an emote palette (always on), the game's authored quick
phrases (always on), a free-text input (ONLY when `chatMode:"text"`, else the
plain-language `chatOffNote`), and a player list with instant MUTE, plus REPORT
(any player) and KICK / BAN. It talks to whichever transport is live through the
`SocialApi` facade `co-op.ts` supplies (host → the authority; client → the
relay/BroadcastChannel). No editor.css / no cache-bust (inline styles).

**Transports:** `sendMod(action,target,reason?)` + `onReport` added to
`RelayClient` and `RoomClient`; `RoomHost` gained `sendEmote`/`sendChat`
(censored via the shared `resolveSay`)/`sendMod` (the host IS the owner, so it
moderates directly) and now censors peer chat + refuses a peer's kick/ban
(`not-allowed`) + name-bans a rejoin. `RoomClient` also gained `onError`/`onKick`
(parity with the relay so a locally-kicked player gets feedback). `active.ts`
`ClientLike` gained `sendMod`. `co-op.ts` wires `onReport` (owner inbox toast),
in-session `onError` (non-owner kick → `onlyOwner` toast), and mounts/unmounts
the panel (+ `clearMuted` on leave).

**i18n:** 15 new player strings (openSocial, emotesLabel, phrasesLabel,
typeMessage, sendMsg, muteBtn, unmuteBtn, reportBtn, kickBtn, banBtn,
reportedToast, reportInbox, onlyOwner, noOthers, chatOffNote) added to EN + all
10 packs → the mp-i18n parity set is now **58 keys/pack** (parity test still 34
green).

**Proof:** `tests-unit/moderation.test.ts` (3, mute module) ·
`tests-unit/coop-moderation.test.ts` (5, BroadcastChannel: chatMode:text masks a
peer's profanity, chat-off rejects, peer report → host inbox, peer kick →
not-allowed while the host owner kicks, banned name can't rejoin).

**Gate slice (A3):** root tsc 0 · server tsc Node/CF 0 · eslint 0 · fast
`test:unit` **1290** (92 files; +8) · i18n parity 34 (58 keys/pack) · **Playwright
128/128** (perf 235.18/300; renderer-golden + showcase specs green — the
render-glue additions are remote-loop-only, so the frozen goldens are
byte-identical). No `js/` `?v=` touched.

**Stage A complete.** Chat + moderation are wired end-to-end on every transport
(loopback/BroadcastChannel/relay/world) with the D4 posture enforced by the
authority: chat off by default, filtered opt-in text, instant client-local mute,
report → owner/operator, owner kick/ban (friend room) + operator ban-by-passport
+ CLI (world). Solo byte-identical (Playwright 128/128).

---

## Stage B — packaging + safety docs (Opus) ✅ landed 2026-07-20

**Packaging = verification, not code.** Every export builds from `src/` via
`vite build → dist/player-bundle.js` (the shared build manifest + standalone
template both the in-editor export and `package-game-exe.mjs` use), so a game
with Play Together enabled **carries the full MP9 client automatically** — the
social panel, mute, chat, moderation. Confirmed live: the Playwright `mp-relay`
spec drives the real relay "Play Together" flow in the BUILT player and is green
(part of 128/128). A single-player game never mounts any of it (byte-identical).

**Wiki + docs-site (the parent/teacher safety deliverable):**
- **NEW `wiki/Online-Safety.md`** — the plain-language parent/teacher page the
  roadmap requires: is online play even on, what connects to what (client↔server
  only, no P2P, no IPs), what's collected (nothing — no accounts/email/PII; the
  world passport is a random device key with nothing personal), room-code
  privacy, chat off-by-default + an **honest** account of the filter's limits,
  the mute/report/kick/ban tools, self-hosted passport bans, and a 5-point
  checklist. Added to `wiki/_Sidebar.md` nav.
- **`Making-Your-Game-Multiplayer.md`** — documents the in-game "💬 Players &
  Chat" panel (emotes/phrases/chat + per-player mute/report + owner kick/ban),
  the honest filter note, room-owner kick/ban, and corrects the stale "events
  run in a later phase" caveat (MP8·B's `--engine-events` runtime is real).
- **`Hosting-a-World.md`** — adds the MP8 world flags (`--world` / `--data` /
  `--engine-events` / `--zone-workers`), the ~30 s crash-loss budget, the
  passport identity note, and a concrete **operator console** table (`players`,
  `reports`, `ban <id|fingerprint>`, `unban`, `bans`, `help` — durable
  passport bans), plus a pointer to Online-Safety.
- **`Publishing-Your-Game.md`** — a "Multiplayer games" section: exports carry
  Play Together automatically; check the play-server address + chat mode.
- **docs-site rebuilt** (`node scripts/build-docs-site.mjs`): **28 pages**
  (was 27 at beacon-7) — `Online-Safety.html` generated; every page's nav
  refreshed from the updated sidebar.

**Gate slice (B):** docs + docs-site only (no code, no tests, no `js/`
touched); the vite production build with MP9 is green (Playwright webServer +
mp-relay). Wiki/docs-site are the deliverable.

---

## Stage C — showcase: Driftwood Shore co-op demo (Opus) ✅ landed 2026-07-20

A ready-made co-op scenario so a creator can *see* Play Together before building
their own — the Atlas Quest showcase turned into a beach meet-up on **Driftwood
Shore** (map 4), built the **derived-project** way so **no map layout is edited**
(the frozen pixel goldens are untouched — the roadmap's "don't edit frozen
map 1" rule, honored by deriving a whole project, not a map).

- **`scripts/coop-demo-config.mjs` (NEW):** `applyCoopDemo(project)` — the single
  SHARED transform (Node + browser) so the built demo file and the e2e can't
  drift. It sets ONLY `system` fields: title, start on Driftwood Shore (map 4,
  tile 5,6 — the showcase's own known-good shore tile), and
  `system.multiplayer` = enabled · 8 players · `chatMode:"presets"` (the SAFE
  default: emotes + preset phrases, no free typing) · 8 kid-friendly co-op
  presets · a shore spawn so joiners land together. `COOP_DEMO_PRESETS` exported.
- **`scripts/build-coop-demo.mjs` (NEW):** derives `Atlas_Quest_Coop.json` from
  `Atlas_Quest.json` via the shared transform (committed, ready-to-host; rerun
  after editing the showcase). Prints the one-command host line.
- **Hosted demo room flow — `wiki/Making-Your-Game-Multiplayer.md` "Try the
  co-op demo first":** two ways to host (the free relay = zero setup, or
  `node dist/beacon.mjs --project ../Atlas_Quest_Coop.json`), then Play Together
  → Create Room → share code → friend Joins → both on the shore. docs-site
  rebuilt (28 pages).
- **`tests-e2e/coop-demo.spec.mjs` (NEW, +2 → Playwright 130):** the showcase
  loaded through the real pipeline with `applyCoopDemo` — the title offers "Play
  Together" (a solo game doesn't), a New Game lands on **Driftwood Shore**, and
  Play Together opens the Create / Join room flow. Additive; no golden touched
  (multiplayer is gated, absent in the frozen fixtures).

**Gate slice (C):** eslint 0 (new script/config/spec) · **Playwright coop-demo
2/2** (full suite → 130) · Atlas_Quest_Coop.json builds; maps identical to the
source (`[1,2,3,4,5]`). No `js/` `?v=` touched; no map layout edited.

---

## Stage D — release prep (Opus) ✅ landed 2026-07-20 (NOT tagged — the gate tags)

Everything for 2.0.0 except the final verdict-signing + tags, which are the
**Fable RELEASE gate's** job (per the BUILD kickoff: "Do NOT tag v2.0.0").

- **Version → 2.0.0** across the **6 literal sites**: `package.json`,
  `server/package.json`, `src/editor/help.ts` (About display),
  `src/editor/workspace.ts` (storage comment), `src-tauri/Cargo.toml`,
  `src-tauri/tauri.conf.json`. `cargo check` confirms `rpgatlas v2.0.0`
  compiles. (No stray `1.2.0` remains outside historical patch notes / specs.)
- **Patch note:** a "Play Together — online multiplayer is here (RPGAtlas
  2.0.0)" entry added to the top of `js/patch-notes.js` (kid-readable: one
  checkbox, room codes, kid-safe by construction, chat off-by-default with
  mute/report/kick/ban, self-hosting, the new help pages + demo). **Cache-bust
  bumped `patch-notes.js ?v=74 → 75`** in BOTH `src/editor/help.ts` (import) and
  `src/editor/shims.d.ts` (module decl — they must match; tsc enforces it).
  `editor.css` (?v=70) and `data.js` (?v=36) UNTOUCHED (no such file changed) →
  no bump owed.
- **README:** version badge → 2.0.0, "RPGAtlas 2.0", and a "New in 2.0 — Play
  Together" highlight linking Making-Multiplayer / Hosting-a-World /
  Online-Safety.
- **Plugin API re-frozen for 2.x:** `wiki/Plugin-and-Script-API.md` compatibility
  promise now reads "frozen for 2.x" and names `atlas.mp` (the 2.0 net surface)
  as part of the frozen set, with the no-PII/opaque/rate-limited note.
  docs-site rebuilt (28 pages).
- **Roadmap status table** MP9 row updated to 🚧 BUILD COMPLETE (gate-ready
  numbers recorded); the header verdict + tags stay for the gate.
- **FORMAT_VERSION stays 2** (untouched). Frozen goldens untouched (js/
  patch-notes is editor-About only; not on the player/golden path).

**Release follow-up flagged for the gate/operator (NOT in the MP9·D checklist):**
the committed desktop binaries (`RPGAtlas-Desktop.exe`, `RPGAtlas.exe`,
`bin/RPGAtlasLauncher.exe`) still embed the previous build — they are rebuilt
from the now-2.0.0 source with the Tauri/Rust toolchain (`npm run tauri:build` /
`scripts/package-game-exe.mjs`), a heavy step deliberately outside this BUILD
(the web/itch export + source are 2.0.0; the exe rebuild is a packaging step).

**Gate slice (D):** root tsc 0 (patch-notes ?v= matches shims) · cargo check
`v2.0.0` 0 · Playwright editor+coop-demo 24/24 · eslint 0 · version 2.0.0 ×6 +
patch-notes ?v=75 · docs-site 28 pages. No golden touched.

---

## MP9 BUILD complete — hand-off to the Fable RELEASE gate

All four stages (A chat+moderation · B packaging+safety docs · C showcase ·
D release prep) are landed + pushed to `main`. The BUILD did **not** tag.

**Gate-ready snapshot (re-verify from scratch — never trust these numbers):**
fast `test:unit` **1290** (92 files) · net `test:net` **11/11** · node --test
**48** (determinism 46633057) · cargo **26** · Playwright **130/130** (128
goldens byte-identical + 2 coop-demo; perf 235.18/300) · root + server (Node +
CF) tsc **0** · eslint **0** + sim wall fires · mp-i18n parity **34** (58
keys/pack) · **version 2.0.0 ×6 + patch-notes ?v=75** · FORMAT_VERSION **2** ·
both server bundles build + `beacon.mjs --help` headless.

**RELEASE GATE kickoff (paste into a NEW Fable conversation):**
```
Project Beacon — MP9 RELEASE GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (ALL) + every docs/mp-N-spec.md.
Independently re-verify every phase gate (full vitest/node/cargo/Playwright/eslint/i18n/load-harness smoke), run the end-to-end safety checklist (chat off by default, filter/mute/report/kick, no-IP audit, room-code entropy, parent page accuracy), verify version consistency across the sites + cache-busts + FORMAT_VERSION 2, and do the fresh-eyes playthrough (room → join → co-op battle → world, <60s to first join).
Sign the verdict in the roadmap header, tag beacon-9 + v2.0.0, push with tags, update the Beacon memory file, and end with a summary for Driftwood.
```

---

## §RELEASE GATE — verdict ❌ NO-GO (Fable, 2026-07-20; tags withheld)

The gate ran in full. Every re-runnable gate below was re-executed from scratch
this session; every safety-checklist item was re-audited from source (never
from the specs' claims); the playthrough was performed live in a real browser
against real servers built from this tree. The release fails on one finding
that the roadmap's own gate definition makes blocking, plus one operator gap.

### Re-verified PASS (all numbers live this session)

- fast `test:unit` **1290 / 92 files** · net `test:net` **11/11 × 3 consecutive**
  (MP5·E 16-bot latency 144 samples p50 16.4 / p95 31.9 ms vs 150 budget;
  world restart-over-socket round-trip green each run)
- node --test **48/48**, determinism hash **46633057** re-computed live ·
  cargo **26/26** · root tsc 0 · server tsc Node + CF 0 · eslint 0, and the
  MP1·C sim wall PROVEN to fire (probe import of `engine/net/moderation` from
  `src/shared/sim/` → 1 error; an `editor/` probe does NOT fire it — the wall's
  restricted set is engine/ui/renderer/audio/platform/three, as designed)
- **Playwright 130/130** (perf 245.92/300 ms, −4.1 % vs beacon-8's 232.21 →
  within ±10 %); `git diff beacon-7..HEAD -- "*.png"` **EMPTY** (solo frozen
  goldens byte-identical through TWO phases)
- Load smoke re-run live: **200 bots/1 zone p95 74.0 ms** (15,489 samples,
  200/200 moved, 88 MB rss) · **1000 bots/8 worker zones p95 104.4 ms**
  (68,593 samples, 1000/1000 moved, 262 MB rss) — match the MP8-recorded
  82.6/101.8 within noise, 2.4–3× headroom under the 250 ms budget
- i18n: editor parity 31 + **mp-i18n parity 34** green · versions **2.0.0 × 7**
  (package.json, server/package.json, Cargo.toml + Cargo.lock, tauri.conf.json,
  help.ts About, README badge; workspace.ts comment) · patch-notes **?v=75** in
  BOTH help.ts and shims.d.ts · editor.css v70 / data.js v36 correctly
  untouched (`git diff beacon-8..HEAD -- js/` = patch-notes.js +14 only) ·
  FORMAT_VERSION **2** · docs-site **28 pages** incl. Online-Safety.html ·
  both server bundles build; `beacon.mjs --help` evaluates headless
- Coop demo artifact: `Atlas_Quest_Coop.json` maps byte-equal to source
  (no map edited), multiplayer 8-player `chatMode:"presets"`, 8 presets,
  shore spawn map 4 — as specified.

### Safety checklist PASS (all re-audited from source)

- **Chat off by default:** `chatModeOf` defaults `"off"`; free text passes only
  under `"text"`, then `censorChat`-masked; presets always pass. Enforced by
  the ONE shared `resolveSay` on all four transports (server room.ts:283,
  server zone.ts:332, RoomHost peer path :163 AND host-own path :204).
- **Mute** is client-local only — `protocol.ts` contains no mute on the wire.
- **Report** frame = `{t,from,target,name?,reason?}` — two public pids + display
  name + capped hint; room.ts:318 constructs exactly that. World reports carry
  the passport **fingerprint** for durable bans; the `player-report` log
  (beacon-world.ts:306) carries pids/names/fingerprint and **never `source`** —
  the MP5 "keep IPs out of player-correlated moderation logs" note is honored
  (`source` still appears only in the pre-existing transient abuse events:
  conn-idle-timeout / conn-closed-strikes).
- **Room codes:** 9 chars × 30-alphabet = 44.16 bits ≥ 40, CSPRNG,
  rejection-sampled (REJECT_AT 240), collision-checked server-side; live
  normalization proven (typed `7zs-v09-kwx` lowercase+dashes → joined).
- **No-IP wire audit:** grep of both directions + server sources — IP/`source`
  exists only in rate-limit buckets and the documented transient logs.
- **Parent page (Online-Safety.md)** verified claim-by-claim against code:
  accurate throughout except the F-5 wording nit below.
- Passport-file trust-tier promise from MP8 ("same trust tier as a save file")
  is delivered in Hosting-a-World.md:102.

### Fresh-eyes playthrough (live browser, real relay + real world server)

Create Room → code `7ZS-V09-KWX` → second tab Join (lowercase + dashes) →
friend lands on **Driftwood Shore** beside the host: **≈30 s wall clock** ✅
(<60 s budget). Friendly error copy renders verbatim ("Couldn't find that room —
check the code and try again"). 💬 Players & Chat panel: 9 emotes, the demo's 8
phrases, "Free typing is off — use emotes and quick phrases." (presets mode),
per-player **Mute / Report / Kick / Ban** on the owner's view. World leg: Play
Together → Join a World → address → in, silent passport creation + challenge
sign-in, server logs `zone-created {mapId:4}` + `world-join`, engine events ON.
Observed live along the way: empty-room TTL + the 45 s idle reaper both fired
exactly as specified (see F-4).

**The co-op-battle leg cannot be performed — see F-1. The playthrough as the
roadmap defines it (room → join → co-op battle → world) is impossible through
the shipped UI, which fails the gate.**

### Findings

- **F-1 · BLOCKER (D5).** Parties + co-op battles are unreachable by any
  player-facing flow. They run only on the local BroadcastChannel transport,
  whose sole entries are dev-console hooks (`RPGATLAS_MP.createRoom/joinRoom/
  partyInvite`; co-op.ts's own header: local test is "Reached only via the
  RPGATLAS_MP dev hook"). NOTHING in the UI sends `partyInvite` (grep: only
  boot.ts's dev surface; the social panel, menus, map scene and title flow have
  no Team Up affordance). The shipped title flow is relay/world-only, and
  `server/src` contains **zero** party or battle code: relay rooms still run the
  MP5 player-layer world (no encounters — D-5-0 was never closed for rooms),
  and the world engine-zone runtime stubs `Battle: { run: async () => "win" }`
  (D-8-6). Confirmed live: a relay-room `partyInvite` is silently dropped — no
  consent prompt reaches the target. MP6's own principle ("an invite that can
  never battle would be a lie to a kid") now describes the shipped experience,
  while the wiki promises "party up, and fight battles side by side". Each link
  in the deferral chain (D-5-0 → MP8 · MP6 local-only awaiting MP8 · D-8-6
  deferring server battles) passed its phase gate honestly; nobody reconciled
  the chain against the locked D5 ("co-op battles In 2.0") before release, and
  MP9 A–D shipped chat/docs/demo/version work around the gap.
- **F-2 · docs.** Making-Your-Game-Multiplayer's "Party up and fight together"
  section is transport-silent and reads as general online play; the online-
  event-commands section directly above it IS transport-honest ("local co-op
  today… for real on a world server with `--engine-events`"). Fix with F-1.
- **F-3 · operator, release-day.** `DEFAULT_RELAY_URL = "wss://beacon.rpgatlas.app"`
  — the hostname **does not resolve** (checked live this session). Until
  Driftwood deploys the relay (D-B5-1 was always an operator step), every
  "zero setup" path in the docs + demo dies with the friendly offline error.
  Deploy before announce, or soften the copy.
- **F-4 · note.** No client keepalive/auto-reconnect: a tab backgrounded ≥45 s
  is idle-reaped (observed live twice; the server behaves exactly as MP5
  specified). Two-device play is unaffected (both players foregrounded);
  same-machine tab-switching and alt-tabbed hosts are affected. D-8-8's
  reconnect deferral covers the re-dial half; a lightweight WS-level keepalive
  is worth considering in the fix phase.
- **F-5 · nit.** Online-Safety.md says a world ban "keeps that specific device
  from rejoining" — a ban is per-**passport** (key), not per-device; a wiped
  passport is a fresh identity (at the cost of all progress, which is a real
  deterrent). Tighten the sentence in the fix phase.
- Minor coverage note: filter/mute/report/kick are exercised in vitest
  (unit + real-bus) and were exercised live here; no Playwright moderation
  spec exists. Acceptable now; nice-to-have with fork (a).

### Fix fork (Driftwood decides; then re-run this gate)

- **(a) Make D5 true online** — wire party intents + shared battles into the
  server engine-zone runtime (and decide the friend-room story: rooms gain
  `--engine-events`-style sim, or battles are worlds-only and rooms say so).
  The MP6 battle/party core already lives headless in `src/shared/sim/` —
  it was built for exactly this. Biggest work, honest 2.0.
- **(b) Re-scope 2.0** — multiplayer ships as explore/chat/events now, co-op
  battles become 2.1. Contradicts locked D5, so it needs Driftwood's explicit
  sign-off, plus copy edits (wiki battle section, demo copy, patch note).
- **(c) Same-device co-op made real** — a player-facing local-room entry in
  the title flow + a Team Up button (social panel rows), with every battle
  mention transport-labeled. Smallest work; weakest fulfilment of D5.

Whichever fork: deploy the relay or soften "zero setup" (F-3), fix F-2/F-5,
rebuild the desktop exe (still embeds the 1.2.0-era build — MP9·D's flag),
and consider F-4's keepalive. Tags `beacon-9` + `v2.0.0` stay withheld until
a re-gate passes the playthrough end-to-end.
