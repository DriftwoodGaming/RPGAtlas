/* RPGAtlas — src/shared/move-route.ts
   Character movement rules shared by BOTH event runtimes: the map scene
   (src/engine/scenes/map.ts + map-runtime.ts, which renders) and the headless
   zone driver (src/engine/net/zone-event-runtime.ts, which serves a
   multiplayer world). Those two files each carry their own copy of the update
   scheduler for good reasons (one is render-coupled, one must bundle
   headless), and the copies had already drifted — the zone's move routes only
   understood half the steps the map's did. Anything that decides WHERE a
   character may step, or WHAT a route step means, lives here instead, so the
   two runtimes cannot disagree again.

   Pure module: no DOM, no engine imports, no ambient RNG (the caller injects
   its world's seedable stream). Copyright (C) 2026 RPGAtlas contributors —
   GPL-3.0-or-later (see LICENSE). */

// ---------------------------------------------------------------------------
// The wander leash (post-2.0)
// ---------------------------------------------------------------------------

/** How far a random-moving event may stray from the tile it was placed on.
 *  Measured as "tiles away in any direction" (a square around home, so 3 is
 *  the 7×7 box centred on the spawn) — the shape a kid draws when they say
 *  "stay near your house". 0 / absent = no leash, which is every event
 *  authored before this existed. */
export function homeDistance(x: number, y: number, homeX: number, homeY: number): number {
  return Math.max(Math.abs(x - homeX), Math.abs(y - homeY));
}

/** May this character step onto (nx, ny) without breaking its leash?
 *  Outside the leash already (a move route walked it out, or the author moved
 *  the spawn) it may still move — but only closer to home, so it finds its way
 *  back instead of freezing where it stands. */
export function withinLeash(
  nx: number,
  ny: number,
  x: number,
  y: number,
  homeX: number,
  homeY: number,
  maxDistance: number,
): boolean {
  const max = Number(maxDistance) || 0;
  if (max <= 0) return true; // no leash configured — classic behaviour
  const next = homeDistance(nx, ny, homeX, homeY);
  if (next <= max) return true;
  return next < homeDistance(x, y, homeX, homeY); // heading home is always allowed
}

/** The slice of an event runtime (evRT) the leash reads. Both runtimes build
 *  a much larger untyped object; this is the contract they share. */
export interface EventRuntimeLike {
  x: number;
  y: number;
  /** The MapEvent — `ev.x`/`ev.y` are the authored spawn tile. */
  ev?: { x?: number; y?: number };
  page?: { maxDistance?: number } | null;
}

/** The leash for an event runtime: its page's `maxDistance` measured from the
 *  tile the event was PLACED on in the editor (rt.ev.x/y — the authored spawn,
 *  which never moves). Both runtimes call this from their random-walk and
 *  chase branches. */
export function eventMayStep(rt: EventRuntimeLike, nx: number, ny: number): boolean {
  const max = rt && rt.page ? Number(rt.page.maxDistance) || 0 : 0;
  if (max <= 0) return true;
  const ev = rt.ev || {};
  return withinLeash(nx, ny, rt.x, rt.y, Number(ev.x) || 0, Number(ev.y) || 0, max);
}

// ---------------------------------------------------------------------------
// Move routes (post-2.0)
// ---------------------------------------------------------------------------

/* A move route is a sequenced pattern a character plays: the tool you reach
   for to stage a cutscene. Before this the engine understood twelve step
   tokens; the palette below is the full one, so an imported RPG Maker route
   survives intact and an Atlas author can write "walk to the door, turn to
   face the player, wait a beat, fade out" without a single Wait command.

   The payload stays BACKWARD COMPATIBLE: a step may be a plain string (every
   route saved before this is exactly that) or an object `{k, …}` for the
   steps that carry a value. `normalizeStep` maps either onto one shape. */

/** Direction ids, shared with the runtimes' DIRD / DIR_OFFSET tables:
 *  0 down · 1 left · 2 right · 3 up · 4 down-left · 5 down-right ·
 *  6 up-left · 7 up-right. */
export const ROUTE_DIR_OFFSET: Record<number, [number, number]> = {
  0: [0, 1], 1: [-1, 0], 2: [1, 0], 3: [0, -1],
  4: [-1, 1], 5: [1, 1], 6: [-1, -1], 7: [1, -1],
};

