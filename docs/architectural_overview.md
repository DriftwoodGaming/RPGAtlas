# RPGAtlas Architecture Overview

## 1. Introduction and Goals

### 1.1 Purpose

This document describes the current software architecture of RPGAtlas to help new developers understand the system quickly and to create a shared baseline for future refactoring.

### 1.2 Scope

RPGAtlas is a browser-based RPG editor and runtime with:

- a web editor (`index.html`)
- a web player (`play.html`)
- a Tauri desktop wrapper (`src-tauri/`)
- a Windows local-server launcher and exported Windows game launcher (`tools/*.cs`)

The document covers runtime structure, subsystem boundaries, major data flows, and architectural risks visible in the current implementation.

### 1.3 Quality Goals

The main architectural goals are:

1. **Understandability**: Developers should be able to locate responsibilities and follow main flows without reading the full monolithic entry modules.
2. **Refactorability**: Subsystem seams should become explicit enough to split large modules safely.
3. **Behavioral stability**: Refactoring should preserve current browser, standalone export, and desktop-wrapper behavior.
4. **Portability**: The same game/editor logic should continue to work in browser-served, standalone-exported, and Tauri-hosted environments.

## 2. Architecture Constraints

The current architecture is shaped by these constraints:

- The application is primarily a static HTML/CSS/JavaScript app with minimal build tooling.
- Shared runtime services are still exposed as globals for compatibility (**RA**, **Assets**, **Renderer**, **Sfx**, etc.).
- Editor and player are separate entry points but share a large amount of runtime code.
- Project persistence in the browser relies on `localStorage`.
- Standalone export must embed the project and required assets into a single HTML file or Windows executable.
- Tauri is an additional host target, not a replacement for the browser-served app.
- Plugins and event script commands intentionally execute arbitrary JavaScript.

Relevant files:

- `index.html`
- `play.html`
- `js/editor.js`
- `js/engine.js`
- `js/data.js`
- `js/editor/project-io.js`
- `src-tauri/src/lib.rs`

## 3. System Context
### 3.1 Business Context

RPGAtlas serves two primary user workflows:

1. **Game creation**:A developer edits maps, events, database records, plugins, and assets in the editor.
2. **Game execution**: The resulting project is played either via local playtest, browser runtime, standalone HTML export, or Windows executable export.

### 3.2 Technical Context

External actors and systems:

- **Browser**: Hosts the editor and player UI, canvas rendering, storage, and file download behavior.
- **Local storage**: Stores autosaved editor project state and player save slots.
- **Tauri host**: Provides native dialogs and a dedicated playtest window.
- **Windows launcher**: Serves the web app locally over HTTP for non-Tauri usage.
- **Exported EXE launcher**: Loads appended standalone game payload.
- **Filesystem**: Used indirectly via Tauri or launcher/export packaging.
## 4. Solution Strategy

The current solution uses a pragmatic hybrid architecture:

- static HTML entry pages define application shells
- shared non-module JavaScript initializes core globals
- one module entry drives the editor (`js/editor.js`)
- one script entry drives the player/runtime (`js/engine.js`)
- data schema/defaults/migration live centrally in `js/data.js`
- host-specific behavior is abstracted only where necessary (`js/editor/host.js`)
- packaging and embedding are handled by lightweight scripts and wrappers

The strategy favors:

- zero/low build complexity
- broad runtime reuse
- compatibility with browser and desktop delivery modes

The tradeoff is weaker separation of concerns, especially in the two large entry modules.

## 5. Building Block View

### 5.1 Level 1

#### Editor Shell

Responsible for authoring UI, map/database/event editing, undo/redo, autosave, export, and playtest launch.

Main file:
- `js/editor.js`

#### Player Shell

Responsible for game boot, scenes, map runtime, events, battle, menus, save/load, and plugin execution.

Main file:
- `js/engine.js`

#### Domain and Schema Core

Provides project defaults, migration, schema helpers, type lists, IDs, traits, and sample project creation.

Main file:
- `js/data.js`

#### Asset System

Provides procedural asset generation, custom asset discovery/loading, and export of used assets.

Main file:
- `js/assets.js`

#### Rendering System

Provides rendering support, including HD-2D / PIXI-based renderer integration.

Main file:
- `js/renderer.js`

#### Message System

Provides text-code substitution, rich text processing, typewriter display, and message windows.

Main file:
- `js/runtime/messages.js`

#### Plugin System

Provides built-in plugin definitions and runtime plugin hook integration.

Main files:
- `js/plugins.js`
- parts of `js/engine.js
`
#### Desktop Host Adapter

