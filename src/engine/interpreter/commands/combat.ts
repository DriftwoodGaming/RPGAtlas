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
    // Beacon MP6·A (A-7): a SHARED battle's defeat revived everyone at 1 HP
    // and must not game-over a friend's world — lastShared suppresses it
    // (false/undefined in solo and in stubbed node-test services).
    if (result === "lose" && !c.lose && !services.Battle.lastShared) {
      await services.gameOver();
      return;
    }
    // Autosave (post-1.1): a survived event battle autosaves like MZ. The
    // service guard keeps node test bundles (stubbed services) happy; the
    // function itself no-ops unless system.autosave is on.
    if (services.autosaveNow) services.autosaveNow();
    if (result === "win" && c.onWin) await interp.runList(c.onWin);
    else if (result === "escape" && c.onEscape) await interp.runList(c.onEscape);
    else if (result === "lose" && c.onLose) await interp.runList(c.onLose);
  });

  // Open Shop is a presentation directive (Beacon MP3·A): the world offers the
  // goods, the client runs the whole browse/buy/sell session and replies with
  // the transcript. Loopback (localEcho): the session's live lines already
  // applied by reference — the byte-identical solo path — so the transcript is
  // NOT re-applied; a real remote session's transcript (MP4/MP5) is applied
  // here through services.applyShopTranscript, re-validated line-by-line
  // against authoritative stock/wallet (A6/C3.2c).
  registerCommand("shop", async (c: any, { interp, services }: InterpContext) => {
    const goods = c.goods || [];
    const transactions = await services.presentation.shop(interp.origin, {
      goods: services.wireShopGoods(goods),
      currencyId: c.currencyId == null ? undefined : Number(c.currencyId) || 0,
    });
    if (!services.presentation.localEcho) services.applyShopTranscript(goods, c.currencyId, transactions);
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
