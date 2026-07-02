# Phase 4 Spec — Atlas Graph (node-based visual scripting)

**Status:** IN PROGRESS. Stage log accumulates here, phase-2/3-spec style.

**Branch:** `phase-4-graph` (off `main` after the Phase 3 Stage F merge)
**Architect & implementation:** Claude Fable 5 (roadmap assignment: "graph IR +
compiler design"; per the standing choreography note Sonnet is excluded and the
core work runs at the Fable/Opus tier).

## Objective

Ship the roadmap's "node-based engine" answer: **nodes as an authoring layer,
not an engine rewrite.** A graph is stored per event page and compiles
deterministically into the Phase 1 interpreter's command registry — so graphs,
classic command lists, playtest, saves, plugins, and exported games all stay
mutually compatible, and every graph feature works in exports with **zero
runtime cost** (the runtime never sees a graph; it runs the compiled
`page.commands` exactly as today).

## Non-goals (whole phase)

- No interpreter rewrite. The ONE engine addition is the `loop` / `breakLoop`
  command pair the roadmap's flow-node list requires (below) — additive,
  registry-registered, save-compatible, and independently useful from the
  classic command list.
- No schema meaning changes. `EventPage.graph` is additive and optional
  (absent-is-meaningful, like `map.notes` / `map.worldPos`); projects without
  graphs round-trip byte-identically.
- Stretch items (expression nodes for variable math, shared function graphs
  compiling to common events) are explicitly deferred; `label`/`jump` nodes are
  also deferred — structured Branch/Choice/Loop covers their use cases in a
  graph, and a flat-jump interpreter change is exactly the kind of runtime risk
  this phase's design avoids.

---

## Current-state facts that constrain the design

1. **The interpreter is a sequential async walker** (`interp.ts`):
   `runList` awaits `exec` per command; `exec` dispatches through the shared
   registry (`getCommand(c.t)`); unknown types are a silent no-op. `if` and
   `choices` handlers recurse via `interp.runList(branch)`. A Loop command can
   therefore be a handler that re-runs its `body` list, with a small unwind
   flag checked by `runList` for Break — no structural change.
2. **`CMD_DEFS` is the editor's command catalog** (`command-defs.ts`): per-type
   `label` / `make()` / `form(c, box) → apply()`. `mountForm` and `editCommand`
   host any command's form in any container/dialog. `cmdSummary(c)` renders
   one-line summaries. **The graph node library is this catalog** — every
   command type is a node type; forms, summaries, and the pickers are reused
   verbatim. `commandPresets` (saved Script buttons) ride along for free, which
   is also the plugin-node story: plugin runtime commands registered via
   `atlas.registerCommand` are authored as Script/preset nodes exactly as they
   are in the classic list today.
3. **Command lists recurse only through `if.then/else` and
   `choices.branches`** — the sites that must learn `loop.body`:
   `command-list.ts` (`walkCommands`, `buildCmdRows`, `ownsArray`),
   `world-graph.ts` (`collectTransfers` walk), `js/assets.js`
   (`scanCommands`, export asset scan), `event-searcher.ts` (uses the shared
   `walkCommands`; needs a loop summary case only).
4. **The event editor** (`event-editor.ts`) edits a **working clone** of the
   event; OK commits with one map-history snapshot ("Event edit"). Per-page
   command undo (`cmdHist`) snapshots `page.commands` — graph edits must
   snapshot `{commands, graph}` together so Ctrl+Z inside the editor stays
   coherent.
5. **The world-view panel** established the canvas pattern to reuse: DOM nodes
   absolutely positioned over an SVG edge layer on a scaled stage inside a
   scroll viewport; drag via mousedown + document mousemove; cheap
   position-only redraw during drags.
6. **Gates:** `tsc --noEmit`, eslint, `node --test tests/`, `vitest run`, full
   Playwright suite; renderer goldens must stay byte-identical (this phase
   touches no renderer code). `css/editor.css?v` and `patch-notes.js?v` bumps +
   patch-note entry per AGENTS.md.

---

## Design

### Graph IR (persisted, additive — `src/shared/schema.ts`)

```ts
interface GraphNode {
  id: number;                    // unique within the graph
  kind?: "cmd" | "comment" | "reroute";  // default "cmd"
  x: number; y: number;          // canvas position (stage px)
  cmd?: AnyCommand;              // kind "cmd": the payload command (branch
                                 //   arrays inside it stay EMPTY — structure
                                 //   lives in the edges)
  text?: string;                 // kind "comment"
  w?: number; h?: number;        // kind "comment": frame size (frames are
                                 //   sized comments)
  out: (number | null)[];        // exec outputs → target node id (null = end)
}
interface EventGraph {
  nodes: GraphNode[];
  entry: number | null;          // the Start pill's target
  nextId: number;                // id allocator
}
// EventPage gains: graph?: EventGraph
```

**Out-port shape per node** (`outPorts(cmd)` in the pure core):

| node | out ports |
|---|---|
| `if` | `Then`, `Else`, `After` |
| `choices` | one per option…, `After` |
| `loop` | `Body`, `After` |
| every other command | `Next` |
| `reroute` | `Next` |
| `comment` | none (never wired, skipped by compile) |