/** Named single-token steps → the direction they move in. */
const STEP_DIR: Record<string, number> = {
  down: 0, left: 1, right: 2, up: 3,
  downleft: 4, downright: 5, upleft: 6, upright: 7,
};
/** Named single-token steps → the direction they turn to face. */
const TURN_DIR: Record<string, number> = {
  turn_down: 0, turn_left: 1, turn_right: 2, turn_up: 3,
};
/** Clockwise cardinal order (down → left → up → right) for the relative turns. */
const CLOCKWISE = [0, 1, 3, 2];

export interface RouteStep {
  k: string;
  [key: string]: unknown;
}

/** One authored step in either accepted form → the `{k, …}` shape the machine
 *  runs. Unknown tokens normalize to `{k: "<token>"}` and are skipped by the
 *  machine, exactly as an unknown token was ignored before. */
export function normalizeStep(step: unknown): RouteStep {
  if (step && typeof step === "object") {
    const obj = step as Record<string, unknown>;
    return { ...obj, k: String(obj.k ?? "") };
  }
  return { k: String(step ?? "") };
}

/** A one-line human description of a step — the editor's route list and the
 *  command summary both read from here, so they can never describe a step the
 *  machine runs differently. */
export function describeStep(step: unknown): string {
  const s = normalizeStep(step);
  const n = (key: string, fallback = 0) => Number(s[key] ?? fallback) || fallback;
  switch (s.k) {
    case "forward": return "step forward";
    case "back": return "step backward";
    case "random": return "step in a random direction";
    case "toward": return "step toward the player";
    case "away": return "step away from the player";
    case "turn_r90": return "turn 90° right";
    case "turn_l90": return "turn 90° left";
    case "turn_180": return "turn around";
    case "turn_random": return "turn a random way";
    case "turn_toward": return "face the player";
    case "turn_away": return "face away from the player";
    case "jump": return s.dx == null && s.dy == null
      ? "jump forward"
      : `jump ${n("dx")}, ${n("dy")}`;
    case "wait": return `wait ${n("frames", 15)} frames`;
    case "wait15": return "wait 15 frames";
    case "wait60": return "wait 60 frames";
    case "speed": return `move speed ${n("value", 3)}`;
    case "opacity": return `opacity ${n("value", 255)}`;
    case "graphic": return `change graphic to ${String(s.charset || "(none)")}`;
    case "se": return `play sound ${String(s.name || "")}`;
    case "switch": return `switch ${n("id")} ${s.on === false ? "OFF" : "ON"}`;
    case "walk_on": return "walking animation on";
    case "walk_off": return "walking animation off";
    case "step_on": return "stepping animation on";
    case "step_off": return "stepping animation off";
    case "dirfix_on": return "keep facing (direction fix on)";
    case "dirfix_off": return "direction fix off";
    case "through_on": return "walk through walls on";
    case "through_off": return "walk through walls off";
    case "transparent_on": return "become invisible";
    case "transparent_off": return "become visible";
    default:
      if (STEP_DIR[s.k] != null) return "step " + s.k;
      if (TURN_DIR[s.k] != null) return "face " + s.k.slice(5);
      return s.k || "(nothing)";
  }
}

/** What a runtime must be able to do for the machine to drive a character.
 *  The map scene and the headless zone driver each supply their own. */
