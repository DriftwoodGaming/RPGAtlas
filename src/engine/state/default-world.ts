/* RPGAtlas — src/engine/state/default-world.ts
   Project Beacon MP1·A: THE default world — the one simulation a solo
   session runs. The compat shim binds the engine's historical module-level
   names to this instance: `G` (game-state.ts) is defaultWorld.g, the world
   slice of `ctx` (engine-context.ts) delegates here via accessors, and the
   gameplay RNG (util.ts rnd/rndf/seedRnd, with the ?rngseed= /
   window.AtlasRng hooks) draws from this world's stream. Servers never
   import this module — they call createWorld() per room; this file IS the
   solo/client binding, so the sim itself stays instanced and headless.
   GPL-3.0-or-later (see LICENSE). */

import { createWorld, type World } from "../../shared/sim/world.js";

/** The solo session's world instance. Created unseeded (Math.random), then
 *  util.ts's pre-boot hook seeds it when ?rngseed= / RPGATLAS_RNG_SEED is
 *  present — the exact old module-eval ordering, so seeded e2e runs draw
 *  the identical roll sequence. */
export const defaultWorld: World = createWorld(null);
