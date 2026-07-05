# Project Compass — Phase M2 spec: Engine parity I (interpreter, messages, actors)

**Phase:** M2 · **Model:** Opus 4.8 (Extra High) · **Tags:** `mig-2` at phase exit (M2·C)
**Roadmap:** `docs/MZ_MV_MIGRATION_ROADMAP.md` (phase M2) · **Contract:** `docs/mz-mv-parity-matrix.md`

Every step in this phase ships real engine features **and** flips the matching
`translate-commands.ts` rows from `mzTodo` to real translations in the same step,
so a re-import of an MZ/MV project picks up the new features automatically. Schema
additions are **optional-only** — FORMAT_VERSION stays 2, and 1.0 projects are
untouched (no new required fields anywhere).

---

## M2·A — Presentation: pictures, tint, timer, scroll, balloons, scrolling text

**Scope (matrix §16 "M2·A — presentation"):** the on-screen presentation command
family that was absent from the interpreter — RM codes **231–235** (pictures),
**223** (Tint Screen), **221/222** (Fadeout/Fadein Screen), **124** (Control Timer),
**204** (Scroll Map), **213** (Show Balloon Icon), **105/405** (Show Scrolling Text).
Each becomes a real Atlas command (schema + interpreter handler + editor form + engine
render), wired into save/load where it is persistent state, and its
`translate-commands.ts` row flips from `mzTodo` to a real translation.

### New commands (all additive to `AnyCommand`)

| `t` | RM code(s) | Purpose |
|---|---|---|
| `showPic` | 231 | Show a picture in a numbered slot (1–100) at a screen position |
| `movePic` | 232 | Tween a picture's position/scale/opacity/blend over N frames |
| `rotatePic` | 233 | Spin a picture continuously (degrees/tick) |
| `tintPic` | 234 | Tween a picture's colour tone over N frames |
| `erasePic` | 235 | Remove a picture slot |
| `tint` | 223, 221, 222 | Tween the whole-screen colour tone (fade-out = tone→black, fade-in = tone→normal) |
| `timer` | 124 | Start/stop a count-down timer (HUD + optional expiry common event) |
| `scrollMap` | 204 | Scroll the map camera a distance in a direction at a speed |
| `balloon` | 213 | Pop a speech-balloon glyph over the player / this event / an event |
| `scrollText` | 105/405 | Full-screen scrolling text (credits-style) |

### Engine architecture (the house pattern)

- **`src/engine/scenes/presentation-runtime.ts`** (new) owns all M2·A screen state as
  module-level singletons — pictures map, screen tone + tween, count-down timer, camera
  scroll offset + tween — and the pure operations on them. It mirrors the codebase's
  existing "mutable-scalar advanced in `update()`" pattern (shake/flash timers on
  `ctx`): tweens store a target + `framesLeft`, and `updatePresentation()` (called once
  per tick from the map scene `update()`) advances them deterministically. No DOM, no
  render imports → no cycles.
- **Interpreter handlers** live in `commands/presentation.ts` (the presentation house
  file). Each thin handler sets state via presentation-runtime, then — for `wait`
  variants — polls `while (stillAnimating()) await services.frameWait();`, exactly like
  the existing `shake`/`flash` handlers.
- **Rendering:** `render-glue.ts` calls `drawPresentation(g2d, camX, camY, TILE,
  reduceMotion)` after the map composite. Pictures → screen tint → (existing screen
  flash) → balloons → timer HUD are drawn onto `ctx.g2d`, so they show on the `#gamecanvas`
  overlay in **both** the HD-2D (WebGL) and Canvas-2D paths — the same seam the screen
  flash already uses. The camera offset from `scrollOffsetPx()` is added to `camX/camY`
  before clamping to the map edges.
- **Timer tick:** `update()` calls `tickTimer()`; when the timer reaches 0 the map scene
  fires the (optional) expiry common event through a fresh `Interp` (fire-and-forget,
  like a parallel common event).
- **Save/load:** pictures, screen tone, and the timer round-trip through
  `serializePresentation()` / `restorePresentation()` (called from `save.ts`). Picture
  images are re-loaded from their stored key on load. Scroll offset and balloons are
  transient (reset on map load / not saved), matching RM.
- **Reset:** `resetPresentation()` runs from `newGame()` (title.ts) and `loadMap` clears
  the transient scroll offset.

### Picture image sourcing (scoped decision)

