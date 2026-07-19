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
import { G, Quests, invCount, currencyBalance } from "../state/game-state.js";
import { compareVariable } from "../util.js";
import { evalMzScript, mzGlobalsFromState } from "../../shared/mz-script.js";
import type { InterpOrigin } from "../../shared/sim/directives.js";

export type { InterpOrigin };

let EngineServices: any = null;
/** Install the engine service surface command handlers receive (ctx.services). */
export function initInterpServices(services: any): void {
  EngineServices = services;
}

export class Interp {
  evRT: any;
  commonStack: any[];
  dialogueStack: any[];
  /** Set by the breakLoop command (Phase 4); runList unwinds while it is
   *  true and the innermost loop handler consumes it. Never set unless a
   *  loop/breakLoop command exists, so pre-Phase-4 behavior is untouched. */
  breakLoop = false;
  /** Set by the `jump` command (Project Compass M2·C); runList seeks the
   *  matching `label` in the current list, unwinding to an enclosing list when
   *  it isn't found. Null unless a jump ran, so pre-M2·C behavior is untouched. */
  jumpLabel: string | null = null;
  /** Yield counter guarding a wait-less backward jump loop (see the `jump`
   *  command); mirrors the `loop` handler's spin valve. */
  jumpSpins = 0;
  /** Who this run acts as (Beacon MP3·A, MP0·C §C6): the triggering player
   *  ({playerId: N}) or the world ({playerId: null} — autorun/parallel/timer
   *  scheduling passes it explicitly). Presentation directives target
   *  participantsOf(origin). The default is the solo player context, so every
   *  constructor site that predates MP3 (battle common events, script API,
   *  plugins) keeps its player-facing behavior without changes. */
  origin: InterpOrigin;

  constructor(evRT: any, commonStack?: any[], dialogueStack?: any[], origin?: InterpOrigin) {
    this.evRT = evRT;
    this.commonStack = commonStack || [];
    this.dialogueStack = dialogueStack || [];
    this.origin = origin || { playerId: 0 };
  }
  selfKey(key: any): string {
    return G.mapId + ":" + (this.evRT ? this.evRT.ev.id : 0) + ":" + key;
  }

  async runList(list: any): Promise<void> {
    const arr = list || [];
    for (let i = 0; i < arr.length; i++) {
      await this.exec(arr[i]);
      if (this.breakLoop) return; // unwind to the innermost loop handler
      if (this.jumpLabel != null) {
        // Seek the target label in THIS list; found → resume after it, else
        // unwind so an enclosing list (or the common-event boundary) resolves it.
        const idx = arr.findIndex(
          (cmd: any) => cmd && cmd.t === "label" && String(cmd.name) === this.jumpLabel,
        );
        if (idx < 0) return;
        this.jumpLabel = null;
        i = idx; // for-loop ++ resumes at the command after the label
      }
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
      // A jump is scoped to its own command list: an unresolved one never
      // leaks across the common-event boundary into the caller's list.
      this.jumpLabel = null;
    }
    return true;
  }
  async callDialogue(id: any): Promise<boolean> {
    const dialogue = RA.byId(ctx.proj.dialogues || [], Number(id));
    if (!dialogue || !Array.isArray(dialogue.nodes) || !dialogue.nodes.length) return false;
    if (this.dialogueStack.includes(dialogue.id)) {
      console.warn("Skipped recursive dialogue call:", dialogue.id);
      return false;
    }
    const nodes = new Map(dialogue.nodes.map((node: any) => [Number(node.id), node]));
    const speakers = new Map((dialogue.speakers || []).map((speaker: any) => [Number(speaker.id), speaker]));
    let nodeId = Number(dialogue.startNodeId) || Number(dialogue.nodes[0].id) || 0;
    let steps = 0;
    this.dialogueStack.push(dialogue.id);
    try {
      while (nodeId && steps++ < 1000) {
        const node: any = nodes.get(nodeId);
        if (!node) break;
        if (node.condition && !this.testCond(node.condition)) {
          nodeId = Number(node.nextId) || 0;
          continue;
        }
        if (node.kind === "choice") {
          const speaker: any = speakers.get(Number(node.speakerId));
          if (node.voice) await this.exec({ t: "se", name: node.voice });
          if (node.text) {
            await EngineServices.showMessage(
              speaker ? speaker.name : "",
              node.text,
              node.portrait || (speaker && speaker.portrait) || "",
              {},
            );
          }
          const options = Array.isArray(node.options) ? node.options : [];
          if (!options.length) {
            nodeId = Number(node.nextId) || 0;
            continue;
          }
          const picked = await EngineServices.showList(
            options.map((option: any) => ({ html: EngineServices.richText(option.text || "Choice") })),
            { className: "choicewin", cancellable: false },
          );
          nodeId = Number((options[picked] || {}).nextId) || Number(node.nextId) || 0;
        } else if (node.kind === "cutscene") {
          await this.runList(Array.isArray(node.commands) ? node.commands : []);
          nodeId = Number(node.nextId) || 0;
        } else {
          const speaker: any = speakers.get(Number(node.speakerId));
          if (node.voice) await this.exec({ t: "se", name: node.voice });
          await EngineServices.showMessage(
            speaker ? speaker.name : "",
            node.text || "",
            node.portrait || (speaker && speaker.portrait) || "",
            {},
          );
          nodeId = Number(node.nextId) || 0;
        }
      }
      if (steps >= 1000) console.warn("Stopped dialogue after 1000 nodes:", dialogue.id);
    } finally {
      this.dialogueStack.pop();
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
        // currencyId ≥ 2 reads a wallet balance; absent/0/1 is classic gold.
        return cmp(currencyBalance(cond.currencyId), cond.val, cond.cmp || ">=");
      case "region": {
        // the player's tile region (Phase 5); 0 = untagged
        const m = ctx.map;
        const p = G.player;
        if (!m || !p || !m.regions) return (Number(cond.id) || 0) === 0;
        return (m.regions[p.y * m.width + p.x] || 0) === (Number(cond.id) || 0);
      }
      case "time": {
        // in-game clock window [from, to) hours, wrap-around ok (Phase 5)
        const h = ((Number(G.timeOfDay) || 0) % 24 + 24) % 24;
        const from = Number(cond.from) || 0;
        const to = Number(cond.to) || 0;
        if (from === to) return true; // degenerate window = whole day
        return from < to ? h >= from && h < to : h >= from || h < to;
      }
      case "mzScript":
        // A read-only RPG Maker Conditional-Branch "Script" expression (M5·B):
        // evaluate it through the same $game* compat shim as the mzScript
        // command. Any error reads as "not met" (evalMzScript returns false).
        return evalMzScript(cond.code, mzGlobalsFromState(G));
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
