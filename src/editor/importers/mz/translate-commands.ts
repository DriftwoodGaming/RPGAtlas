/* RPGAtlas — src/editor/importers/mz/translate-commands.ts
   Project Compass M1·C: THE TRANSLATION TABLE — the spine of the whole
   migration (see "The translation table is the spine" in
   docs/MZ_MV_MIGRATION_ROADMAP.md). This one module owns the MZ/MV
   event-command-code → Atlas-`AnyCommand` mapping (matrix §8 codes 101–657,
   §9 move routes, §13 escape codes). Every code either translates to real
   Atlas command(s) or becomes an additive `mzTodo` placeholder (raw code +
   params preserved, friendly editor render, engine no-op, one report line) so
   nothing is a silent drop (locked decision 6) and a re-import after a later
   phase ships upgrades it in place. Phases M2–M4 flip the `+ Mn` rows below
   from `mzTodo` to real translations in the same step they ship the feature.

   RM command lists are FLAT arrays with an `indent` level and structural
   continuation codes (401 text-line, 402/403/404 choices, 411/412 branch,
   413 loop-end, 601–604 battle result, 605 shop-goods, 655 script-line). The
   translator walks the list with a cursor and rebuilds Atlas's nested command
   tree (branches/loops/choices) from the indent + continuation markers.

   Pure — no DOM. Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AnyCommand, Condition } from "../../../shared/schema";
import { assetKeyOf, slugName } from "../../../shared/asset-library";
import type { CommandTranslator } from "./convert-events";
import type { ImportReport, ReportKind } from "./report";
import type { RmCommand, RmMoveRoute } from "./raw-types";

// ---------------------------------------------------------------------------
// The `+ Mn` table: codes that are a real engine/editor feature in a later
// phase. They import as `mzTodo` now and the named phase flips them. `what` is
// the friendly noun the editor label + report line use; `detail` is the report
// explanation (M1·D rewrites report copy for the audience, D11). ONE aggregated
// report line per code (D11 "aggregate repeats").
// ---------------------------------------------------------------------------
interface TodoInfo { what: string; detail: string; }
const TODO: Record<number, TodoInfo> = {
  103: { what: "asking the player for a number", detail: "number-entry prompts arrive in a later update (M2·B)" },
  104: { what: "letting the player pick an item", detail: "item-picker prompts arrive in a later update (M2·B)" },
  118: { what: "a jump label", detail: "labels and jumps arrive in a later update (M2·C)" },
  119: { what: "jumping to a label", detail: "labels and jumps arrive in a later update (M2·C)" },
  132: { what: "changing the battle music", detail: "swapping the battle music from an event arrives in a later update" },
  133: { what: "changing the victory music", detail: "swapping the victory jingle arrives in a later update (M4·B)" },
  134: { what: "turning saving on or off", detail: "locking the save menu arrives in a later update (M2·C)" },
  135: { what: "turning the menu on or off", detail: "locking the menu arrives in a later update (M2·C)" },
  136: { what: "turning random battles on or off", detail: "toggling encounters arrives in a later update (M2·C)" },
  137: { what: "turning party-arranging on or off", detail: "locking the formation menu arrives in a later update (M2·C)" },
  138: { what: "changing the window color", detail: "recoloring the message window arrives in a later update (M2·C)" },
  139: { what: "changing the defeat music", detail: "swapping the defeat jingle arrives in a later update (M4·B)" },
  140: { what: "changing a vehicle's music", detail: "swapping a vehicle's music arrives in a later update" },
  202: { what: "moving a vehicle", detail: "placing a boat/ship/airship from an event arrives in a later update (M4·A)" },
  203: { what: "moving another event", detail: "teleporting an event to a spot arrives in a later update" },
  206: { what: "getting on or off a vehicle", detail: "the board/exit-vehicle command arrives in a later update (M4·A)" },
  216: { what: "showing or hiding followers", detail: "toggling the follower trail arrives in a later update (M2·C)" },
  243: { what: "remembering the music", detail: "save/resume-music arrives in a later update (M4·B)" },
  244: { what: "bringing the music back", detail: "save/resume-music arrives in a later update (M4·B)" },
  245: { what: "playing a background sound", detail: "looping background sounds arrive in a later update (M4·B)" },
  246: { what: "fading out a background sound", detail: "looping background sounds arrive in a later update (M4·B)" },
  249: { what: "playing a musical effect", detail: "one-shot musical effects (ME) arrive in a later update (M4·B)" },
  251: { what: "stopping a sound", detail: "stopping a looping sound arrives in a later update (M4·B)" },
  282: { what: "changing the tileset", detail: "swapping a map's tileset arrives in a later update (M4·A)" },
  283: { what: "changing the battle background", detail: "custom battle backgrounds arrive in a later update (M4·A)" },
  284: { what: "changing the parallax", detail: "scrolling background pictures arrive in a later update (M4·A)" },
  285: { what: "reading tile info", detail: "the get-location-info command arrives in a later update (M2·C)" },
  303: { what: "letting the player type a name", detail: "the name-entry screen arrives in a later update (M2·B)" },
  313: { what: "adding or removing a status", detail: "changing a hero's status outside battle arrives in a later update (M2·C)" },
  315: { what: "changing EXP", detail: "changing a hero's EXP arrives in a later update (M2·C)" },
  316: { what: "changing level", detail: "changing a hero's level arrives in a later update (M2·C)" },
  317: { what: "changing stats", detail: "changing a hero's stats arrives in a later update (M2·C)" },
  318: { what: "changing skills", detail: "teaching or removing skills arrives in a later update (M2·C)" },
  319: { what: "changing equipment", detail: "changing a hero's gear from an event arrives in a later update (M2·C)" },
  320: { what: "changing a hero's name", detail: "renaming a hero arrives in a later update (M2·C)" },
  321: { what: "changing class", detail: "changing a hero's class arrives in a later update (M2·C)" },
  322: { what: "changing a hero's picture", detail: "swapping a hero's sprite/face arrives in a later update (M2·C)" },
  323: { what: "changing a vehicle's picture", detail: "swapping a vehicle's sprite arrives in a later update (M4·A)" },
  324: { what: "changing a nickname", detail: "changing a hero's nickname arrives in a later update (M2·C)" },
  325: { what: "changing a profile", detail: "changing a hero's profile arrives in a later update (M2·C)" },
  326: { what: "changing TP", detail: "the TP system arrives in a later update (M3·B)" },
  331: { what: "changing an enemy's HP", detail: "in-battle enemy commands arrive in a later update (M3·C)" },
  332: { what: "changing an enemy's MP", detail: "in-battle enemy commands arrive in a later update (M3·C)" },
  333: { what: "changing an enemy's status", detail: "in-battle enemy commands arrive in a later update (M3·C)" },
  334: { what: "fully healing an enemy", detail: "in-battle enemy commands arrive in a later update (M3·C)" },
  335: { what: "making an enemy appear", detail: "hidden enemies joining mid-battle arrive in a later update (M3·C)" },
  336: { what: "transforming an enemy", detail: "enemy transformations arrive in a later update (M3·C)" },
  337: { what: "a battle animation on an enemy", detail: "in-battle animations arrive in a later update (M3·C)" },
  339: { what: "forcing a battle action", detail: "forced battle actions arrive in a later update (M3·C)" },
  340: { what: "ending the battle early", detail: "aborting a battle arrives in a later update (M3·C)" },
  342: { what: "changing an enemy's TP", detail: "the TP system arrives in a later update (M3·B)" },
  356: { what: "a plugin command", detail: "plugin commands are listed in the import report, not run (M5·A)" },
  357: { what: "a plugin command", detail: "plugin commands are listed in the import report, not run (M5·A)" },
  601: { what: "what happens if you win the battle", detail: "battle win/lose branches arrive in a later update (M3·C)" },
  602: { what: "what happens if you flee the battle", detail: "battle win/lose branches arrive in a later update (M3·C)" },
  603: { what: "what happens if you lose the battle", detail: "battle win/lose branches arrive in a later update (M3·C)" },
};

// Codes that are an intentional skip (`−`, matrix §16): dropped with a friendly
// line, never preserved as a placeholder (they will never "come back").
const SKIP: Record<number, TodoInfo> = {
  217: { what: "regrouping the followers", detail: "Atlas keeps the follower trail together automatically" },
  261: { what: "a video", detail: "Atlas doesn't play movies; the game runs fine without it" },
  281: { what: "the map-name popup", detail: "Atlas doesn't show a map-name banner; the map still works" },
  351: { what: "opening the menu", detail: "the player can always open Atlas's own menu" },
};

/** RM conditional-branch / gold compare index → Atlas cmp string (matrix §8.6). */
const CMP = ["==", ">=", "<=", ">", "<", "!="];
/** RM facing (0 retain · 2 down · 4 left · 6 right · 8 up) → Atlas Dir (0 d/1 l/2 r/3 u). */
const RM_DIR: Record<number, 0 | 1 | 2 | 3> = { 0: 0, 2: 0, 4: 1, 6: 2, 8: 3 };
/** RM move-route step code → Atlas `CmdMove.steps` token (matrix §9, the `=`
 *  rows). Diagonals decompose (§9 5–8); everything else drops + reports. */