export interface RouteOps {
  /** May this character stand on (x, y)? */
  canStep(ent: any, x: number, y: number): boolean; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Begin a one-tile step in `dir`. */
  startMove(ent: any, dir: number): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Begin a jump of (dx, dy) tiles; (0, 0) hops in place. Absent ⇒ jumps
   *  degrade to a plain step (the headless zone has no hop arc). */
  startJump?(ent: any, dx: number, dy: number): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Where the player is standing, for toward/away/face-player. */
  playerTile?(): { x: number; y: number } | null;
  /** Random integer in [0, n) from the world's seedable stream. */
  rnd(n: number): number;
  playSe?(name: string): void;
  setSwitch?(id: number, on: boolean): void;
  /** Swap the character's spritesheet (the runtime owns the key → index map). */
  setGraphic?(ent: any, charset: string): void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** A blocked step on a non-skippable route retries — but never forever. Five
 *  seconds at 60fps is long enough for a wandering NPC to get out of the way
 *  and short enough that a cutscene can't hard-lock a young player's game. */
export const ROUTE_BLOCKED_GIVE_UP = 300;

/** The route a character is playing. Created by setRoute in each runtime. */
export interface RouteState {
  steps: unknown[];
  idx: number;
  wait: number;
  onDone?: (() => void) | null;
  /** Start again from the top instead of ending (never resolves onDone). */
  repeat?: boolean;
  /** A blocked step is dropped (default, and how routes always behaved).
   *  false = retry the step until it clears or ROUTE_BLOCKED_GIVE_UP ticks. */
  skippable?: boolean;
  /** Pause inserted after every step ("Change Frequency"), in frames. */
  gap?: number;
  /** Click-to-move pathing: an obstruction cancels the whole route. */
  touch?: boolean;
  /** Ticks spent retrying the current blocked step (non-skippable only). */
  blocked?: number;
}

/** Advance a character's route by one tick. Call only when the character is
 *  standing still (not mid-step, not mid-jump) — both runtimes already gate on
 *  that. Returns true if the route ended on this tick. */
export function advanceRoute(ent: any, ops: RouteOps): boolean { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r: RouteState | null = ent.route;
  if (!r) return false;
  if (r.wait > 0) {
    r.wait--;
    return false;
  }
  if (r.idx >= r.steps.length) {
    if (r.repeat && r.steps.length) {
      r.idx = 0; // loop forever until something replaces the route
    } else {
      ent.route = null;
      if (r.onDone) r.onDone();
      return true;
    }
  }
  const step = normalizeStep(r.steps[r.idx]);
  const moved = runStep(ent, step, r, ops);
  if (moved === "retry") {
    // Non-skippable and blocked: stay on this step until the way clears.
    r.blocked = (r.blocked || 0) + 1;
    if (r.blocked < ROUTE_BLOCKED_GIVE_UP) return false;
  }
  r.blocked = 0;
  r.idx++;
  if (r.gap && moved !== "none") r.wait = Math.max(r.wait, r.gap);
  return false;
}

/** Run one step. "moved" = the character started moving/jumping, "none" = an
 *  instant step (a turn, a flag), "retry" = blocked and worth another try. */
function runStep(ent: any, s: RouteStep, r: RouteState, ops: RouteOps): "moved" | "none" | "retry" { // eslint-disable-line @typescript-eslint/no-explicit-any
  const num = (key: string, fallback: number) => {
    const v = Number(s[key]);
    return Number.isFinite(v) ? v : fallback;
  };
  const player = ops.playerTile ? ops.playerTile() : null;
  /** Try to move one tile in `dir`; honours skippable / touch-cancel. */
  const step = (dir: number): "moved" | "none" | "retry" => {
    if (dir < 0) return "none";
    const [dx, dy] = ROUTE_DIR_OFFSET[dir] || [0, 0];
    if (ops.canStep(ent, ent.x + dx, ent.y + dy)) {
      ops.startMove(ent, dir);
      return "moved";
    }
    // Blocked. Click-to-move gives up entirely; an authored route either drops
    // the step (the historic behaviour) or waits for the way to clear.
    if (r.touch) {
      ent.route = null;
      return "none";
    }
    if (r.skippable === false) return "retry";
    // A dropped step still turns the character, like RPG Maker.
    if (!ent.dirFix) ent.dir = dir;
    return "none";
  };
  /** The cardinal that points from the character toward (or away from) the player. */
  const facePlayer = (away: boolean): number => {
    if (!player) return -1;
    const dx = player.x - ent.x;
    const dy = player.y - ent.y;
    if (dx === 0 && dy === 0) return -1;
    let dir: number;
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 2 : 1;
    else dir = dy > 0 ? 0 : 3;
    if (!away) return dir;
    return dir === 0 ? 3 : dir === 3 ? 0 : dir === 1 ? 2 : 1;
  };
  const turn = (dir: number): "none" => {
    if (dir >= 0) ent.dir = dir;
    return "none";
  };

  if (STEP_DIR[s.k] != null) return step(STEP_DIR[s.k]);
  if (TURN_DIR[s.k] != null) return turn(TURN_DIR[s.k]);

  switch (s.k) {
    case "forward": return step(ent.dir);
    case "back": {
      // Backward keeps the facing, so a character can retreat while watching.
      const d = ent.dir;
      const back = d === 0 ? 3 : d === 3 ? 0 : d === 1 ? 2 : d === 2 ? 1 : d;
      const fix = ent.dirFix;
      ent.dirFix = true;
      const out = step(back);
      ent.dirFix = fix;
      ent.dir = d;
      return out;
    }
    case "random": return step(ops.rnd(4));
    case "toward": return step(facePlayer(false));
    case "away": return step(facePlayer(true));
    case "turn_r90": return turn(CLOCKWISE[(CLOCKWISE.indexOf(cardinal(ent.dir)) + 1) % 4]);
    case "turn_l90": return turn(CLOCKWISE[(CLOCKWISE.indexOf(cardinal(ent.dir)) + 3) % 4]);
    case "turn_180": {
      const d = cardinal(ent.dir);
      return turn(d === 0 ? 3 : d === 3 ? 0 : d === 1 ? 2 : 1);
    }
    case "turn_random": return turn(ops.rnd(4));
    case "turn_toward": return turn(facePlayer(false));
    case "turn_away": return turn(facePlayer(true));
    case "jump": {
      const [fx, fy] = ROUTE_DIR_OFFSET[ent.dir] || [0, 0];
      // A bare "jump" is the historic hop: two tiles ahead, one if that's
      // blocked, in place if both are. A parameterized jump goes where it says.
      const dx = s.dx == null && s.dy == null ? null : num("dx", 0);
      const dy = s.dx == null && s.dy == null ? null : num("dy", 0);
      if (!ops.startJump) {
        // No hop arc in this runtime (headless zone): walk the first tile.
        if (dx == null) return step(ent.dir);
        return "none";
      }
      if (dx == null) {
        if (ops.canStep(ent, ent.x + fx * 2, ent.y + fy * 2)) ops.startJump(ent, fx * 2, fy * 2);
        else if (ops.canStep(ent, ent.x + fx, ent.y + fy)) ops.startJump(ent, fx, fy);
        else ops.startJump(ent, 0, 0);
        return "moved";
      }
      const jy = dy == null ? 0 : dy;
      if (dx === 0 && jy === 0) { ops.startJump(ent, 0, 0); return "moved"; }
      if (!ops.canStep(ent, ent.x + dx, ent.y + jy)) {
        if (r.skippable === false) return "retry";
        return "none";
      }
      ops.startJump(ent, dx, jy);
      return "moved";
    }
    case "wait": r.wait = Math.max(0, num("frames", 15)); return "none";
    case "wait15": r.wait = 15; return "none";
    case "wait60": r.wait = 60; return "none";
    case "speed": {
      // 1 (slowest) … 6 (fastest) → tiles per frame, the `speed` both runtimes
      // feed to their motion integrator (0.05 ≈ the authored default, 3).
      const level = Math.max(1, Math.min(6, Math.round(num("value", 3))));
      ent.speed = ROUTE_SPEEDS[level - 1];
      return "none";
    }
    case "freq": r.gap = ROUTE_GAPS[Math.max(1, Math.min(5, Math.round(num("value", 3)))) - 1]; return "none";
    case "opacity": ent.opacity = Math.max(0, Math.min(255, Math.round(num("value", 255)))); return "none";
    case "graphic": if (ops.setGraphic) ops.setGraphic(ent, String(s.charset || "")); return "none";
    case "se": if (ops.playSe) ops.playSe(String(s.name || "")); return "none";
    case "switch": if (ops.setSwitch) ops.setSwitch(num("id", 0), s.on !== false); return "none";
    case "walk_on": ent.walkAnim = true; return "none";
    case "walk_off": ent.walkAnim = false; return "none";
    case "step_on": ent.stepAnim = true; return "none";
    case "step_off": ent.stepAnim = false; return "none";
    case "dirfix_on": ent.dirFix = true; return "none";
    case "dirfix_off": ent.dirFix = false; return "none";
    case "through_on": ent.routeThrough = true; return "none";
    case "through_off": ent.routeThrough = false; return "none";
    case "transparent_on": ent.transparent = true; return "none";
    case "transparent_off": ent.transparent = false; return "none";
    default: return "none"; // unknown token — ignored, as it always was
  }
}

/** Diagonal facings collapse to the cardinal they lean on, so a relative turn
 *  from a diagonal is still one of the four the sprite sheets draw. */
function cardinal(dir: number): number {
  const d = Number(dir) || 0;
  if (d <= 3) return d;
  return d === 4 || d === 5 ? 0 : 3; // down-left/down-right → down, else up
}

/** Move speeds 1–6 in tiles per frame. 3 is the authored default (0.05, the
 *  value every entity is created with), and each level is roughly half or
 *  double its neighbour, like RPG Maker's ×2 ladder. */
export const ROUTE_SPEEDS = [0.0125, 0.025, 0.05, 0.1, 0.2, 0.4];
/** Frequencies 1–5 as the pause between steps, in frames (5 = no pause). */
export const ROUTE_GAPS = [60, 30, 15, 5, 0];
