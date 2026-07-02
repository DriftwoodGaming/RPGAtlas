/* RPGAtlas — src/engine/interpreter/commands/flow.ts
   Control-flow + dialogue interpreter commands (Phase 1 Stage B), extracted
   verbatim from the monolith's Interp.exec switch: text, choices, if,
   commonEvent, wait, script. Behavior unchanged — same control codes, same
   silent-skip on unknown types (handled by the registry). GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { registerCommand, type InterpContext } from "../registry.js";

export function registerFlowCommands(): void {
  registerCommand("text", async (c: any, { services }: InterpContext) => {
    await services.showMessage(c.name, c.text, c.face);
  });

  registerCommand("choices", async (c: any, { interp, services }: InterpContext) => {
    const i = await services.showList(
      c.options.map((o: any) => ({ html: services.richText(o) })),
      { className: "choicewin", cancellable: false },
    );
    await interp.runList(c.branches[i] || []);
  });

  registerCommand("if", async (c: any, { interp }: InterpContext) => {
    const ok2 = interp.testCond(c.cond);
    await interp.runList(ok2 ? c.then : c.else);
  });

  // Phase 4 (Atlas Graph): structured loop + break. `loop` re-runs its body
  // until a breakLoop inside it sets interp.breakLoop (runList unwinds on the
  // flag; the innermost loop consumes it). Safety valve: a body that never
  // awaited a frame yields one frame every 1000 iterations, so a wait-less
  // loop degrades to ~60k iterations/s instead of freezing the tab.
  registerCommand("loop", async (c: any, { interp, services }: InterpContext) => {
    let spins = 0;
    for (;;) {
      await interp.runList(c.body || []);
      if (interp.breakLoop) {
        interp.breakLoop = false;
        return;
      }
      if (++spins % 1000 === 0) await services.waitFrames(1);
    }
  });

  registerCommand("breakLoop", (_c: any, { interp }: InterpContext) => {
    interp.breakLoop = true;
  });

  registerCommand("commonEvent", async (c: any, { interp }: InterpContext) => {
    await interp.callCommonEvent(c.commonEventId);
  });

  registerCommand("wait", async (c: any, { services }: InterpContext) => {
    await services.waitFrames(c.frames || 30);
  });

  registerCommand("script", async (c: any, { interp, services }: InterpContext) => {
    try {
      const api = Object.create(services.scriptApi);
      api.callCommonEvent = (id: any) => interp.callCommonEvent(id);
      const result = new Function("game", c.code)(api);
      if (result && typeof result.then === "function") await result;
    } catch (e) {
      console.error("Script command error:", e);
    }
    services.refreshAllPages();
  });
}