const MOVE_STEP: Record<number, string> = {
  1: "down", 2: "left", 3: "right", 4: "up", 12: "forward",
  16: "turn_down", 17: "turn_left", 18: "turn_right", 19: "turn_up",
};
const MOVE_DIAG: Record<number, [string, string]> = {
  5: ["down", "left"], 6: ["down", "right"], 7: ["up", "left"], 8: ["up", "right"],
};

/** RM Scroll Map direction (2 down · 4 left · 6 right · 8 up) → Atlas dir. */
const SCROLL_DIR: Record<number, "up" | "down" | "left" | "right"> = { 2: "down", 4: "left", 6: "right", 8: "up" };
/** RM tone array [r,g,b,gray] → Atlas tone tuple (defaults to normal). */
const toneOf = (t: any): [number, number, number, number] => {
  const a = Array.isArray(t) ? t : [0, 0, 0, 0];
  return [num(a[0]), num(a[1]), num(a[2]), num(a[3])];
};
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const hex2 = (n: number): string => ("0" + Math.max(0, Math.min(255, Math.round(n || 0))).toString(16)).slice(-2);
const rgbHex = (c: any): string => `#${hex2(c?.[0])}${hex2(c?.[1])}${hex2(c?.[2])}`;
const audioKey = (a: any): string => (a && a.name ? "asset:audio/" + a.name : "");

