# Phase MP9 Spec — Safety, Chat, Moderation, Packaging, Release 2.0 ("Project Beacon")

**Status:** BUILD ✅ (Opus, 4 stages) → **RELEASE GATE ❌ NO-GO 2026-07-20 (Fable)
— `beacon-9` + `v2.0.0` NOT tagged.** All numeric/safety gates re-verified PASS;
the fresh-eyes playthrough fails its co-op-battle leg (D5 unreachable by
players). See §RELEASE GATE at the end of this file for the full verdict,
findings F-1…F-5, and the fix fork. **Driftwood locked fork (a) 2026-07-20
(roadmap decision D8) → phase MP9·E is active: work order in §MP9·E below,
kickoff blocks in the roadmap §MP9·E. Tags withheld until the re-gate.**
Prior: `beacon-8` tagged (MP8 LOAD GATE PASS 2026-07-20).

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

---

## §MP9·E — work order (fork (a), decision D8; authored by Fable 2026-07-20)

Driftwood locked fork (a): make D5 true online. Four stages; E-stage logs
append below this section as they land. The guiding fact: the architecture
already points here — `coop-battle.ts`'s header ("MP8's per-zone runtime
becomes the server home"), the instanced sim core, the headless party broker,
and the MP4 free-roam decision were all built FOR this finish.

### Design decisions (locked for the phase; deviations logged per stage)

- **D-9E-1 — Friend rooms become engine worlds, worker-per-room (Node target).**
  A room is what the roadmap diagram always said: ONE world instance ticking
  its occupied maps. The engine world already does multi-map ticking in a
  single instance (MP4 free-roam host); a 2–16 player room needs no per-map
  zone sharding. So: `beacon.mjs --project X` (room mode) spawns one worker
  per room hosting one engine world (reuse the MP8 zone-worker + headless-env
  machinery — `headless-env.ts` must still be imported FIRST, and each worker
  ADOPTS its `defaultWorld`, the one-engine-world-per-process constraint that
  makes worker-per-room the shape). Room semantics preserved EXACTLY: room-code
  capability gate · anonymous hello, never a challenge (D3) · empty-room TTL +
  resume grace · owner = first player + promotion · name-ban + `not-allowed` ·
  the shared `resolveSay` chat gate · social bucket. Engine rooms are the
  DEFAULT for self-hosted Node (the out-of-the-box promise); `--max-rooms N`
  caps a shared relay's worker budget (friendly "relay is full" error beyond
  it). **CF DO rooms stay player-layer in 2.0** (the engine slice is proven in
  plain Node workers; workerd compat for it is unproven — documented honestly
  in Hosting-a-World, deferred as D-9E-D1). The Node relay is the reference
  deployment for room battles.
- **D-9E-2 — Headless battle runner (E1, the Fable core).** New
  `src/engine/net/battle-runtime.ts` beside zone-event-runtime, same
  re-implementation discipline (pure logic re-implemented verbatim-semantics;
  REAL shared helpers imported, never the scene): the turn loop from
  `battle.ts` driven headlessly — troop init from participants' `battleJoin`
  loadouts (`battle-coop.ts` makeActor rebuild path), round loop = collect
  per-participant `battleCmd` directives (the EXISTING coop-battle.ts broker:
  deadlines, AFK all-guard, withdrawal, outbox) → resolve actions with
  `battle-logic.ts` + the game-state helpers → fan out battle events → end
  frames + A-8 reward order (authority classic sequence first, then
  per-participant `rollDrops` behind the coop gate). The zone runtime's
  `Battle: { run: async () => "win" }` stub is replaced by the runner;
  `lastShared` semantics preserved. **N=1 participants = the solo instanced
  battle server-side** — this also un-stubs solo battles in `--engine-events`
  worlds (today auto-"win"). RNG: the zone world's seeded stream (a NEW
  consumer — legal: no solo-loopback stream is shared with it; the frozen
  goldens never run this path). Timed schedulers (ATB/CTB) stay out per the
  deferred ledger — turn-based only, as MP6 shipped. Vitest: a headless battle
  matrix (win/loss/escape · items with D-6-7 itemUsed · AFK all-guard ·
  withdrawal mid-round · N=1 solo · reward split) + determinism hash guard.
