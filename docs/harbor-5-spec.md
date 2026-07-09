# Harbor H5 — Launch from the project folder (spec)

**Phase:** H5 of Project Harbor (`docs/PROJECT_FOLDERS_ROADMAP.md`)
**Author:** Claude Opus 4.8 (High), 2026-07-09
**Builds on:** the signed on-disk contract + native plumbing (`docs/harbor-1-spec.md`,
tagged `harbor-1`), the desktop Project Manager launcher (`docs/harbor-2-spec.md`,
`harbor-2`), project-scoped saving (`docs/harbor-3-spec.md`, `harbor-3`), and per-project
assets (`docs/harbor-4-spec.md`, `harbor-4`). H5 is the "double-click your game to open
it" phase: the desktop exe learns to boot straight into a project when it is handed one —
from the command line, from a second launch while it is already running, or from a
`.rpgatlas` file the operating system opens with it.

**Non-negotiables carried from H1–H4 / the roadmap:**
- **No new webview windows (trap 2).** A second launch **focuses the existing `main`
  window** and asks the running frontend to open the requested project. We never build a
  window from a command / plugin callback; the play-test window pattern is untouched.
- **The e2e boot gate (trap 1).** `#save-ind` is still revealed **last** by `boot()`. A
  command-line / double-click launch that opens straight into a game boots through the
  exact same `bootChosen` pipeline the Project Manager uses, so the gate is unchanged; a
  bad path falls back to the manager (which never reveals `#save-ind`).
- **Desktop-first, browser-safe (trap 4).** All H5 behavior is gated on `managerActive()`
  (desktop `isTauri` **or** the H2·D `?fakehost` hook). The **pure browser build is
  byte-identical**: it never asks for a launch path, never installs the single-instance
  listener, and the existing 70 Playwright specs pass **unmodified**. Desktop flows are
  e2e-covered through the `?fakehost` host, additively.
- **vitest is env=node (trap 3).** No new pure TS core is needed this phase (the launch
  path is a single opaque string threaded from Rust to the manager); the argv → path
  parse is pure Rust, cargo-tested.
- **Path safety (trap 9).** The argv path is never trusted as-is: it is handed to the
  existing `project_open` (H1), which canonicalizes-and-contains and returns the tagged
  error taxonomy. A bad path surfaces as the same kid-friendly "we can't find that game"
  copy the manager already uses.
- **The exe embeds the frontend (trap 6).** H5 changes both Rust (argv capture,
  single-instance, file-association config) and frontend (launch-path wiring, external-open
  listener). The desktop exe is **rebuilt at H6** (the release phase), as in H4 — the whole
  phase is drivable in the browser through `?fakehost`, so every flow is e2e-covered
  without the desktop app.

**Rust:** H5 adds a small `src-tauri/src/launch.rs` (initial-argv capture + the
`take_launch_path` command + the argv→path parse, cargo-tested), registers
`tauri-plugin-single-instance` (**first**, per the plugin's requirement), and adds the
`.rpgatlas` `fileAssociations` bundle config. The single-instance callback and the initial
argv both flow to the frontend through one seam: a launch path the manager consumes on
first load (pull), and an `atlas://open-project` event the running app listens for (push).

---

## 0. What H5 delivers (and does not)

**Delivers (per stage):**
- **H5·A — CLI / argv.** `RPGAtlas.exe <path>` (a project folder **or** a
  `…/game.rpgatlas` file) boots straight into that project, skipping the manager. An
  unreadable / not-a-project path falls back to the manager with a friendly note.
- **H5·B — Single instance.** `tauri-plugin-single-instance`: a second launch (e.g. the
  child double-clicks another game while the app is open) **focuses** the running window
  and asks it to open the requested project, flushing the current game to its folder first
  (the unsaved-work guard). No orphan windows, no second process.
- **H5·C — File association.** `.rpgatlas` is registered with the app via the bundler
  config (installer path), so a double-click opens RPGAtlas on that game (the H5·A flow).
  Docs cover the portable-exe "Open with…" path on Windows, where there is no installer to
  register the association.

**Does NOT (out of scope, by design):**
- **No installer rebuild / signing this phase.** The `fileAssociations` config is added and
  documented; producing a signed installer that actually registers the association is a
  release/packaging concern (H6 rebuilds the exe; a full installer is a separate future
  effort). The portable exe ships today, so the docs cover "Open with…".
- **No filesystem watcher, no protocol handler (`rpgatlas://` URLs), no multi-window**
  editing. One running instance, one `main` window, focus-and-open on a second launch.

---

## 1. H5·A — CLI / argv: boot straight into a project

### 1.1 The seam

The desktop process may be started with a project path as its first non-flag argument
(the shipped exe with a `.rpgatlas` association, or `RPGAtlas.exe C:\Games\MyGame` from a
shell). That path has to reach the frontend's boot decision (`boot.ts` `start()` →
`launchManager()`), which already knows how to open a game and boot the editor on it.