// ---------------------------------------------------------------------------
// The cursor-based recursive translator. One instance per top-level list.
// ---------------------------------------------------------------------------
class Translator {
  private i = 0;
  constructor(private readonly list: RmCommand[], private readonly report: ImportReport) {}

  run(): AnyCommand[] {
    this.i = 0;
    return this.parseBlock(0);
  }

  private peek(): RmCommand | undefined { return this.list[this.i]; }
  private at(code: number, indent: number): boolean {
    const c = this.list[this.i];
    return !!c && c.code === code && c.indent === indent;
  }

  /** Parse the run of statements at `indent`; stop when the indent drops below
   *  it (a nested block ended) or the list runs out. Openers consume their own
   *  same-indent continuations (401/402/411/412/413/604/605/655…). */
  private parseBlock(indent: number): AnyCommand[] {
    const out: AnyCommand[] = [];
    while (this.i < this.list.length) {
      const c = this.list[this.i];
      if (c.indent < indent) break;
      this.i++;
      this.dispatch(c, indent, out);
    }
    return out;
  }

  // -- report helpers -------------------------------------------------------
  private bump(key: string, kind: ReportKind, what: string, detail: string, code?: number): void {
    this.report.bump(key, () => ({ area: "Events", kind, what, detail, code }));
  }
  private todoCmd(cmd: RmCommand, info?: TodoInfo): AnyCommand {
    const t = info || TODO[cmd.code] || { what: "an unusual command", detail: "an RPG Maker command Atlas doesn't recognize yet — it was kept safe for a re-import" };
    this.bump("cmd-todo-" + cmd.code, "todo", t.what, t.detail, cmd.code);
    return { t: "mzTodo", code: cmd.code, params: (cmd.parameters as unknown[]) || [], label: cap(t.what) + " — coming in a later update" };
  }

