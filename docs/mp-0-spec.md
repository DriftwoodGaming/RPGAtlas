# Phase MP0 Spec — Protocol, Singleton Audit & Sim-Boundary Spec ("Project Beacon")

**Status:** IN PROGRESS — stage A landed; B (singleton audit) and C (sim-boundary
spec) follow in this document.
**Authored:** 2026-07-19 by Claude Fable 5 (build + self-gate per the roadmap
choreography), from the MP0 section of `docs/MULTIPLAYER_ROADMAP.md`.
**Workflow:** commit + push each stage directly to `main` (house rule). Phase
exit records the gate verdict in the roadmap status table and tags `beacon-0`.

## Objective

The thinking phase with teeth: real protocol code (stage A) plus the two
documents that make MP1 (world-core extraction) and MP3 (presentation
directives) mechanical instead of exploratory — the singleton audit table
(stage B, THE MP1 work order) and the sim-boundary/directive spec (stage C).
Zero engine behavior change: no existing file's runtime behavior may differ;
Playwright goldens stay untouched.

---

## Stage A — Baseline + protocol v1 (landed 2026-07-19)

### Live gate baseline (recorded into the roadmap, first act)

| Gate | Live 2026-07-19 | Roadmap "last known" |
|------|-----------------|----------------------|
| vitest | **983** (62 files) | 977+ |
| node --test | **44** | 19 |
| cargo | **26** | 23 |
| Playwright | **123/123** (2.8m) | 111 |
| eslint | **0** | 0 |
| version | 1.2.0 (7 sites) | 1.2.0 |

Every count had drifted upward since the roadmap was written — the "never
trust these written numbers" rule earned its keep on day one.

### What landed

- **`src/shared/net/protocol.ts`** — wire protocol v1. `PROTOCOL_VERSION = 1`;
  client→server `hello / join / resume / input / reply / emote / chat`;
  server→client `welcome / snapshot / delta / directive / presence / kick /
  error`; input sequence numbers (`input.seq` echoed as `delta.ack` for the
  MP2 prediction seam); typed `Directive` + `DirectiveReplyValue` unions for
  all five modal kinds (message, choices, numberInput, nameInput, shop) so MP3
  compiles against wire truth; strict structural decoders
  (`decodeClientMessage` / `decodeServerMessage`) that return `{ok:false,
  error}` instead of throwing — the seed of the MP5·D fuzz gate. Protocol-level
  limits exported as constants (frame/name/chat/emote caps).
- **`src/shared/net/room-code.ts`** — capability-token room codes: 9 chars
  from a 30-char alphabet (digits + consonants; **no vowels** so a code can
  never spell a word in front of a kid; no L) = **44.15 bits entropy** (floor
  is 40); CSPRNG with rejection sampling (no modulo bias, injectable byte
  source for deterministic tests); `normalizeRoomCode` repairs real typing
  (lowercase, separators, O→0/I→1/L→1) and returns `null` — never throws — for
  the friendly-error path; display format `XXX-XXX-XXX`.
- **`tests-unit/net-protocol.test.ts`** (18) + **`tests-unit/net-room-code.test.ts`**
  (12) — every union arm round-trips encode→decode (this is the wire-safety
  proof the MP2 loopback transport will lean on, since loopback skips
  serialization); hostile-input rejection matrix; entropy/uniformity/
  normalization pins. **vitest 983 → 1013.**

### Design decisions (stage A)

- **A1 — Room creation rides `join`.** The roadmap's fixed client-message list
  has no `create`; `{t:"join"}` with no `code` means "create a room and make
  me owner". Keeps the message list exactly as specified.
- **A2 — Presets/chat/emotes on the wire:** `chat` carries exactly one of
  `text` (free text, D4 opt-in, server rejects with `chat-disabled` when off)
  or `preset` (index into dev-authored phrases — always available). Server
  broadcasts all social traffic via `presence` (kinds `join/leave/emote/say`)
  — the fixed server-message list has no separate chat-broadcast type.
- **A3 — Errors are codes, not copy.** `ServerError.code` picks localized
  plain-language client copy (audience-beginners rule); `detail` is
  dev-console-only. Copy itself lands client-side in MP5·C with i18n in MP7.
- **A4 — Both decoders are strict**, not just the server's: a client must
  survive a buggy/malicious *self-hosted* server, so server frames validate
  too (D2 makes hostile servers a real threat model).
- **A5 — Forward compat:** unknown extra fields on known messages are
  accepted (additive evolution — e.g. passport pubkeys arrive in MP8 without
  a version bump); unknown message types are rejected.
- **A6 — Shop replies are transcripts.** One `shop` directive → one reply
  carrying the whole buy/sell log; the server re-validates every line against
  authoritative stock/wallet before applying (client shop UI is presentation,
  not authority). Capped at 200 lines.
- **A7 — Snapshot/delta payloads are `JsonValue`-opaque at MP0.** MP1 owns the
  world-state shape (save-payload machinery doubles as join-sync per the
  roadmap); pinning it now would prejudge the MP1 extraction.

### Deviations / discoveries (stage A)

- **Baseline drift** (table above) — recorded, no action needed.
- **Tooling trap (new, Windows):** writing a regex character class of raw
  control characters (a bracket class spanning U+0000 through U+001F as
  *actual bytes*, not `\uXXXX` escapes) into a source
  file makes ripgrep treat the file as binary (silently unsearchable) and
  trips the harness's hidden-character guard on shell commands. Fix: keep the
  class in escaped `\uXXXX` form in source (a `fix-regex.mjs` scratchpad
  script did the byte surgery). Rule of thumb: **no raw bytes < 0x20 (beyond
  tab/LF/CR) in any source file, ever.**

---

## Stage B — Singleton audit (pending)

---

## Stage C — Sim-boundary + directive spec (pending)
