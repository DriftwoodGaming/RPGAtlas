/* RPGAtlas — src/engine/interpreter/commands/combat.ts
   Combat/economy interpreter commands (Phase 1 Stage B), extracted verbatim
   from the monolith's Interp.exec switch: battle, shop. `battle` still triggers
   the game-over flow on a loss unless the command opts out (c.lose).
   Project Compass M3·C: battle-result branches (RM 601/602/603) run after the
   result, and the in-troop enemy commands (RM 331–340) reach the live battle
   through the `battleEnemyOps` bridge — outside battle they are safe no-ops.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { registerCommand, type InterpContext } from "../registry.js";

export function registerCombatCommands(): void {
  registerCommand("battle", async (c: any, { interp, services }: InterpContext) => {
    const result = await services.Battle.run(c.troopId, c.escape !== false);
    // M3·C battle branches (RM 601/602/603). The lose branch only exists
    // with `lose:true` (RM's Can Lose) — otherwise a loss still game-overs.
    if (result === "lose" && !c.lose) {
      await services.gameOver();
      return;
    }
    if (result === "win" && c.onWin) await interp.runList(c.onWin);
    else if (result === "escape" && c.onEscape) await interp.runList(c.onEscape);
    else if (result === "lose" && c.onLose) await interp.runList(c.onLose);
  });

  registerCommand("shop", async (c: any, { services }: InterpContext) => {
    await services.Shop.run(c.goods || []);
  });

  // ---- In-troop enemy commands (RM 331–340, Project Compass M3·C) ----
  // Every handler goes through the battle bridge registered while a battle
  // runs (scenes/battle.ts). No battle ⇒ no bridge ⇒ a quiet no-op, exactly
  // like Change Enemy TP (M3·B).
  const ops = (services: any) => services.battleEnemyOps;

  registerCommand("changeEnemyHp", async (c: any, { services }: InterpContext) => {
    const b = ops(services);
    if (!b) return;
    const delta = (c.op === "sub" ? -1 : 1) * (Number(c.value) || 0);
    await b.hp(Number(c.enemyIndex) || 0, delta, !!c.allowKo);
  });

  registerCommand("changeEnemyMp", async (c: any, { services }: InterpContext) => {
    const b = ops(services);
    if (!b) return;
    const delta = (c.op === "sub" ? -1 : 1) * (Number(c.value) || 0);
    b.mp(Number(c.enemyIndex) || 0, delta);
  });

  registerCommand("changeEnemyState", async (c: any, { services }: InterpContext) => {
    const b = ops(services);
    if (!b) return;
    await b.state(Number(c.enemyIndex) || 0, c.op === "remove" ? "remove" : "add", Number(c.stateId) || 0);
  });

  registerCommand("enemyRecoverAll", async (c: any, { services }: InterpContext) => {
    const b = ops(services);
    if (!b) return;
    await b.recoverAll(Number(c.enemyIndex) || 0);
  });

  registerCommand("enemyAppear", async (c: any, { services }: InterpContext) => {
    const b = ops(services);
    if (!b) return;
    await b.appear(Number(c.enemyIndex) || 0);
  });

  registerCommand("enemyTransform", async (c: any, { services }: InterpContext) => {
    const b = ops(services);
    if (!b) return;
    await b.transform(Number(c.enemyIndex) || 0, Number(c.enemyId) || 0);
  });

  registerCommand("forceAction", async (c: any, { services }: InterpContext) => {
    const b = ops(services);
    if (!b) return;
    await b.forceAction(
      c.side === "actor" ? "actor" : "enemy",
      Number(c.index) || 0,
      Number(c.skillId) || 0,
      Number(c.target) || 0,
    );
  });

  registerCommand("abortBattle", (_c: any, { services }: InterpContext) => {
    const b = ops(services);
    if (!b) return;
    b.abort();
  });
}