  // -- the per-code table ---------------------------------------------------
  private dispatch(c: RmCommand, indent: number, out: AnyCommand[]): void {
    const p = (c.parameters as any[]) || [];
    switch (c.code) {
      // ---- §8.1 messages & text ----
      case 101: out.push(this.showText(c, indent)); return;
      case 102: out.push(this.showChoices(c, indent)); return;
      case 105: out.push(this.scrollText(c, indent)); return;
      case 108: this.consumeLines(108, 408, indent); return; // comment → dropped (not report-worthy)
      // ---- §8.2 flow control ----
      case 111: this.conditional(c, indent, out); return;
      case 112: out.push({ t: "loop", body: this.branchThen(indent) }); if (this.at(413, indent)) this.i++; return;
      case 113: out.push({ t: "breakLoop" }); return;
      case 115: this.bump("cmd-exit", "partial", "stopping the event early", "Atlas keeps running the rest of the event after this point", 115);
                out.push({ t: "mzTodo", code: 115, params: p, label: "Stop this event here — Atlas keeps going" }); return;
      case 117: out.push({ t: "commonEvent", commonEventId: num(p[0]) }); return;
      // ---- §8.3 party / progression ----
      case 121: this.controlSwitches(p, out); return;
      case 122: this.controlVariables(c, out); return;
      case 123: out.push({ t: "selfsw", key: String(p[0] ?? "A"), val: p[1] === 0 }); return;
      case 124: out.push({ t: "timer", op: num(p[0]) === 0 ? "start" : "stop", seconds: num(p[1]) }); return;
      case 125: this.changeGold(c, out); return;
      case 126: this.changeItem(c, "item", out); return;
      case 127: this.changeItem(c, "weapon", out); return;
      case 128: this.changeItem(c, "armor", out); return;
      case 129: out.push({ t: "party", op: p[1] === 0 ? "add" : "remove", actorId: num(p[0]) }); return;
      // ---- §8.5 movement & map ----
      case 201: this.transfer(c, out); return;
      case 204: out.push({ t: "scrollMap", dir: SCROLL_DIR[num(p[0])] || "right", distance: num(p[1]), speed: num(p[2]) || 4, wait: true }); return;
      case 205: this.moveRoute(c, out); return;
      case 211: out.push({ t: "transparency", val: p[0] === 0 }); return;
      case 212: out.push({ t: "playAnim", animationId: num(p[1]), target: p[0] === -1 ? "player" : "this", wait: true }); return;
      case 213: out.push({ t: "balloon", target: num(p[0]) === -1 ? "player" : num(p[0]) === 0 ? "this" : num(p[0]), balloonId: num(p[1]) || 1, wait: !!p[2] }); return;
      case 214: out.push({ t: "erase" }); return;
      // ---- §8.6 screen effects ----
      case 221: out.push({ t: "tint", tone: [-255, -255, -255, 0], frames: 24, wait: true }); return; // Fadeout → fade to black
      case 222: out.push({ t: "tint", tone: [0, 0, 0, 0], frames: 24, wait: true }); return;             // Fadein → back to normal
      case 223: out.push({ t: "tint", tone: toneOf(p[0]), frames: num(p[1]) || 60, wait: !!p[2] }); return;
      case 224: out.push({ t: "flash", color: rgbHex(p[0]), opacity: clamp01(num((p[0] || [])[3]) / 255) || 0.5, duration: num(p[1]) || 15, wait: !!p[2] }); return;
      case 225: out.push({ t: "shake", power: num(p[0]) || 5, speed: num(p[1]) || 5, duration: num(p[2]) || 30, wait: p[3] !== false }); return;
      case 236: out.push({ t: "weather", kind: weatherKind(p[0]), power: num(p[1]) || 5 }); return;
      // ---- §8.8 pictures ----
      case 231: this.showPic(c, out); return;
      case 232: this.movePic(c, out); return;
      case 233: out.push({ t: "rotatePic", id: num(p[0]) || 1, speed: num(p[1]) }); return;
      case 234: out.push({ t: "tintPic", id: num(p[0]) || 1, tone: toneOf(p[1]), frames: num(p[2]) || 60, wait: !!p[3] }); return;
      case 235: out.push({ t: "erasePic", id: num(p[0]) || 1 }); return;
      // ---- §8.7 timing ----
      case 230: out.push({ t: "wait", frames: num(p[0]) || 1 }); return;
      // ---- §8.9 audio & video ----
      case 241: out.push({ t: "music", theme: audioKey(p[0]) || "none" }); return;
      case 242: out.push({ t: "music", theme: "none", fadeMs: (num(p[0]) || 0) * 1000 }); return;
      case 250: { const k = audioKey(p[0]); if (k) out.push({ t: "se", name: k }); return; }
      // ---- §8.10 scene control ----
      case 301: this.battle(c, out); return;
      case 302: out.push(this.shop(c, indent)); return;
      case 352: out.push({ t: "save" }); return;
      case 353: out.push({ t: "gameover" }); return;
      case 354: out.push({ t: "totitle" }); return;
      // ---- §8.11 actor/party data ----
      case 311: this.changeHpMp(c, "hp", out); return;
      case 312: this.changeHpMp(c, "mp", out); return;
      case 314: this.recoverAll(c, out); return;
      // ---- §8.10 battle-result branch openers (siblings after 301) ----
      case 601: case 602: case 603:
        out.push(this.todoCmd(c)); this.branchThen(indent); return; // consume+discard the branch body (M3·C)
      case 604: return; // structural: end battle branches
      // ---- §8.13 script ----
      case 355: this.script(c, out); return;
      // ---- structural terminators / orphaned continuations → skip ----
      case 0: case 401: case 402: case 403: case 404: case 405:
      case 408: case 411: case 412: case 413: case 605: case 655: return;
      // ---- the `−` skip set ----
      default:
        if (SKIP[c.code]) { const s = SKIP[c.code]; this.bump("cmd-skip-" + c.code, "skipped", s.what, s.detail, c.code); return; }
        out.push(this.todoCmd(c)); return; // everything else (incl. all TODO codes) → mzTodo
    }
  }

