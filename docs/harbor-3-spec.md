# Harbor H3 — Project-scoped saving & playtest (spec)

**Phase:** H3 of Project Harbor (`docs/PROJECT_FOLDERS_ROADMAP.md`)
**Author:** Claude Opus 4.8 (Extra High), 2026-07-09
**Builds on:** the signed on-disk contract + native plumbing (`docs/harbor-1-spec.md`,
tagged `harbor-1`) and the desktop Project Manager launcher (`docs/harbor-2-spec.md`,
tagged `harbor-2`). H3 is where *edits land in the folder*: with a game open on desktop,
autosave writes `<root>/game.rpgatlas` (atomic + rolling backup), and localStorage is
demoted from "the truth" to a **crash-recovery mirror** (which is also the same-origin
playtest bridge, so it is never removed — only demoted).

**Non-negotiables carried from H1/H2 / the roadmap:**
- **FORMAT_VERSION stays 2.** The folder document is exactly today's blob-free project
  JSON. Folder saves are **blob-free** (H4 completes the per-project asset library; until
  then the embedded-asset import path still works, and **Export** still bundles assets).
- **The e2e boot gate (trap 1).** `#save-ind` ships hidden in `index.html` and is revealed
  **last**, by `boot()`, once the *editor* is interactive. H3 does not touch that: the
  indicator's three states (`●` unsaved / `✓` saved / `⚠` save failed) are unchanged, and
  the folder write only ever *updates* those states — it never re-reveals or restyles it.
- **Desktop-first, browser-safe.** Folder saving is gated on `folderRoot != null`, bound
  only when the Project Manager chooses a game (desktop, or the H2·D `?fakehost` test
  hook). **The pure browser build never binds it**, so `saveNow()` there is byte-identical
  to before (mirror only) and the existing 70 Playwright specs pass **unmodified**.
- **No new webview windows (trap 2).** Playtest stays the predefined-window,
  reload-only pattern. H3·C changes *nothing* about how the playtest window is created.

**H3 adds no Rust.** The H1 native surface is sufficient: autosave writes through
`project_save`, and H3·B re-reads the file through `project_open` (both already shipped and
cargo-tested in H1). New capability/permission: none. The Rust changes therefore need no
exe rebuild until H6 — but there are none here anyway. The whole phase is drivable in the
browser build through the `?fakehost` `ManagerHost` (now with a `save` method), so every
flow is e2e-covered without the desktop app.

---

## 0. What H3 delivers (and does not)

**Delivers (per stage):**
- **H3·A — Autosave rebind.** With a folder game open, the debounced `saveNow()` writes
  `<root>/game.rpgatlas` via the active host's `project_save` (atomic tmp-then-rename +
  rolling `.atlas/backup/` — the H1 command). localStorage stays the crash-recovery mirror
  (written first, synchronously, on every save). Ctrl+S / File ▸ Save flush immediately.
  The old first-save **Save-As** dialog is gone; **Export** keeps the native Save dialog +
  `embedUsedAssets` (a shareable single-file copy).
- **H3·B — External changes & recovery.** On window focus, re-read the file and, if it
  changed outside the editor, offer a friendly **reload** (no local edits) or
  **reload-or-keep-mine** (local edits). On boot, if the localStorage mirror is *newer*
  than the file (crash evidence), offer to recover it. Both decisions are pure cores
  (`src/shared/folder-sync.ts`, vitest env=node). Kill-process scenario documented + e2e.
- **H3·C — Playtest bridge.** Keep the proven **same-origin localStorage** bridge: the
  editor writes the mirror right before `open_playtest`, and the playtest window stays
  reload-only. Document that `saves/` slots remain in browser storage for 1.2.0.

**Does NOT deliver (later phases):**
- No per-project asset drop-folders / auto-discovery — assets still live in the device
  library and ride along via embedded-asset import; folder saves stay blob-free (**H4**).
- No argv / single-instance / file association (**H5**). No migration wizard (**H6**).
- No `saves/` folder slots (browser storage keeps playtest saves for 1.2.0 — roadmap H3·C).

---

## 1. Autosave rebind (H3·A)

### 1.1 Where the truth lives now

`src/editor/persistence.ts` gains a small folder-save state:

```
folderRoot     : the open game's canonical root, or null (browser / no game chosen)
lastSavedJson  : the exact bytes we believe are on disk (opened, or last written)
folderDirty    : set by touch() on any edit; cleared once a folder save persists it
folderSaveInFlight / folderSaveQueued : serialize overlapping writes into one re-run
```

`bindFolderProject(root, diskDocument, dirty=false)` is called by the manager's
`bootChosen` the instant a game is chosen (create or open), setting `folderRoot` and
seeding `lastSavedJson` with the **exact bytes read from disk** (`bundle.document`). The
pure browser build never calls it, so `folderRoot` stays null.

`saveNow()`:
1. **Always** writes the localStorage mirror first (synchronously). This is the
   crash-recovery copy *and* the same-origin playtest bridge — it must be current before
   anything opens the player.
2. If `folderRoot` is set → persist to the folder (`saveToFolder()`); else set the
   indicator from the mirror result (the classic browser path, unchanged).

`saveToFolder()` writes `JSON.stringify(S.proj)` into `<root>/game.rpgatlas` via
`activeManagerHost().save(root, json)` — the real `project_save` on desktop, the fake host
under `?fakehost`. It **skips the write entirely when `!folderDirty`** (or the bytes equal
`lastSavedJson`), so merely opening a game — or the unconditional post-boot `saveNow()` —
never rolls a backup for content the folder already holds. On success it advances
`lastSavedJson`, marks the mirror bookkeeping confirmed, and ticks `✓`; on failure it
re-arms `folderDirty` and shows `⚠` (the primary write is what matters; the user can retry).

**Serialization discipline.** The folder file, `lastSavedJson`, and the H3·B in-memory /
disk comparisons all use `JSON.stringify(S.proj)`. So immediately after any folder save the
file bytes equal `lastSavedJson` exactly, which is what makes external-change detection
precise (§3). (The mirror's own serialization is whatever `BrowserProjectRepository` uses;
its content only matters to crash recovery, which leans on the bookkeeping flag, not on
byte-equality — see §2.)

### 1.2 Indicator semantics (unchanged)

`#save-ind` keeps exactly its three states. `touch()` sets `●`; a resolved folder save (or
the mirror-only browser path) sets `✓`; a rejected folder save sets `⚠`. Nothing gives it
static text or reveals it early (trap 1). Ctrl+S / File ▸ Save call `desktopFlush()` (clear
the debounce, `saveNow()` now) on desktop; the browser build keeps its "saved to this
browser" behavior.

### 1.3 Export (unchanged behavior, renamed)

`exportProject()` on desktop calls `exportDesktopFile()` — `embedUsedAssets(S.proj)` → the
native Save dialog (`host.saveProjectToFile`, the proven `save_project` command) → a
portable single-file `.json`. The old autosave-to-a-single-file machinery
(`currentProjectPath` / `save_project_to_path` for silent overwrite / the first-save Save-As
prompt) is **removed**: with a project folder, silent overwrite is what autosave already
does to `game.rpgatlas`. Export is now purely "make a shareable copy," which is what a kid
means by "send my game to a friend."

---

## 2. Crash recovery (H3·B)

The mirror bookkeeping lives in a sibling localStorage key **`atlas.mirror.meta`** =
`{ root, savedAt, folderConfirmed }` (the mirror payload `rpgatlas_project` is untouched):
- `saveNow()` writes `folderConfirmed: false` right before starting a folder save (the
  mirror is now ahead of the folder), and the folder save flips it to `true` on resolve (or
  when skipped because the folder already holds the content).
- If the process is **killed** between the mirror write and the folder write resolving,
  the meta is left `folderConfirmed: false` and the mirror holds content the folder never
  got — the exact crash signature.

`decideRecovery({ root, folderDoc, mirrorDoc, mirrorMeta })` → `use-folder | offer-mirror`
(pure, `src/shared/folder-sync.ts`). Offers recovery **only** when every guard agrees the
mirror is genuinely newer for *this* game:

| Guard | Result |
|---|---|
| no mirror | `use-folder` |
| no/corrupt meta | `use-folder` |
| `meta.root !== root` (mirror belongs to another game) | `use-folder` |
| `mirrorDoc === folderDoc` (nothing to recover) | `use-folder` |
| `meta.folderConfirmed` true (folder has it, or a later external edit) | `use-folder` |
| else (differs, same game, never confirmed) | **`offer-mirror`** |