- **D-9E-3 — Team Up UI (E3).** `SocialApi` gains `invite(pid)` /
  `leaveParty()`; the social-panel player row gains **Team Up** (and a
  **Leave Team** control in the panel header while partied). Implementation =
  exactly what the dev hook does today: send the `partyInvite`/`partyLeave`
  intent through the active client — the sim validates authoritatively
  (self/ghost/partied/full all already rejected), the consent `choices`
  directive + toasts already exist end-to-end. Works on every transport that
  routes party intents (local co-op now; rooms/worlds after E1/E2). New i18n
  keys (teamUpBtn, leaveTeamBtn, + any toast) ×11 packs; mp-i18n parity test
  updated; DB field labels stay exempt.
- **D-9E-4 — Party scope in worlds.** Parties + shared battles are supported
  within one zone (one map) in 2.0; the leader-transfer party-follow ACROSS
  worker zones is deferred post-2.0 (D-9E-D2, next to D-8-7's multi-DO
  sharding). Friend rooms are unaffected — a room is ONE world, transfers
  inside it keep A-2 follow semantics.
- **D-9E-5 — Client keepalive (F-4).** Additive protocol-v1 client message
  `{ t: "ping" }` (browsers cannot send WS protocol pings): client sends every
  ~20 s from a plain interval; server treats it as liveness (bumps the idle
  clock), never rebroadcasts, normal token-bucket cost. Backgrounded-tab
  interval throttling (1/min) still beats the 45 s reaper? NO — 60 s > 45 s;
  so ALSO bump the server idle window to 90 s (2 missed throttled pings) —
  config default change, documented. Resume-grace math re-checked in E3.
- **D-9E-6 — Docs to the new truth (E3).** Making-Your-Game-Multiplayer:
  battles/parties section states plainly where it works (friend rooms +
  `--engine-events` worlds on Node; CF DO rooms walk/chat-only for now).
  Online-Safety F-5: "blocks that passport (the player's game key)" wording.
  Relay copy F-3: "zero setup once the free relay is live" + the self-host
  one-liner front-and-center until then; `DEFAULT_RELAY_URL` unchanged
  (deploying it stays Driftwood's operator step, still flagged).
- **E4 — Proof + packaging.** New `tests-e2e/mp-relay-battle.spec.mjs`: real
  `beacon.mjs` child process (engine rooms), two REAL browser contexts, REAL
  UI end-to-end — Play Together → Create/Join by code → 💬 → **Team Up** →
  consent "Join!" → forced encounter (armEncounter dev hook stays acceptable
  for determinism, per the mp-battle precedent — but the INVITE must go
  through the panel button) → shared battle → both end frames; 3× consecutive
  --workers=1. Desktop exe rebuild (`npm run tauri:build` — predefined-window
  trap holds). Docs-site rebuild. Then hand the unchanged MP9 RELEASE GATE
  block to a fresh Fable conversation; only the re-gate tags.

### Stage log (append as stages land)

#### E1 — Headless Shared-Battle Runner (Fable, 2026-07-20)

Built per D-9E-2 in two sub-stages; all gates re-run green (numbers at the end).

**E1·a — party-intent routing + zone plumbing** (`src/shared/net/zone-runtime.ts`,
`server/src/core/zone.ts`):

- `ZoneRuntime` gains two OPTIONAL methods (additive seam — runtime fakes keep
  compiling): `onPartyIntent(pid, intent)` and `onLeave(pid)`. The zone calls
  them only when present; a runtime-less (player-layer) zone stays
  byte-identical and still silently ignores party verbs — honest: a walk-only
  zone has no battles for a party to fight.
- `Zone.frame` routes `partyInvite`/`partyLeave` (the §C5 intents the release
  gate proved silently dropped — F-1) to the runtime. `Zone.remove` (disconnect,
  reap, AND transfer) calls `onLeave` before the entity goes.
- The zone broadcast drains the two MP6 channels the RoomHost has always
  drained: the party table rides `changes.party` when membership changed (an
  EMPTY table still rides — the last party dissolving must reach clients), and
  each member's queued battle events ride `changes.battle` on a per-player
  frame (members without events keep sharing one encoded frame — the AOI/chunk
  economy is untouched). Snapshots (join/resume/post-transfer) carry the live
  party table like the RoomHost's late-joiner snapshot. The client side needed
  ZERO changes — relay-client already applies `snap.party`/`changes.party`/
  `changes.battle`, and directive-renderer already auto-answers `battleJoin`
  and renders the full `battleCmd` command UI (MP6·B shipped it; it was simply
  unreachable over a socket until now).
- **Latent MP8 bug fixed in passing:** `autoResolveDirectivesFor` had zero
  server callers — a player who disconnected mid-directive (e.g. an open Show
  Message) left the interpreter suspended and the zone's blocking flag stuck
  forever once the reaper removed them. `onLeave`'s C3.4 sweep (withdraw →
  leaveParty → auto-resolve) closes it for engine zones.