Rather than invent a new boot entry, H5·A threads the path through the **same
`launchManager()` the Project Manager uses**, as one more source of "a game to open,
straight in":

1. **Capture (Rust).** In `run()`, before building the app, read `std::env::args()` +
   `std::env::current_dir()`, parse out the first non-flag path, and stash it in a managed
   `LaunchState { pending: Mutex<Option<String>> }`.
2. **Pull (frontend).** `launchManager()` asks the host for a launch path
   (`host.takeLaunchPath()`), **once**, after the in-session pending-open check (H2·C/H3·B
   reboots) and before falling back to showing the launcher. On a fresh cold launch the
   in-session pending is empty, so the launch path is what decides the boot.
3. **Open or fall back.** A launch path is opened through the existing
   `host.open(path)` → `bootChosen(...)` pipeline (recents touch, window title, autosave
   bind, `#save-ind` revealed last). A thrown host error (bad path, not a project, vanished
   folder) → show the manager and set the toast to the same kid-friendly copy the Browse
   flow uses.

`take_launch_path` **takes** (read-and-clears) the value, so a later `location.reload()`
(a File ▸ Open reboot, an external-change reload) does not re-trigger the CLI open — those
reboots are the in-session `pendingOpen` path, which is checked first anyway.

### 1.2 Rust

`src-tauri/src/launch.rs`:
- `project_arg_from_args(args: &[String], cwd: &Path) -> Option<String>` — pure: skip
  `args[0]` (the exe), skip empty / `-`-prefixed flags, take the first remaining arg;
  resolve a relative path against `cwd`; return the absolute string. Not existence-checked
  here — validation is `project_open`'s job (§1.1 step 3), so a bad path yields the
  friendly taxonomy, not a silent drop. Cargo-tested (absolute preserved, relative joined,
  flags skipped, none when only the exe).
- `LaunchState` (managed) + `#[tauri::command] take_launch_path(state) -> Option<String>`
  (returns-and-clears; a poisoned lock degrades to `None`).

`lib.rs run()` captures the initial argv into `LaunchState` and registers the command. No
new capability (a plain command, like the `library_*` / `project_*` commands).

### 1.3 Frontend

- `src/platform/tauri/project-host.ts` — `takeLaunchPath(): Promise<string | null>` over
  `take_launch_path`.
- `src/editor/project-manager/manager-host.ts` — optional `takeLaunchPath?()` on
  `ManagerHost`; the real host delegates to the façade.
- `src/editor/project-manager/test-host.ts` — the fake host reads-and-clears a seeded
  `atlas.fakehost.launch` localStorage key (mirrors the real read-and-clear); a
  `setLaunchPath(path)` control + `reset()` cleanup make it e2e-drivable.
- `src/editor/project-manager/manager.ts` — `launchManager()` gains the launch-path branch
  (open straight in, or manager + friendly toast on failure).

### 1.4 e2e (browser, `?fakehost`)

