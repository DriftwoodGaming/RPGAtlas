/* RPGAtlas — src/engine/interpreter/commands/world.ts
   World/scene interpreter commands (Phase 1 Stage B), extracted verbatim from
   the monolith's Interp.exec switch: transfer, move, save, gameover, totitle.
   Vehicle commands joined in Project Compass M4·A (RM 202/206/323). Scene
   transitions and routing go through the engine services surface.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { registerCommand, type InterpContext } from "../registry.js";

const num = (v: any): number => (typeof v === "number" ? v : Number(v) || 0);

export function registerWorldCommands(): void {
  registerCommand("transfer", async (c: any, { services }: InterpContext) => {
    await services.transferPlayer(c.mapId, c.x, c.y, c.dir);
  });

  // Set Move Route. `target` is "player", "this" (the running event) or
  // "other" with an `eventId` — the third is new, and is what makes a route a
  // cutscene tool: one event can walk the whole cast. Options ride alongside:
  // repeat (loop until something replaces it), skippable (a blocked step is
  // dropped rather than waited on), and gap (the pause between steps).
  registerCommand("move", async (c: any, { interp, state, services }: InterpContext) => {
    // Anything that isn't "player" and doesn't name another event is the
    // running event, which is what every route saved before this was.
    const otherId = c.target === "other" || Number(c.eventId) > 0 ? Number(c.eventId) || 0 : 0;
    const target =
      c.target === "player"
        ? state.player
        : c.target === "other" || otherId > 0
          ? services.eventRuntimeById && services.eventRuntimeById(otherId)
          : interp.evRT;
    if (!target) return; // an event that isn't on this map — an honest no-op
    const steps = Array.isArray(c.steps) ? c.steps.slice() : [];
    const opts = {
      repeat: !!c.repeat,
      skippable: c.skippable !== false,
      gap: Number(c.gap) || 0,
    };
    // A repeating route never ends, so waiting on it would freeze the game —
    // the editor hides the pairing, and this is the belt to that braces.
    if (c.wait && !c.repeat) {
      await new Promise<void>((res) => services.setRoute(target, steps, res, opts));
    } else {
      services.setRoute(target, steps, null, opts);
    }
  });

  registerCommand("save", async (_c: any, { services }: InterpContext) => {
    await services.saveLoadMenu("save");
  });

  registerCommand("gameover", async (_c: any, { services }: InterpContext) => {
    await services.gameOver();
  });

  registerCommand("totitle", async (_c: any, { services }: InterpContext) => {
    await services.toTitle();
  });

  // ---- vehicles (Project Compass M4·A) ----
  // 202 Set Vehicle Location: repark a configured vehicle (byVar reads the
  // map/x/y from game variables at run time, like RM's designation toggle).
  registerCommand("setVehiclePos", (c: any, { state, services }: InterpContext) => {
    const st = services.vehicleState && services.vehicleState(c.vehicle);
    if (!st) return; // vehicle not configured in System — honest no-op
    const v = (n: any) => num(state.vars[num(n)]);
    st.mapId = c.byVar ? v(c.mapId) : num(c.mapId);
    st.x = c.byVar ? v(c.x) : num(c.x);
    st.y = c.byVar ? v(c.y) : num(c.y);
  });

  // 206 Get on/off Vehicle: MZ's toggle — board the vehicle faced/stood on,
  // or step off the one being ridden. Reuses the action-key boarding path.
  registerCommand("vehicle", (_c: any, { services }: InterpContext) => {
    if (services.tryVehicleAction) services.tryVehicleAction();
  });

  // 323 Change Vehicle Image: a save-persisted charset override.
  registerCommand("vehicleImage", (c: any, { state, services }: InterpContext) => {
    if (!c.vehicle || !c.charset) return;
    state.vehicleImages = state.vehicleImages || {};
    state.vehicleImages[c.vehicle] = String(c.charset);
    if (services.refreshPlayerCharset) services.refreshPlayerCharset();
  });
}
