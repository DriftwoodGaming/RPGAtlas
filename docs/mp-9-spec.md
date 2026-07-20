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
