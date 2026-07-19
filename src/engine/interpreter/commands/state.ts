/* RPGAtlas — src/engine/interpreter/commands/state.ts
   Game-state interpreter commands (Phase 1 Stage B), extracted verbatim from
   the monolith's Interp.exec switch: switch, selfsw, var, gold, item, party,
   heal, transparency, erase, and the quest* commands. Behavior unchanged.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { registerCommand, type InterpContext } from "../registry.js";

export function registerStateCommands(): void {
  registerCommand("switch", (c: any, { state, services }: InterpContext) => {
    state.switches[c.id] = !!c.val;
    services.refreshAllPages();
    services.evaluateQuestFailures();
  });

  registerCommand("selfsw", (c: any, { interp, state, services }: InterpContext) => {
    state.selfSw[interp.selfKey(c.key)] = !!c.val;
    services.refreshAllPages();
  });

  registerCommand("var", (c: any, { state, services }: InterpContext) => {
    const cur = state.vars[c.id] || 0;
    let v = c.val;
    if (c.op === "rnd") v = c.val + services.rnd((c.val2 || c.val) - c.val + 1);
    state.vars[c.id] = c.op === "add" ? cur + v : c.op === "sub" ? cur - v : v;
    services.refreshAllPages();
    services.evaluateQuestFailures();
  });

  registerCommand("questStart", (c: any, { services }: InterpContext) => {
    services.Quests.start(c.questId);
  });

  registerCommand("questAdvanceObj", (c: any, { services }: InterpContext) => {
    services.Quests.advanceObjective(c.questId, c.objIndex, c.amount);
    services.evaluateQuestFailures();
  });

  registerCommand("questSetObj", (c: any, { services }: InterpContext) => {
    services.Quests.setObjective(c.questId, c.objIndex, c.value);
    services.evaluateQuestFailures();
  });

  registerCommand("questComplete", async (c: any, { interp, state, services }: InterpContext) => {
    const res = services.Quests.complete(c.questId, {
      mapId: state.mapId,
      eventId: interp.evRT ? interp.evRT.ev.id : 0,
    });
    if (res && res.rewardText) {
      await services.showMessage("", "You received " + res.rewardText + "!");
    }
  });

  registerCommand("questFail", (c: any, { services }: InterpContext) => {
    services.Quests.fail(c.questId);
  });

  registerCommand("gold", (c: any, { state, services }: InterpContext) => {
    const delta = c.op === "sub" ? -c.val : c.val;
    const cid = Number(c.currencyId) || 0;
    // Currency ids ≥ 2 change a wallet balance; anything else is the exact
    // pre-wallet classic-gold path (see game-state.ts currency helpers).
    if (cid > 1) {
      state.wallet = state.wallet || {};
      state.wallet[cid] = services.clamp((state.wallet[cid] || 0) + delta, 0, 9999999);
      return;
    }
    state.gold = services.clamp(state.gold + delta, 0, 9999999);
  });

  registerCommand("item", (c: any, { services }: InterpContext) => {
    services.addInv(c.kind || "item", c.id, c.op === "sub" ? -c.val : c.val);
  });

  registerCommand("party", (c: any, { state, services }: InterpContext) => {
    if (c.op === "add") {
      if (
        !state.party.find((a: any) => a.actorId === c.actorId) &&
        state.party.length < 4
      ) {
        const a = services.makeActor(c.actorId);
        if (a) state.party.push(a);
      }
    } else {
      state.party = state.party.filter((a: any) => a.actorId !== c.actorId);
      if (!state.party.length)
        state.party.push(
          services.makeActor(
            services.getProj().system.party[0] || services.getProj().actors[0].id,
          ),
        );
    }
  });

  registerCommand("heal", (c: any, { state, services }: InterpContext) => {
    for (const a of state.party) {
      if (c.full) {
        a.hp = services.param(a, "mhp");
        a.mp = services.param(a, "mmp");
        a.states = [];
      } else {
        a.hp = services.clamp(a.hp + (c.hp || 0), 1, services.param(a, "mhp"));
        a.mp = services.clamp(a.mp + (c.mp || 0), 0, services.param(a, "mmp"));
      }
    }
  });

  registerCommand("transparency", (c: any, { state }: InterpContext) => {
    if (state.player) state.player.transparent = !!c.val;
  });

  registerCommand("erase", (_c: any, { interp }: InterpContext) => {
    if (interp.evRT) interp.evRT.erased = true;
  });
}