  // -- §8.1 Show Text (101 + 401 lines) ------------------------------------
  private showText(c: RmCommand, indent: number): AnyCommand {
    const p = (c.parameters as any[]) || [];
    const lines: string[] = [];
    while (this.at(401, indent)) lines.push(String(((this.list[this.i++].parameters as any[]) || [])[0] ?? ""));
    const cmd: AnyCommand = { t: "text", text: lines.join("\n") } as any;
    // MZ carries a speaker name as the 5th param (MV has none — that's the §0 delta).
    if (typeof p[4] === "string" && p[4]) (cmd as any).name = p[4];
    // faceName+faceIndex → a portrait; Atlas links faces after the wizard slices art (M1·D).
    if (p[0]) this.bump("text-face", "partial", "message portraits", "message face pictures get linked after the import finishes");
    if (num(p[2]) !== 0 || num(p[3]) !== 2) this.bump("text-window", "todo", "message window style & position", "custom message backgrounds/positions arrive in a later update (M2·B)");
    return cmd;
  }

  // -- §8.1 Show Choices (102 + 402/403/404) -------------------------------
  private showChoices(c: RmCommand, indent: number): AnyCommand {
    const p = (c.parameters as any[]) || [];
    const options: string[] = Array.isArray(p[0]) ? (p[0] as any[]).map((s) => String(s)) : [];
    const branches: AnyCommand[][] = options.map(() => []);
    while (this.i < this.list.length) {
      if (this.at(402, indent)) {
        const wp = (this.list[this.i++].parameters as any[]) || [];
        const idx = num(wp[0]);
        const body = this.parseBlock(indent + 1);
        if (idx >= 0 && idx < branches.length) branches[idx] = body;
      } else if (this.at(403, indent)) {
        this.i++; this.parseBlock(indent + 1); // When Cancel → no Atlas home
        this.bump("choices-cancel", "partial", "the Cancel choice", "what happens when the player cancels a choice needs to be redone in Atlas");
      } else if (this.at(404, indent)) { this.i++; break; }
      else break;
    }
    return { t: "choices", options: options.length ? options : ["OK"], branches } as any;
  }

  // -- §8.2 Conditional Branch (111 + 411/412) -----------------------------
  private conditional(c: RmCommand, indent: number, out: AnyCommand[]): void {
    const cond = this.convertCond((c.parameters as any[]) || []);
    if (!cond) {
      // Unmappable condition: preserve as a placeholder, drop the bodies (report).
      this.bump("cmd-if-todo", "todo", "a special condition check", "some conditional-branch checks (timer/enemy/button/script/…) arrive in a later update", 111);
      out.push({ t: "mzTodo", code: 111, params: (c.parameters as any[]) || [], label: "A special condition check — coming in a later update" });
      this.branchThen(indent);
      if (this.at(411, indent)) { this.i++; this.parseBlock(indent + 1); }
      if (this.at(412, indent)) this.i++;
      return;
    }
    const then = this.branchThen(indent);
    let els: AnyCommand[] = [];
    if (this.at(411, indent)) { this.i++; els = this.parseBlock(indent + 1); }
    if (this.at(412, indent)) this.i++;
    out.push({ t: "if", cond, then, else: els } as any);
  }

  /** Parse an opener's primary child block (indent+1). */
  private branchThen(indent: number): AnyCommand[] { return this.parseBlock(indent + 1); }

