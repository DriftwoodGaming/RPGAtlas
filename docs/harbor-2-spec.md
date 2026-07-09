# Harbor H2 — Project Manager launcher (spec)

**Phase:** H2 of Project Harbor (`docs/PROJECT_FOLDERS_ROADMAP.md`)
**Author:** Claude Opus 4.8 (High), 2026-07-09
**Builds on:** the signed on-disk contract + native plumbing (`docs/harbor-1-spec.md`,
tagged `harbor-1`). H2 is the first user-visible Harbor phase: on desktop the engine now
opens like RPG Maker / Godot — **create a game or open one** — before the editor boots.

**Non-negotiables carried from H1 / the roadmap:**
- **FORMAT_VERSION stays 2.** The `.rpgatlas` document is exactly today's blob-free project
  JSON. Templates are built by existing TS (`DataDefaults` / the Atlas Quest sample) and the
  ready bytes are handed to `project_create` — Rust stays template-agnostic (H1 §3.1).
- **Desktop-first, browser-safe.** The manager + folder flows are gated on
  `isTauri` (or the H2·D `?fakehost` test hook). The **pure browser build is byte-identical**:
  the manager never mounts, `boot()` runs exactly as today, and **the existing 70 Playwright
  specs pass unmodified** (baseline 0 failures, frozen map 1 untouched).
- **The e2e boot gate (trap 1).** `#save-ind` ships hidden in `index.html` and is revealed
  **last**, by `boot()`, once the *editor* is interactive. The Project Manager being on
  screen is **not** the boot signal — the manager must never reveal `#save-ind` or give it
  static text. Specs that gate on `#save-ind` therefore wait for the *editor*, after a
  project is chosen.
- **No new webview windows (trap 2).** The manager is a screen rendered **inside `main`** (a
  full-window overlay in the same document), never a `WebviewWindowBuilder` call.
- **Audience rule.** Every label, hint, and error the child can reach is written for kids
  and first-time devs — "Let's make a game", "We can't find this game anymore", never a
  stack trace.

**H2 adds no Rust.** The native surface H1 shipped (`project_create/open/save`,
`recents_*`, `project_reveal`) is sufficient. The parent-directory / Browse pickers use the
**dialog plugin's JS API** (`window.__TAURI__.dialog.open`, available because
`withGlobalTauri: true` and `dialog:default` is granted) — no new command, no new
capability. (One optional config-only nicety — `core:window:allow-set-title` for the native
window title — is noted in §6; it changes no code and takes effect at the H6 exe rebuild.)

---

## 0. What H2 delivers (and does not)

**Delivers (per stage):**
- **H2·A — the manager surface + boot gating + host plumbing.** A desktop-only pre-boot
  screen (logo, **New Project**, **Open Project**, recents) rendered in the main window; the
  editor's `boot()` runs only *after* a project is chosen. A `ManagerHost` abstraction with a
  real (Tauri) implementation, plus the template document builders (`project-templates`
  descriptors → ready blob-free documents). `#save-ind` stays hidden until the editor boots.
