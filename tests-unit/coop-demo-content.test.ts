/* RPGAtlas — tests-unit/coop-demo-content.test.ts
   Post-2.0.0 content patch (re-gate finding R-2, docs/mp-9-spec.md §RELEASE
   RE-GATE): the co-op demo must ship something to FIGHT. Online battles fire
   ONLY from authored battle events on the room's start map (R-1), so the demo
   transform (scripts/coop-demo-config.mjs) now plants a Practice Dummy battle
   event on the Driftwood Shore spawn beach.

   Guards here:
   · the transform stays ADDITIVE (no existing DB entry or event touched, no
     tile layer edited — frozen goldens depend on it),
   · the dummy is REACHABLE: baked with the real server collision core
     (src/shared/sim/collision.ts), its tile and all four neighbours are
     walkable, so a player can face it from any side and act,
   · the shipped Atlas_Quest_Coop.json is in LOCK-STEP with the transform (a
     forgotten `node scripts/build-coop-demo.mjs` rerun fails here),
   · the transform is idempotent (safe to apply to an already-transformed
     project). GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { bakeMapCollision, isPassable } from "../src/shared/sim/collision";
import {
  applyCoopDemo,
  COOP_DEMO_TROOP,
  COOP_DEMO_DUMMY,
} from "../scripts/coop-demo-config.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const loadQuest = (): any => JSON.parse(readFileSync(join(REPO, "Atlas_Quest.json"), "utf8"));

describe("R-2 co-op demo battle content", () => {
  const base = loadQuest();
  const demo = applyCoopDemo(loadQuest());
  const shore = demo.maps.find((m: any) => m.id === demo.system.startMapId);

  it("adds the Practice Dummy enemy + troop additively (no showcase id touched)", () => {
    const enemy = demo.enemies.find((e: any) => e.id === COOP_DEMO_TROOP);
    const troop = demo.troops.find((t: any) => t.id === COOP_DEMO_TROOP);
    expect(enemy).toBeTruthy();
    expect(troop).toBeTruthy();
    expect(troop.enemies).toEqual([COOP_DEMO_TROOP]);
    // additive: every original id is still present, exactly once
    expect(demo.enemies.map((e: any) => e.id)).toEqual([...base.enemies.map((e: any) => e.id), COOP_DEMO_TROOP]);
    expect(demo.troops.map((t: any) => t.id)).toEqual([...base.troops.map((t: any) => t.id), COOP_DEMO_TROOP]);
    // frail on purpose — a kid's first shared battle should end in one round
    expect(enemy.stats.mhp).toBeLessThanOrEqual(10);
    expect(enemy.stats.atk).toBeLessThanOrEqual(1);
  });

  it("plants an action-trigger battle EVENT on the START map (the only place online battles fire)", () => {
    const ev = shore.events.find((e: any) => e.name === "Practice Dummy");
    expect(ev).toBeTruthy();
    expect(ev.x).toBe(COOP_DEMO_DUMMY.x);
    expect(ev.y).toBe(COOP_DEMO_DUMMY.y);
    const page = ev.pages[0];
    expect(page.trigger).toBe("action");
    expect(page.commands).toEqual([{ t: "battle", troopId: COOP_DEMO_TROOP, escape: true, lose: false }]);
    // unconditional page — active from the first frame of the demo
    expect(page.cond.switchId).toBe(0);
    expect(page.cond.varId).toBe(0);
    // event id is fresh and its tile clashes with no showcase event
    const baseShore = base.maps.find((m: any) => m.id === shore.id);
    expect(baseShore.events.some((e: any) => e.id === ev.id)).toBe(false);
    expect(baseShore.events.some((e: any) => e.x === ev.x && e.y === ev.y)).toBe(false);
    // the shore's tile layers are byte-identical to the showcase (frozen goldens)
    expect(shore.layers).toEqual(baseShore.layers);
    expect(shore.passOv).toEqual(baseShore.passOv);
  });

  it("is REACHABLE: dummy tile + all four neighbours walkable per the real collision baker", () => {
    const mc = bakeMapCollision(demo, shore);
    const { x, y } = COOP_DEMO_DUMMY;
    for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      expect(isPassable(mc, x + dx, y + dy), `tile (${x + dx},${y + dy})`).toBe(true);
    }
    // the meet-up spawn itself is walkable and is not the dummy's tile
    expect(isPassable(mc, demo.system.startX, demo.system.startY)).toBe(true);
    expect(demo.system.startX !== x || demo.system.startY !== y).toBe(true);
  });

  it("Atlas_Quest_Coop.json on disk is in lock-step with the transform", () => {
    const shipped = JSON.parse(readFileSync(join(REPO, "Atlas_Quest_Coop.json"), "utf8"));
    expect(shipped).toEqual(demo);
  });

  it("applies idempotently", () => {
    expect(applyCoopDemo(applyCoopDemo(loadQuest()))).toEqual(demo);
  });
});