  private convertCond(p: any[]): Condition | null {
    switch (num(p[0])) {
      case 0: return { kind: "switch", id: num(p[1]), val: p[2] === 0 };
      case 1: {
        if (num(p[2]) !== 0) return null; // operand is a variable/script → M2·C
        return { kind: "var", id: num(p[1]), cmp: CMP[num(p[4])] || ">=", val: num(p[3]) };
      }
      case 2: {
        if (p[2] === 1) this.bump("cond-selfsw-off", "partial", "a self-switch OFF check", "Atlas checks a self-switch is ON; an 'is OFF' check needs a quick edit");
        return { kind: "selfsw", key: String(p[1] ?? "A"), val: p[2] === 0 };
      }
      case 4: {
        const check = num(p[2]);
        if (check === 0) return { kind: "actor", actorId: num(p[1]), check: "inParty" };
        if (check === 4) return { kind: "actor", actorId: num(p[1]), check: "weapon", itemId: num(p[3]) };
        if (check === 5) return { kind: "actor", actorId: num(p[1]), check: "armor", itemId: num(p[3]) };
        return null; // name/class/skill/state checks → M2·C
      }
      case 7: {
        const cmp = num(p[2]) === 1 ? "<=" : num(p[2]) === 2 ? "<=" : ">=";
        if (num(p[2]) === 2) this.bump("cond-gold-lt", "partial", "a 'gold less than' check", "Atlas compares gold with ≤; a strict 'less than' becomes 'or equal'");
        return { kind: "gold", cmp, val: num(p[1]) };
      }
      case 8: return { kind: "item", itemKind: "item", id: num(p[1]) };
      case 9: return { kind: "item", itemKind: "weapon", id: num(p[1]) };
      case 10: return { kind: "item", itemKind: "armor", id: num(p[1]) };
      default: return null; // 3 timer · 5 enemy · 6 character · 11 button · 12 script · 13 vehicle
    }
  }

  // -- §8.3 party / progression --------------------------------------------
  private controlSwitches(p: any[], out: AnyCommand[]): void {
    const a = num(p[0]), b = num(p[1]) || num(p[0]), val = p[2] === 0;
    for (let id = Math.min(a, b); id <= Math.max(a, b); id++) out.push({ t: "switch", id, val });
  }
  private controlVariables(c: RmCommand, out: AnyCommand[]): void {
    const p = (c.parameters as any[]) || [];
    const a = num(p[0]), b = num(p[1]) || num(p[0]), oper = num(p[2]), operandType = num(p[3]);
    const OP: Record<number, "set" | "add" | "sub"> = { 0: "set", 1: "add", 2: "sub" };
    if (operandType === 0 && OP[oper]) {
      const val = num(p[4]);
      for (let id = Math.min(a, b); id <= Math.max(a, b); id++) out.push({ t: "var", id, op: OP[oper], val });
      return;
    }
    if (operandType === 2 && oper === 0) { // random, set
      const lo = num(p[4]), hi = num(p[5]);
      for (let id = Math.min(a, b); id <= Math.max(a, b); id++) out.push({ t: "var", id, op: "rnd", val: lo, val2: hi });
      return;
    }
    this.bump("cmd-var-todo", "todo", "advanced variable math", "reading game data (item counts, positions…) or multiply/divide into a variable arrives in a later update (M2·C)", 122);
    out.push({ t: "mzTodo", code: 122, params: p, label: "Advanced variable math — coming in a later update" });
  }
  private changeGold(c: RmCommand, out: AnyCommand[]): void {
    const p = (c.parameters as any[]) || [];
    if (num(p[1]) !== 0) { this.bump("cmd-gold-var", "todo", "changing gold by a variable", "gold amounts read from a variable arrive in a later update (M2·C)", 125); out.push({ t: "mzTodo", code: 125, params: p, label: "Change gold by a variable — coming in a later update" }); return; }
    out.push({ t: "gold", op: num(p[0]) === 0 ? "add" : "sub", val: num(p[2]) });
  }
  private changeItem(c: RmCommand, kind: "item" | "weapon" | "armor", out: AnyCommand[]): void {
    const p = (c.parameters as any[]) || [];
    if (num(p[2]) !== 0) { this.bump("cmd-item-var-" + kind, "todo", "changing " + kind + "s by a variable", "item counts read from a variable arrive in a later update (M2·C)", c.code); out.push({ t: "mzTodo", code: c.code, params: p, label: "Change " + kind + "s by a variable — coming in a later update" }); return; }
    out.push({ t: "item", kind, id: num(p[0]), op: num(p[1]) === 0 ? "add" : "sub", val: num(p[3]) });
  }