M1's asset pipeline imports four image types (characters/facesets/enemies/tilesets); it
does **not** import `img/pictures/`, and adding a whole new asset *type* (library +
editor browser + export walk) is out of M2·A's "commands + interpreter + editor forms +
engine render" scope. So for M2·A:

- The picture `name` field is resolved by `resolvePictureSrc(name)`: an `asset:*` key
  resolves through the shared asset library / embedded assets (`assetUrlSync`); any other
  string is used as a direct image URL / data-URL. Missing/failed images render nothing
  (RM behaviour) — never a crash.
- The importer flips 231–235 to real commands and preserves the RM picture name as an
  `asset:pictures/<slug>` key, plus **one honest, kid-friendly report line**: pictures now
  play, but their image files need adding to the Assets library (a dedicated pictures asset
  browser is a natural M4/M6 follow-up). This keeps locked-decision 6 (nothing silently
  wrong): the *behaviour* converts even though the *art* may need re-adding.

### Screen tone application

`tint`/`tintPic` tone is `[r, g, b, gray]` (r/g/b −255..255, gray 0..255) tweened per
tick. Rendering approximates RM's tone with two composite passes on `g2d`: a `multiply`
pass `rgb(255+min(0,r), …)` (darkening) and a `lighter` pass `rgb(max(0,r), …)`
(brightening); `gray` is stored/round-tripped and applied as a light desaturating grey
overlay. Fade-out/fade-in (221/222) reuse the `tint` machinery (tone→black / tone→normal
over a fixed 24-frame default), so a fade persists across the rest of the event and into a
save, unlike the transient DOM transfer fader.

### Tests

- **vitest** `mz-translate-commands.test.ts`: the SPEC rows for 105/124/204/213/221/222/223/
  231–235 flip from `{ todo }` to `{ first: <atlas t> }`; a new 124 row is added; the D3
  `mzTodo`-shape tests re-point at codes that stay `mzTodo` (103/104); the fixture
  round-trip Sign-event expectation flips to `["showPic","wait","erasePic"]`; report keeps a
  no-silent-drop line for the picture art.
- **vitest** `presentation-runtime.test.ts` (new): pure-state behaviour — show/move/erase a
  picture, tint tween end-state, timer count-down + expiry id, scroll offset tween — with no
  DOM.
- **node --test** `interpreter.test.js`: the new handlers are registered and one
  (`showPic`) drives presentation-runtime end to end.
- **Playwright** `presentation.spec.mjs` (new): a pixel e2e — a data-URL picture shown by an
  autorun common event paints the expected colour onto `#gamecanvas` over the live map
  scene, and `erasePic` clears it. Map 1 (Driftwood Shore goldens) is never touched — the
  project is transformed in-memory to add the common event.

### Stage log

- **2026-07-05 — M2·A started.** Read roadmap phase M2 + M2·A, matrix §8.6/§8.8/§16 rows,
  and the interpreter house pattern (`src/engine/interpreter/`, `commands/presentation.ts`,
  render-glue, save/load, translate-commands spine). Wrote this spec. Design locked:
  presentation-runtime module + `drawPresentation` on the `g2d` overlay (works in HD + 2D),
  tone via multiply+lighter passes, fade = tint machinery, pictures reference an asset
  key/URL with an honest "add the art" report line. Implementation next.

