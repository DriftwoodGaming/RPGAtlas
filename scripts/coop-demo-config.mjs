/* RPGAtlas — scripts/coop-demo-config.mjs
   Project Beacon MP9·C: the Driftwood Shore co-op demo scenario, as a single
   shared transform so the built demo file (build-coop-demo.mjs) and the
   showcase e2e (tests-e2e/coop-demo.spec.mjs) can never drift apart.

   It turns the bundled "Atlas Quest" showcase into a co-op meet-up on
   DRIFTWOOD SHORE (map 4) — friends spawn together on the beach, wave and use
   preset phrases, party up and explore. It ONLY sets `system` fields
   (start position + `system.multiplayer`); it edits NO map layout, so the
   frozen pixel-golden maps are untouched (the derived-project pattern the
   roadmap asks for). Chat is the SAFE default (emotes + preset phrases only —
   no free typing) so the demo shows off the kid-safe posture out of the box.
   GPL-3.0-or-later (see LICENSE). */

/** Kid-friendly co-op preset phrases (the always-on layer, D4). */
export const COOP_DEMO_PRESETS = [
  "Follow me!",
  "Over here!",
  "Nice one!",
  "Need healing!",
  "Let's explore!",
  "To the cave!",
  "Wait for me!",
  "Ready?",
];

/** Driftwood Shore is map 4 in the Atlas Quest showcase; (5,6) is the shore
 *  arrival tile the showcase's own cave passage uses, so it's known-good. */
const SHORE_MAP = 4;
const SHORE_SPAWN = { x: 5, y: 6, dir: "down" };

/** Turn a loaded Atlas Quest project into the co-op demo (in place, returned).
 *  Pure + dependency-free so it runs in Node (the build script) and in the
 *  browser under Playwright (transformProject). */
export function applyCoopDemo(project) {
  const sys = project.system;
  sys.title = "Atlas Quest — Co-op Demo";
  // Meet on the beach: start directly on Driftwood Shore so friends land
  // together (no map edits — just where the game begins).
  sys.startMapId = SHORE_MAP;
  sys.startX = SHORE_SPAWN.x;
  sys.startY = SHORE_SPAWN.y;
  sys.startDir = SHORE_SPAWN.dir;
  sys.multiplayer = {
    enabled: true,
    maxPlayers: 8,
    relayUrl: "", // Driftwood's free relay (friend rooms, zero setup)
    chatMode: "presets", // safest default — emotes + preset phrases, no free typing
    presets: COOP_DEMO_PRESETS.slice(),
    spawns: { [SHORE_MAP]: { ...SHORE_SPAWN } }, // joiners land on the shore too
  };
  return project;
}