  // -- §8.5 movement -------------------------------------------------------
  private transfer(c: RmCommand, out: AnyCommand[]): void {
    const p = (c.parameters as any[]) || [];
    if (num(p[0]) !== 0) { this.bump("cmd-transfer-var", "todo", "a transfer to a variable spot", "transfers whose destination is stored in variables arrive in a later update (M2·C)", 201); out.push({ t: "mzTodo", code: 201, params: p, label: "Transfer to a variable spot — coming in a later update" }); return; }
    out.push({ t: "transfer", mapId: num(p[1]), x: num(p[2]), y: num(p[3]), dir: RM_DIR[num(p[4])] ?? 0 });
  }
  private moveRoute(c: RmCommand, out: AnyCommand[]): void {
    const p = (c.parameters as any[]) || [];
    const charId = num(p[0]);
    if (charId > 0) { this.bump("cmd-move-other", "todo", "moving another event by number", "move routes aimed at a specific event by number arrive in a later update", 205); out.push({ t: "mzTodo", code: 205, params: p, label: "Move another event — coming in a later update" }); return; }
    const route = p[1] as RmMoveRoute;
    out.push({ t: "move", target: charId === -1 ? "player" : "this", steps: this.routeSteps(route), wait: !!(route && route.wait) });
  }
  /** Move-route step list → Atlas `CmdMove.steps` (matrix §9). */
  private routeSteps(route: RmMoveRoute | undefined): string[] {
    const steps: string[] = [];
    let simplified = false;
    for (const mc of (route && route.list) || []) {
      if (MOVE_STEP[mc.code]) { steps.push(MOVE_STEP[mc.code]); continue; }
      if (MOVE_DIAG[mc.code]) { steps.push(...MOVE_DIAG[mc.code]); simplified = true; continue; }
      if (mc.code === 14) { steps.push("jump"); if (((mc.parameters as any[]) || []).some((v) => v)) simplified = true; continue; }
      if (mc.code === 15) { const f = num(((mc.parameters as any[]) || [])[0]) || 15; steps.push(f > 30 ? "wait60" : "wait15"); continue; }
      if (mc.code === 0) continue; // route terminator
      simplified = true; // 9–13 dynamic, 20–26 relative turns, 27–45 extras → dropped
    }
    if (simplified) this.bump("route-steps", "partial", "some movement details", "fancy movement steps (diagonals, chase, speed, in-route sounds…) were simplified to the basic moves");
    return steps;
  }

  // -- §8.10 scene control -------------------------------------------------
  private battle(c: RmCommand, out: AnyCommand[]): void {
    const p = (c.parameters as any[]) || [];
    if (num(p[0]) !== 0) { this.bump("cmd-battle-var", "todo", "a battle chosen by a variable", "battles whose troop is chosen at random or by a variable arrive in a later update", 301); out.push({ t: "mzTodo", code: 301, params: p, label: "Battle chosen by a variable — coming in a later update" }); return; }
    out.push({ t: "battle", troopId: num(p[1]), escape: !!p[2], lose: !!p[3] });
  }
  private shop(c: RmCommand, indent: number): AnyCommand {
    const goods: { kind: "item" | "weapon" | "armor"; id: number }[] = [];
    const KIND: Record<number, "item" | "weapon" | "armor"> = { 0: "item", 1: "weapon", 2: "armor" };
    let custom = false;
    const add = (g: any[]) => {
      const kind = KIND[num(g[0])]; if (!kind || !num(g[1])) return;
      goods.push({ kind, id: num(g[1]) });
      if (num(g[2]) === 1) custom = true; // custom price override
    };
    add((c.parameters as any[]) || []);
    while (this.at(605, indent)) add((this.list[this.i++].parameters as any[]) || []);
    if (custom) this.bump("shop-price", "partial", "custom shop prices", "Atlas shops sell items at their normal price");
    return { t: "shop", goods } as any;
  }

  // -- §8.11 actor/party data ----------------------------------------------
  private changeHpMp(c: RmCommand, field: "hp" | "mp", out: AnyCommand[]): void {
    const p = (c.parameters as any[]) || [];
    // Only the simple case maps: whole party (fixed, actorId 0), increase, constant.
    if (num(p[0]) === 0 && num(p[1]) === 0 && num(p[2]) === 0 && num(p[3]) === 0) {
      this.bump("cmd-heal-partywide", "partial", "restoring " + field.toUpperCase(), "restored " + field.toUpperCase() + " to the whole party (Atlas heals everyone together)");
      out.push({ t: "heal", [field]: num(p[4]) } as any);
      return;
    }
    out.push(this.todoCmd(c, TODO[c.code]));
  }
  private recoverAll(c: RmCommand, out: AnyCommand[]): void {
    const p = (c.parameters as any[]) || [];
    if (num(p[1]) !== 0) this.bump("cmd-recover-one", "partial", "a full heal", "Atlas fully heals the whole party together");
    out.push({ t: "heal", full: true });
  }

