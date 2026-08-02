/* RPGAtlas — src/engine/scenes/gameover.ts
   The game-over scene, extracted verbatim from the js/engine.js monolith
   (Phase 1 Stage B): the GAME OVER panel (confirm key or click to dismiss)
   followed by the return-to-title flow. Self-installs fns.gameOver for the
   map runtime's touch-damage defeat path, encounters, and the battle/
   gameover interpreter commands (which reach it via EngineServices).
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Music } from "../../shared/deps.js";
import { el, sysSe } from "../util.js";
import { pushUI, removeUI } from "../ui-stack.js";
import { ctx, fns } from "../state/engine-context.js";
import { playMe } from "../../shared/audio-deck.js";
import { toTitle } from "./title.js";

/** Ask for a game over from a defeat (a lost battle, a killing touch on the
 *  map). `owner` is the Interp whose event caused it, if any: that run keeps
 *  its turn and the latch is consumed when its command list finishes, so an
 *  authored "you have fallen…" text box plays where it was written instead of
 *  surfacing over the title screen afterwards. With nothing running — a
 *  random encounter, a map hazard — this is the immediate flow it always was.
 *
 *  The explicit "Game Over" event command is deliberately NOT routed here:
 *  there the author has said "end it right now", and the run epoch (bumped by
 *  toTitle) stops the rest of their list instead. */
export function requestGameOver(owner?: any): void {
  if (ctx.scene === "gameover" || ctx.pendingGameOver) return; // already going
  if (owner) {
    ctx.pendingGameOver = owner;
    return;
  }
  void gameOver();
}
fns.requestGameOver = requestGameOver;

export async function gameOver(): Promise<void> {
  // Re-entry guard: the map's touch-damage check runs every frame and a
  // hazard can "kill" an already-dead party again while the panel is up.
  if (ctx.scene === "gameover") return;
  ctx.pendingGameOver = null;
  ctx.scene = "gameover";
  Music.stop();
  // An imported game-over jingle (M4·B, system.music.gameover) plays instead
  // of the procedural sting; absent = the exact pre-M4·B call.
  const jingle = (ctx.proj && ctx.proj.system && ctx.proj.system.music && ctx.proj.system.music.gameover) || "";
  if (jingle) void playMe(jingle);
  else sysSe("gameover");
  const gw = el(
    "div",
    "gameoverwin",
    "<div>GAME OVER</div><div class='go-sub'>press confirm</div>",
  );
  ctx.uiLayer.appendChild(gw);
  await new Promise<void>((resolve) => {
    const ui = {
      el: gw,
      onKey(k: any) {
        if (k === "ok") {
          removeUI(ui);
          resolve();
        }
      },
    };
    gw.addEventListener("click", () => {
      removeUI(ui);
      resolve();
    });
    pushUI(ui);
  });
  await toTitle();
}
fns.gameOver = gameOver;