- **H2·B — New Project flow.** Name field with a **live folder-safe preview** (the H1
  `sanitizeFolderName` core), a parent-directory picker (dialog plugin), and a **template
  chooser** — **Blank** (empty map), **Starter** (today's first-run project), **Atlas Quest**
  (the curated sample) — resolved to a document and scaffolded via `project_create`, then the
  editor boots on it.
- **H2·C — Open flow & in-editor rewiring.** Recents (name, path, last-opened; vanished
  folders show a friendly "can't find this game anymore" row with Remove), **Browse…**,
  `File ▸ New Project` / `Open Project` route back through the manager (guarding unsaved
  work), and the window title becomes **`<Game Name> — RPGAtlas`**.
- **H2·D — Testability.** The `window.__ATLAS_TEST_HOST__` fake host (installed by a
  `?fakehost` query param in dev/test builds only) that simulates the whole Tauri project
  surface in the browser, so Playwright can drive the manager. New specs are **additive**;
  the existing 70 run unmodified.

**Does NOT deliver (later phases):**
- No autosave rebind to the folder — desktop editing still autosaves to localStorage this
  phase; a created/opened project boots the editor, but edits land in localStorage until
  **H3** rewires `saveNow()` to `project_save`.
- No per-project asset drop-folders / auto-discovery (**H4**).
- No argv / single-instance / file association (**H5**). No migration wizard (**H6**).

---

## 1. Boot gating (H2·A)

`src/editor/main.ts` still does `import "./boot"`; `boot.ts` remains the composition root but
its bottom now runs a small **`start()`** decision instead of booting unconditionally:

```
start():
  if ?fakehost present → install the fake host (H2·D) on window.__ATLAS_TEST_HOST__
  if managerActive()  → dynamic import("./project-manager/manager") → showProjectManager()
  else                → runBoot()          // pure browser: byte-identical to today
```

- `managerActive() = isTauri || hasFakeHostParam()`.
- The manager module is loaded via **dynamic `import()`**, so it (and the ~187 KB Atlas Quest
  sample bundled for its template) live in a **lazy chunk the pure-browser build never
  fetches**. This is also why there is no circular-import hazard: `manager.ts` statically
  imports `bootWithProject` from `../boot`, and by the time the manager chunk loads, `boot.ts`
  has fully evaluated.
- `boot.ts` is refactored so the project source is a parameter:
  `bootWithProject(project)` holds the existing boot body (from `initAssetLibrary` onward);
  `boot()` = `bootWithProject(loadStored() || DataDefaults.newProject())` (the unchanged
  browser path); `runBootWith(project)` = `bootWithProject(project).catch(showBootFailure)`
  for the manager's "a project was chosen" path.

**The manager overlay** is a `position:fixed; inset:0` full-window screen appended to
`document.body` at a high z-index. Before boot, `index.html`'s editor chrome
(menubar/toolbar/dock/status) is present but empty; the opaque overlay covers it. When a
project is chosen the overlay is removed and `runBootWith(project)` builds the editor — which
reveals `#save-ind` last (the gate). The manager **never** touches `#save-ind`.

### 1.1 The `ManagerHost` abstraction (H2·A)

The manager talks to one interface so the real Tauri surface and the fake test host are
interchangeable:

```
interface ManagerHost {
  create(parentDir, leaf, documentJson): Promise<ProjectBundle>
  open(target): Promise<ProjectBundle>
  recentsList(): Promise<Recent[]>
  recentsTouch(path, name): Promise<void>
  recentsRemove(path): Promise<void>
  reveal(root): Promise<void>
  pickDirectory(): Promise<string | null>   // New Project parent-dir picker
  pickFolder(): Promise<string | null>       // Browse (Open) — a game folder
  exists?(path): Promise<boolean>            // optional; fake host provides it (see §3)
}
```

- **Real host** (`isTauri`): `create/open/recents*/reveal` delegate to the H1 `projectHost`
  façade; `pickDirectory`/`pickFolder` call `window.__TAURI__.dialog.open({ directory:true })`.
  It does **not** implement `exists` (the webview cannot stat the FS without a command/plugin,
  and H2 adds neither) — so on desktop a vanished recent is detected **on click** (an `open()`
  that throws `MISSING` turns that row friendly), not pre-flagged. (H2·D's fake host *does*
  implement `exists`, so the "missing row up front" behavior is fully e2e-covered.)
- Errors: every host rejects with a `ProjectHostError` carrying a `ProjectErrorCode`; the
  manager renders `projectErrorCopy(code)` (H1 §6 copy) — never a raw message.

### 1.2 Template documents (H2·A, `src/editor/project-manager/templates.ts`)

`buildTemplateDocument(id, displayName)` returns a **validated, blob-free project object**
(run through `RA.migrateProject` + `validateProject(…, "load")` so a bad template can never
boot a broken editor). `displayName` becomes `system.title` (the child's chosen name), while
the folder leaf is the `sanitizeFolderName(displayName)` result.

- **starter** — `DataDefaults.newProject()` (today's first-run project).
- **blank** — `DataDefaults.newProject()` reduced to a single empty map (via
  `DataDefaults.newMap`), start position re-homed onto it, quests/common-events cleared —
  "a tiny empty world."
- **atlas-quest** — the curated sample, imported as a raw string via
  `import atlasQuestRaw from "../../../Atlas_Quest.json?raw"` (Vite `?raw` keeps the type
  `string`, avoiding a 15k-line inferred JSON type in `tsc`, and bundles the bytes into the
  lazy manager chunk). Parsed, title overridden, migrated/validated like the others.

The descriptor list + `isTemplateId` come from the H1 core `src/shared/project-templates.ts`
(labels/blurbs already final and kid-friendly).

---

## 2. New Project flow (H2·B)

The **New Project** view:
- **Name** input. A live preview shows the folder that will be made:
  "Folder: `<sanitizeFolderName(name)>`" — so a child sees `My Game!!!` become `My Game` and
  an empty name fall back to `Untitled Game` before they commit.
- **Where** row: a "Choose folder…" button (→ `host.pickDirectory()`) and the chosen parent
  path (kid copy: "We'll make your game's folder inside here"). Desktop pops the native
  directory dialog; the fake host returns its queued path.
- **Template** chooser: three cards from `TEMPLATES` (Blank / Starter / Atlas Quest) with
  their kid blurbs; one is selected.
- **Make my game** builds the document (`buildTemplateDocument(templateId, name)`), calls
  `host.create(parentDir, sanitizeFolderName(name), JSON.stringify(document))`, then on
  success `recentsTouch(root, name)`, sets the open-project context, and boots the editor on
  the (already-validated) document. `FOLDER_EXISTS` etc. render inline via the H1 copy; the
  child stays on the form to fix the name or pick another folder.

`project_create` re-validates the leaf (`validate_component`) as defense-in-depth (H1 §3);
the frontend pre-sanitizes so the two agree.

---

## 3. Open flow & rewiring (H2·C)

**Recents** (newest-first, from `host.recentsList()`):
- Each row shows the game **name**, its **path** (dimmed), and, when the host implements
  `exists`, a **missing** state (`annotateRecents` from the H1 core) rendered with the
  `MISSING` copy ("We can't find this game anymore") + a **Remove** control
  (`recentsRemove`). On the real desktop host (no `exists`) rows render normally and a click
  that hits a vanished folder throws `MISSING` → the row turns friendly then.
- Clicking a present row → `host.open(path)` → boot; `recentsTouch` moves it to the front.

**Browse…** → `host.pickFolder()` (a game *folder* — "a game is a folder", the kid mental
model; `project_open` also accepts a `game.rpgatlas` path for H5 double-click) → `open()`. A
non-project folder throws `NOT_A_PROJECT` → the friendly "that folder isn't an RPGAtlas game"
copy.

**In-editor rewiring** (only when `managerActive()` — pure browser keeps today's behavior):
- `File ▸ New Project` and `File ▸ Open Project` **return to the manager**, guarding unsaved
  work with a friendly confirm.
- Because the editor binds many one-time listeners at boot, "open another game while one is
  open" is done by **stashing the chosen root in `sessionStorage` and reloading** — on the
  fresh load `start()` opens the stashed project directly (skipping the manager) and boots
  cleanly. A vanished stash falls back to the manager. (First launch has no stash.)
- **Window title** → `document.title = "<Game Name> — RPGAtlas"` (asserted by the browser
  specs) and a best-effort native `getCurrentWindow().setTitle(...)` in a `try/catch` so a
  missing permission never throws. `core:window:allow-set-title` is added to
  `capabilities/default.json` (config only) so the native title works after the H6 exe
  rebuild.

---

## 4. Testability — the fake host (H2·D)

`window.__ATLAS_TEST_HOST__`, installed only when `?fakehost` is in the URL, implements the
full `ManagerHost` against an **in-memory / localStorage-backed** fake filesystem so
Playwright can drive the whole manager in the browser build:
- Persistence keys: `atlas.fakehost.docs` (`{ root: documentJson }`) and
  `atlas.fakehost.recents` (a `Recent[]`), so **state survives reloads** (create → reload →
  the recents row is still there).
- Test controls on the hook: `setNextDirectory(path)` / `setNextFolder(path)` (queue the next
  picker result), `seedDoc(root, json)` / `seedRecent(entry)` / `deletePath(root)`
  (simulate a vanished folder), and `reset()`.
- `exists(path)` is implemented (docs map membership), so the "missing row up front" path is
  covered.
- Errors are thrown as `ProjectHostError` with the right `code`, matching the real host.

**New specs (additive, `tests-e2e/project-manager.spec.mjs`):**
- **create → editor boots**: `?fakehost`, queue a directory, type a name, pick a template,
  Make my game → the overlay closes and `#save-ind` appears (editor booted).
- **reopen → recents shows it**: after create, reload → the recents row is present → click →
  boots.
- **missing folder → friendly row**: seed a recent, `deletePath` its folder, open the manager
  → the row shows the "can't find this game anymore" copy + Remove.
- **the gate holds**: on `?fakehost`, `#save-ind` is hidden while the manager is up, and only
  appears after a project is chosen.

The existing 70 specs are **not modified** and stay green (they never pass `?fakehost`, so the
manager never mounts).

---

## 5. Cross-phase trap acknowledgements (this phase)

- **Trap 1 (e2e boot gate):** the manager never reveals or writes `#save-ind`; only `boot()`
  reveals it, last. Manager specs wait for the editor after choosing a project.
- **Trap 2 (windows):** the manager is an overlay inside `main`; no `WebviewWindowBuilder`.
  Playtest is untouched.
- **Trap 3 (vitest env=node):** the template *descriptors*, name sanitizer, recents logic, and
  error copy are the H1 `src/shared` pure cores (already env=node tested); H2 adds unit
  coverage for the new pure helper(s) it introduces. The manager UI itself is DOM code
  (exercised via Playwright + the fake host), and imports no `audio-deck`.
- **Trap 4 (Playwright = browser):** desktop flows hide behind `managerActive()`; e2e goes
  through the `?fakehost` hook, additively; the 70 stay unmodified.
- **Trap 7 (PS 5.1):** commit with `git commit -F <msgfile>`; docs via Write/Edit.
- **Trap 8 (version sites):** phase exit bumps `js/patch-notes.js` (+ `help.ts` /
  `shims.d.ts` cache-busters) and `css/editor.css?v=` for the new manager styles; the product
  version stays 1.1.0 until H6.

---

## 6. Exit criteria (H2 phase)

- Desktop boots to the manager; **create / open / recents / Browse** all work against real
  folders (native), and the editor boots on the chosen game.
- Browser build behavior unchanged; the existing 70 Playwright specs pass **unmodified**;
  new manager specs (via `?fakehost`) green.
- `#save-ind` still revealed last by `boot()`; frozen map 1 untouched.
- Gates ≥ baseline: **vitest ≥ 941 · node 19 · Playwright 70/70 (+ new manager specs) ·
  eslint 0 · typecheck clean**. Patch-notes entry added; `help.ts` + `shims.d.ts` bumped.
  Tag **`harbor-2`**.

---

## Stage log

### H2·A — manager surface + boot gating + host plumbing — 2026-07-09

- **Authored this spec** (`docs/harbor-2-spec.md`) from the roadmap H2 section.
- **`boot.ts` refactor:** the boot body is now `bootWithProject(project)` (exported);
  `boot()` = `bootWithProject(loadStored() || DataDefaults.newProject())` (the unchanged
  browser/no-manager source); `runBootWith(project)` boots a manager-chosen game through the
  same `showBootFailure` recovery. The bottom now runs **`start()`**: install the fake host if
  `?fakehost`, then `managerActive()` → dynamic `import("./project-manager/manager")` →
  `showProjectManager()`, else `runBoot()`. `markEditorBooted()` is called at the true end of
  boot (right after `#save-ind` is revealed — the gate is untouched). Pure browser: `start()`
  hits `runBoot()` synchronously (no `await` before it), so timing is byte-identical.
- **New modules under `src/editor/project-manager/`:**
  - `manager-host.ts` — the `ManagerHost` interface, `realManagerHost` (delegates to the H1
    `projectHost` façade; pickers via `window.__TAURI__.dialog.open` — no new command/
    capability), `managerActive()`/`hasFakeHostParam()`, and `activeManagerHost()` (fake host
    if installed, else real).
  - `project-context.ts` — the open game's `{root, name}`, `isEditorBooted()`/
    `markEditorBooted()`, and the window title (`document.title` + best-effort native
    `setTitle`).
  - `templates.ts` — `buildTemplateDocument(id, name)`: **starter** (`DataDefaults.newProject`),
    **blank** (one fresh grass map + cleared quests), **atlas-quest** (the sample via
    `import "…/Atlas_Quest.json?raw"` — keeps `tsc` off a 15k-line inferred type and bundles
    into the lazy manager chunk). Every path runs `migrateProject` + `validateProject(…,
    "load")`; the child's name becomes `system.title`.
  - `manager.ts` — the overlay UI (logo, New Project / Open Project, recents), the shared
    `bootChosen` pipeline (validate → `recentsTouch` → set context/title → close → boot), and
    inline kid-friendly error copy via `projectErrorCopy`. The **New Project view** ships as a
    working name + folder-picker + create (template = starter); the live folder preview + the
    three template cards land in H2·B.
  - `test-host.ts` — the `window.__ATLAS_TEST_HOST__` fake host, **landed early** (roadmap
    scopes it to H2·D) so the manager is Playwright-verifiable as it is built. Installed only
    under `?fakehost`; localStorage-backed fake FS + test controls (`setNextDirectory`,
    `seedDoc`, `seedRecent`, `deletePath`, …). H2·D formalizes/documents it and adds the
    remaining scenario specs; the existing 70 (which never pass `?fakehost`) are untouched.
- **CSS:** `.pm-*` manager styles appended to `css/editor.css` (theme tokens; kid-friendly);
  cache-buster bumped `editor.css?v=59 → 60` in `index.html`. No patch-notes entry yet (added
  at the phase exit).
- **New spec `tests-e2e/project-manager.spec.mjs` (3 tests, additive):** manager mounts on
  `?fakehost` with `#save-ind` hidden (the gate); the New Project button reveals the form;
  clicking a seeded recent opens the game, boots the editor (`#save-ind` appears, chrome up),
  and the window title becomes `Atlas Quest — RPGAtlas`.
- **Gates:** Playwright **73/73** (the 70 existing **unmodified** + 3 new) · vitest **941** ·
  node **19** · eslint **0** · typecheck **clean**. Browser build behavior unchanged; frozen
  map 1 untouched. Git ritual: branch `harbor-2a` → gates green → commit → merge to `main` →
  delete branch. **Next: H2·B** (New Project — live folder preview + parent-dir picker UX +
  the Blank/Starter/Atlas Quest template chooser).