  // -- §8.13 script (355 + 655 lines) --------------------------------------
  private script(c: RmCommand, out: AnyCommand[]): void {
    const lines = [String(((c.parameters as any[]) || [])[0] ?? "")];
    while (this.at(655, c.indent)) lines.push(String(((this.list[this.i++].parameters as any[]) || [])[0] ?? ""));
    this.bump("cmd-script", "todo", "a script snippet", "small RPG Maker scripts that read game data run in a later update (M5·B); the rest are listed in the import report");
    out.push({ t: "mzTodo", code: 355, params: [lines.join("\n")], label: "A script snippet — coming in a later update" });
  }

  // -- §8.1 Show Scrolling Text (105 + 405 lines) --------------------------
  private scrollText(c: RmCommand, indent: number): AnyCommand {
    const p = (c.parameters as any[]) || [];
    const lines: string[] = [];
    while (this.at(405, indent)) lines.push(String(((this.list[this.i++].parameters as any[]) || [])[0] ?? ""));
    return { t: "scrollText", text: lines.join("\n"), speed: num(p[0]) || 2, noFast: !!p[1] } as AnyCommand;
  }

  // -- §8.8 Pictures (231 / 232) -------------------------------------------
  /** RM picture name → an Atlas "asset:pictures/<slug>" key, and one aggregated
   *  report line: pictures play now, but their art must be re-added (M1's asset
   *  pipeline doesn't import img/pictures — matrix §16 / mig-2 spec). */
  private pictureKey(raw: any): string {
    const name = String(raw || "");
    if (!name) return "";
    this.bump("pic-art", "partial", "picture image files",
      "your pictures now play in Atlas — add their image files to the Assets library and they'll appear (the picture names are kept for you)");
    return assetKeyOf("pictures", slugName(name));
  }
  private picVarPos(): void {
    this.bump("pic-var-pos", "partial", "a picture placed by a variable",
      "pictures positioned from a variable use a fixed spot for now (variable positions arrive in a later update, M2·C)");
  }
  private showPic(c: RmCommand, out: AnyCommand[]): void {
    const p = (c.parameters as any[]) || [];
    const varDesig = num(p[3]) === 1;
    if (varDesig) this.picVarPos();
    out.push({
      t: "showPic", id: num(p[0]) || 1, name: this.pictureKey(p[1]), origin: num(p[2]),
      x: varDesig ? 0 : num(p[4]), y: varDesig ? 0 : num(p[5]),
      scaleX: p[6] == null ? 100 : num(p[6]), scaleY: p[7] == null ? 100 : num(p[7]),
      opacity: p[8] == null ? 255 : num(p[8]), blend: num(p[9]),
    });
  }
  private movePic(c: RmCommand, out: AnyCommand[]): void {
    const p = (c.parameters as any[]) || [];
    const varDesig = num(p[2]) === 1;
    if (varDesig) this.picVarPos();
    out.push({
      t: "movePic", id: num(p[0]) || 1, origin: num(p[1]),
      x: varDesig ? 0 : num(p[3]), y: varDesig ? 0 : num(p[4]),
      scaleX: p[5] == null ? 100 : num(p[5]), scaleY: p[6] == null ? 100 : num(p[6]),
      opacity: p[7] == null ? 255 : num(p[7]), blend: num(p[8]),
      frames: num(p[9]) || 1, wait: !!p[10],
    });
  }

  /** Consume `openerCode`'s following continuation lines (`lineCode`) at `indent`. */
  private consumeLines(_openerCode: number, lineCode: number, indent: number): void {
    while (this.at(lineCode, indent)) this.i++;
  }
}

const num = (v: any): number => (typeof v === "number" ? v : Number(v) || 0);
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
function weatherKind(v: any): string {
  const k = String(v || "none");
  return k === "rain" || k === "storm" || k === "snow" || k === "fog" ? k : "none";
}

/** Translate one RM command list into Atlas commands (matrix §8/§9/§13). */
export function translateCommands(list: RmCommand[] | undefined, report: ImportReport): AnyCommand[] {
  return new Translator(Array.isArray(list) ? list : [], report).run();
}

/** Build the `CommandTranslator` seam M1·A/M1·B left injected — the real spine.
 *  Every command-bearing record (common events, troop pages, map event pages)
 *  runs its list through this. */
export function makeTranslator(report: ImportReport): CommandTranslator {
  return (list: RmCommand[]) => translateCommands(list, report);
}
