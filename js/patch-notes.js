/* RPGAtlas - patch-notes.js
   Keep newest entries first. See AGENTS.md for the update policy. */
"use strict";

export const PATCH_NOTES = [
  {
    date: "July 2, 2026",
    title: "Unified undo & UI polish",
    summary:
      "Undo now spans everything: map painting, event edits, Map Properties, and every Database change share one Ctrl+Z history, and the editor got a consistency pass — labeled undo steps, keyboard list navigation, visible focus rings, and a unified dark palette.",
    items: [
      "Database edits are undoable: typing, New/Delete/Duplicate, bulk edits, and pastes commit to the same history as map painting. Ctrl+Z / Ctrl+Y work inside the Database and Map Properties dialogs too (text boxes keep the browser's native text undo while you type).",
      "Map Properties changes (name, size, HD-2D settings, notes) undo as a single step, including resizes.",
      "The Edit menu, command palette, and toolbar tooltips now name the next step — e.g. \"Undo — Paint\", \"Redo — Database edit\".",
      "Database lists: press ↑/↓ in the search box to walk the (filtered) list without touching the mouse.",
      "UI polish: one shared dark-theme palette and type scale across every panel and dialog, visible gold focus rings when tabbing through controls, and thin themed scrollbars everywhere.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "World View & database upgrades",
    summary:
      "A new bird's-eye World View draws your whole game as a map-connection graph parsed live from Transfer commands, and every Database list gains search, multi-select bulk editing, and cross-project copy/paste.",
    items: [
      "View ▸ World View (F3) opens a dockable map graph: each map is a node, each Transfer-Player command an arrow. Drag maps to arrange them (positions are saved per map), click to select, double-click to open, and add per-map notes in the inspector. Drag the ↻ handle on an arrow onto another map to re-link every transfer behind that connection. Broken links to deleted maps are flagged.",
      "Every Database list (Actors, Items, Skills, Enemies, …) now has a search box, per-row checkboxes for multi-select, and a bulk bar: Bulk Edit a shared numeric field (set / add / multiply), Duplicate, and Delete across the whole selection.",
      "Copy and Paste move entries between projects through a shared clipboard — copy your enemies in one project, open another, and paste them in.",
      "The Classes tab shows a live stat-curve preview (levels 1/25/50/99) and the Skills tab an interactive damage preview, both using the exact engine formulas — purely editor-side, no change to how the game runs.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Cliff auto-texturing — sculpted rock faces in HD-2D",
    summary:
      "Raised terrain blocks can now render as proper cliffs in the HD-2D scene: their exposed walls get a top-down light gradient, a sunlit crest, and shaded vertical corners instead of a single flat tint. Off by default, per map.",
    items: [
      "Map Properties ▸ HD-2D ▸ Cliff auto-texturing turns it on for a map. Any tile you raise in Height mode now reads as a carved cliff — darker toward the base, brighter along the top edge, with chiselled corners where the wall turns.",
      "The look is derived from the same neighbour connectivity as the floor autotiles, and updates live in the HD-2D Viewport as you paint heights.",
      "Purely a rendering option: it changes no map data, and leaving it off keeps the exact previous flat-shaded walls.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Autotiles — paint connected terrain with RPG-Maker sheets",
    summary:
      "Terrain now autotiles: import an RPG-Maker A2 autotile sheet and paint whole regions of grass, water, or path that automatically pick the right edges and corners as you draw. Comes with resizable terrain brushes.",
    items: [
      "Tiles panel ▸ Autotiles ▸ Import… (or Tools ▸ Import Autotile Sheet…) brings in a standard RPG-Maker A2 sheet — each 2×3 block becomes a terrain brush swatch. Click a swatch, then paint like any tile; the 47-blob engine resolves borders and inner corners from the neighbours automatically.",
      "Brush sizes: pick 1×1, 3×3, or 5×5 in the Tiles panel (or press [ and ] ) to paint broad strokes of terrain at once.",
      "Autotiles resolve live everywhere — the 2D map, the HD-2D viewport, and playtest — and right-clicking a swatch deletes the group. Maps stay plain tile data, so existing projects and saves are unchanged.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Live HD-2D viewport — edit your map inside the 3D scene",
    summary:
      "The HD-2D preview is now a full dockable viewport panel: the game's three.js renderer runs live inside the editor, with its own camera you can fly around and drag-to-place point lights right in the 3D scene.",
    items: [
      "Press F2 (or use View ▸ HD-2D Viewport) to dock the live renderer as a panel — split it beside the map, tab it, or float it like any other panel; it updates instantly as you paint tiles, edit heights, or change Map Properties.",
      "A viewport camera decoupled from the game: drag to pan across the map, scroll the wheel to zoom toward the cursor, and Shift-drag (or right-drag) to change the camera tilt — none of it touches the map's own HD-2D settings.",
      "Point lights are now editable with drag gizmos: double-click empty space to drop a light, drag its handle to reposition it in the scene, and tweak its colour and radius live — the first way to place per-map lights without light-named events.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Dockable workspace — arrange the editor your way",
    summary:
      "The editor's panels (Maps, Tiles, Map) are now a fully dockable workspace: drag panels by their tabs to re-dock, split, tab, or float them, resize with draggable dividers, and save named layouts.",
    items: [
      "Drag any panel's tab to rearrange it: drop on the center of a region to add it as a tab, drop near an edge to split, or drag it out to float it in its own window (floating windows move and resize).",
      "Drag the dividers between panels to resize; your arrangement is remembered automatically between sessions.",
      "New View menu: show/hide the Maps and Tiles panels, Focus Map, Focus Next Panel (F6), Reset Panel Layout, and Save/Load named layouts — every one also reachable from the Command Palette.",
      "The map and tile-palette views now live inside dockable panels while keeping all their existing behavior.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Command Palette — press Ctrl+P and type what you want",
    summary:
      "Phase 3 of the Atlas overhaul (the editor platform) begins: a fuzzy-searching Command Palette puts every editor action one keystroke away, backed by a new command registry and a declarative keyboard map.",
    items: [
      "New Command Palette — open with Ctrl+P, Ctrl+Shift+P, or Tools ▸ Command Palette…, type a few letters of any command (save, playtest, database, height mode, zoom…), and press Enter to run it.",
      "Every palette entry shows where the command lives in the menus and its keyboard shortcut; commands that can't run right now (like Undo with nothing to undo) are hidden.",
      "All existing shortcuts behave exactly as before; under the hood they now run through one declarative key map that upcoming editor features (dockable panels, live HD-2D viewport) will extend.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Weather, stairs, drop shadows — and the HD-2D overhaul is complete",
    summary:
      "Phase 2 of the Atlas HD overhaul wraps up: GPU weather particles fall inside the 3D scene, stairs tiles become real ramps, characters get soft drop shadows, and the renderer is tuned to hold 60 fps at 1080p with every effect enabled.",
    items: [
      "New 'Weather particles' setting in Map Properties: Rain, Snow, or floating Ambient motes, rendered inside the HD-2D scene (they fall behind buildings and in front of the ground, not as a flat overlay).",
      "New 'Soft character drop shadows' toggle: a gentle blob grounds every character even without sun shadows.",
      "Stairs tiles now render as real sloped ramps between terrain heights in HD-2D.",
      "Performance: chunk-level view culling plus a CI-enforced frame budget — the sample map with every feature on (shadows, water, materials, rain, day/night, full post stack) holds 60 fps at 1080p on ordinary hardware.",
      "The Whispering Cave in the sample project is now an HD-2D showcase: point-light shadows off the rock formations, glowing lava and crystal, dust motes, night color grade.",
      "The old pre-three.js renderer has been retired (?renderer=classic no longer switches); two driver-strict shader bugs found on real GPUs (water at dusk, weather particles) were fixed on the way out.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Cinematic post stack and a day/night cycle",
    summary:
      "HD-2D maps gain a film-grade finishing stack — ACES tone mapping, color grades, vignette, ambient occlusion, FXAA — plus a real day/night cycle where the sun arcs across the sky, shadows stretch and fade, and windows light up after dark.",
    items: [
      "New Map Properties toggles: ACES filmic tone mapping, FXAA anti-aliasing, SSAO ambient occlusion, vignette, and a color-grade preset (Warm, Cool, Night, Sepia, Noir) — all per map, combinable with bloom/depth-of-field/fog.",
      "New 'Day/night cycle' toggle: the map's lighting follows an in-game clock — golden dawns and dusks, blue moonlit nights, the sun (and its shadows) sweeping east to west, and emissive windows/torches igniting at night with Auto materials.",
      "Set each map's 'Time of day on entry', and drive the clock from scripts/plugins with game.setTimeOfDay(hours) / game.getTimeOfDay(); the clock is saved with the game.",
      "All effects render in the editor's HD-2D preview and in exported games.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Living water and auto materials for HD-2D maps",
    summary:
      "Ponds, rivers, and swamps come alive with animated waves, real reflections, and shore foam — and a new auto-material system gives tiles light-reactive relief, specular sparkle, and windows that glow at night.",
    items: [
      "New 'Water surface' toggle in Map Properties: water/deep-water/swamp tiles get an animated surface with planar reflections (characters and terrain mirror in the water), refraction ripples, sun glints, and foam along shores.",
      "New 'Auto materials' toggle: normal maps are auto-generated from every tile's artwork so point lights reveal relief; wet/icy/crystal tiles get specular highlights; windows, torches, lava, and crystals glow as ambient light drops (they ignite automatically with the upcoming day/night cycle).",
      "Both effects are per-map, off by default, and cost nothing when disabled.",
      "Works in the editor's live HD-2D preview and in exported games.",
    ],
  },
  {
    date: "July 2, 2026",
    title: "Point lights now cast shadows on HD-2D maps",
    summary:
      "Torches, lamps, and any other point light can now cast real-time shadows: walls block lamplight and characters throw flickering shadows away from nearby flames.",
    items: [
      "New 'Point-light shadows' toggle in Map Properties (HD-2D section); off by default, existing maps are unchanged.",
      "The 4 lights nearest the camera cast omnidirectional soft shadows (raised terrain, overhead tiles, and characters all occlude).",
      "Advanced: map.hd2d.pointShadows accepts a 0–1 strength for partially-soft occlusion instead of full darkness.",
      "Works in the editor's live HD-2D preview and in exported games.",
    ],
  },
  {
    date: "July 1, 2026",
    title: "Real-time sun shadows for HD-2D maps",
    summary:
      "HD-2D maps can now cast real-time shadows: terrain blocks, overhead tiles, and characters all cast and receive soft sun shadows — the first new rendering capability unlocked by the three.js port.",
    items: [
      "New 'Sun shadows' toggle in Map Properties (HD-2D section); off by default, so existing maps look exactly as before.",
      "Characters cast soft moving drop shadows; buildings, cliffs, and trees shade the ground realistically (3×3 PCF soft edges).",
      "Advanced: map.hd2d.shadows accepts a 0–1 strength, and map.hd2d.sun { azimuth, elevation } aims the sun (defaults: NE sky, 55° up) — groundwork for the upcoming day/night cycle.",
      "Shadows render in the editor's live HD-2D preview too.",
    ],
  },
  {
    date: "July 1, 2026",
    title: "Atlas HD Phase 2 begins — HD-2D renderer now runs on three.js",
    summary:
      "The HD-2D renderer has been ported to the three.js engine with strict visual parity — games look identical (golden-image tests prove it), and the new scene graph is the foundation for upcoming real-time shadows, water, weather, and richer lighting.",
    items: [
      "HD-2D maps and the editor's live HD-2D preview now render through three.js by default; visuals, per-map settings (tilt, bloom, depth of field, fog, lights, ambient), and performance are unchanged.",
      "Temporary escape hatch: add ?renderer=classic to the player URL to run the previous raw-WebGL2 renderer until the parity sign-off retires it.",
      "New golden-image tests pin the bloom / depth-of-field / fog post-processing stack so both renderers provably match.",
    ],
  },
  {
    date: "July 1, 2026",
    title: "Standalone Export Fix",
    summary:
      "Exported games (Standalone HTML and Windows EXE) work again — a long-standing packaging gap made every exported game crash on startup before showing the title screen.",
    items: [
      "Exports now include the quest runtime, quest journal view, and input system the engine requires at startup; exported games boot to the title screen and play normally.",
      "An automated export smoke test now boots a freshly exported game on every change, so exports can't silently break again.",
    ],
  },
  {
    date: "July 1, 2026",
    title: "Atlas HD Phase 0 — Stability & Foundations",
    summary:
      "First phase of the Atlas HD overhaul: several crash fixes players could hit in normal use, versioned project files, and a modern engine-development toolchain (using and playing RPGAtlas still needs no install).",
    items: [
      "Fixed a battle crash when a troop contained a deleted enemy before a surviving one — attacks and enemy AI now target correctly.",
      "Deleting a map now reassigns the game's starting map if needed and lists any events whose Transfer Player commands still point at the deleted map.",
      "Continue and Load no longer crash on saves that reference a deleted map — the game falls back to an existing map and keeps the player inside its bounds.",
      "In-game saving now shows 'Could not save — storage is full or unavailable.' instead of freezing the event that opened the save menu.",
      "HD-2D now survives a lost graphics context: the game falls back to classic 2D rendering and automatically rebuilds and resumes HD-2D when the browser restores the GPU.",
      "Alt-tabbing or losing window focus while holding a key no longer leaves the player walking on their own.",
      "Project files now carry a formatVersion with a proper migration registry, protecting projects opened across engine versions (newer projects are left untouched by older engines).",
      "New contributor toolchain: Vite dev server, TypeScript, ESLint, Vitest, Playwright smoke and golden-image render tests, and CI — see the README's 'Developing the engine' section. Exports and the zero-install workflow are unchanged.",
    ],
  },
  {
    date: "June 29, 2026",
    title: "Plugin Metadata Foundation",
    summary: "Plugins now have formal metadata fields, clearer validation, and a more flexible Plugin Manager layout.",
    items: [
      "Plugin Manager now exposes plugin ID, version, author, description, and dependency fields above the code editor.",
      "The Plugin Manager window and plugin list divider can now be resized.",
      "Bundled plugins now carry metadata, and older projects are migrated with safe defaults for custom plugins.",
      "Playtests now record plugin load status in window.AtlasPluginStatus and skip duplicate or missing-dependency plugins with console warnings.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "Project Export Save As",
    summary: "Export Project As File now opens a Save As destination picker when the editor is running in a capable desktop browser or desktop app.",
    items: [
      "File -> Export Project As File opens a native Save As picker so the project file can be named and saved to a chosen folder.",
      "Browsers without the save-picker API still fall back to the standard .json download.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "Action Combat Chase Spacing",
    summary: "Chasing action-combat enemies now avoid stacking on each other unless their event page has Through enabled.",
    items: [
      "Enemy chase AI now treats another same-priority event's current tile or reserved movement destination as blocked.",
      "Turning on Through for an event still allows that chaser to overlap other events when the project needs pass-through behavior.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "Playtest and Event Marker Sync",
    summary: "Editor event markers now stay visible while painting, and browser playtests launch from a fresh player URL.",
    items: [
      "Events remain visible as faint map pins outside Event mode, so they no longer look deleted when switching back to tile painting.",
      "The Playtest command now opens browser playtests with a cache-busting play.html URL while still saving the current project first.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "Action Combat AI Picker",
    summary: "Action Combat events now expose enemy AI directly and the default Attack binding includes F again.",
    items: [
      "The Action Combat section now has an Enemy AI picker with None and Chase player options.",
      "Existing random touch-damage enemies keep their chase behavior through migration, but new enemies choose it explicitly.",
      "The default Attack action now responds to F as well as J unless the project has a custom attack binding.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "HD-2D Toggle Respects Map Properties",
    summary: "Maps now return to the flat 2D renderer when HD-2D is switched off in Map Properties.",
    items: [
      "The Map Properties Enabled checkbox now controls the runtime renderer even when camera tilt, ambient light, fog, bloom, point lights, or saved map lights remain configured.",
      "Older projects that had HD-2D settings before the explicit toggle still opt into HD-2D until the map is saved with the checkbox off.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "Action Combat Follow-Up",
    summary: "Map action combat now reliably hits the adjacent tile and gives touch-damage enemies a simple way to pressure the player.",
    items: [
      "Sword swings now check the tile in front of the player as well as the visual slash collider, so adjacent enemies are hit and knocked back reliably.",
      "Touch damage now works as an adjacent melee strike for action-combat enemies instead of requiring an impossible same-tile overlap.",
      "Random-moving action-combat enemies with Touch damage now chase nearby players before resuming random wandering.",
    ],
  },
  {
    date: "June 28, 2026",
    title: "True 3D HD-2D Rendering",
    summary: "HD-2D now renders through a real perspective camera again, so the Camera tilt control actually tilts the view. The PIXI dependency was removed in favor of a dependency-free WebGL renderer.",
    items: [
      "Camera tilt (25–89 degrees) leans the camera back through a genuine 3D perspective: raised blocks reveal their walls and the world foreshortens, instead of the slider doing nothing.",
      "Restored the full HD-2D feature set on the 3D path — height-extruded blocks with shaded cliff faces, billboard characters that stand at their elevation, 3D point lights with ambient, plus bloom, depth of field, and distance fog.",
      "Removed the bundled PIXI library; the renderer is now raw WebGL2 with no third-party dependency and a smaller download.",
      "The in-editor HD-2D Preview and exported games use the same renderer, so what you see while editing matches the game.",
    ],
  },
  {
    date: "June 22, 2026",
    title: "Live HD-2D Editor Preview",
    summary: "The HD-2D Preview now uses the current PIXI renderer directly and stays synchronized with map edits.",
    items: [
      "Game -> HD-2D Preview opens a working draggable preview panel again, including elevation, map characters, ambient lighting, event lights, and map lights.",
      "Blocked and elevated tiles cast bounded point-light shadows in both the preview and game runtime.",
      "The Map Properties Point lights toggle now consistently controls event and map lights during playtests and previews.",
      "Closing and reopening the preview reuses its renderer safely without accumulating per-frame lighting graphics.",
    ],
  },
  {
    date: "June 19, 2026",
    title: "HD-2D Height Extrusion",
    summary: "Elevation painted with the map editor's Height tool now renders as raised blocks with shaded cliff faces in the HD-2D view, instead of being ignored.",
    items: [
      "Tiles with a non-zero height paint as raised platforms — the tile's own art lifts into a top, with a shaded south-facing wall showing the exposed step over lower terrain.",
      "Taller terrain correctly hides what stands behind it, and characters pass in front of or behind elevation based on where their feet are.",
      "Block height scales with the painted 0–9 value (about a third of a tile per step), so stepped ridges, plateaus, and pillars read as real depth.",
      "Replaces the previous placeholder that simply nudged the overhead layer up by a few pixels and otherwise discarded the height layer at render time.",
    ],
  },
  {
    date: "June 19, 2026",
    title: "Fixed Message Windows in Exported Games",
    summary: "Standalone HTML/EXE exports now load the message system correctly, so Show Text boxes and other dialog work in exported games.",
    items: [
      "The standalone export now ships runtime/messages.js as a regular script (matching the editor and playtest), instead of an unused import map that left createMessageSystem undefined.",
      "Added a continuous-integration test workflow and an npm test script so the full test suite runs automatically on every change.",
    ],
  },
  {
    date: "June 18, 2026",
    title: "Reusable Common Events",
    summary: "The Database now includes Common Events for reusable command sequences, explicit calls, and switch-controlled automatic processing.",
    items: [
      "Added Database -> Common Events with Name, Trigger, Activation switch, and the full event-command list editor.",
      "Added the Call Common Event command to event content lists and game.callCommonEvent(id) to the Script API.",
      "Common Events support None, Autorun, and Parallel triggers, with optional switch gating for automatic execution.",
      "Recursive common-event calls are safely skipped to prevent an immediate infinite call loop.",
    ],
  },
  {
    date: "June 18, 2026",
    title: "Custom Window Colors",
    summary: "Projects can now set a shared window color for Show Text boxes, menus, and battle information panels from the System tab.",
    items: [
      "Added a Window color picker beside the existing font size and opacity settings in Database -> System.",
      "The selected color is applied to message boxes, speaker-name labels, standard menus, and battle log and party panels.",
      "Existing projects receive the original dark-blue window color automatically, while custom colors persist through saves and exports.",
    ],
  },
  {
    date: "June 18, 2026",
    title: "Remappable Map Attack Prompts",
    summary: "Map action combat and its guidance now consistently use the remappable Attack action instead of assuming the default J key.",
    items: [
      "Map sword attacks are covered by a regression test that verifies a replacement Attack binding works and the old key no longer triggers it.",
      "The Action Combat editor hint now points authors to the remappable Attack action and the \\input[attack] message prompt.",
      "Action Combat and message text-code documentation now show input-aware attack instructions for keyboard and gamepad players.",
    ],
  },
  {
    date: "June 17, 2026",
    title: "Options: Audio Mixer & Game Settings",
    summary: "The in-game Options menu is now a full settings screen with separate volume sliders and gameplay/accessibility toggles.",
    items: [
      "Independent Master, Music, and Sound Effects volume sliders replace the old single Music on/off toggle.",
      "New Text Speed setting (Slow / Normal / Fast / Instant) controls how quickly message text reveals.",
      "New Dash setting: Hold to run, Toggle to latch running on/off, or Always On.",
      "New Screen Shake setting (Off / Reduced / Full) scales combat and event camera shake.",
      "Adjust any option with the mouse (click the arrows, or click along a volume bar), keyboard, or gamepad; settings persist per game.",
    ],
  },
  {
    date: "June 16, 2026",
    title: "Quest Editor Validation Warnings",
    summary: "The Quests database tab now warns authors about broken quest references and other common setup mistakes while editing.",
    items: [
      "Quest warnings now flag missing next quests, duplicate follow-up links, and self-referencing quest chains.",
      "Objective warnings catch missing enemies, missing fetch items, and invalid turn-in map or event targets.",
      "Requirement and failure warnings catch missing referenced quests, troops, enemies, and quest lock/unlock targets.",
    ],
  },
   {
     date: "June 17, 2026",
     title: "Gamepad Support & Remappable Controls",
     summary: "Full gamepad support with a unified keyboard/gamepad input layer, in-game and in-editor rebinding, and input-prompt glyphs you can drop into messages.",
     items: [
       "Play with a gamepad: movement, Confirm/Cancel, dash, and attack map to the W3C Standard Gamepad, including left-stick movement with a configurable stick deadzone.",
       "In-game Options -> Controls lets players rebind keyboard and gamepad inputs, with conflict detection and a guard that stops Confirm/Cancel from being left unbound.",
       "The in-game Controls menu now shows the same procedural glyphs as the editor, auto-skinned to the controller in your hands, instead of plain text labels.",
       "New dedicated \"Controls\" tab in the editor sets the default key/gamepad bindings a new player starts with, shown as button/key glyphs (no more console snippet).",
       "Gamepad glyphs auto-detect the player's controller and relabel for Xbox (A/B/X/Y), PlayStation (Cross/Circle/Square/Triangle), and Nintendo Switch (B/A/Y/X); the editor Controls tab has a per-brand preview.",
       "Distinct procedural icons for the D-Pad, analog stick, and stick-clicks (L3/R3), so on-screen directions no longer all look the same.",
       "New \\input[action] message code shows the glyph for a bound control (e.g. \"Press \\input[ok] to continue\"), matching keyboard or gamepad to the device in use when the message opens.",
       "Show Text and Show Choices now include a built-in \"Text codes\" reference, so you can recall every code (including \\input[...]) without leaving the message editor.",
       "Input-prompt glyphs are generated procedurally, so they need no extra art and carry into standalone exports automatically.",
     ],
   },
   {
     date: "June 16, 2026",
     title: "Map Action Combat",
     summary: "Events can now become Zelda-style map enemies that take sword damage, flash, knock back, and update kill quests on defeat.",
     items: [
       "Added an Action Combat section to event pages for enabling map enemies, choosing an enemy, and tuning HP, touch damage, knockback, invulnerability frames, and defeat self-switches.",
       "Press J during map play to swing the player's sword with a directional hit collider.",
       "Sword hits damage each enemy once per swing, show slash and damage feedback, and apply tile knockback when space is available.",
       "Defeated action-combat enemies erase or flip their configured self-switch and count toward matching Kill quest objectives.",
     ],
   },
   {
     date: "June 15, 2026",
     title: "Abandoned Quest Tracking",
     summary: "The Journal now separates abandoned quests from failed ones so players can review dropped quests independently.",
     items: [
       "Added an Abandoned Quests tab to the Journal.",
       "Player-abandoned quests now use their own abandoned state instead of being mixed into Failed Quests.",
       "Quest status pickers now include abandoned for page conditions and quest prerequisites.",
     ],
   },
   {
     date: "June 15, 2026",
     title: "Split-Panel Quest Journal",
     summary: "The in-game Journal now opens as a full-size split panel with quest browsing on the left and live details on the right.",
     items: [
       "Replaced the old Journal popup flow with a dedicated full-screen-style panel.",
       "Browse Active, Completed, and Failed quests from tabs across the top of the Journal.",
       "See the selected quest's title, description, objectives, and failure outcome in a persistent detail pane.",
       "Opening the Journal now hides the party panel so the quest screen has room to breathe.",
     ],
   },
   {
     date: "June 15, 2026",
     title: "Built-In Quest System",
     summary: "Added a built-in quest framework with editor tools, runtime tracking, objective progress, branching outcomes, and an in-game Journal.",
     items: [
       "New Database -> Quests tab for creating and editing quests, objectives, rewards, prerequisites, failure rules, and follow-up quest chains.",
       "Added Event, Kill, and Fetch objectives with progress tracking, optional fetch item turn-in consumption, and objective-aware event page conditions.",
       "New event commands: Start Quest, Complete Quest, Fail Quest, Advance Quest Objective, and Set Quest Objective Progress.",
       "Added an in-game Journal with Active, Completed, and Failed quest lists, objective progress display, outcome text, and optional quest abandonment.",
       "Quest rewards now support XP, gold, and items, with save/load support, restart/abandon policies, branching failures, and automatic follow-up quest unlocking.",
     ],
   },
  {
    date: "June 14, 2026",
    title: "Event editor: 3-pane layout + live command inspector",
    summary:
      "Reorganized the event editor into a three-pane workspace and added an inline inspector that edits the selected command without opening a dialog.",
    items: [
      "Event editor now uses a 3-pane layout: Conditions, Appearance, and Behaviour on the left; the command list in the center; and a command inspector on the right.",
      "The Conditions section shows an \"N active\" badge when page conditions are set.",
      "Single-click a Show Text command to edit its speaker, face, and message live in the right-hand inspector; double-click any command to open the full editor dialog as before.",
      "Command list is easier to scan with alternating row shading and a running command count next to the \"Commands\" heading.",
      "Event name and page tabs moved into a single header bar; the map position now sits in the footer beside OK / Cancel.",
    ],
  },
  {
    date: "June 14, 2026",
    title: "Lighting polish: smoother lights, shadows disabled",
    summary:
      "Improve radial light visuals and temporarily disable shadow generation while debugging.",
    items: [
      "Smoothed radial gradient for more natural light falloff (less burnt centers).",
      "Removed the ambient overlay sprite in favor of a single ambient background color.",
      "Temporarily disabled per-tile shadow generation to prevent visual artifacts.",
      "Fixed PIXI v8 compatibility: string blend modes and linear scaleMode usage.",
      "Credits: Kiro (Dirgefall Studio) — PIXI integration and lighting polish",
    ],
  },
  {
    date: "June 14, 2026",
    title: "PIXI v8 HD-2D Lighting System",
    summary:
      "Replaced basic circle-based light rendering with a GPU-efficient radial gradient light map for PIXI v8.",
    items: [
      "Lights now use radial gradient sprites with smooth falloff instead of hard-edged circles.",
      "Ambient darkness overlay darkens unlit areas; lights pierce through via ADD blend mode.",
      "Fixed TILE size mismatch (32 to 48) for correct sprite and light positioning.",
      "Camera zoom is now applied to the PIXI scene container.",
      "Light sprites are pooled and reused each frame (zero GC pressure).",
      "Editor GLRender alias added for HD-2D preview compatibility.",
      "Credits: Kiro (Dirgefall Studio) — PIXI integration and lighting polish",
    ],
  },
  {
    date: "June 14, 2026",
    title: "Desktop App (Tauri)",
    summary: "RPGAtlas can now be packaged as a lightweight cross-platform desktop application using the system WebView, alongside the existing local-server build.",
    items: [
      "Added a Tauri wrapper (src-tauri/) that runs the editor in a native window on Windows, macOS, and Linux.",
      "RPGAtlas-Desktop.exe opens the editor directly in the desktop app; the original RPGAtlas.exe still opens it in your browser.",
      "Playtest opens in its own dedicated desktop window instead of a browser tab.",
      "Project export uses a native Save dialog when running as a desktop app.",
      "Build with: npm install, then npm run dev (live) or npm run build (installer). Requires the Rust toolchain.",
    ],
  },
  {
    date: "June 14, 2026",
    title: "Name & Manage Event Pages",
    summary: "Name an event's pages and reorder, duplicate, or jump between them by drag, right-click menu, or number keys.",
    items: [
      "Name a page: double-click its tab (or right-click → Rename) to label it, e.g. “Greeting” instead of “Page 3”. Clear the name to return to the default.",
      "Drag a page tab left or right to reorder it.",
      "Right-click a page tab for Add page, Rename, Move, Copy, Paste, and Delete.",
      "Copy a page and paste it — within an event or into another event — as a full duplicate.",
      "Press 1–9 to jump straight to that page.",
    ],
  },
  {
    date: "June 14, 2026",
    title: "Undo, Redo & Delete-Key for Event Commands",
    summary: "The event editor gains its own undo/redo and Delete-key shortcuts — conveniences RPG Maker never offered inside event editing.",
    items: [
      "Undo and redo adding, editing, deleting, moving, copy/cut/paste, and drag-reordering of commands, including multi-selected blocks and commands nested inside If/Choices branches.",
      "Ctrl+Z undoes; Ctrl+Y or Ctrl+Shift+Z redoes — anywhere in the event editor, not only when the list is focused.",
      "Each event page keeps its own command history, so undo never disturbs another page or your page condition/appearance settings.",
      "Press Delete to remove the selected command(s) from the Commands list — and Ctrl+Z brings them back.",
      "Press Delete to remove the highlighted page, or use the − button; pages that still hold commands ask to confirm first.",
      "Command history lasts while the event editor is open; clicking OK still commits the whole event as a single undo step on the map.",
    ],
  },
  {
    date: "June 14, 2026",
    title: "Multilingual Editor Interface",
    summary: "Added a persistent interface-language module so creators can use the editor chrome in English, Spanish, French, or German.",
    items: [
      "Added Help → Interface Language for switching languages without reloading the editor.",
      "Translated the main menus, toolbar labels, map sidebar, status text, and common dialog controls.",
      "Language selection follows the browser by default, is saved locally, and never changes project-authored names or content.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Smoother Movement",
    summary: "Reworked the play-test movement loop so walking is fluid and runs at a consistent speed on every display.",
    items: [
      "Removed the brief pause that occurred at each tile during grid movement, for both the player and NPCs.",
      "Game logic now runs on a fixed timestep, so movement speed is identical on 60 Hz, 120 Hz, and high-refresh screens (no more fast-forward on fast monitors).",
      "Added frame interpolation so motion stays smooth on high-refresh displays.",
      "Event 'Wait' and camera-zoom timing is now frame-rate independent, matching real time even when the frame rate dips.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Select Multiple Event Commands",
    summary: "Shift+click a range of commands in the event editor and copy, cut, paste, delete, move, or drag them as one block.",
    items: [
      "Click a command, then Shift+click another to select the whole run between them.",
      "Copy/Cut/Paste/Delete and the ↑/↓ buttons act on the entire selection at once.",
      "Drag a selected block to a new spot, including into another branch.",
      "Selection stays within one branch level; selecting across an If/Choices carries the whole block along.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Copy & Paste Event Commands",
    summary: "Copy, cut, and paste commands in the event editor — within an event or from one event to another.",
    items: [
      "Select a command and use Ctrl+C / Ctrl+X / Ctrl+V (or the Copy/Cut/Paste buttons) in the Commands list.",
      "Paste works across events, so you can copy a command in one event and paste it into another.",
      "Container commands (If / Choices) copy with everything nested inside them.",
      "Right-click a command for a menu with all the list actions (add, edit, cut, copy, paste, move, delete).",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Drag-to-Reorder Event Commands",
    summary: "Reorder commands in the event editor by dragging them, not just the ↑/↓ buttons.",
    items: [
      "Click and drag a command in the Commands list to move it anywhere in the event.",
      "Drag commands into or out of If/Choices branches, not just within a single list.",
      "A drop line shows where the command will land; the ↑/↓ buttons still work too, and now keep the command selected so you can tap them repeatedly.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Cinematic and Control Event Command Expansion",
    summary: "Added new visual effects commands and advanced branching controls to map events.",
    items: [
      "Shake Screen - shakes the game viewport horizontally and vertically in both 2D and HD-2D modes.",
      "Flash Screen - overlays a fading color overlay for thunder strikes, hit impacts, or magical bursts.",
      "Change Weather - triggers map weather changes visually without requiring JavaScript Script blocks.",
      "Actor Conditional Branch - checks party membership and specific weapon/armor equipment in event branches.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Faster Event Command Navigation",
    summary: "Increased the Add Command menu from 12 to 24 buttons per page and added direct numbered page tabs.",
    items: [
      "Each Event Command page now displays up to 24 buttons.",
      "Page tabs appear above the command grid for one-click access without cycling through pages.",
      "Saved custom command buttons and +Add New remain at the end of the picker.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Patch Notes",
    summary: "Added an easily digestible Patch Notes menu under Help so players and creators can review feature updates.",
    items: [
      "Patch notes are shown newest-first and older entries remain available by scrolling.",
      "Added a project instruction requiring future AI-assisted features and major changes to include a short patch note.",
    ],
  },
  {
    date: "June 13, 2026",
    title: "Event Command Expansion",
    summary: "Expanded Event Commands into multiple pages with 12 buttons per page and the ability to add reusable event buttons on demand.",
    items: [
      "Camera Zoom - zoom the player camera in or out immediately or over time.",
      "+Add New - create project-saved JavaScript command buttons for reusable event flow and scene-management tasks.",
      "Saved command buttons can be inserted with one click, or edited and deleted with right-click.",
    ],
  },
];
