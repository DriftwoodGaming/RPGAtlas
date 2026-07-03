# Migration Guide

RPGAtlas opens **every project it has ever been able to save** — a project file from the earliest
unversioned builds (even pre-rebrand "Driftwood" files) loads in 1.0 and upgrades itself in place.
This page explains how that works and what changes between format versions.

---

## How project versioning works

Every project carries `meta.formatVersion`, an integer schema version (missing = 0, i.e. a
pre-versioning project). On **every load, import, or playtest boot** the engine runs each
registered migration whose version is newer than the file's, in order, then stamps the current
version. Migrations are:

- **Automatic** — no prompts, no separate tool; opening a project *is* migrating it.
- **Additive** — they backfill new fields with defaults that reproduce the old behavior exactly.
  Your game plays the same until you use the new features.
- **Round-trip tested** — the test suite loads and re-saves older fixtures and fails if a
  migration ever changes behavior.

**Forward compatibility:** a file saved by a *newer* RPGAtlas than the one opening it is returned
untouched (the version stamp is never downgraded) — newer-format data is preserved rather than
half-migrated. Upgrade the app to edit the file.

---

## Format history

| Version | Introduced | What the migration adds |
|---|---|---|
| **0 → 1** | pre-overhaul | The catch-all legacy upgrade: second decor layer, painted shadows, passability overrides, HD-2D heights, plugins list, quests, custom characters, input bindings, database type lists; adopts `"driftwood"`-engine files. |
| **1 → 2** | Phase 5 (Gameplay Systems) | Purely additive backfills: the animations collection, battle-mode system fields (ATB/CTB options), follower/minimap/vehicle settings, the per-map region layer, per-troop battle-event pages. |
| *(current)* | **2** | Phases 6–7 added **no format bump** — asset library references, audio v2 fields, ambience layers, and all 1.0 features are optional fields with "absent = previous behavior". |

## Upgrading from pre-overhaul RPGAtlas (or Driftwood) to 1.0

1. **Back up** your `.json` project (you should always have one — File ▸ Export Project As File…).
2. Open it in RPGAtlas 1.0 (drop it on the editor or File ▸ Open Project). Migration is automatic.
3. Save. The file is now format 2 and includes any library assets your project uses, embedded.

Notes:

- **Older RPGAtlas versions can still open** a migrated file in most cases (unknown fields are
  ignored), but anything built on new features won't function there — treat upgrades as one-way.
- **Plugins keep working**: the plugin/script API surface is frozen for 1.x
  (see [Plugin & Script API](Plugin-and-Script-API)).
- **Exported games never migrate** — an export bundles the engine it was built with, forever.

## Player saves

Save slots and player options are stored per game (by game title) in the player's browser or, for
native builds, the app's storage. Engine updates don't invalidate saves: the save is a snapshot of
game state, and loading it into an updated export works as long as your game's maps/events still
have the same ids — the usual care when patching a released game.

**Next:** [Troubleshooting & FAQ →](Troubleshooting-and-FAQ)
