/* RPGAtlas — scripts/coop-demo-config.mjs
   Project Beacon MP9·C: the Driftwood Shore co-op demo scenario, as a single
   shared transform so the built demo file (build-coop-demo.mjs) and the
   showcase e2e (tests-e2e/coop-demo.spec.mjs) can never drift apart.

   It turns the bundled "Atlas Quest" showcase into a co-op meet-up on
   DRIFTWOOD SHORE (map 4) — friends spawn together on the beach, wave and use
   preset phrases, party up, explore, and FIGHT together: a frail Practice
   Dummy (a sparkling crystal a couple of tiles from the spawn) carries an
   action-trigger Battle event, so a partied pair can Team Up and win a shared
   server-side battle right on the shore (re-gate finding R-2 — online battles
   fire ONLY from authored battle events on the start map, so the demo must
   ship one). The transform sets `system` fields (start position +
   `system.multiplayer`) and makes three ADDITIVE inserts (enemy 900, troop
   900, one shore event); it edits NO tile layer, so the frozen pixel-golden
   maps are untouched (the derived-project pattern the roadmap asks for). The
   event/enemy/troop shape mirrors tests-e2e/mp-relay-battle.spec.mjs
   setupBattle — the exact shape the shipped relay battle e2e proves. Chat is
   the SAFE default (emotes + preset phrases only — no free typing) so the
   demo shows off the kid-safe posture out of the box.
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

/** The practice fight (R-2): id 900 is far above the showcase's own DB ids, so
 *  the inserts are collision-free; (7,7) is open sand two tiles from the spawn
 *  — visible at boot, but not blocking the spawn tile's neighbours. */
export const COOP_DEMO_TROOP = 900;
export const COOP_DEMO_DUMMY = { x: 7, y: 7 };

/** Add the Practice Dummy enemy + troop + the shore battle event (in place).
 *  Additive only — nothing existing is touched, and every insert is skipped if
 *  already present so the transform stays idempotent. */
function addPracticeDummy(project) {
  if (!project.enemies.some((e) => e.id === COOP_DEMO_TROOP)) {
    project.enemies.push({
      id: COOP_DEMO_TROOP,
      name: "Practice Dummy",
      sprite: "crystal", // matches the on-map crystal charset
      color: "#d8b04f",
      stats: { mhp: 6, mmp: 0, atk: 1, def: 0, mat: 0, mdf: 0, agi: 1 },
      exp: 30,
      gold: 15,
      actions: [{ skillId: 0, weight: 5 }],
    });
  }
  if (!project.troops.some((t) => t.id === COOP_DEMO_TROOP)) {
    project.troops.push({ id: COOP_DEMO_TROOP, name: "Practice Dummy", enemies: [COOP_DEMO_TROOP], pages: [] });
  }

  const shore = project.maps.find((m) => m.id === SHORE_MAP);
  if (shore.events.some((e) => e.name === "Practice Dummy")) return;
  const nextId = 1 + Math.max(0, ...shore.events.map((e) => e.id | 0));
  shore.events.push({
    id: nextId,
    name: "Practice Dummy",
    x: COOP_DEMO_DUMMY.x,
    y: COOP_DEMO_DUMMY.y,
    pages: [{
      name: "",
      cond: { switchId: 0, varId: 0, varVal: 0, selfSw: "", questId: 0, questStatus: "active", objectiveQuestId: 0, objectiveIndex: 0, objectiveStatus: "completed" },
      charset: "crystal",
      dir: 0,
      moveType: "fixed",
      trigger: "action",
      priority: "same",
      through: false,
      combat: { enabled: false, enemyId: 0, hp: 0, touchDamage: 0, knockbackTiles: 1, invulnFrames: 24, defeatSelfSwitch: "" },
      commands: [{ t: "battle", troopId: COOP_DEMO_TROOP, escape: true, lose: false }],
    }],
  });
}

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
  addPracticeDummy(project); // something to FIGHT together (R-2)
  return project;
}