- **2026-07-05 — M2·A complete (branch `mig-2a`).** Shipped all ten presentation commands:
  - Schema: 10 additive `Cmd*` interfaces (`showPic`/`movePic`/`rotatePic`/`tintPic`/
    `erasePic`/`tint`/`timer`/`scrollMap`/`balloon`/`scrollText`) added to `AnyCommand`
    (43 built-ins + `mzTodo`); no required fields, FORMAT_VERSION stays 2.
  - Engine: new `src/engine/scenes/presentation-runtime.ts` owns pictures/tint/timer/scroll
    state + `updatePresentation()`/`tickTimer()`/`drawPresentation()`/`serialize`/`restore`/
    `reset`. Interpreter handlers in `commands/presentation.ts` (wait via `frameWait`, like
    shake/flash). Rendered on `ctx.g2d` after the map composite; scroll offset added to the
    follow-camera before edge-clamp. `map.ts` advances the tweens + timer (paused in menus),
    fires the timer-expiry common event. Save/load round-trips pictures/tint/timer;
    `newGame` resets; map transfer clears the scroll. Scrolling-text overlay + CSS in
    `play.css`.
  - Editor: 10 `CMD_DEFS` forms + `cmdSummary` cases; a shared `[r,g,b,gray]` tone editor
    with presets; balloon/blend/origin option lists.
  - Flip: `translate-commands.ts` codes 105/124/204/213/221/222/223/231–235 now translate to
    real commands (fade-out/in = tone→black/normal; pictures keep their name as an
    `asset:pictures/<slug>` key + one honest "add the art" partial report line;
    variable-positioned pictures report + fall back to 0,0). Codes 103/104 stay `mzTodo`
    (M2·B).
  - Tests: `mz-translate-commands.test.ts` SPEC rows flipped + a 124 row + field-fidelity
    block (151 tests); new `tests/presentation-runtime.test.js` (state math via esbuild+vm);
    `interpreter.test.js` + `common-events.test.js` window stubs updated (deps now in the
    bundle) + new-handler registration; new `tests-e2e/presentation.spec.mjs` pixel proof
    (SVG data-URL picture paints magenta on `#gamecanvas`; erase clears it). **All green:**
    typecheck, 17 node tests, 666 vitest, 68 Playwright (map 1 untouched, 0 regressions).
  - Patch notes added; `patch-notes.js?v=45→46` bumped in `help.ts` + `shims.d.ts`.
  - Scope note: picture *art* import (a dedicated "pictures" asset type) is deliberately
    deferred (out of M2·A's commands/interpreter/render scope) — behaviour converts now, art
    is a documented re-add. Pictures/tint/balloons/timer are map-scene only (not battle).

---

## M2·B — Message system parity

**Scope (matrix §13 + §8.1/§8.10 + §16 "M2·B — messages"):** escape-code parity for the
full MZ/MV set, message window background/position options, and the three player-input
scenes — Input Number (103), Select Item (104), Name Input (303). Each new command is
additive to `AnyCommand`; the escape codes and window options add optional fields only
(FORMAT_VERSION stays 2). The matching `translate-commands.ts` rows flip from `mzTodo` to
real translations in the same step.

### Escape-code renderer (js/runtime/messages.js)

The message runtime already handled `\v \n \g` (substitution) with `\i \c` + BBCode coming
from the Atlas_TextCodes plugin and `\input[..]` from the engine input module. M2·B fills
in the rest so imported messages render instead of showing raw codes:

- **Substitution:** `\p[n]` (nth party member's name) joins `\v \n \g`. `\\` renders one
  literal backslash (guarded by a sentinel so no later pass consumes it).
- **`applyMsgControls`** (a new post-esc, pre-plugin pass in the message closure so it can
  read live gold): `\{`/`\}` → a running relative-size stack emitted as `[size=n]` tags the
  bbcode pass renders; `\$` → an inline gold badge with the current amount; `\fs[n]` →
  `[size=n]`; `\px[n]`/`\py[n]` → stripped (position isn't modeled in Atlas's flow layout);
  the pacing codes `\. \| \! \> \< \^` → zero-width `.msg-ctl` marker spans carrying their
  behaviour in `data-*` (esc turns `\>`/`\<` into `\&gt;`/`\&lt;`, matched in that form).
- **Palette map:** `Atlas_TextCodes` `CONFIG.palette` extended from 10 to 32 entries so
  MZ-range `\C[n]` codes resolve to a colour instead of falling back to white (indices 0–9
  keep Atlas's own colours; additive — existing projects' stored plugin code is untouched).
- **Control-aware typewriter:** `makeTypewriter` records the `.msg-ctl` markers with the
  reveal-unit index they sit at; `showMessage`'s reveal driver honours them — `\.`/`\|`
  pause N frames, `\!` waits for a button, `\>`/`\<` toggle instant reveal, `\^` closes
  without waiting. Messages with no codes reduce to the exact previous behaviour.
- **Window options:** `showMessage(name, text, face, opts)` gained an `opts` arg
  (`background` 0 window / 1 dim / 2 transparent, `position` 0 top / 1 middle / 2 bottom),
  applied as `.msg-dim`/`.msg-transparent`/`.msg-top`/`.msg-mid` classes. The `text`
  command forwards `c.background`/`c.position`.
- **Name box:** verified — the importer already lands the MZ speaker name (101 param[4]) on
  `CmdText.name`, and `showMessage` renders it in `.msg-name`; no change needed.

### Input scenes (src/engine/scenes/input-scenes.ts)

New module, three UI-stack scenes driven entirely through named-action `onKey` (keyboard +
gamepad), wired into `EngineServices` (`numberInput`/`selectItem`/`nameInput`) and dispatched
by new `flow.ts` handlers `inputNumber`/`selectItem`/`nameInput`:

- **Input Number** — a fixed-width column of digits; ▲▼ change the selected digit, ◄► move
  columns, OK confirms; the value is stored in the command's variable.
- **Select Item** — reuses `showList` over the party's owned regular items (icons + counts);
  stores the chosen item id (0 on cancel / no items).
- **Name Input** — an on-screen keyboard (upper/lower/digits/space + Back + OK) that renames
  the party actor; empty result keeps the current name.

### Flip (translate-commands.ts)

103 → `inputNumber`, 104 → `selectItem` (RM category param preserved), 303 → `nameInput`
(both digit/char counts clamped). 101 now maps `background`/`positionType` onto the `text`
command (storing only the non-defaults) instead of emitting an M2·B `todo` report line.
103/104/303 removed from the `TODO` table.

### Tests

- **node --test** `tests/message-codes.test.js` (new): the escape-code renderer — loads
  `messages.js` + `plugins.js` in a vm and asserts `richText` expands every code
  (substitution, gold badge, size stack, pacing markers, `\fs`/`\px`/`\py`, literal `\\`,
  plugin colour/icon, name-box reuse).
- **node --test** `interpreter.test.js`: the three new handlers register, drive their scenes
  (stubbed), and store results; `text` forwards the background/position opts.
- **vitest** `mz-translate-commands.test.ts`: SPEC rows 103/104/303 flip to real commands;
  the D3 `mzTodo`-shape tests re-point at codes that stay `mzTodo` (313/315); new
  field-fidelity block for 103/104/303 + 101 window/position (670 tests).
- **Playwright** `tests-e2e/message-parity.spec.mjs` (new): a gated parallel common event
  shows a `\v \$ \{ \} \.` message (asserts the gold badge, size span, and pacing marker
  render + the substituted value shows), then Input Number stores a keyed-in value a
  follow-up `\v[2]` message reads back. Map 1 untouched.

### Stage log

- **2026-07-05 — M2·B complete (branch `mig-2b`).** Shipped message-system parity:
  - Schema: `CmdInputNumber`/`CmdSelectItem`/`CmdNameInput` added to `AnyCommand`; optional
    `background`/`position` on `CmdText`. FORMAT_VERSION stays 2, no required fields.
  - Engine: `js/runtime/messages.js` rewritten for full escape-code parity (`\p \$ \{ \} \.
    \| \! \> \< \^ \px \py \fs \\` + the control-aware typewriter + `opts` window
    background/position); new `src/engine/scenes/input-scenes.ts` (number / select-item /
    name-input scenes) wired through `EngineServices` + `flow.ts` handlers; `text` handler
    forwards the window opts. `Atlas_TextCodes` palette extended to 32 for MZ `\C[n]` range.
  - Editor: Show Text form gained Window + Position dropdowns; `textCodesHelp` legend lists
    the new codes; `inputNumber`/`selectItem`/`nameInput` `CMD_DEFS` forms + `cmdSummary`
    cases. CSS for the two new scenes + message dim/transparent/top/middle + gold badge.
  - Flip: `translate-commands.ts` 103/104/303 → real commands, 101 → window/position fields;
    removed from the `TODO` table. Codes 313/315 (M2·C) still exercise the `mzTodo` shape.
  - Tests: new `tests/message-codes.test.js` + `tests-e2e/message-parity.spec.mjs`;
    `interpreter.test.js` + `mz-translate-commands.test.ts` extended. **All green:**
    typecheck, 18 node tests, 670 vitest, 69 Playwright (map 1 untouched, 0 regressions).
  - Patch notes added; `patch-notes.js?v=46→47` bumped in `help.ts` + `shims.d.ts`. Wiki
    `Message-Text-Codes.md` documents the new codes, window options, and input commands.
  - Scope note: `\px`/`\py` in-window pixel positioning is intentionally not modeled (Atlas
    messages use flow layout) — stripped, not reported, since the text still reads correctly.
    Input scenes are map-scene UI (transient, not saved), matching RM.