The `folderConfirmed` guard is what makes recovery *respect* an external edit made while the
editor was closed: a mirror from a clean prior session is `folderConfirmed: true`, so a file
changed on disk afterward is honored, never clobbered by the stale mirror.

**Wiring** (`manager.ts` `bootChosen`, the open/create pipeline): after reading the folder
bundle, run `decideRecovery` against the current mirror + meta. On `offer-mirror`, show a
kid-friendly modal — **"We found changes from your last time that didn't finish saving.
Bring them back?"** [Bring my changes back] / [Use the saved game]. If the child chooses to
recover, boot on the mirror document and `bindFolderProject(root, diskBytes, dirty=true)` so
the recovered work is written back to the folder on the next autosave; otherwise boot on the
folder document as normal. Create never has crash evidence (brand-new folder), and opening a
*different* game is guarded by `meta.root` — so the prompt only appears for the genuine case.

## 3. External changes on focus (H3·B)

A `focus` + `visibilitychange` listener (installed once at persistence load, inert unless
`folderRoot` is bound — so the browser build and the existing 70 specs never trip it)
re-reads `<root>/game.rpgatlas` via `activeManagerHost().open(root)` and classifies it:

`decideExternalChange({ diskDoc, lastSavedDoc, inMemoryDoc })` → `none | reload | conflict`:

| Condition | Result | Action |
|---|---|---|
| `diskDoc === lastSavedDoc` (file is what we wrote) | `none` | nothing |
| file changed, **no** local edits (`inMemoryDoc === lastSavedDoc`) | `reload` | offer a plain reload |
| file changed **and** local edits | `conflict` | offer reload-theirs / keep-mine |

- **Reload** → `setPendingOpen(root)` + `location.reload()`: the fresh load's
  `launchManager()` consumes the stash, re-opens the folder (newest bytes), and boots
  cleanly (the same clean-reboot path H2·C uses, so no double-bound listeners). The pending
  handoff lives in `src/editor/project-manager/pending-open.ts` (extracted from `manager.ts`
  so persistence can request a reboot without importing the manager — that would cycle).
- **Keep mine** → accept the disk state as the new baseline (`noteDiskBaseline(disk, dirty=true)`)
  so the same external state stops re-prompting, and mark dirty so our version overwrites on
  the next save. **Dismiss** (in the no-edits case) → accept the disk state as baseline
  (`noteDiskBaseline(disk, false)`) so we don't nag again for the same state.

All copy is kid-friendly: "This game changed on your computer since you opened it." No
mtimes, no diffs, no jargon.

## 4. Playtest bridge (H3·C)

Unchanged by design. The `play` action already `saveNow()`s before opening the player, and
`saveNow()` still writes the mirror **first, synchronously**, so `play.html` (which reads
`rpgatlas_project`) always sees the latest edits — in the browser AND across the Tauri
editor/playtest windows (same origin). The predefined **playtest window stays reload-only**
(`open_playtest` = reload + show + focus; close = hide) — H3 never builds a window from a
command (trap 2). `saves/` slots stay in browser storage for 1.2.0 (folder slots = a
post-1.2.0 stretch, per roadmap H3·C).

---

## 5. Cross-phase trap acknowledgements (this phase)

- **Trap 1 (e2e boot gate):** `#save-ind` semantics untouched; the folder write only sets
  the existing `●`/`✓`/`⚠` states, never reveals or restyles it. It is still revealed last,
  by `boot()`, and is the boot gate.
- **Trap 2 (windows):** playtest is byte-identical (predefined window, reload-only). No
  `WebviewWindowBuilder`.
- **Trap 3 (vitest env=node):** the two decision cores + mirror-meta parsing live in
  `src/shared/folder-sync.ts` — pure, no `window`/DOM/`audio-deck`.
- **Trap 4 (Playwright = browser):** folder flows hide behind `folderRoot`, bound only under
  `managerActive()`; e2e goes through the `?fakehost` host's new `save`, additively. The 70
  run unmodified.
- **Trap 7 (PS 5.1):** commit with `git commit -F <msgfile>`; docs via Write/Edit.
- **Trap 8 (version sites):** phase exit bumps `js/patch-notes.js` (+ `help.ts` /
  `shims.d.ts` cache-buster); product version stays 1.1.0 until H6. No `editor.css` change
  (no new UI beyond modal dialogs, which reuse existing styles).

