# Phase MP9 Spec — Safety, Chat, Moderation, Packaging, Release 2.0 ("Project Beacon")

**Status:** 🚧 IN PROGRESS (Opus BUILD). Prior: `beacon-8` tagged (MP8 LOAD GATE
PASS 2026-07-20). This phase ships opt-in filtered chat + moderation, packaging
& parent/teacher safety docs, the Driftwood Shore co-op showcase, and the 2.0.0
release prep — then hands to the **Fable RELEASE gate** (which tags `beacon-9` +
`v2.0.0`; this BUILD conversation does NOT tag v2.0.0).

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