Additive specs in `tests-e2e/project-launch.spec.mjs`:
- seed a game doc + `atlas.fakehost.launch = <root>` → navigate `?fakehost` → the editor
  boots straight into it (no launcher, title tracks the game, `#save-ind` visible).
- seed `atlas.fakehost.launch = <missing path>` (no doc) → the launcher shows with the
  friendly "can't find this game" toast, `#save-ind` hidden.

---

## Stage log

### H5·A — CLI / argv — 2026-07-09

**Shipped:** the desktop exe boots straight into a project when launched with one.

- **Rust `src-tauri/src/launch.rs` (new):** `project_arg_from_args(args, cwd)` — pure,
  cargo-tested: skips `args[0]` + empty/`-`-prefixed flags, takes the first remaining arg,
  resolves a relative path against `cwd`, returns the absolute string (no existence check —
  `project_open` classifies it). `LaunchState { pending: Mutex<Option<String>> }` (managed)
  + `#[tauri::command] take_launch_path` (returns-and-clears; poisoned lock → `None`).
  `initial_launch_path()` reads the real `std::env::args()` + `current_dir()`.
  `OPEN_PROJECT_EVENT = "atlas://open-project"` declared here for H5·B. **No new
  capability** (a plain command, like `library_*` / `project_*`).
- **`lib.rs`:** `mod launch;`; `run()` captures `launch::initial_launch_path()` into a
  `.manage(LaunchState::new(...))` before building; registered `launch::take_launch_path`
  in the invoke handler.
- **Frontend:** `project-host.ts` `takeLaunchPath()` over `take_launch_path`;
  `manager-host.ts` optional `takeLaunchPath?()` + real host delegate; `test-host.ts`
  read-and-clears `atlas.fakehost.launch` (mirrors the native command) + `setLaunchPath`
  control + reset cleanup. **`manager.ts` `launchManager()`** gained the launch-path branch:
  after the in-session `pendingOpen` check (priority 1) and before the launcher fallback, it
  `takeLaunchPath()` (priority 2), opens straight in via the existing `bootChosen` pipeline,
  or on a thrown host error shows the launcher + `setToast(errText(e))` (the same
  kid-friendly copy the Browse flow uses). A reload only ever hits `pendingOpen` (the launch
  path is already cleared), so a File ▸ Open reboot never re-triggers the CLI open.
- **e2e (`tests-e2e/project-launch.spec.mjs`, new, additive):** launch path → boots straight
  in (no launcher, title tracks the game, `#save-ind` visible), consumed once (a plain
  relaunch shows the launcher with the game in recents); a missing path → launcher + "can't
  find this game" toast; a folder with no `game.rpgatlas` → "isn't an RPGAtlas game" toast;
  no launch path → launcher as usual. `#save-ind` stays hidden in every non-boot case (the
  gate holds, trap 1).
- **Gates:** vitest **968** · node **19** · cargo **23** (19 + 4 launch) · Playwright
  **100/100** (97 prior + 3 launch) · eslint **0** · typecheck **clean**. No user-visible
  copy needs a patch note yet (phase-exit bundles the H5 note). `patch-notes.js?v=64`,
  `editor.css?v=61`, `data.js?v=31`, FORMAT_VERSION 2, version 1.1.0 — all unchanged.
- Git ritual: branch `harbor-5a` → gates green → commit → merge to `main` → delete branch.
  **Next: H5·B (single instance).**

### H5·B — Single instance — 2026-07-09

**Shipped:** one running instance; a second launch focuses the app and opens the requested
game, guarding the current one.