**E1·b — the runner** (`src/engine/net/battle-runtime.ts`, ~1150 lines, wired
into `zone-event-runtime.ts` replacing `Battle: { run: async () => "win" }`):

- Same discipline as zone-event-runtime: the turn loop, resolution core,
  states/buffs/TP machinery, enemy AI and reward sequence of `scenes/battle.ts`
  re-implemented with verbatim semantics (every say line preserved as a `log`
  battle event; FX/audio/DOM dropped); REAL helpers imported, never the scene —
  `battle-logic.ts` math, `formula.ts` MZ pipeline, game-state derivations
  (`param`/`makeActor`/trait carriers), the `coop-battle.ts` broker
  (deadlines, AFK all-guard, withdrawal, outbox), `party.ts` gates. The
  `useItemOn` pure slice is re-implemented headless (menus.ts is DOM-coupled);
  the in-troop command bridge (RM 331–340 + Change Enemy TP, incl. forceAction
  and abort) is live during battles through the EngineServices getters.
- **The all-remote posture** (the deviation from the MP6 client-authority
  bridge, where the trigger IS the local scene): the TRIGGER contributes its
  loadout over `battleJoin` and answers `battleCmd` rounds like everyone else;
  the trigger draws victory drops FIRST then join order (A-8's "authority
  classic sequence" seat); EVERY item spend emits `itemUsed` to its owner
  (D-6-7 generalizes — the server holds no bags, so there is never a host-bag
  decrement or precheck); rewards/EXP/write-back reach every participant
  through their own end frame (`applyBattleEnd` client-side, unchanged).
- **N=1 = the solo instanced battle server-side**: a one-entry participant
  list through the same runner/broker (slots = the full loadout cap). This
  un-stubs solo battles in `--engine-events` worlds. Non-partied neighbors are
  never pulled in (presence gate #1 intact).
- Locked decisions:
  - **D-9E-E1-1** — a server battle NEVER game-overs: defeat revives every
    battler at 1 HP (A-7 extended to N=1 — a persistent world has no game-over
    flow) and `Battle.lastShared` reports true for every runner-hosted battle,
    so the combat command's game-over branch is never taken server-side;
    authored onLose branches still run.
  - **D-9E-E1-2** — a WORLD-context battle command (autorun/parallel, no acting
    player) resolves "win" without fighting — the narrowed remainder of D-8-6
    (it has no subject to seat). Proven by test: the event continues past it.
  - **D-9E-E1-3** — troop battle-pages and skill common events run under the
    TRIGGER's interpreter origin (the scene's `new Interp(null)` binds the one
    solo player; the trigger is that player's server equivalent), so their
    modal directives reach a real screen instead of hanging on pid 0.
  - Turn-based only (D-9E-2); no preemptive/surprise (event battles never had
    them); RNG = the zone world's stream (new consumer, no solo stream shared).
- Honest limits (carried forward, not new): quest kill-credit
  (`onEnemyKilled`) and battle-failure notes are guarded no-ops server-side
  (the quest runtime is still the D-8-6 stub slice); grow/learn effects on
  battlers act in-battle but don't survive the end frame (the MP6 wire shape —
  same on client co-op remotes); a round's log events resolve instantly
  (pacing = the battleCmd round-trips; the client overlay shows each round as
  a burst); while a battle (or any blocking event) runs, other players in the
  zone cannot START new events (the pre-existing §A2 one-blocking-run
  semantic — movement of non-participants is unaffected); a disconnected
  TRIGGER is not withdrawable (D-6-4 pins the trigger) — their pendings
  escape-resolve to guards so rounds keep terminating and the battle plays
  out; Shop stays stubbed (the D-8-6 remainder for MP9·E is battles only).

**Tests** (`tests-unit/battle-runtime.test.ts`, 12, fast pool, through a REAL
zone + real interpreter + wire-decoded frames): N=1 win with rewards ·
determinism (same seed + replies ⇒ byte-identical event streams) · loss with
A-7 1-HP revive · escape via escapeBattle skill · item heal + `itemUsed` ·
AFK all-guard (real 1800-tick deadline) · co-op N=2 (invite intent → consent
choices → both battleJoin → shared fight → both end frames, full rewards +
per-participant drops each) · withdrawal mid-battle (no hang, no end frame for
the leaver, party dissolved on exit) · world-context auto-win · partyLeave
empty-table broadcast · snapshot party table · unpartied-neighbor isolation.

**Gates (E1):** fast `test:unit` **1302 / 93 files** (was 1290/92) · net
**11 × 3 consecutive** · node --test **48/48** (determinism golden 46633057
re-verified live) · cargo **26** · root tsc 0 · server tsc Node + CF 0 ·
eslint 0 · both server bundles build, `beacon.mjs --help` evaluates headless ·
Playwright **130/130**, `git diff beacon-8..HEAD -- "*.png"` EMPTY (solo
goldens byte-identical) · no `js/` touched (no cache-bust due).

#### E2 — Friend rooms become engine worlds (Opus, 2026-07-20)

Built per D-9E-1 in two sub-stages. The insight that shaped it: the room's
CONNECTION + SEMANTICS layer (server.ts + room.ts — room code, anonymous hello,
empty-TTL, resume grace, owner + promotion, name-ban, chat gate, social bucket)
is already MP5-audited and orthogonal to the SIM. So E2 leaves that layer on the
main thread untouched and moves only the world tick into a new per-room engine
world — the exact directory/zone split BeaconWorld already uses, one tier down.
Client needed ZERO changes (RelayClient already applies `snap.party` /
`changes.party` / `changes.battle`; directive-renderer auto-answers `battleJoin`
and renders `battleCmd` — the room simply had no engine to emit them until now).

**E2·a — the in-process core** (`server/src/core/room-world.ts`,
`server/src/core/room.ts`, `server/src/core/server.ts`):

- NEW `RoomWorld` (implements `RoomSim`): a self-contained per-room engine world
  directory. The start map is the ENGINE zone (adopts `defaultWorld` + the
  per-zone runtime → NPCs/events/encounters/battles, E1's `battle-runtime`); a
  `transferOut` spins up a second zone in the SAME instance (player-layer — the
  one-`defaultWorld`-per-worker rule means only the first zone carries the
  runtime, exactly the in-process `--engine-events` shape, engine-zone.ts). It
  reuses `Zone` + the injected `engineZoneFactory` (stays OFF the engine graph
  like beacon-world.ts — the host injects the factory). Its zone `outbox` routes
  `send`/`sendMany` to the room's sockets, resolves `transferOut` in memory,
  fans `sharedSet` to every zone; `recordPatch` is dropped.
- `BeaconRoom` gains an optional `simFactory`. When present it keeps EVERY room
  semantic and delegates admit/frame/tick/resume/remove/close to the sim; the
  room still owns pids, welcome + resume tokens, owner, name-ban and the mod path
  (kick/ban/report is a room concern, never forwarded to the sim). Absent ⇒ the
  MP5 player-layer room, byte-identical (beacon-server/moderation/fuzz suites
  green). `BeaconServerOptions.roomSimFactory` threads the factory through
  `ensureRoom`/`createRoom`.

**E2·b — worker-per-room + CLI** (`server/src/node/room-worker.ts`,
`worker-room.ts`, `main.ts`, `build.mjs`):

- NEW `room-worker.ts` (worker entry, parallel to zone-worker.ts): hosts a
  `RoomWorld` with the engine zone factory, imports engine-zone.ts (headless-env
  FIRST), self-ticks drift-compensated 60 Hz, routes the RoomSim/RoomOutbox ops
  across the thread. NEW `worker-room.ts` (parent adapter `WorkerRoomWorld` +
  `workerRoomFactory`, parallel to worker-zone.ts). Third esbuild bundle
  `dist/room-worker.mjs`.
- `main.ts`: engine rooms are the DEFAULT for `beacon.mjs --project` (one worker
  per room — the out-of-the-box co-op promise). `--no-engine-rooms` opts back to
  MP5 player-layer rooms; `--max-rooms N` caps the worker budget. Banner +
  `--help` updated. The CF DO target (`cf/worker.ts`) is UNTOUCHED — it builds
  BeaconServer with no `roomSimFactory`, so CF DO rooms stay player-layer in 2.0
  (D-9E-1's honest deferral D-9E-D1).

**Locked decisions:**

- **D-9E-E2-1** — worker-per-room, semantics on the parent. A room delegates its
  whole SIM to one RoomWorld (one worker in production); the parent keeps the
  sockets + every room semantic. This is why one process hosts many engine rooms
  despite the one-`defaultWorld`-per-thread rule.
- **D-9E-E2-2** — a room is ONE multi-map engine world in ONE instance (the MP4
  free-roam-host model): start map = engine zone (co-op battles live here, the
  one-map scope D-9E-4), a transfer spins up a player-layer zone for the target
  map in the same worker, and A-2 party-follow + `sharedSet` fan-out resolve
  internally. So `beacon.mjs --project` rooms free-roam across maps with no
  per-map worker sharding — the exact `--engine-events` (in-process) behavior.
- **D-9E-E2-3** — a room is EPHEMERAL. RoomWorld drops `recordPatch` (no
  passport, no record, no durable store — a room disappears on its empty-TTL) and
  keeps no per-zone empty-expiry inside a room (the whole worker tears down at the
  room's TTL via `close()` → `sim.stop()`). Positions are never persisted; that
  is a WORLD feature (beacon-world.ts).

**Deviation carried to E3:** the plan's "friendly 'relay is full' error" beyond
`--max-rooms` is left as the existing `internal` refusal server-side (the cap is
enforced; a new room create past it is refused). A dedicated player-facing
"relay full" string is client copy + i18n, so it rides E3's honesty-copy pass
rather than adding a protocol code here.

**Tests** — `tests-unit/room-world.test.ts` (fast pool, 4): RoomWorld directory
routing (player-layer — admit/see-each-other/move-delta/leave) · two players join
by ROOM CODE, TEAM UP over the relay, BOTH win a shared battle (the F-1 proof,
in-process through the whole room stack) · a Transfer Player re-homes a player
onto a second map inside the one room · owner-kick through the delegated sim
(non-owner refused `not-allowed`; owner kick → sim drops the entity + leave
reaches the room). `tests-unit/room-battle.test.ts` (net suite, 1): the same F-1
co-op battle through the BUILT `room-worker` bundle in a REAL worker thread
(own `defaultWorld`, own headless shim), driven by ROOM CODE over the RoomSim/
RoomOutbox op protocol.

**Gates (E2):** fast `test:unit` **1306 / 94 files** (was 1302/93; +room-world) ·
net **12 × 3 consecutive** (was 11; +room-battle worker e2e) · node --test
**48/48** (determinism golden 46633057 held) · cargo **26** · root tsc 0 ·
server tsc Node + CF 0 · eslint 0 · all **three** server bundles build
(`dist/room-worker.mjs` new), `beacon.mjs --help` evaluates headless ·
Playwright **130/130** (perf 254.25/300), `git diff beacon-8..HEAD -- "*.png"`
EMPTY (solo goldens byte-identical) · E2 touched no `js/` (no cache-bust due).

#### E3 — Team Up UI + honesty fixes (Opus, 2026-07-20)

Built per D-9E-3 / D-9E-5 / D-9E-6 in three committed+pushed sub-stages, plus a
fourth de-flake fix the gate surfaced. The button E2 wired the channel for is now
on the panel; the release-gate F-2/F-4/F-5 doc + keepalive findings are closed.

**E3·a — Team Up / Leave Team UI** (`src/engine/net/social-ui.ts`,
`src/engine/co-op.ts`, `src/engine/mp-i18n.ts`; commit `3bc0993`):

- `SocialApi` gains `invite(pid)` / `leaveParty()` / `party()`. co-op.ts sends
  the `{k:"partyInvite"|"partyLeave"}` §C5 intent through `active.client`
  (relay/room) or the loopback `soloClient` (local BroadcastChannel host) — byte
  for byte what the RPGATLAS_MP dev hook did (F-1's proven path), now behind a
  button. The sim validates authoritatively (self / ghost / already-partied /
  full all rejected), so the button is safe on every transport.
- social-ui.ts: each OTHER-player row gains a **Team Up** button (hidden for
  players already on my team, who get a 🤝 mark read from the client party
  mirror); the panel header gains **Leave Team** while partied. Inline-styled
  like the rest of the panel (no editor.css, no cache-bust). The invite fires an
  `inviteSentToast`; Leave Team closes the panel so a reopen reads fresh state
  (party changes are async — they land via `applyPartyTable`/the host tick, then
  the existing `youLeftParty`/`friendJoinedParty` toasts fire).
- mp-i18n: `teamUpBtn` / `leaveTeamBtn` / `inviteSentToast` (+ `errRelayFull`,
  wired in E3·c) across all 11 packs; the parity gate auto-covers them and the
  mpText test pins the EN copy.

**E3·b — client WS keepalive + idle window** (`src/shared/net/protocol.ts`,
`src/engine/net/relay-client.ts`, `server/src/core/{config,server,beacon-world}.ts`;
commit `59a1efc`):

- Additive `ClientPing = {t:"ping"}` (a new `t`, no shape change → PROTOCOL_VERSION
  stays 1); the strict decoder accepts it with no fields, extras tolerated per the
  v1 additive rule. net-protocol round-trip + extra-field test added.
- RelayClient sends `{t:"ping"}` every ~20 s from a plain unref'd interval,
  cleared on `close()`. RoomClient/BroadcastChannel (same-machine) needs none.
- Both server routers (`server.ts` room, `beacon-world.ts` world) treat a ping as
  liveness ONLY: `onFrame` already bumped `lastActivity` before routing, so
  `route()` returns immediately — never rebroadcast, valid in any phase (so a
  pre-hello ping never counts as malformed), one normal message token.
- `idleTimeoutMs` default **45 s → 90 s** (D-9E-5): a backgrounded tab throttles
  timers to ~1/min, so 90 s clears two throttled pings before reaping. Independent
  of `resumeGraceMs` (30 s, a DISCONNECTED slot's hold) and `emptyRoomTtlMs`
  (60 s) — re-checked, unchanged. beacon-server test proves a ping is
  no-error / no-rebroadcast and staves off the 90 s reaper while silence still
  reaps.

**E3·c — honesty docs + relay-full copy** (`wiki/*.md`, `docs-site/*.html`,
`src/engine/co-op.ts`; commit `f87ffc5`):

- **F-2** (Making-Your-Game-Multiplayer): the "Party up and fight together"
  section was transport-silent. It now documents the Team Up / Leave Team flow AND
  states plainly WHERE co-op battles run — Node Beacon friend rooms (engine rooms
  ON by default, E2), `--engine-events` worlds, the free relay once deployed, and
  Cloudflare rooms as walk/chat-only for now (D-9E-D1). The panel + demo sections
  were updated to the new truth (self-host-first, honest join steps).
- **F-5** (Online-Safety): a world ban is per-PASSPORT (the player's game key),
  not per-device; wording fixed, with the honest "wipe = fresh identity at the
  cost of all progress" deterrent stated.
- **F-3** (Making- / Hosting- / Publishing-): "zero setup" / "nothing to run"
  softened to "once the free relay is live" with the self-host one-liner
  front-and-centre. `DEFAULT_RELAY_URL` unchanged (deploy stays Driftwood's
  operator step, still flagged).
- Hosting-a-World also documents `--max-rooms` / `--no-engine-rooms`, corrects the
  stale "later phase" persistence note (ships now with `--data`), and flags the CF
  co-op limit. docs-site rebuilt (28 pages, only the 4 edited pages changed).
- **relay-full copy** (E2's D-9E-E2 deviation closed): co-op.ts `friendlyError`
  maps the server's `internal` room-cap refusal (a CREATE past `--max-rooms`) to
  the new `errRelayFull` string. Kept the server-side `internal` refusal — no new
  protocol code, exactly the E2 deviation's plan.

**E3 de-flake** (`tests-unit/{beacon-world,world-persistence,relay-client-world}.test.ts`;
commit `a01b14c`): the gate surfaced a PRE-EXISTING load flake unrelated to E3 —
the fast-pool world tests waited a FIXED count of `setTimeout(0)` macrotasks for
the REAL async ECDSA passport verify, which loses the race intermittently (~40 %
for the 2-flush `joinWorld` helper, observed failing across DIFFERENT tests
run-to-run, always at the "no welcome yet" check) under full-suite parallelism.
Replaced with a bounded `waitFor(pred, tries=100)` poll for the actual terminal
frame (welcome / error / kick); resume/steal now send hello+resume back-to-back
and poll (the auth queue already orders them). Negative assertions
(welcome-undefined, auth-failed) unchanged — they poll for the error/kick frame.
Behavior-preserving, test-only; **10/10 consecutive clean full-suite runs** after
the fix, vs intermittent single-test failures before.

**Locked decisions:**

- **D-9E-E3-1** — the Team Up button IS the dev hook. It sends the identical §C5
  party intent through the same client the E1/E2 tests drove; the sim is the sole
  authority, so no client-side party validation was added (the button is "safe on
  every transport" by construction, and unreachable in solo — the panel mounts
  only in a live MP session, so the frozen goldens never see it).
- **D-9E-E3-2** — Team Up shows per OTHER-player row and hides for current
  teammates (🤝 mark); Leave Team lives in the panel header. Membership is read
  from the client mirror (`partyOf(rosterWorld(), local)`), so it reflects host
  authority (`soloHost.world`) or relay delta (`applyPartyTable`) identically.
- **D-9E-E3-3** — keepalive is a RelayClient (socket) concern only; the idle
  window widened globally via the shared `idleTimeoutMs` default (rooms AND
  world), and a ping is liveness-only in every server phase.

**Client/CF untouched semantics:** the wire is additive-only (`ClientPing`); no
snapshot/delta shape changed; `cf/worker.ts` still builds player-layer rooms
(D-9E-D1 stands — CF DO rooms are walk/chat only, documented honestly).

**Gates (E3):** fast `test:unit` **1308 / 94 files** (was 1306/94; +net-protocol
ping +beacon-server ping; **10× consecutive clean** after the de-flake) · net
**12 × 3 consecutive** · node --test **48/48** (determinism golden **46633057**
re-computed live) · cargo **26** · root tsc 0 · server tsc Node + CF 0 · eslint 0 ·
mp-i18n parity **34** (62 keys/pack, was 58) · Playwright **130/130** (perf
225.92/300), `git diff beacon-8..HEAD -- "*.png"` **EMPTY** (solo goldens
byte-identical) · all three server bundles build, `beacon.mjs --help` headless ·
docs-site 28 pages · E3 touched no `js/` (no cache-bust due) · version **2.0.0**
unchanged (only the re-gate tags). **NEXT: E4** (relay-battle Playwright e2e +
exe rebuild + docs-site refresh), then hand the unchanged MP9 RELEASE GATE block
to a fresh Fable conversation.