---

## 6. Exit criteria (H3 phase)

- Edit → quit → relaunch → open from the folder: everything is there (autosave writes the
  folder). A killed process recovers from the mirror. Backups rotate at 5 (the H1 command).
  Export still produces a portable single file.
- Browser build behavior unchanged; the existing 70 Playwright specs pass **unmodified**;
  new H3 specs (via `?fakehost`) green.
- Gates ≥ baseline: **vitest ≥ 941 · node 19 · Playwright 70/70 (+ manager specs) ·
  eslint 0 · typecheck clean**. Patch-notes entry added; `help.ts` + `shims.d.ts` bumped.
  Tag **`harbor-3`**.

---

## Stage log

### H3·A — Autosave rebind — 2026-07-09

- **Authored this spec** (`docs/harbor-3-spec.md`) from the roadmap H3 section.
- **New pure core `src/shared/folder-sync.ts`** (env=node — trap 3): `MirrorMeta` +
  `parseMirrorMeta`/`stringifyMirrorMeta` (corrupt/missing-field → null), `decideRecovery`
  (the six-guard crash-recovery truth table, §2) and `decideExternalChange`
  (none/reload/conflict, §3). The recovery + external-change *functions* land now (fully
  unit-tested); their UI wiring is H3·B.
- **`persistence.ts` rebind:** added `folderRoot`/`lastSavedJson`/`folderDirty` +
  serialized-write state; `bindFolderProject(root, diskDoc, dirty)`,
  `openFolderRoot()`/`folderBaseline()`/`noteDiskBaseline()` (the last two feed H3·B).
  `saveNow()` now always writes the mirror first, then — when `folderRoot` is set — persists
  `<root>/game.rpgatlas` via `activeManagerHost().save`, skipping the write (and its backup)
  when nothing changed since the last folder save, so opening a game never rolls a backup.
  `touch()` marks `folderDirty`. `desktopFlush()` (Ctrl+S / File ▸ Save) clears the debounce
  and flushes now. The mirror bookkeeping (`atlas.mirror.meta`) is written `false` before a
  folder save and `true` on resolve/skip. `#save-ind`'s three states are unchanged.
- **Export unchanged, renamed:** `exportDesktopFile()` = `embedUsedAssets` + the native Save
  dialog (`save_project`) — a shareable single file. Removed the old `desktopSave` /
  `currentProjectPath` / `save_project_to_path` first-save-Save-As machinery (folder autosave
  replaces silent-overwrite-to-a-.json).
- **Host `save`:** added `save(root, documentJson)` to the `ManagerHost` interface, the real
  host (delegates to `projectHost.save` → `project_save`), and the `?fakehost` test host
  (writes the fake FS docs map so a later `open` returns it — makes folder autosave and the
  H3·B disk re-read e2e-drivable). **No Rust added** (the H1 `project_save`/`project_open`
  suffice); no new capability.
- **Manager wiring:** `bootChosen` calls `bindFolderProject(bundle.root, bundle.document)`
  after setting the open-project context, so the baseline is the exact on-disk bytes.
- **Workspace:** the `save` action now calls `desktopFlush()` on desktop (was
  `desktopSave(false)`); the tip reads "Save your game to its folder now."
- **New unit tests (11):** `folder-sync` — mirror-meta round-trip + 6 malformed cases,
  the six `decideRecovery` guards, and the three `decideExternalChange` verdicts.
- **New e2e (2, additive, `?fakehost`):** opening a game does **not** rewrite the folder
  file (byte-identical to the seed) until an edit, and the mirror meta records
  `folderConfirmed: true`; painting a tile autosaves the change into
  `<root>/game.rpgatlas` (the fake folder), with the mirror kept as a live copy.
- **Gates:** vitest **952** (941 + 11) · node **19** · Playwright **85/85** (70 existing
  **unmodified** + 15 manager) · eslint **0** · typecheck **clean**. Browser build
  byte-identical (`folderRoot` never binds there); frozen map 1 untouched. No patch-notes
  entry yet (added at the phase exit). Git ritual: branch `harbor-3a` → gates green →
  commit → merge to `main` → delete branch. **Next: H3·B** (external-change on focus +
  crash recovery from a newer mirror, with the kill-process test).