Provides native save/open dialogs and a dedicated playtest window when running inside Tauri.

Main files:
- `js/editor/host.js`
- `src-tauri/src/lib.rs`

#### Packaging and Launchers

Provide web staging, desktop packaging, browser-serving launcher, and standalone EXE launcher behavior.

Main files:
- `scripts/stage-frontend.mjs`
- `scripts/package-exe.mjs`
- `tools/RPGAtlasEngine.cs`
- `tools/RPGAtlasLauncher.cs`

### 5.2 Level 2 Candidate Subsystems

Within the current monoliths, the following implicit subsystems are already visible and are good refactoring candidates:

In `js/editor.js`:
- Map editor
- Event editor
- Database editor
- Modal/UI framework
- Persistence/autosave integration
- Export/playtest actions
- Resource manager
- Character generator
- Audio manager
- Search tools
- HD-2D preview integration

In `js/engine.js`:

- Boot/title flow
- Scene management
- UI stack/input handling
- Message/dialog interaction
- Map runtime
- Event interpreter
- Battle system
- Save/load system
- Plugin runtime bridge
- Script API
- Quest/journal integration
- 
Already extracted and promising:
- `js/editor/project-io.js`
- `js/editor/host.js`
- `js/editor/i18n.js`
- `js/runtime/messages.js`
- `js/quests.js`
- `js/journal-view.js`

## 6. Runtime View

### 6.1 Editor Boot

1. index.html loads shared global scripts:
   - assets.js
   - renderer.js
   - runtime/messages.js
   - sfx.js
   - plugins.js
   - data.js

2. These are assembled into `window.RPGAtlasDeps`
3. `js/editor.js` starts
4. Editor loads project from `localStorage` via `loadStoredProject(...)`
5. Project is migrated through `RA.migrateProject(...)`
6. UI state is initialized and rendered

Files:
- index.html
- js/editor.js
- js/editor/project-io.js
- js/data.js

### 6.2 Editor Autosave

1. Any edit calls `touch()`
2. `touch()` schedules a debounced save
3. `saveNow()` writes the full project JSON to `localStorage`
4. Playtest later reads the same saved project

Files:
- js/editor.js
- js/editor/project-io.js

### 6.3 Playtest Flow

#### Browser Mode

1. Editor saves project
2. Editor opens `play.html`

#### Tauri Mode

1. Editor saves project
2. Editor calls `host.openPlaytest()`
3. Tauri reloads and shows the hidden playtest window
4. Player reads shared `localStorage`

Files:
- js/editor.js
- js/editor/host.js
- src-tauri/src/lib.rs

### 6.4 Player Boot

1. `play.html` loads shared scripts and `js/engine.js`
2. Runtime loads project from:
   - embedded standalone payload
   - browser/Tauri localStorage
   - default sample project
3. Runtime applies system settings
4. Assets are prepared
5. Plugins are executed
6. Title or map scene begins

Files:
- play.html
- js/engine.js
- js/data.js

### 6.5 Standalone Export

1. Editor collects required runtime source files
2. Editor serializes project JSON
3. Editor exports only used external assets
4. Editor embeds CSS, JS, project, and assets into one HTML file
5. Optional EXE export appends that HTML payload to `bin/RPGAtlasLauncher.exe`

Files:
- js/editor/project-io.js
- bin/RPGAtlasLauncher.exe
- tools/RPGAtlasLauncher.cs

### 6.6 Plugin Execution

1. Project contains ordered plugin definitions
2. Player boot creates plugin/runtime bridge objects
3. Enabled plugins are executed dynamically
4. Plugins register hooks for:
   - map load
   - render
   - message text
   - transitions
   - commands
5. Runtime invokes those hooks during gameplay

Files:
- js/plugins.js
- js/engine.js
- js/data.js

---

## 7. Deployment View

### 7.1 Browser-Served Editor/Player

Deployed as static files served over HTTP.

Entry points:
- index.html
- play.html

Typical hosts:
- RPGAtlas.exe local server
- `python -m http.server`
- any static web server

### 7.2 Tauri Desktop App

The static frontend is copied into `src-tauri/dist/` and embedded by Tauri.

Components:
- frontend files in `src-tauri/dist/`
- Rust host shell in `src-tauri/src/`

### 7.3 Standalone HTML Export

Single HTML file containing:
- game project JSON
- used assets
- runtime JS/CSS

### 7.4 Standalone Windows EXE Export

Windows launcher executable plus appended HTML payload.

---

## 8. Cross-Cutting Concepts

### 8.1 Project as Central Document

The dominant architectural concept is the project JSON document. Most systems read or mutate the same in-memory project object.

