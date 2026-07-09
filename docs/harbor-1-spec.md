# Harbor H1 — On-disk contract & native plumbing (spec)

**Phase:** H1 of Project Harbor (`docs/PROJECT_FOLDERS_ROADMAP.md`)
**Author:** Claude Opus 4.8 (Extra High), 2026-07-09
**Scope:** Finalize the on-disk contract for real project folders and specify the native
(Rust) + host (JS/TS) plumbing that later phases build on. **Zero user-visible change ships
in H1.** FORMAT_VERSION stays **2**; the `.rpgatlas` project document is exactly today's
blob-free project JSON.

---

## Fable 5 contract gate

> **Verdict: SIGNED** (2026-07-09, with four binding amendments below). Reviewed by a fresh
> Claude Fable 5 conversation (the roadmap's H1·A gate) against
> `docs/PROJECT_FOLDERS_ROADMAP.md` (H1 section, locked decisions, cross-phase traps),
> `AGENTS.md`, and `src-tauri/src/lib.rs`; fact-checked §5.2's app identifier against
> `tauri.conf.json` (`com.rpgatlas.editor` ✓) and §3's no-new-permission claim against
> `capabilities/default.json` (`core:default` + `dialog:default` ✓). **H1·B is cleared.**
>
> **Signed:** SIGNED — 2026-07-09 — Contract is sound and roadmap-faithful: §1.1 fixed
> `game.rpgatlas` and §1.2 `.atlas/` are the right resolutions; §3.1's template-agnostic
> `project_create` (ready document JSON in; templates stay in TS) is **confirmed** — Rust
> must never grow game-content knowledge, and ready-bytes-in mirrors the proven
> `save_project(json)` contract; §2/§4 correctly extend the `blob_file_name`/`write_index`
> discipline; §7's never-purge rule and the §6 copy uphold the audience rule;
> FORMAT_VERSION stays 2 and nothing user-visible ships in H1.
>
> **Binding amendments (part of the signed contract — folded into §1/§3/§4/§5.4 below;
> H1·B implements them):**
> 1. **`project_create` is all-or-nothing (§3).** If create fails after the root folder was
>    made, best-effort `remove_dir_all` the root *this call created* (never a pre-existing
>    folder — that case already returned `FOLDER_EXISTS` before anything was written).
>    Otherwise a half-scaffolded folder makes a retry say `FOLDER_EXISTS` ("open the game
>    that's already in this folder") while `project_open` says `NOT_A_PROJECT` — a
>    kid-visible contradiction with no self-serve way out.
> 2. **The per-project `assets/` README is rewritten for in-place semantics (§1).** Do NOT
>    reuse the inbox README text: it promises "each file is moved into the Imported folder",
>    which contradicts §7 (project asset files are NEVER moved or deleted). The per-project
>    copy must say files stay exactly where the user put them; final text lands in the H1·B
>    stage log.
> 3. **Backups are named `game-<epoch_ms>.rpgatlas.backup` (§4).** Not bare `*.rpgatlas`:
>    H5 associates that extension, so a double-clicked backup would launch straight into
>    `NOT_A_PROJECT`. The trailing `.backup` keeps the association off backups and keeps
>    recovery a simple rename.
> 4. **`project-errors.ts` also carries the `MISSING_ASSET` copy (§5.4).** §6 declares that
>    copy FINAL, so it must live in the tested table now (a separate export or a widened
>    copy key — the command-error union itself stays exactly as specified), or H4 will
>    re-author it untested.
>
> *Non-binding implementation note:* `std::io::ErrorKind::StorageFull` is not stable on the
> pinned MSRV (1.77.2); detect `DISK_FULL` via `raw_os_error` (`ENOSPC` / Windows error 112)
> or bump the MSRV in H1·B.

---

## 0. What H1 delivers (and does not)

**Delivers (contract + plumbing, invisible to users):**
- This finalized on-disk contract (layout, path safety, atomicity, asset identity, name
  sanitization, recents registry, error taxonomy) — the normative reference for H2–H6.
- H1·B: Rust project commands + a canonicalize-and-contain path guard module, cargo-tested.
- H1·C: the `host.js` project surface, a typed `project-host.ts` façade, and four pure cores
  in `src/shared` (name sanitizer, recents logic, template descriptors, error copy) with
  vitest (env=node — no `window`/DOM).

**Does NOT deliver (later phases — do not build these in H1):**
- No Project Manager UI, no boot rewiring, no menu changes (H2).
- No autosave rebind to the folder; localStorage stays the sole truth this phase (H3).
- No per-project asset library / auto-discovery; `.atlas/library.json` is scaffolded **empty**
  and the in-place `assets/` index is defined but not populated (H4).
- No argv / single-instance / file association (H5). No migration wizard or docs (H6).
- **No patch-notes entry** (nothing a user can observe changed).

H1·C's cores and host surface exist and are unit-tested / devtools-drivable, but **nothing
imports them into `boot.ts`/`persistence.ts`**. Wiring is H2's job.

---

## 1. On-disk layout (FINAL)

```
MyGame/                         ← the project root = the folder the user sees & backs up
├─ game.rpgatlas               ← the project document: FORMAT_VERSION 2 JSON, blob-free.
│                                 FIXED name (see §1.1). Double-clickable (H5 association).
├─ assets/                     ← the user's drop folders. Files STAY here (in-place, H4).
│  ├─ characters/                 Walking sprites (PNG)
│  ├─ facesets/                   Message-box faces (PNG)
│  ├─ enemies/                    Battlers (PNG)
│  ├─ tilesets/                   Map tiles (PNG → 48px slicer)
│  ├─ audio/                      OGG / MP3 / WAV / M4A / FLAC
│  └─ READ ME — how to add assets.txt   (in-place rewrite of the inbox README — gate amendment 2)
├─ .atlas/                     ← engine-managed (Godot's .atlas/.godot analogue). See §1.2.
│  ├─ library.json                asset index: relPath, hash, kind, name, slicer payloads (H4)
│  ├─ cache/                      derived data (sliced tiles, thumbnails) — safe to delete
│  └─ backup/                     rolling autosave backups of game.rpgatlas (last 5 — §4)
├─ .gitignore                  ← scaffolded convenience: ignores .atlas/cache/ + .atlas/backup/
└─ saves/                      ← playtest save slots (H3 stretch; NOT created in 1.2.0 core)
```

**H1 scaffolds:** the root, `game.rpgatlas`, `assets/` + its five subfolders + README, `.atlas/`
+ `library.json` (empty `[]`) + `cache/` + `backup/`, and `.gitignore`. It does **not** create
`saves/` (deferred; `saves/` slots remain in browser storage for 1.2.0 per the roadmap H3·C).

### 1.1 Resolved open choice — project document filename: **fixed `game.rpgatlas`**

Chosen over `<Name>.rpgatlas`. Rationale:
- **Folder path and file path are interchangeable identifiers.** `project_open` accepts either
  the folder or the `game.rpgatlas` inside it and resolves to the same root (§3).
- **No rename churn.** Renaming the game's title (a common early edit) never renames a file on
  disk, never orphans a recents entry, never breaks a shortcut or association.
- **Trivial association & double-click** (H5): one fixed target, no guessing.
- The game's human name lives in the document (`system.title`) and the recents registry; the
  filename need not carry it.

### 1.2 Resolved open choice — engine-managed folder: **`.atlas/` (keep the dot)**

Chosen over `atlas-data/`. Rationale:
- Mirrors Godot's `.godot/` — a familiar "engine-managed, safe to delete/gitignore" signal.
- **On Windows a leading dot does NOT hide a folder** (only the Hidden *attribute* does), so
  `.atlas/` is fully visible in Explorer — no discoverability loss for kids, while still reading
  as "not yours to hand-edit."
- Everything in `.atlas/` is reconstructible: `cache/` is derived, `backup/` is history, and
  `library.json` is re-derivable by re-scanning `assets/` (it only *adds* tags/slicer meta,
  which is why it is kept, not ignored — see §1.3).

### 1.3 `.gitignore` (scaffolded convenience — not part of the strict contract)

Scaffolded at the root so a user who version-controls their game gets sane defaults:

```
# RPGAtlas engine-managed, regenerable data
.atlas/cache/
.atlas/backup/
```

`.atlas/library.json` is intentionally **kept** (it carries tags/slicer payloads not present in
the raw files). `assets/` and `game.rpgatlas` are the source of truth. This file is a nicety; a
project with no `.gitignore` is still fully valid.

---

## 2. Path safety (guard module — the load-bearing rule)

Every project-scoped Rust command **canonicalizes its target and proves it stays inside the
project root**; **IPC-supplied strings are never trusted as path components** without validation.
This extends the existing `blob_file_name` discipline (`src-tauri/src/lib.rs`) to whole paths.

A dedicated Rust module — **`project_paths`** (new file `src-tauri/src/project_paths.rs`) — owns
this and is unit-tested in isolation (`cargo test`). Contract of its API (names indicative;
behavior normative):

| Function | Behavior |
|---|---|
| `canonical_root(path) -> Result<PathBuf, ProjectError>` | Canonicalize an **existing** directory via `dunce::canonicalize` (friendly non-UNC paths on Windows). `NotFound → MISSING`, `PermissionDenied → NO_PERMISSION`. |
| `validate_component(name) -> Result<(), ProjectError>` | Reject a single path segment that is empty, `.`, `..`, contains any of `/ \ : NUL` or control chars, is absolute, ends in a dot or space, or is a Windows reserved device name (`CON PRN AUX NUL COM1–9 LPT1–9`, case-insensitive, with or without extension). Returns `UNSAFE_PATH` on rejection. |
| `contained_join(root, rel[]) -> Result<PathBuf, ProjectError>` | `validate_component` each segment, join onto the canonical `root`, then verify by canonicalizing the deepest **existing** ancestor and asserting it `starts_with(root)` (defeats symlink escape). `UNSAFE_PATH` if the result would leave `root`. |
| `resolve_target(target) -> Result<PathBuf /*root*/, ProjectError>` | If `target` is a file whose name ends `.rpgatlas` → root = its parent; else root = `target`. Canonicalize and return the root. Used by `project_open`/`project_save`/`project_reveal` so folder-path and file-path inputs converge. |

**Notes:**
- Internal, fixed components (`"assets"`, `"characters"`, `"game.rpgatlas"`, `".atlas"`, …) are
  compile-time constants and inherently safe, but they still flow through the same join helper so
  there is exactly one path-construction path. H1 has **no** IPC-derived components yet;
  `validate_component` exists now because H4 will feed it real asset relative paths.
- **Canonicalization requires existence.** For a target being *created* (e.g. a new project
  folder), canonicalize the **parent** (which must exist) and append the validated leaf; never
  canonicalize a not-yet-existing leaf.
- Symlink defense is the canonical-ancestor `starts_with` check (portable; Windows symlink
  creation needs privilege, so the cargo tests assert traversal via `..`, absolute segments,
  separator injection, and reserved names — see §7).

---

## 3. Native command surface (normative contract for H1·B)

New Rust commands in `src-tauri/src/lib.rs` (or a `project.rs` submodule), registered in the
`invoke_handler`. They use `std::fs` directly with the `project_paths` guard — exactly like the
`library_*` commands — so **no new Tauri capability/permission is required** (`core:default` +
`dialog:default` already cover everything; the directory *picker* used by H2's New Project flow
is the existing `dialog` plugin). Args are camelCase over IPC (Tauri convention). All fallible
commands return a **tagged error** (§6), not a raw OS string.

Shared result type (JSON to the frontend):

```
ProjectBundle { root: String, name: String, document: String }
    root     — canonical absolute path of the project folder
    name     — the folder leaf name (the sanitized game name; §5)
    document — the game.rpgatlas contents (blob-free FORMAT_VERSION 2 JSON, as a string)
```

| Command | Signature (IPC args) | Behavior |
|---|---|---|
| `project_create` | `(parentDir: String, name: String, documentJson: String)` → `ProjectBundle` | Sanitize `name` → folder leaf (the **frontend** pre-sanitizes with the shared core §5; Rust re-validates the leaf with `validate_component` as defense-in-depth). Root = `parentDir/leaf`. **If root already exists → `FOLDER_EXISTS`** (never clobber). Create the full tree (§1), write `game.rpgatlas` from `documentJson` **atomically** (§4), write empty `.atlas/library.json` (`[]`), the `assets/` README (in-place copy — gate amendment 2), and `.gitignore`. Return the bundle. **On any failure after the root folder was created by this call, best-effort `remove_dir_all` that root (never a pre-existing one) — create is all-or-nothing (gate amendment 1).** **`template` is resolved frontend-side into `documentJson`** — see §3.1. |
| `project_open` | `(target: String)` → `ProjectBundle` | `resolve_target` → root. Read `root/game.rpgatlas`. Missing folder → `MISSING`; folder exists but no `game.rpgatlas` → `NOT_A_PROJECT`. The document is returned verbatim (migration/validation stays frontend-side, as today's import path does). |
| `project_save` | `(root: String, documentJson: String)` → `()` | `canonical_root(root)`; require it is a project (contains `game.rpgatlas` **or** `.atlas/`). Roll a backup of the current `game.rpgatlas` (§4), then **atomically** write the new document. |
| `recents_list` | `()` → `String` (JSON array) | Read `<app-config>/projects.json`; return `[]` if absent or corrupt (never brick — same posture as `read_index`). Does **not** prune; pruning of vanished folders is a **display-time** concern (§5.2, H2). |
| `recents_touch` | `(path: String, name: String)` → `()` | Upsert `{name, path, lastOpened: now_ms}` to the front, dedupe by exact `path`, cap at **12**, atomically write the file (§5.2 rules are normative; mirrored by the tested TS core). |
| `recents_remove` | `(path: String)` → `()` | Remove the entry with exact `path`; atomically write. |
| `project_reveal` | `(root: String)` → `()` | `canonical_root(root)` (must be an existing directory), then reuse the existing `reveal_path` to open it in the OS file manager. |

### 3.1 Where the template document comes from (resolved design)

The roadmap's H1·B sketch writes `project_create(parentDir, name, template)`. Resolved: the Rust
command takes the **ready document JSON**, not a template id. The three templates —
**Blank**, **Starter** (today's `DataDefaults` first-run project), **Atlas Quest** (the sample
map project) — are all built by **existing TypeScript** (DataDefaults / sample-map builders),
which Rust cannot and should not reimplement. So:
- The template *selection + descriptors* live in the shared pure core `project-templates.ts`
  (§5.3) and (H2) the manager UI.
- The manager (H2) resolves the chosen template into a complete blob-free document and hands
  the bytes to `project_create`, exactly as today's `save_project(json)` receives ready bytes.
- `project_create` is therefore **template-agnostic**: it scaffolds the tree and writes whatever
  valid document it is handed, atomically, in one round-trip (so a folder never exists in a
  half-scaffolded state without its document).

This keeps all game-content construction in TS (where it already lives), keeps Rust a pure
filesystem layer, and mirrors the proven `save_project` contract. **Flagged for Fable review.**

---

## 4. Atomicity & backups

- **Atomic writes.** `game.rpgatlas` and `.atlas/library.json` are written **tmp-then-rename**
  — the exact `write_index` pattern already in `lib.rs`: write `game.rpgatlas.tmp` fully, then
  `rename` over `game.rpgatlas`, so a crash mid-write never leaves a truncated document. Same for
  `library.json`.
- **Rolling backups (last 5).** On each `project_save`, if `game.rpgatlas` already exists, copy it
  into `.atlas/backup/` as `game-<epoch_ms>.rpgatlas.backup` (the `.backup` suffix keeps H5's
  file association off backups — gate amendment 3) **before** the atomic write, then prune the
  backup folder to the **5 newest** (by the embedded timestamp / mtime). Backups are best-effort:
  a backup failure must **not** block the save (the primary write is what matters); it is logged,
  not surfaced. This gives "undo the last few saves" as a recovery affordance for H3.
- A corrupt or unreadable `projects.json` / `library.json` degrades to "empty", never an error
  dialog (users can't lose their game to a bad index — the same rule the current library follows).

---

## 5. Pure cores (normative rules; H1·C implements + vitest-tests, env=node)

All four live in `src/shared` with **no `window`/DOM imports** (vitest runs env=node — trap 3).

### 5.1 Project-name sanitizer — `src/shared/project-name.ts`

`sanitizeFolderName(raw: string): string` produces a cross-platform-safe folder leaf. Rules, in
order:
1. Unicode-normalize (NFC) and trim surrounding whitespace.
2. Strip control characters (U+0000–U+001F, U+007F).
3. Replace each Windows-reserved character `< > : " / \ | ? *` with a single space.
4. Collapse internal whitespace runs to a single space; trim again.
5. Strip **trailing** dots and spaces (illegal as a Windows folder-name ending).
6. Truncate to **80** characters, then re-strip any trailing dot/space exposed by truncation.
7. If the result is empty → **`"Untitled Game"`**.
8. If the result case-insensitively equals a Windows reserved device name (`CON`, `PRN`, `AUX`,
   `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, with or without an extension) → prefix with `_`
   (e.g. `CON` → `_CON`).

The game's **display name** (`system.title`, recents `name`, window title) keeps the user's
original trimmed input; only the *folder leaf* is sanitized. Casing is **preserved** (RPG Maker /
Godot keep it). **Collision is not the sanitizer's concern** — two games named the same in one
parent folder surface as `FOLDER_EXISTS` (§6), not a silent `-2` suffix, so the child stays in
control of the name. Unit tests cover: illegal chars, trailing dot/space, reserved names,
empty/whitespace, over-length, unicode preserved, idempotence.

### 5.2 Recents registry — `src/shared/recents.ts`

On-disk file: **`<app-config>/projects.json`** (Windows: `%APPDATA%\com.rpgatlas.editor\`),
a JSON array of `{ name: string, path: string, lastOpened: number /*epoch ms*/ }`. Rust stores
**canonicalized absolute paths**, so equality is exact string comparison (no per-OS normalization
in the pure core — keeps it deterministic).

Normative rules (implemented identically in the Rust commands **and** this TS core; the spec is
the single source of truth):
- `RECENTS_CAP = 12`.
- `touchRecent(list, entry)`: remove any existing entry with the same `path`, unshift the new
  entry to the front, truncate to `RECENTS_CAP`. Result is newest-first.
- `removeRecent(list, path)`: drop the entry with that exact `path`.
- `annotateRecents(list, exists: (path) => boolean)`: returns each entry tagged
  `{ ...entry, missing: !exists(path) }`, preserving order. **Pruning is display-time only** —
  a vanished folder is shown as a "can't find this game anymore" row (H2 copy = `MISSING`
  taxonomy §6), never silently dropped and never auto-deleted from the file (the user removes it
  explicitly via the row's control). Corrupt file → treated as `[]`.

Unit tests: upsert moves-to-front, dedupe by path, cap enforced, remove, annotate splits
present/missing, order stable.

### 5.3 Template descriptors — `src/shared/project-templates.ts`

Pure descriptor list for the manager (no document bytes here — those are built by existing TS at
wire-up time, §3.1):

```
type TemplateId = "blank" | "starter" | "atlas-quest";
TEMPLATES: { id: TemplateId; label: string; description: string }[]   // kid-friendly copy
isTemplateId(x: unknown): x is TemplateId
```

Copy (kid-friendly, final):
- **blank** — "Empty map" — "A tiny empty world. Best when you want to build everything yourself."
- **starter** — "Starter game" — "A ready-to-edit little game with the basics already set up."
- **atlas-quest** — "Atlas Quest sample" — "Our example adventure — poke around to see how a
  finished game fits together."

Unit tests: every `TemplateId` has a descriptor with non-empty label/description; `isTemplateId`
accepts the three ids and rejects others.

### 5.4 Error copy — `src/shared/project-errors.ts`

The kid-friendly taxonomy §6, as tested code:

```
type ProjectErrorCode =
  | "FOLDER_EXISTS" | "NO_PERMISSION" | "DISK_FULL" | "MISSING"
  | "NOT_A_PROJECT" | "UNSAFE_PATH" | "SECOND_INSTANCE" | "IO";
projectErrorCopy(code: ProjectErrorCode): { title: string; body: string }
```

Unit test asserts **every** code in the union returns non-empty `title` + `body` (no code can
ship without copy). The map is i18n-ready (a single table the future locale layer can translate).
Per gate amendment 4, the module also exports the `MISSING_ASSET` state copy from §6 (kept out
of the command-error union — it is an asset *state*, not a command failure) under the same
non-empty-copy test, so H4 renders §6's final copy from tested code.

---

## 6. Error taxonomy (finite, kid-friendly — copy is FINAL)

Native commands fail with a stable machine **code** (+ an optional developer `detail`), never a
raw OS message. The typed host (§ H1·C) maps `code` → the copy below via `project-errors.ts`.
`std::io::ErrorKind` maps: `AlreadyExists → FOLDER_EXISTS`, `PermissionDenied → NO_PERMISSION`,
storage-full / quota → `DISK_FULL`, `NotFound → MISSING`, else → `IO`.

| Code | Trigger | Kid-friendly copy (title — body) | Surfaced (phase) |
|---|---|---|---|
| `FOLDER_EXISTS` | `project_create` target folder already exists | **"You already have a game with that name here"** — "Pick a different name, or open the game that's already in this folder." | H2 (New Project) |
| `NO_PERMISSION` | OS denied read/write | **"RPGAtlas can't save here"** — "This folder is locked. Try making your game inside your Documents folder instead." | H2/H3 |
| `DISK_FULL` | Write failed, disk/quota full | **"Your disk is full"** — "There's no room to save your game right now. Free up some space and try again — your work is still open." | H3 |
| `MISSING` | Path/file vanished (open, reveal, recents row) | **"We can't find this game anymore"** — "Its folder may have been moved, renamed, or deleted. If you find it again, use Open to bring it back." | H2/H3 |
| `NOT_A_PROJECT` | Folder has no `game.rpgatlas` | **"That folder isn't an RPGAtlas game"** — "There's no game.rpgatlas inside it. Pick the folder that holds your game." | H2 (Open/Browse) |
| `MISSING_ASSET` (per-asset state, not a dialog) | A file listed in `library.json` isn't on disk | **"A picture or sound is missing"** — "Put the file back in your assets folder to bring it home. Your game is safe in the meantime." | H4 |
| `UNSAFE_PATH` | Guard rejected a path (should never occur normally) | **"That file's location wasn't safe"** — "RPGAtlas didn't touch it, just to be careful." | backstop |
| `SECOND_INSTANCE` | A second launch while one is open | **"RPGAtlas is already open"** — "We brought it to the front for you." | H5 |
| `IO` | Any other filesystem error | **"Something went wrong saving your game"** — "Please try again. If it keeps happening, copy your game folder somewhere safe." | any |

`MISSING_ASSET` is an asset-item **state** (per §7 identity), rendered inline in the Asset Browser
(H4), not one of the command-returned `ProjectErrorCode`s — listed here so the whole user-visible
failure surface is fixed in one place.

---

## 7. Asset identity (contract; H4 implements)

An asset is identified by **relative path (under `assets/`) + content hash** (SHA-256, the
existing frontend hash). Rules:
- **Same hash re-add is a no-op** (content already present; dedupe as today).
- **Changed hash re-imports**, keeping the entry's tags / slicer meta / name (edit-in-place, not
  a new asset) — the relPath is the stable identity, the hash tracks content.
- **Missing file** (relPath in `library.json`, no file on disk) → the entry survives in a
  plain-language **`MISSING_ASSET`** state (§6). Never a crash, **never an index purge** — putting
  the file back heals the entry. This is why `library.json` is kept, not treated as pure cache.
- **Files stay where the user put them.** The engine references `assets/` files **in place**;
  a scan never moves or deletes a user's file (unlike the legacy app-data inbox, which archives to
  `Imported/`). Rename/retag edits touch only `library.json`, never the file.

H1 scaffolds `library.json` as `[]` and fixes these rules; population + scanning is H4 (with the
oversliced-library safeguards — trap 5: 48px default, overslice warnings, batched writes).

---

## 8. Host + typed façade (H1·C)

- **`js/editor/host.js`** gains thin `isTauri`-gated wrappers (same shape as `openPlaytest`):
  `projectCreate`, `projectOpen`, `projectSave`, `recentsList`, `recentsTouch`, `recentsRemove`,
  `projectReveal` — each a one-liner over `invoke(...)`.
- **`src/platform/tauri/project-host.ts`** — a typed façade (same custom-`invoke` pattern as
  `fs-asset-store.ts`, i.e. `(window as any).__TAURI__.core.invoke`), exporting typed methods that
  return `ProjectBundle` / `Recent[]` and translate a thrown Rust `{code, detail}` into a typed
  `ProjectHostError` carrying a `ProjectErrorCode` the UI resolves to copy via `project-errors.ts`.
  Not itself unit-tested (it is the IPC boundary, like `fs-asset-store.ts`); its pure inputs — the
  four §5 cores — are.
- **No editor wiring.** The façade + cores are importable and devtools-drivable but unreferenced
  by `boot.ts`/`persistence.ts` until H2. Browser builds never touch any of it (`isTauri` false).

---

## 9. Exit criteria (H1 phase)

- `cargo build` + `cargo test` green (guard traversal tests + command round-trip where feasible).
- Project commands drivable from devtools on a scratch folder: create → open → save → recents
  round-trip works; a traversal attempt is rejected.
- Zero frontend behavior change; browser build byte-identical; frozen map 1 untouched.
- All H0 gates ≥ baseline: **vitest 917 · node tests 19 · Playwright 70/70 · eslint 0 ·
  typecheck clean**, plus the new H1·C vitest specs (name sanitizer, recents, templates, error
  copy). No patch-notes entry. Tag **`harbor-1`**.

---

## 10. Cross-phase trap acknowledgements (this phase)

- **Trap 3 (vitest env=node):** all four §5 cores are pure, no `window`/DOM/`audio-deck`.
- **Trap 5 (oversliced library):** identity §7 defers population to H4 *with* the 48px/overslice/
  batched-write safeguards — H1 must not open a path that bypasses them.
- **Trap 7/9 (PS 5.1 + path safety):** commit with `git commit -F <msgfile>`; write docs via
  Write/Edit (no `Get-Content`/`Set-Content` round-trip); every command canonicalizes + contains.
- **Trap 8 (version sites):** none bumped in H1 (no release; version stays 1.1.0 until H6).

---

## Stage log

### H1·A — contract (spec first) — 2026-07-09

- Authored this spec: finalized the on-disk layout (§1) with both open choices resolved —
  **fixed `game.rpgatlas`** (§1.1) and **`.atlas/` dot-folder** (§1.2); pinned path safety /
  guard-module contract (§2), the native command surface (§3) including the resolved
  template-document design (§3.1, flagged for Fable), atomicity + rolling backups (§4), the four
  pure cores with normative rules (§5), the finite kid-friendly error taxonomy with final copy
  (§6), asset identity (§7), and the host/façade shape (§8).
- No code changed (docs-only). Git ritual: branch `harbor-1a` → commit → merge to `main` →
  delete branch. Code gates unaffected by a markdown-only change (tree was at baseline: vitest
  917 · node 19 · Playwright 70/70 · eslint 0); ran the fast gates to confirm the tree is green
  before merge (see the commit's verification note); the 70-spec Playwright browser suite was not
  re-run for a docs-only change (it cannot be affected — nothing it exercises changed).
- **STOP for the Fable 5 contract gate.** H1·B does not begin until this spec's header reads
  SIGNED. Next: a fresh Fable 5 conversation reviews §1–§8 (especially the §3.1 template-document
  reconciliation and the §5.1 sanitizer rules) and records the verdict.

### H1·A — Fable 5 contract gate — 2026-07-09

- Reviewed §1–§8 against the roadmap (H1 section, locked decisions, cross-phase traps),
  AGENTS.md, and the existing `lib.rs` patterns; fact-checked the §5.2 app identifier and the
  §3 no-new-capability claim against `tauri.conf.json` / `capabilities/default.json` — both hold.
- Verdict: **SIGNED** with four binding amendments (create rollback on partial scaffold,
  in-place README rewrite, `.rpgatlas.backup` backup suffix, `MISSING_ASSET` copy carried in
  `project-errors.ts`) — recorded in the gate header and folded into §1/§3/§4/§5.4. The
  §1.1/§1.2 resolutions and the §3.1 template-agnostic design are confirmed as the contract.
- Docs-only edit, committed straight to `main` (gate ritual; code gates unaffected).
  **H1·B is cleared to start.**

### H1·B — Rust project commands — 2026-07-09

- **New guard module `src-tauri/src/project_paths.rs`** (§2): owns the tagged error
  taxonomy (`ProjectErrorCode` serialized SCREAMING_SNAKE + `ProjectError { code, detail }`),
  the `std::io::Error → code` mapper (`map_io`), and the four guard functions —
  `canonical_root` (`dunce::canonicalize`, existing dir), `validate_component`
  (rejects empty/`.`/`..`/separators/colon/NUL/control/absolute/trailing-dot-or-space/
  reserved-device), `contained_join` (validate each segment, join, then canonicalize the
  deepest existing ancestor and assert `starts_with(root)` — the symlink-escape defense),
  and `resolve_target` (a `…/game.rpgatlas` file resolves to its parent; a folder to
  itself). **Disk-full** is detected via `raw_os_error` (`ENOSPC` / Windows 112/39), per the
  gate's non-binding MSRV note (no `ErrorKind::StorageFull` on 1.77.2). `dunce = "1"` added
  to `Cargo.toml` (already resolved transitively).
- **New command module `src-tauri/src/project.rs`**: the seven commands from §3 —
  `project_create` / `project_open` / `project_save` / `recents_list` / `recents_touch` /
  `recents_remove` / `project_reveal`, plus `ProjectBundle { root, name, document }`, an
  `atomic_write` (tmp-then-rename, `game.rpgatlas.tmp` sibling — not `with_extension`), and
  rolling backups. Wired into `lib.rs` (module decls + `invoke_handler`); `reveal_path` made
  `pub(crate)` for `project_reveal` to reuse. **No new Tauri capability** (uses `std::fs` +
  the guard, like `library_*`).
- **All four binding amendments implemented:**
  1. `project_create` is all-or-nothing — it `std::fs::create_dir`s the root, and on **any**
     failure of `canonical_root`+`scaffold` best-effort `remove_dir_all`s exactly that root
     (a pre-existing folder short-circuits to `FOLDER_EXISTS` before anything is written).
  2. The per-project `assets/` README (`ASSETS_README`) is an in-place rewrite — "Your files
     STAY right here… RPGAtlas never moves, renames, or deletes them"; a test asserts it does
     **not** contain "Imported".
  3. Backups are `game-<epoch_ms>.rpgatlas.backup` under `.atlas/backup/`, pruned to the 5
     newest by mtime; best-effort (a backup failure never blocks the save).
  4. The `MISSING_ASSET` copy is H1·C's `project-errors.ts` concern (carried there); the Rust
     command-error union stays exactly the eight §6 codes.
- **`scaffold` writes** the full tree (§1): `assets/` + five subfolders + README, `.atlas/` +
  empty `library.json` (`[]`) + `cache/` + `backup/`, `.gitignore`, and `game.rpgatlas` (last,
  atomic). `saves/` is deliberately **not** created (deferred). `library.json` and
  `game.rpgatlas` are atomic (tmp-then-rename).
- **Tests (`cargo test --lib`): 12 passing** — 7 guard (traversal/separators/reserved-name
  rejection, nested-accept + escape-reject, under-root, resolve-target file→parent, missing→
  MISSING) + 5 command (full-tree scaffold incl. README wording + no `saves/`, open→
  NOT_A_PROJECT then folder/file round-trip, save atomic + backup rolled, prune keeps 5,
  create→FOLDER_EXISTS without clobber). Recents commands need an `AppHandle`, so their logic
  is covered by the shared TS core (H1·C `recents.ts`) + devtools round-trip per §3.
- **Gates:** `cargo test` 12/12, `cargo build` **0 warnings** (the H5-reserved
  `SecondInstance` variant is `#[allow(dead_code)]`). Frontend untouched → vitest **917** ·
  node **19** · eslint **0** · typecheck **clean**, all at baseline. Playwright not re-run: a
  native-only change with no frontend edit and no exe rebuild cannot affect the browser suite
  (same rationale as the H1·A docs-only entry). No patch-notes entry (nothing user-visible).
- Git ritual: branch `harbor-1b` → gates green → commit → merge to `main` → delete branch.
  **Next: H1·C** (host.js project surface + `project-host.ts` façade + the four `src/shared`
  pure cores with vitest).

### H1·C — Host + pure cores (phase exit) — 2026-07-09

- **Four pure cores in `src/shared` (env=node, no window/DOM — trap 3):**
  - `project-name.ts` — `sanitizeFolderName` per §5.1 (NFC → strip controls →
    reserved-char→space → collapse ws → strip trailing dot/space → truncate 80 →
    fallback `Untitled Game` → `_`-prefix reserved device names). Casing preserved.
    Control chars are stripped by **codepoint** (`stripControlChars`, not a control-char
    regex) so the source stays clean ASCII and dodges the `no-control-regex` lint.
  - `recents.ts` — `RECENTS_CAP=12`, `touchRecent` / `removeRecent` / `annotateRecents`
    (display-time missing-tag, never auto-prune) + `parseRecents` (corrupt/non-array → `[]`).
  - `project-templates.ts` — `TemplateId` + `TEMPLATES` (final kid copy: Empty map /
    Starter game / Atlas Quest sample) + `isTemplateId`. **No document bytes** (§3.1).
  - `project-errors.ts` — the eight-code `ProjectErrorCode` union + `projectErrorCopy`
    (unknown code → IO fallback) with the FINAL §6 copy, **plus** `MISSING_ASSET_COPY`
    (gate amendment 4: an asset *state*, kept out of the command union but tested here).
- **Typed façade `src/platform/tauri/project-host.ts`** — same custom-invoke pattern as
  `fs-asset-store.ts`; exports `projectHost.{create,open,save,recentsList,recentsTouch,
  recentsRemove,reveal}` returning `ProjectBundle` / `Recent[]`, and translates a thrown
  Rust `{code, detail}` into a typed `ProjectHostError` carrying a `ProjectErrorCode`.
  `recentsList` runs the raw string through the tested `parseRecents`. Not unit-tested (it
  is the IPC boundary); its pure inputs (the cores) are.
- **`js/editor/host.js`** — seven thin `isTauri`-gated one-liners over `invoke`
  (`projectCreate` / `projectOpen` / `projectSave` / `recentsList` / `recentsTouch` /
  `recentsRemove` / `projectReveal`), matching the `openPlaytest` shape.
- **No editor wiring.** Nothing imports the cores/façade into `boot.ts`/`persistence.ts`;
  browser builds never touch any of it (`isTauri` false). Wiring is H2.
- **New vitest specs (24 tests): 941 total** — `project-name` (9: illegal chars, control
  strip, trailing dot/space, empty/all-punct fallback, reserved-name prefix incl. COM10/
  console pass-through, truncation + boundary re-strip, unicode/casing preserved,
  idempotence), `recents` (8: move-to-front, dedupe, cap, remove no-op, annotate order,
  parse malformed/corrupt), `project-templates` (4), `project-errors` (3: every code
  non-empty + distinct titles, unknown→IO, MISSING_ASSET copy).
- **Gates (phase exit):** vitest **941** (baseline 917 + 24) · node **19** · Playwright
  **70/70** (browser parity byte-identical — the cores are unreferenced) · eslint **0** ·
  typecheck **clean** · cargo test **12/12**. No patch-notes entry (§0 — nothing
  user-visible). Devtools note: create/open/save/traversal are covered by `cargo test`;
  the recents commands need a live `AppHandle`, so their logic rides on the tested
  `recents.ts` core (a full manual devtools round-trip needs the running desktop app, which
  no automated harness here can boot).
- Git ritual: branch `harbor-1c` → gates green → commit → merge to `main` → delete branch.
  **Phase exit: tag `harbor-1`.** H1 delivers the signed on-disk contract + native plumbing
  + host surface + pure cores, all invisible to users. **H2 (Project Manager launcher) is
  cleared.**
