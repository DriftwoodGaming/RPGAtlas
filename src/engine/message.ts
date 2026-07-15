/* RPGAtlas — src/engine/message.ts
   Screen fade + message-window wiring, extracted verbatim from the js/engine.js
   monolith (Phase 1 Stage B). The message system itself (control codes,
   typewriter, choices window) lives in js/runtime/messages.js — a classic
   script — and is created here through the deps seam exactly as the monolith
   created it. richText/showMessage/setMsgSpeed are late-bound onto the shared
   engine context so every consumer (menus, save, battle, command handlers)
   sees the live functions. The Plugins object is reached through fns because
   the plugin runtime is extracted in a later step. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, createMessageSystem } from "../shared/deps.js";
import { el, esc, sleep } from "./util.js";
import { pushUI, removeUI } from "./ui-stack.js";
import { ctx, fns } from "./state/engine-context.js";
import { G } from "./state/game-state.js";

export async function fadeTo(opacity: any, ms: any): Promise<void> {
  ctx.fader.style.transitionDuration = ms + "ms";
  ctx.fader.style.opacity = opacity;
  await sleep(ms + 30);
}

/** Create the message system (typewriter, control codes, name box) and bind
 *  its entry points onto the shared context. Called by the engine body at the
 *  exact point the monolith destructured createMessageSystem(). */
export function initMessageSystem(): void {
  const { richText, showMessage, setTextSpeed } = createMessageSystem({
    Assets,
    RA,
    el,
    esc,
    getPlugins: () => fns.Plugins,
    getProject: () => ctx.proj,
    getState: () => G,
    getUiLayer: () => ctx.uiLayer,
    pushUI,
    removeUI,
  });
  ctx.richText = richText;
  ctx.showMessage = showMessage;
  ctx.setMsgSpeed = setTextSpeed;
}