Defined centrally in:
- js/data.js

### 8.2 Compatibility Through Globals

Shared services are exposed globally and then re-collected into `window.RPGAtlasDeps`.

This preserves compatibility but weakens explicit module boundaries.

Seen in:
- index.html
- play.html

### 8.3 Host Abstraction

Only a small slice of host-specific behavior is abstracted:

- native file open/save
- native playtest window

File:
- js/editor/host.js

### 8.4 Dynamic Extensibility

Plugins and script commands are first-class extension points, implemented through dynamic JavaScript execution.

Files:
- js/plugins.js
- js/engine.js

### 8.5 Progressive Extraction

Some responsibilities have already been split from the monoliths into focused modules.

Examples:
- js/runtime/messages.js
- js/editor/project-io.js
- js/quests.js

---

## 9. Architectural Decisions

### 9.1 Use Static Web Assets as the Primary Product

This keeps the application simple and portable.

### 9.2 Keep Editor and Player as Separate Entry Points

This limits runtime coupling at the page level, even though code sharing remains high.

### 9.3 Store Projects and Saves in localStorage by Default

This reduces setup friction but creates implicit host/origin coupling.

### 9.4 Use Lightweight Wrappers Rather Than a Heavy Platform Layer

Tauri and Windows launchers add only the minimum native integration needed.

### 9.5 Allow Unrestricted Plugin/Script Execution

This maximizes flexibility for game authors but reduces safety and testability.

---

## 10. Quality Requirements and Risks

### 10.1 Strengths

- Very low operational complexity
- Multiple delivery modes with high code reuse
- Centralized project schema and migration logic
- Clear user-facing product model: editor, player, export

### 10.2 Risks

#### Monolithic Entry Modules

`js/editor.js` and `js/engine.js` combine UI, state, domain logic, persistence, and integration concerns.

#### Implicit Boundaries

Subsystems are often conceptual rather than enforced by modules.

#### Global Dependency Assembly

Globals improve compatibility but make dependency tracking less explicit.

#### Storage-Coupled Playtest

Playtest depends on localStorage sharing across windows and host contexts.

#### Packaging Drift

Standalone export and Tauri staging each define their own file inclusion logic.

#### Dynamic Code Execution

Plugins and event script commands are powerful but hard to validate, isolate, or reason about.

---

## 11. Technical Debt and Refactoring Priorities

### 11.1 Recommended Near-Term Refactoring Seams

#### 11.1.1 Split js/editor.js by Feature Area

Start with:
- persistence/playtest actions
- map editor
- database editor
- modal framework

#### 11.1.2 Split js/engine.js by Runtime Concern

Start with:
- save/load repository
- plugin runtime
- event interpreter
- battle system
- scene management

#### 11.1.3 Define Explicit Service Interfaces Around Stable Concepts

Examples:
- ProjectRepository
- SaveGameRepository
- PluginRuntime
- RendererAdapter
- MessageService

#### 11.1.4 Unify Host and Browser Open/Save Behavior Behind One Editor-Facing Repository

The current native open path exists but is only partially integrated.

#### 11.1.5 Reduce Duplication in Packaging Inputs

Centralize the list of frontend runtime files used by both Tauri staging and standalone export.

### 11.2 Suggested Target Architecture Direction

A realistic target is not a rewrite, but a gradual move toward:

- thin page entry points
- explicit application services
- small feature modules
- host adapters at the edges
- a stable project/domain core in the middle

---

## 12. Glossary

### 12.1 Terms

**Project**
- The full RPGAtlas game definition stored as one JSON document.

**Editor Shell**
- The authoring application started by `index.html`.

**Player Shell**
- The runtime application started by `play.html`.

**Host Adapter**
- Environment-specific bridge such as Tauri file dialogs.

**Standalone Export**
- Self-contained playable HTML or Windows EXE.

**Plugin Runtime**
- System that executes project-embedded plugin code.

**HD-2D**
- The enhanced renderer mode used for elevated/3D-like map presentation.

### 12.2 File References

#### Core Entry Points

- index.html
- play.html

#### Core Modules

- js/editor.js
- js/engine.js
- js/data.js
- js/assets.js
- js/renderer.js
- js/runtime/messages.js
- js/plugins.js
- js/quests.js
- js/journal-view.js

#### Infrastructure

- js/editor/project-io.js
- js/editor/host.js
- src-tauri/src/lib.rs
- scripts/stage-frontend.mjs
- scripts/package-exe.mjs
- tools/RPGAtlasEngine.cs
- tools/RPGAtlasLauncher.cs