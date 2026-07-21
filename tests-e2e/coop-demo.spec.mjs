/* RPGAtlas — tests-e2e/coop-demo.spec.mjs
   Project Beacon MP9·C: the Driftwood Shore co-op demo scenario. Proves the
   shared applyCoopDemo transform (scripts/coop-demo-config.mjs — the same one
   build-coop-demo.mjs writes into Atlas_Quest_Coop.json) turns the showcase into
   a working co-op meet-up: the title screen offers "Play Together", the flow
   opens (Create / Join a Room), and a New Game lands friends together on
   Driftwood Shore. Additive — no golden touched (multiplayer is gated, absent in
   the frozen fixtures). GPL-3.0-or-later. */

import { test, expect } from "@playwright/test";
import { gotoWithAtlasQuest } from "./fixtures/atlas-quest.mjs";
import {
  applyCoopDemo,
  COOP_DEMO_PRESETS,
  COOP_DEMO_TROOP,
  COOP_DEMO_DUMMY,
} from "../scripts/coop-demo-config.mjs";

test("co-op demo: title offers Play Together and starts on Driftwood Shore", async ({ page }) => {
  await gotoWithAtlasQuest(page, "/play.html?hd2d=0", { transformProject: applyCoopDemo });
  await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 20_000 });
  // Multiplayer is on → the title offers Play Together (absent in a solo game).
  await expect(page.getByText("Play Together", { exact: true })).toBeVisible();

  await page.getByText("New Game", { exact: true }).click();
  await expect(page.locator(".titlewin")).toHaveCount(0, { timeout: 20_000 });
  await expect
    .poll(() => page.evaluate(() => window.Atlas.atlas.scene === "map" && !!window.Atlas.atlas.player))
    .toBe(true);
  // The demo drops friends onto Driftwood Shore (map 4) — no map was edited.
  await expect.poll(() => page.evaluate(() => window.Atlas.atlas.map.name)).toBe("Driftwood Shore");
});

test("co-op demo: the shore carries a live Practice Dummy battle event (R-2)", async ({ page }) => {
  await gotoWithAtlasQuest(page, "/play.html?hd2d=0", { transformProject: applyCoopDemo });
  await expect(page.getByText("New Game", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByText("New Game", { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.Atlas.atlas.scene === "map" && !!window.Atlas.atlas.player))
    .toBe(true);
  // The LOADED start map — the only map where online battles can fire (R-1) —
  // carries the dummy's action-trigger battle event, with an unconditional
  // page (active from the first frame). mp-relay-battle proves this exact
  // event shape wins a SERVER-side co-op battle end to end; here we prove the
  // shipped demo actually carries it into the running engine.
  const dummy = await page.evaluate(() => {
    const ev = window.Atlas.atlas.map.events.find((e) => e.name === "Practice Dummy");
    const page0 = ev && ev.pages[0];
    return ev && {
      x: ev.x, y: ev.y, trigger: page0.trigger, commands: page0.commands,
      unconditional: page0.cond.switchId === 0 && page0.cond.varId === 0 && page0.cond.selfSw === "",
    };
  });
  expect(dummy).toEqual({
    x: COOP_DEMO_DUMMY.x,
    y: COOP_DEMO_DUMMY.y,
    trigger: "action",
    commands: [{ t: "battle", troopId: COOP_DEMO_TROOP, escape: true, lose: false }],
    unconditional: true,
  });
  // …the troop's enemy resolves in the loaded database (the fight is real) …
  const enemy = await page.evaluate((troopId) => {
    const proj = window.Atlas.atlas.project;
    const troop = proj.troops.find((t) => t.id === troopId);
    return proj.enemies.find((e) => e.id === troop.enemies[0]).name;
  }, COOP_DEMO_TROOP);
  expect(enemy).toBe("Practice Dummy");
  // …and the event's charset key resolves, so the dummy actually DRAWS on the
  // beach (an unknown key would render nothing and kids would act on thin air).
  const charsetIdx = await page.evaluate(() => {
    const ev = window.Atlas.atlas.map.events.find((e) => e.name === "Practice Dummy");
    return window.Atlas.atlas.Assets.charsetIndex(ev.pages[0].charset);
  });
  expect(charsetIdx).toBeGreaterThanOrEqual(0);
});

test("co-op demo: Play Together opens the room flow (Create / Join)", async ({ page }) => {
  await gotoWithAtlasQuest(page, "/play.html?hd2d=0", { transformProject: applyCoopDemo });
  await expect(page.getByText("Play Together", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByText("Play Together", { exact: true }).click();
  // The relay flow modal opens with the friendly Create / Join a Room choices —
  // the "hosted demo room" flow starts here (Create shows a code to share).
  await expect(page.getByText("Create Room", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Join a Room", { exact: true })).toBeVisible();
  // The demo ships the safe defaults (emotes + preset phrases, no free typing);
  // applyCoopDemo (shared with build-coop-demo.mjs) pins the preset list.
  expect(COOP_DEMO_PRESETS.length).toBe(8);
});
