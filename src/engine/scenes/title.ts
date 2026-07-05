/* RPGAtlas — src/engine/scenes/title.ts
   The title scene, extracted verbatim from the js/engine.js monolith
   (Phase 1 Stage B): new-game state reset, the return-to-title flow (fade,
   UI teardown), the title screen (name, "made with RPGAtlas" sub, New Game /
   Continue / Options menu), and the procedural canvas backdrop (hills,
   pines, stars, compass-rose watermark). Logic unchanged; mutable engine
   state goes through the shared context. Self-installs fns.toTitle for the
   pause menu's return-to-title item. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, Music } from "../../shared/deps.js";
import { el, esc, sysBgm } from "../util.js";
import { UIStack, removeUI, showList } from "../ui-stack.js";
import { ctx, fns } from "../state/engine-context.js";
import { G, makeActor } from "../state/game-state.js";
import { slotInfo, saveLoadMenu } from "../state/save.js";
import { loadMap, initPlayer, syncFollowers } from "./map-runtime.js";
import { resetPresentation } from "./presentation-runtime.js";
import { optionsMenu } from "./menus.js";
import { fadeTo } from "../message.js";
import { render } from "../render-glue.js";

/** `start` overrides the System start position — the editor Console's
 *  "playtest <map> <x> <y>" boots straight there (playtest-bridge.ts). */
export async function newGame(start?: { mapId: number; x: number; y: number }): Promise<void> {
  ctx.commonParallels.clear();
  G.switches = {};
  G.vars = {};
  G.selfSw = {};
  G.quests = {};
  G.gold = ctx.proj.system.startGold || 0;
  G.inv = { item: {}, weapon: {}, armor: {} };
  G.party = (ctx.proj.system.party || [])
    .slice(0, 4)
    .map(makeActor)
    .filter(Boolean);
  if (!G.party.length && ctx.proj.actors.length)
    G.party = [makeActor(ctx.proj.actors[0].id)];
  G.steps = 0;
  G.timeOfDay = 12; // fresh day/night clock (loadMap applies the map's pin below)
  G.vehicles = {}; // fresh vehicle placements (lazily seeded from System)
  G.vehicle = null;
  ctx.cameraZoom = 1;
  resetPresentation(); // clear pictures/tint/timer/scroll (Project Compass M2·A)
  initPlayer(
    start ? start.x : ctx.proj.system.startX,
    start ? start.y : ctx.proj.system.startY,
    ctx.proj.system.startDir,
  );
  G.player.transparent = !!ctx.proj.system.startTransparent;
  await loadMap(start ? start.mapId : ctx.proj.system.startMapId);
  syncFollowers(true);
  ctx.scene = "map";
}

export async function toTitle(): Promise<void> {
  await fadeTo(1, 350);
  ctx.scene = "title";
  // clear leftover UI
  while (UIStack.length) removeUI(UIStack[UIStack.length - 1]);
  ctx.uiLayer
    .querySelectorAll(".battlewin, .menupanel")
    .forEach((n: any) => n.remove());
  showTitle();
  await fadeTo(0, 350);
}
// The pause menu's "Return to title" reaches this scene through fns.
fns.toTitle = toTitle;

export async function showTitle(): Promise<void> {
  Music.play(sysBgm("title"));
  const tw = el("div", "titlewin");
  tw.appendChild(
    el("div", "title-name", esc(ctx.proj.system.title || "Untitled")),
  );
  tw.appendChild(el("div", "title-sub", "made with RPGAtlas"));
  ctx.uiLayer.appendChild(tw);
  // decorative title backdrop on the canvas
  drawTitleBackdrop();
  while (true) {
    const hasSave = [1, 2, 3].some((s) => slotInfo(s));
    const i = await showList(
      [
        { label: "New Game" },
        { label: "Continue", disabled: !hasSave },
        { label: "Options" },
      ],
      { className: "titlemenu", cancellable: false },
    );
    if (i === 0) {
      tw.remove();
      await fadeTo(1, 300);
      await newGame();
      await render();
      await fadeTo(0, 300);
      return;
    } else if (i === 1) {
      const ok2 = await saveLoadMenu("load");
      if (ok2) {
        tw.remove();
        await render();
        await fadeTo(0, 300);
        return;
      }
    } else if (i === 2) {
      await optionsMenu();
    }
  }
}
function drawTitleBackdrop(): void {
  const g = ctx.g2d;
  const grad = g.createLinearGradient(0, 0, 0, ctx.SCREEN_H);
  grad.addColorStop(0, "#1a2340");
  grad.addColorStop(1, "#2c4a3a");
  g.fillStyle = grad;
  g.fillRect(0, 0, ctx.SCREEN_W, ctx.SCREEN_H);
  // procedural hills + trees
  g.fillStyle = "#22382c";
  g.beginPath();
  g.moveTo(0, ctx.SCREEN_H);
  for (let x = 0; x <= ctx.SCREEN_W; x += 40) {
    g.lineTo(x, ctx.SCREEN_H - 90 - 40 * Math.sin(x / 130));
  }
  g.lineTo(ctx.SCREEN_W, ctx.SCREEN_H);
  g.fill();
  for (let i = 0; i < 9; i++) {
    const x = 40 + i * 88,
      y = ctx.SCREEN_H - 60 - 30 * Math.sin(x / 130);
    Assets.drawTile(g, Assets.T.pine, x, y - 30);
  }
  g.fillStyle = "rgba(255,255,230,0.85)";
  for (let i = 0; i < 40; i++) {
    g.fillRect((i * 211) % ctx.SCREEN_W, (i * 137) % (ctx.SCREEN_H - 200), 2, 2);
  }
  // faint compass-rose watermark (the RPGAtlas motif)
  g.save();
  g.translate(ctx.SCREEN_W - 120, 130);
  g.globalAlpha = 0.16;
  g.strokeStyle = g.fillStyle = "#ffe2a0";
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, 70, 0, 6.2832);
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 56, 0, 6.2832);
  g.stroke();
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(0, -64);
    g.lineTo(9, 0);
    g.lineTo(0, 64);
    g.lineTo(-9, 0);
    g.closePath();
    g.fill();
    g.rotate(Math.PI / 4);
    g.globalAlpha = i % 2 === 0 ? 0.09 : 0.16; // diagonals fainter than cardinals
  }
  g.restore();
}
