/* RPGAtlas — src/engine/interpreter/commands/flow.ts
   Control-flow + dialogue interpreter commands (Phase 1 Stage B), extracted
   verbatim from the monolith's Interp.exec switch: text, choices, if,
   commonEvent, wait, script. Behavior unchanged — same control codes, same
   silent-skip on unknown types (handled by the registry). GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { registerCommand, type InterpContext } from "../registry.js";
import { runMzScript, mzGlobalsFromState } from "../../../shared/mz-script.js";
import { MESSAGE_BG_NAMES, MESSAGE_POS_NAMES } from "../../../shared/net/protocol.js";

export function registerFlowCommands(): void {
  // ---- Presentation directives (Project Beacon MP3·A) ----
  // The modal commands no longer touch UI: they emit a directive through the
  // presentation port (services.presentation, sim/directives.ts), suspend, and
  // resume on the player's validated reply. The client renders with the same
  // message/ui-stack code as before (scenes/directive-renderer.ts) — in
  // loopback the whole emit→render chain is synchronous, so this is
  // byte-identical to the old direct calls. RM's numeric position/background
  // ride the wire as names and map back losslessly at render.
  registerCommand("text", async (c: any, { interp, services }: InterpContext) => {
    const d: any = { text: c.text, speaker: c.name, portrait: c.face };
    if (c.background != null) d.background = MESSAGE_BG_NAMES[Number(c.background) || 0] || "window";
    if (c.position != null) d.pos = MESSAGE_POS_NAMES[Number(c.position)] || "bottom";
    // MP7·B "Show Message To": `to:"all"` broadcasts the message to every player
    // in the room (fire-and-forget to peers, awaits only the trigger). Absent /
    // "trigger" is the classic single-player message — byte-identical in solo.
    if (c.to === "all") d.to = "all";
    await services.presentation.message(interp.origin, d);
  });

  registerCommand("choices", async (c: any, { interp, services }: InterpContext) => {
    // Per-option conditions: an option whose condition is unmet is hidden and
    // the picked visible index maps back to its authored branch. A command
    // with no conditions array emits the exact pre-upgrade directive. When
    // every option is hidden the whole command is skipped (nothing to ask).
    const all: string[] = c.options || [];
    const conds = Array.isArray(c.conditions) ? c.conditions : null;
    const branchOf: number[] = [];
    const options = !conds
      ? all
      : all.filter((_o, oi) => {
          if (!interp.testCond(conds[oi])) return false;
          branchOf.push(oi);
          return true;
        });
    if (!options.length) return;
    const d: any = { options };
    // Cancelable rides the directive (renderer + reply validation already
    // support it); a canceled reply resolves to -1 and no branch runs.
    if (c.cancelable) d.cancelable = true;
    const i = await services.presentation.choices(interp.origin, d);
    if (i < 0) return;
    await interp.runList(c.branches[conds ? branchOf[i] : i] || []);
  });

  // ---- Message-system input scenes (Beacon MP3·B: presentation directives) ----
  // The three RM player-input scenes (Input Number 103, Select Item 104, Name
  // Input 303) no longer await a UI service directly — the world emits a
  // directive through the presentation port and stores the validated reply.
  // The client renders each with the SAME input scene as before
  // (scenes/directive-renderer.ts → input-scenes.ts), so in loopback this is
  // byte-identical to the pre-directive engine.
  registerCommand("inputNumber", async (c: any, { interp, state, services }: InterpContext) => {
    // (initial 0, exactly as the old numberInput(digits, 0) call: the renderer
    // defaults initial to 0, so the dial starts at zero as before.)
    const value = await services.presentation.numberInput(interp.origin, { digits: Number(c.digits) || 1 });
    if (c.varId != null) state.vars[c.varId] = value;
  });

  registerCommand("selectItem", async (c: any, { interp, state, services }: InterpContext) => {
    const raw = await services.presentation.selectItem(interp.origin, { itemType: c.itemType });
    // A remote session's pick is re-validated against authoritative inventory
    // (A6/C3.2c) — an id the player doesn't actually own is voided to 0. In
    // loopback the client read the world's own bag by reference (localEcho), so
    // the pick is already authoritative and the raw id stands, byte-identical.
    const id = raw && !services.presentation.localEcho && !services.ownsItem("item", raw) ? 0 : raw;
    if (c.varId != null) state.vars[c.varId] = id;
  });

  registerCommand("nameInput", async (c: any, { interp, state, services }: InterpContext) => {
    const member = (state.party || []).find((a: any) => a.actorId === c.actorId);
    const current = member ? member.name : "";
    // The world computes the current name and sends it as the initial value;
    // the renderer's on-screen keyboard opens on it, exactly as before. Empty
    // reply keeps the old name (the `&& name` guard, unchanged).
    const name = await services.presentation.nameInput(interp.origin, {
      maxLen: Number(c.maxChars) || 8,
      initial: current,
      actorId: c.actorId,
    });
    if (member && name) member.name = name;
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
      // A jump seeking a label outside this loop unwound runList — stop looping
      // and let the enclosing list resolve it (Project Compass M2·C).
      if (interp.jumpLabel != null) return;
      if (++spins % 1000 === 0) await services.waitFrames(1);
    }
  });

  registerCommand("breakLoop", (_c: any, { interp }: InterpContext) => {
    interp.breakLoop = true;
  });

  // ---- Jump labels (Project Compass M2·C, RM 118/119) ----
  // `label` is a passive marker; `jump` sets interp.jumpLabel and runList
  // (interp.ts) seeks the matching label in the current list, unwinding to an
  // enclosing list when it isn't found locally. The spin yield mirrors `loop`
  // so a wait-less backward jump can never freeze the tab.
  registerCommand("label", () => {});

  registerCommand("jump", async (c: any, { interp, services }: InterpContext) => {
    interp.jumpLabel = String(c.name == null ? "" : c.name);
    interp.jumpSpins = (interp.jumpSpins || 0) + 1;
    if (interp.jumpSpins % 1000 === 0) await services.waitFrames(1);
  });

  registerCommand("commonEvent", async (c: any, { interp }: InterpContext) => {
    await interp.callCommonEvent(c.commonEventId);
  });

  registerCommand("dialogue", async (c: any, { interp }: InterpContext) => {
    await interp.callDialogue(c.dialogueId);
  });

  registerCommand("wait", async (c: any, { services }: InterpContext) => {
    await services.waitFrames(c.frames || 30);
  });

  // ---- Wait for All Players (Project Beacon MP7·B) ----
  // A co-op sync barrier: pause the event until every other player in the room
  // has gathered on this event's map, or until a timeout (so one wandering
  // friend can't freeze the event forever). SOLO IS INSTANT — `mpOnline()` is
  // false with an empty roster, so the command returns immediately and existing
  // events are byte-identical. `timeout` is in seconds (default 10, capped 60);
  // the barrier polls every 6 world ticks. Full ready-signal semantics ride
  // MP8's server-run events (D-7-0); this is the authoring surface + the honest
  // "everyone's on the map" barrier the local-authority path can already prove.
  registerCommand("waitPlayers", async (c: any, { state, services }: InterpContext) => {
    if (!services.mpOnline || !services.mpOnline()) return;
    const secs = Math.max(1, Math.min(60, Number(c.timeout) || 10));
    const maxTicks = Math.round(secs * 60);
    let t = 0;
    while (t < maxTicks && !services.mpAllOnMap(state.mapId)) {
      await services.waitFrames(6);
      t += 6;
    }
  });

  registerCommand("script", async (c: any, { interp, services }: InterpContext) => {
    try {
      const api = Object.create(services.scriptApi);
      api.callCommonEvent = (id: any) => interp.callCommonEvent(id);
      api.callDialogue = (id: any) => interp.callDialogue(id);
      const result = new Function("game", c.code)(api);
      if (result && typeof result.then === "function") await result;
    } catch (e) {
      console.error("Script command error:", e);
    }
    services.refreshAllPages();
  });

  // A read-only RPG Maker Script command the importer verified against the
  // M5·B subset (mig-0 D5): run it through the $game* compat shim under the
  // same new Function sandbox as `script`. The shim exposes no setters, so it
  // can only read $gameSwitches/$gameVariables/$gameParty; errors are swallowed
  // like the `script` command's. Reads have no observable effect — the branch
  // condition (interp.testCond "mzScript") is where the shim earns its keep.
  registerCommand("mzScript", async (c: any, { state }: InterpContext) => {
    runMzScript(c.code, mzGlobalsFromState(state));
  });
}
