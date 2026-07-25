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
  /** How many topic hubs are open on this run (runDialogueHub). Bounds
   *  hub-inside-a-topic nesting; 0 unless a `hub` node exists. */
  hubDepth = 0;
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
  /** `startNodeId` overrides the asset's own start node. Only the topic hub
   *  passes it, to run a topic that lives in an included dialogue inside its
   *  OWN asset (so that asset's speakers and nodes resolve correctly). */
  async callDialogue(id: any, startNodeId?: number): Promise<boolean> {
    const dialogue = RA.byId(ctx.proj.dialogues || [], Number(id));
    if (!dialogue || !Array.isArray(dialogue.nodes) || !dialogue.nodes.length) return false;
    if (this.dialogueStack.includes(dialogue.id)) {
      console.warn("Skipped recursive dialogue call:", dialogue.id);
      return false;
    }
    const nodes = new Map<number, any>(dialogue.nodes.map((node: any) => [Number(node.id), node]));
    const speakers = new Map<number, any>((dialogue.speakers || []).map((speaker: any) => [Number(speaker.id), speaker]));
    const startId = Number(startNodeId) || Number(dialogue.startNodeId) || Number(dialogue.nodes[0].id) || 0;
    this.dialogueStack.push(dialogue.id);
    try {
      await this.walkDialogue(dialogue, nodes, speakers, startId);
    } finally {
      this.dialogueStack.pop();
    }
    return true;
  }

  /** Walks a conversation from `startId` until it runs out of nodes. Split
   *  out of callDialogue so a topic hub can run a topic's branch and then go
   *  BACK to its list — the branch is an ordinary walk that simply returns
   *  when it ends. Body is otherwise the original loop, unchanged. */
  private async walkDialogue(dialogue: any, nodes: Map<number, any>, speakers: Map<number, any>, startId: number): Promise<void> {
    let nodeId = startId;
    let steps = 0;
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
          // Beacon MP3·B: the dialogue path emits through the presentation
          // port with this run's origin, exactly like the `text`/`choices`
          // command handlers — no direct UI call. Speaker/portrait values are
          // passed byte-exact; the renderer reconstructs the same showMessage.
          await EngineServices.presentation.message(this.origin, {
            text: node.text,
            speaker: speaker ? speaker.name : "",
            portrait: node.portrait || (speaker && speaker.portrait) || "",
          });
        }
        // Per-option conditions (the Dialogue System's answer to Show
        // Choices' `conditions[]`): an option whose condition is unmet is
        // left out of the list. Because the surviving options carry their
        // OWN nextId, filtering can never re-point a branch — no index
        // mapping is needed. Every option hidden ⇒ nothing to ask, so the
        // node falls through on its fallback target.
        const authored = Array.isArray(node.options) ? node.options : [];
        const options = authored.filter((option: any) => this.testCond(option.condition));
        if (!options.length) {
          nodeId = Number(node.nextId) || 0;
          continue;
        }
        // The option strings ride the directive; richText runs client-side at
        // render (same module, same values in loopback). Non-cancelable, so
        // the reply is always a valid index — never -1.
        const picked = await EngineServices.presentation.choices(this.origin, {
          options: options.map((option: any) => option.text || "Choice"),
        });
        nodeId = Number((options[picked] || {}).nextId) || Number(node.nextId) || 0;
      } else if (node.kind === "hub") {
        nodeId = await this.runDialogueHub(dialogue, node, nodes, speakers);
      } else if (node.kind === "cutscene") {
        await this.runList(Array.isArray(node.commands) ? node.commands : []);
        nodeId = Number(node.nextId) || 0;
      } else {
        const speaker: any = speakers.get(Number(node.speakerId));
        if (node.voice) await this.exec({ t: "se", name: node.voice });
        await EngineServices.presentation.message(this.origin, {
          text: node.text || "",
          speaker: speaker ? speaker.name : "",
          portrait: node.portrait || (speaker && speaker.portrait) || "",
        });
        nodeId = Number(node.nextId) || 0;
      }
    }
    if (steps >= 1000) console.warn("Stopped dialogue after 1000 nodes:", dialogue.id);
  }

  /** The topic-pool model: gather every topic whose condition passes, order
   *  them by priority, and offer them as ONE list — the player keeps picking
   *  until they leave or nothing is left to ask. Adding a topic never
   *  re-shapes the branches around it, which is the whole point: authors
   *  declare when a line is available instead of wiring where it sits.
   *  Returns the node id the conversation continues with once the hub ends. */
  private async runDialogueHub(dialogue: any, node: any, nodes: Map<number, any>, speakers: Map<number, any>): Promise<number> {
    const leave = () => Number(node.nextId) || 0;
    // Nested hubs (a topic branch that opens another hub) are legal but
    // bounded, so a pair of hubs pointing at each other can't recurse away.
    if ((this.hubDepth || 0) >= 8) return leave();
    const exitText = node.exitText == null ? "Leave" : String(node.exitText);
    const speaker: any = speakers.get(Number(node.speakerId));
    this.hubDepth = (this.hubDepth || 0) + 1;
    try {
      // Each round re-gathers, so a topic that changes a switch immediately
      // changes what the rest of the list offers.
      for (let round = 0; round < 200; round++) {
        const entries = this.gatherTopics(dialogue, node);
        if (!entries.length) return leave();
        if (node.voice) await this.exec({ t: "se", name: node.voice });
        if (node.text) {
          await EngineServices.presentation.message(this.origin, {
            text: node.text,
            speaker: speaker ? speaker.name : "",
            portrait: node.portrait || (speaker && speaker.portrait) || "",
          });
        }
        const options = entries.map((entry: any) => entry.topic.text || "Topic");
        if (exitText) options.push(exitText);
        const picked = await EngineServices.presentation.choices(this.origin, { options });
        const chosen = entries[picked];
        if (!chosen) return leave(); // the exit option (or an out-of-range reply)
        if (chosen.topic.once) this.topicStore()[this.topicKey(chosen.dialogue.id, chosen.topic.id)] = true;
        const branch = Number(chosen.topic.nextId) || 0;
        if (!branch) continue; // a topic with no branch just leaves the list
        if (chosen.dialogue === dialogue) {
          await this.walkDialogue(dialogue, nodes, speakers, branch);
        } else {
          // A topic borrowed from another asset runs inside that asset, so
          // its own speakers and nodes resolve; we return here afterwards.
          await this.callDialogue(chosen.dialogue.id, branch);
        }
      }
      console.warn("Stopped dialogue hub after 200 rounds:", dialogue.id);
      return leave();
    } finally {
      this.hubDepth--;
    }
  }

  /** The eligible topics for one hub, highest priority first (ties keep
   *  authored order — Array.prototype.sort is stable). Draws from the hub's
   *  own dialogue plus any assets it includes, so a shared "Guild topics"
   *  asset can hang off every guild member's hub. */
  private gatherTopics(dialogue: any, node: any): any[] {
    const pools: any[] = [dialogue];
    for (const id of Array.isArray(node.includeIds) ? node.includeIds : []) {
      const extra = RA.byId(ctx.proj.dialogues || [], Number(id));
      if (extra && extra !== dialogue && !pools.includes(extra)) pools.push(extra);
    }
    const entries: any[] = [];
    for (const pool of pools) {
      for (const topic of Array.isArray(pool.topics) ? pool.topics : []) {
        if (!topic || typeof topic !== "object") continue;
        if (topic.once && this.topicStore()[this.topicKey(pool.id, topic.id)]) continue;
        if (!this.testCond(topic.condition)) continue;
        entries.push({ topic, dialogue: pool });
      }
    }
    entries.sort((a, b) => (Number(b.topic.priority) || 0) - (Number(a.topic.priority) || 0));
    const cap = Number(node.maxTopics) || 0;
    return cap > 0 ? entries.slice(0, cap) : entries;
  }

  /** Save key for a "say once" topic — owning asset, not the offering hub,
   *  so a shared topic stays spent whichever NPC it was asked of. */
  private topicKey(dialogueId: any, topicId: any): string {
    return (Number(dialogueId) || 0) + ":" + (Number(topicId) || 0);
  }

  /** G.topicsUsed, created on first touch — a save written before topics
   *  existed (or a world built by an older path) simply has no bucket yet. */
  private topicStore(): any {
    if (!G.topicsUsed) G.topicsUsed = {};
    return G.topicsUsed;
  }

  testCond(cond: any, depth = 0): boolean {
    if (!cond) return true;
    const cmp = (a: any, b: any, op: any) => compareVariable(a, b, op);
    switch (cond.kind) {
      // ---- Condition groups: several conditions on one gate ----
      // "all" is AND, "any" is OR, and members may be groups themselves. An
      // empty group reads as "always" (same as no condition at all) so a
      // half-built group never silently hides content. The depth cap is a
      // safety valve against hand-edited/imported project JSON — a group
      // nested past it reads as "always" instead of blowing the stack.
      case "all":
      case "any": {
        const list = Array.isArray(cond.conds) ? cond.conds : [];
        if (!list.length || depth >= 16) return true;
        return cond.kind === "all"
          ? list.every((sub: any) => this.testCond(sub, depth + 1))
          : list.some((sub: any) => this.testCond(sub, depth + 1));
      }
      case "switch":
        if (cond.scope === "player") {
          // MP7·B per-player switch read (origin player's own namespace).
          const pid = (this.origin && this.origin.playerId) || 0;
          const bucket = G.pSwitches && G.pSwitches[pid];
          return !!(bucket && bucket[cond.id]) === (cond.val !== false);
        }
        return !!G.switches[cond.id] === (cond.val !== false);
      case "var":
        // valVarId ≥ 1 compares against another variable (amount-from-variable
        // pattern, matching CmdGold/CmdItem); absent/0 is the constant `val`.
        return cmp(
          G.vars[cond.id] || 0,
          Number(cond.valVarId) >= 1 ? G.vars[cond.valVarId] || 0 : cond.val,
          cond.cmp || ">=",
        );
      case "selfsw":
        return !!G.selfSw[this.selfKey(cond.key)];
      case "quest":
        return Quests.status(cond.questId) === (cond.status || "active");
      case "item":
        // A present `count` compares the owned count (dedicated field — a
        // stale `val` left by editor kind-flipping must not change behavior);
        // absent keeps the classic "owns at least one" check.
        return cond.count != null
          ? cmp(invCount(cond.itemKind || "item", cond.id), cond.count, cond.cmp || ">=")
          : invCount(cond.itemKind || "item", cond.id) > 0;
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
      case "online":
        // MP7·B: true when this game is in a multiplayer room. Solo ⇒ false.
        return !!(EngineServices && EngineServices.mpOnline && EngineServices.mpOnline()) === (cond.val !== false);
      case "playerCount": {
        // MP7·B: how many players share the room (self included). Solo ⇒ 1.
        const n = EngineServices && EngineServices.mpPlayerCount ? EngineServices.mpPlayerCount() : 1;
        return cmp(n, cond.val, cond.cmp || ">=");
      }
      default:
        return true;
    }
  }
}