- **Rust:** added `tauri-plugin-single-instance = "2"` (Cargo.toml). `lib.rs` registers it
  **first** (per the plugin's requirement) so it intercepts a second launch before anything
  else initializes; its callback runs in the already-running process and calls
  `launch::focus_and_request_open(app, &argv, &cwd)`. That helper (launch.rs) **focuses the
  predefined `main` window** (`get_webview_window("main")` → unminimize/show/set_focus — we
  NEVER build a window from a callback, trap 2) and, if the second launch carried a project
  path (`project_arg_from_args`, reused from H5·A), emits `atlas://open-project` with it. All
  window ops are best-effort (a focus hiccup never crashes the running editor). No new
  capability (the callback is Rust-side; the frontend `listen` is covered by `core:default`).
- **Frontend:**
  - `manager-host.ts` — optional `onOpenProjectRequest?(cb)` on `ManagerHost`; the real host
    subscribes via the withGlobalTauri event API (`__TAURI__.event.listen("atlas://open-
    project")`), a missing API degrading to no-op.
  - `test-host.ts` — stores the callback (`onOpenProjectRequest`) + an `emitOpenProject(path)`
    control that invokes it (stands in for the native single-instance callback).
  - `manager.ts` — `installExternalOpen(host)` wires the listener **once per page load**
    (`externalOpenInstalled` guard) at the top of `launchManager`, so it is live whether we
    end on the launcher or the editor. `requestOpenProject(target, host)`: opens the game;
    if the editor is booted, **flushes the current game's unsaved edits to its folder first**
    (the unsaved-work guard) then reboots cleanly via `bootChosen` (booted→`setPendingOpen`+
    reload); on the launcher it boots in place; a bad path leaves an open game untouched and,
    only when we're on the launcher, shows the friendly Browse-flow note.
  - `persistence.ts` — `flushFolderNow(): Promise<void>` resolves once the folder-write queue
    drains (a `folderIdleWaiters` list woken in `saveToFolder`'s `finally`); a no-op resolve
    on the browser build or when nothing is dirty (the unchanged-content fast path leaves the
    queue idle). This is the awaitable flush the guard needs — `desktopFlush` is fire-and-
    forget, which would let a reload race the write and drop the current game's last edits.
- **e2e (`tests-e2e/project-launch.spec.mjs`, additive):** a second launch while Game A is
  **dirty** switches into Game B *and* leaves A's paint flushed into A's folder (guard); a
  second launch while on the launcher boots straight in; a bad second-launch path leaves the
  open game untouched (no overlay, title/gate hold). The **focus** half is Rust-side (window
  focus isn't observable through the browser fake host); the open/guard half is fully covered.
- **Gates:** vitest **968** · node **19** · cargo **23** · Playwright **103/103** (100 prior
  + 3 single-instance) · eslint **0** · typecheck **clean**. `patch-notes.js?v=64`,
  `editor.css?v=61`, `data.js?v=31`, FORMAT_VERSION 2, version 1.1.0 — unchanged (phase exit
  bundles the note).
- Git ritual: branch `harbor-5b` → gates green → commit → merge to `main` → delete branch.
  **Next: H5·C (file association).**

### H5·C — File association — 2026-07-09

**Shipped:** the `.rpgatlas` extension is registered with the desktop app via the bundler
config, and the docs cover the portable-exe "Open with…" path.

- **`src-tauri/tauri.conf.json`:** added `bundle.fileAssociations` for `ext: ["rpgatlas"]`
  (`name: "RPGAtlas Game"`, `description: "RPGAtlas game project"`, `role: "Editor"`).
  Tauri's installer path (NSIS/WiX) registers the extension and points its DefaultIcon at the
  app exe (the bundle `icon` = `icons/icon.ico`), so a registered `.rpgatlas` shows the app
  icon and double-click launches `RPGAtlas-Desktop.exe <that file>` → the H5·A flow. Validated
  by `cargo build` (the config is parsed by `generate_context!`). Tauri v2's
  `FileAssociation` has no per-association `icon` field, so the association reuses the app
  icon by design (adding one would fail schema validation).
- **Docs (`README.md`):** new "Opening a game by double-clicking it (desktop app)" section —
  explains `game.rpgatlas` is the game's project file, that the desktop app opens a handed-in
  folder or `game.rpgatlas` straight in (double-click, `RPGAtlas-Desktop.exe "C:\Games\My
  Game"`, or the front-and-switch second-launch behavior), and the **portable-exe Windows
  "Open with… ▸ Always use this app"** steps for when there is no installer to register the
  association. Clarifies that only the desktop app opens `.rpgatlas` (the browser launcher
  `RPGAtlas.exe` just serves the editor). Deliberately compact — H6·B does the full
  project-folders docs pass (wiki pages + docs-site rebuild) and can fold this in.
- **Out of scope (per §0):** no installer is built or signed this phase; the portable exe
  ships today, hence the "Open with…" docs. No `rpgatlas://` protocol handler.
- **Gates:** tsc **clean** · eslint **0** · cargo **23** · vitest **968** · node **19** ·
  Playwright **unchanged 103/103** (H5·C touches only `README.md` + `tauri.conf.json`, which
  Vite never reads — the built `dist/` the e2e suite previews is byte-identical to H5·B; the
  full suite is re-run authoritatively at the phase-exit gate). `patch-notes.js?v=64`,
  `editor.css?v=61`, `data.js?v=31`, FORMAT_VERSION 2, version 1.1.0 — unchanged.
- Git ritual: branch `harbor-5c` → gates green → commit → merge to `main` → delete branch.
  **Next: phase exit** (patch-notes entry + `help.ts`/`shims.d.ts` cache-buster bump, tag
  `harbor-5`).

### H5 — phase exit — 2026-07-09

- **Patch note added** (`js/patch-notes.js`, prepended): "Open your game by double-clicking
  it" (kid-friendly; names the game.rpgatlas double-click / folder-drop straight-in open, the
  single-instance front-and-switch that saves your current game first, the Windows
  "Open with… ▸ Always use this app" one-time setup, and the friendly "we can't find that
  game" fallback; notes the web version is unchanged). Cache-buster bumped
  `patch-notes.js?v=64 → 65` in **both** `src/editor/help.ts` and `src/editor/shims.d.ts`
  (AGENTS.md / trap 8). **No `editor.css` change this phase** (H5 added no styles — the
  manager overlay/toast are H2's), so `editor.css?v=61` and `data.js?v=31` are unchanged.
  Product **version stays 1.1.0** (bumps to 1.2.0 at H6); **FORMAT_VERSION stays 2**.
- **Final gate sweep:** vitest **968** · node **19** · cargo **23** (19 + 4 launch) ·
  Playwright **103/103** (70 original browser specs **unmodified** + 21 manager (H2/H3) + 6
  project-assets (H4) + 6 launch (H5)) · eslint **0** · typecheck **clean** ·
  `patch-notes.js?v=65` · `editor.css?v=61` · `data.js?v=31`.
- **Exit criterion (double-click opens the game), by construction:** the Tauri
  `fileAssociations` config registers `.rpgatlas` → a double-click launches
  `RPGAtlas-Desktop.exe <that game.rpgatlas>`; the initial-argv capture (H5·A) + the
  single-instance callback (H5·B) both funnel that path through the same `bootChosen`
  pipeline the Project Manager uses — a fresh launch boots straight in, an already-running
  instance focuses `main` and switches (saving the current game first). The whole flow is
  browser-e2e-covered through the `?fakehost` `takeLaunchPath` / `emitOpenProject` seams
  (the Rust-side window focus is unobservable there but is the plugin's own contract). No new
  webview windows (trap 2), `#save-ind` still revealed last (trap 1), the 70 browser specs
  unmodified (trap 4). The desktop half ships at H6's exe rebuild (trap 6) — **H5 ships no
  exe**.
- Git ritual: branch `harbor-5exit` → gates green → commit → merge to `main` → delete
  branch. **Phase exit: tag `harbor-5`.** H5 delivers launch-from-the-project-folder: the
  desktop exe boots straight into a game handed to it (argv / double-click), one running
  instance handles a second launch by focusing + switching (guarding unsaved work), and
  `.rpgatlas` is registered with the app (with portable-exe "Open with…" docs) — all behind
  `managerActive()` so the browser build is byte-identical. **H6 (migration, docs & release
  1.2.0) is cleared.**
