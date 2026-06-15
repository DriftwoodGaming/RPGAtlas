/* RPGAtlas - patch-notes.js
   Keep newest entries first. See AGENTS.md for the update policy. */
"use strict";

export const PATCH_NOTES = [
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