The **`After` port is the design keystone**: it represents "what runs after
the branch completes" and maps 1:1 onto "the commands following the
if/choices/loop in the parent list". That makes compilation structured and
gives `commands → graph → commands` **identity round-trip** with no
join-detection heuristics.

### Compiler (`src/shared/event-graph.ts`, pure)

`compileGraph(graph) → { commands, issues }`, deterministic:

- Walk from `entry`, following `Next`/`After` chains; each `cmd` node emits a
  deep-cloned command. `if`/`choices`/`loop` compile their branch ports into
  the command's own nested arrays, then continue with `After`.
- `reroute` nodes pass through; `comment` nodes are ignored.
- **Merges are legal** (two ports targeting one node): the shared tail is
  compiled once per path (tail duplication). A per-path visit stack rejects
  **cycles** ("use a Loop node") and a compiled-size guard (4096 commands)
  rejects pathological diamond stacks — both as validation errors, compile
  returns the last good output's issues.
- Unreachable `cmd` nodes are a **warning** (kept in the graph, not compiled).

`decompileCommands(commands) → EventGraph` ("convert page to graph"): builds a
tree-shaped graph (chains via `Next`, nested arrays via branch ports + `After`)
with a deterministic recursive block layout (columns flow right, branches stack
down). By construction `compileGraph(decompileCommands(cmds)).commands`
deep-equals `cmds` — the conversion is lossless, proven by round-tripping
every event page of the sample game in unit tests.

`validateGraph(graph)` → the compile issues plus graph-only lint (no entry
while cmd nodes exist, dangling port targets).

### Engine: `loop` / `breakLoop` (the flow-node enablers)

- `CmdLoop { t: "loop"; body: AnyCommand[] }` — runs `body` repeatedly.
  Safety valve: every 1000 iterations it awaits one frame
  (`services.waitFrames(1)`) so a wait-less loop can't freeze the tab.
- `CmdBreakLoop { t: "breakLoop" }` — sets `interp.breakLoop`; `runList`
  returns early while the flag is set; the innermost `loop` handler consumes
  it. (A stray Break outside any loop ends the current list run — same
  spirit as RPG Maker, flagged by editor validation.)
- Both get CMD_DEFS entries (Loop's body is authored in the command tree /
  Body port; Break has no parameters), so the classic list gains them too.

### Graph editor (`src/editor/event-editor/graph-editor.ts`)

Vanilla TS + `h()`, world-view canvas pattern:

- **Canvas:** pan (background drag / middle-drag), wheel zoom-to-cursor,
  scaled stage; SVG bezier edges; nodes are DOM cards (title = CMD_DEFS label,
  body = `cmdSummary`, in-port left, labeled out-ports right); Start pill
  bound to `graph.entry`; **minimap** (corner overview + click-to-jump);
  marquee-free v1 (single select + drag).
- **Editing:** drag out-port → drop on a node/in-port to wire (or onto empty
  canvas → command picker opens and the new node auto-wires); right-click
  canvas → add-node menu (reuses `pickCommand`, plus Comment/Frame/Reroute);
  double-click a node → its `editCommand` dialog; Delete removes node
  (edges heal: single-out nodes splice through); click edge → select,
  Delete disconnects.
- **Live compile:** every mutation snapshots undo, recompiles into
  `page.commands`, refreshes the validation banner (errors keep the last
  good compile; the page still runs).
- **Event-editor integration:** the center pane gets a `List | Graph` toggle
  per page. "Convert page to graph" (from Graph view on a graph-less page)
  runs `decompileCommands`; while a graph exists the List view is a
  **read-only compiled preview** ("view graph as command list");
  "Convert to list" deletes the graph after confirm, keeping the compiled
  commands fully editable again. Per-page undo snapshots `{commands, graph}`.

### Out of scope for the runtime

Playtest/exports read `page.commands` only. No engine file except
`interp.ts`/`flow.ts` (loop/break) changes; renderer untouched; goldens must
stay byte-identical.

---

## Stage plan

- **A — Graph core:** schema additions, loop/breakLoop (engine + CMD_DEFS +
  all list-walker recursion sites), `event-graph.ts` pure core
  (outPorts/compile/decompile/validate), vitest suite incl. sample-game
  round-trip.
- **B — Graph editor:** canvas UI, event-editor integration, CSS, e2e,
  patch notes, wiki (Events.md "Atlas Graph" section).

### Acceptance criteria (phase exit)

1. Any sample-game event page converts to a graph and back with
   deep-equal commands; editing in graph view updates `page.commands` live;
   playtest runs graph-authored pages with zero behavioral difference from
   the equivalent classic list.
2. Node library covers the full built-in command set (one node per CMD_DEFS
   entry) + Branch/Choice/Loop/Break structured flow + Script & preset
   (plugin) nodes + comments/frames/reroutes.
3. Validation catches cycles, dangling entries, unreachable nodes — shown
   live, never crashing the compile.
4. Loop/Break work in the classic command list as ordinary commands.
5. Full gate green; renderer goldens byte-identical; patch notes + wiki
   updated; `editor.css?v` bumped.
