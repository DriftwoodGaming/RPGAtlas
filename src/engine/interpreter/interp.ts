/* RPGAtlas — src/engine/interpreter/interp.ts
   The event interpreter, extracted verbatim from the js/engine.js monolith
   (Phase 1 Stage B). Interp walks a command list and dispatches every command
   — built-in and plugin-registered — through the shared registry; unknown
   types resolve to no handler and are a silent no-op (the old switch default).
   The common-event call stack guards against recursion exactly as before.

   The EngineServices surface handed to command handlers is injected via
   initInterpServices() (the engine body installs it after building the
   services object; boot.ts owns this once the monolith is gone), so handlers
   see the same live service getters they always did. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA } from "../../shared/deps.js";
import { getCommand } from "./registry.js";
import { ctx } from "../state/engine-context.js";
import { G, Quests, invCount } from "../state/game-state.js";
import { compareVariable } from "../util.js";

let EngineServices: any = null;
/** Install the engine service surface command handlers receive (ctx.services). */
export function initInterpServices(services: any): void {
  EngineServices = services;
}

export class Interp {
  evRT: any;
  commonStack: any[];
  /** Set by the breakLoop command (Phase 4); runList unwinds while it is
   *  true and the innermost loop handler consumes it. Never set unless a
   *  loop/breakLoop command exists, so pre-Phase-4 behavior is untouched. */
  breakLoop = false;

  constructor(evRT: any, commonStack?: any[]) {
    this.evRT = evRT;
    this.commonStack = commonStack || [];
  }
  selfKey(key: any): string {
    return G.mapId + ":" + (this.evRT ? this.evRT.ev.id : 0) + ":" + key;
  }

  async runList(list: any): Promise<void> {
    for (const cmd of list || []) {
      await this.exec(cmd);
      if (this.breakLoop) return; // unwind to the innermost loop handler
    }
  }
  async exec(c: any): Promise<void> {
    // Every command — built-in and plugin-registered — is dispatched through
    // the shared registry (src/engine/interpreter/registry.ts). An unknown
    // type resolves to undefined and is a silent no-op, exactly as the old
    // switch's `default` was when no plugin handler existed. Plugin handlers
    // register through the plugin bridge, wrapped in the same try/catch the
    // old default case used, so their frozen (cmd, interp) signature and
    // error handling are preserved.
    const handler = getCommand(c.t);
    if (handler)
      await handler(c, { interp: this, state: G, services: EngineServices });
  }
  async callCommonEvent(id: any): Promise<boolean> {
    const commonEvent = RA.byId(ctx.proj.commonEvents || [], Number(id));
    if (!commonEvent || !commonEvent.commands.length) return false;
    if (this.commonStack.includes(commonEvent.id)) {
      console.warn("Skipped recursive common event call:", commonEvent.id);
      return false;
    }
    this.commonStack.push(commonEvent.id);
    try {
      await this.runList(commonEvent.commands);
    } finally {
      this.commonStack.pop();
    }
    return true;
  }
  testCond(cond: any): boolean {
    if (!cond) return true;
    const cmp = (a: any, b: any, op: any) => compareVariable(a, b, op);
    switch (cond.kind) {
      case "switch":
        return !!G.switches[cond.id] === (cond.val !== false);
      case "var":
        return cmp(G.vars[cond.id] || 0, cond.val, cond.cmp || ">=");
      case "selfsw":
        return !!G.selfSw[this.selfKey(cond.key)];
      case "quest":
        return Quests.status(cond.questId) === (cond.status || "active");
      case "item":
        return invCount(cond.itemKind || "item", cond.id) > 0;
      case "gold":
        return cmp(G.gold, cond.val, cond.cmp || ">=");
      case "actor": {
        const actor = G.party.find((a: any) => a.actorId === cond.actorId);
        if (!actor) return false;
        if (cond.check === "inParty") return true;
        if (cond.check === "weapon") return actor.weaponId === cond.itemId;
        if (cond.check === "armor") return actor.armorId === cond.itemId;
        return true;
      }
      default:
        return true;
    }
  }
}
