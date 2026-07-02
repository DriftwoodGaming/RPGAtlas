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
import { toTitle } from "./title.js";

export async function gameOver(): Promise<void> {
  ctx.scene = "gameover";
  Music.stop();
  sysSe("gameover");
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
