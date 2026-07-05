/* RPGAtlas — tests-unit/mz-translate-commands.test.ts
   Project Compass M1·C: the command-translation table (the spine). The SPEC
   table below is BOTH the test corpus and the human-readable spec — one row per
   RPG Maker event-command code (matrix §8, 101–657) asserting the code either
   translates to the right Atlas command or becomes an `mzTodo` placeholder /
   intentional skip. Adds focused tests for nested structure (branches / loops /
   choices / battle-result branches), move routes (§9), escape-code passthrough
   (§13), event-page conversion, and the full fixture round-trip through
   `convertProject` + a bootable-project assemble check.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assembleProject,
  convertMapEvents,
  fsSource,
  importMzProject,
  makeTranslator,
  translateCommands,
  type FsReadFns,
  type MzProjectResult,
} from "../src/editor/importers/mz";
import { ImportReport } from "../src/editor/importers/mz/report";
import type { RmCommand, RmEvent } from "../src/editor/importers/mz/raw-types";
import { isProjectLike, validateProject, type AnyCommand, type Project } from "../src/shared/schema";

// --- helpers ----------------------------------------------------------------
const c = (code: number, parameters: unknown[] = [], indent = 0): RmCommand => ({ code, indent, parameters });
function tr(list: RmCommand[]): { cmds: AnyCommand[]; report: ImportReport } {
  const report = new ImportReport();
  return { cmds: translateCommands(list, report), report };
}
const t0 = (list: RmCommand[]): AnyCommand => tr(list).cmds[0];

// ============================================================================
// The SPEC table — one row per §8 code. `expect` is one of:
//   { first: "<atlas t>" }  → cmds[0].t is that Atlas command
//   { todo: <code> }        → cmds[0] is an mzTodo preserving that raw code
//   { drop: true }          → nothing emitted (intentional skip / comment)
// ============================================================================
type Expect = { first: string } | { todo: number } | { drop: true };
interface Row { code: number; name: string; list: RmCommand[]; expect: Expect; }

const SPEC: Row[] = [
  // §8.1 messages & text
  { code: 101, name: "Show Text", list: [c(101, ["", 0, 0, 2, "Bo"]), c(401, ["Hi"])], expect: { first: "text" } },
  { code: 102, name: "Show Choices", list: [c(102, [["A", "B"], 1]), c(404)], expect: { first: "choices" } },
  { code: 103, name: "Input Number", list: [c(103, [1, 2])], expect: { first: "inputNumber" } },
  { code: 104, name: "Select Item", list: [c(104, [1, 2])], expect: { first: "selectItem" } },
  { code: 105, name: "Scrolling Text", list: [c(105, [2, false]), c(405, ["scroll"])], expect: { first: "scrollText" } },
  { code: 108, name: "Comment", list: [c(108, ["note"]), c(408, ["more"])], expect: { drop: true } },
  // §8.2 flow control
  { code: 111, name: "Conditional Branch", list: [c(111, [0, 1, 0])], expect: { first: "if" } },
  { code: 112, name: "Loop", list: [c(112), c(413)], expect: { first: "loop" } },
  { code: 113, name: "Break Loop", list: [c(113)], expect: { first: "breakLoop" } },
  { code: 115, name: "Exit Event", list: [c(115)], expect: { todo: 115 } },
  { code: 117, name: "Common Event", list: [c(117, [1])], expect: { first: "commonEvent" } },
  { code: 118, name: "Label", list: [c(118, ["x"])], expect: { todo: 118 } },
  { code: 119, name: "Jump to Label", list: [c(119, ["x"])], expect: { todo: 119 } },
  // §8.3 party / progression
  { code: 121, name: "Control Switches", list: [c(121, [3, 3, 0])], expect: { first: "switch" } },
  { code: 122, name: "Control Variables", list: [c(122, [1, 1, 0, 0, 5])], expect: { first: "var" } },
  { code: 123, name: "Control Self Switch", list: [c(123, ["A", 0])], expect: { first: "selfsw" } },
  { code: 124, name: "Control Timer", list: [c(124, [0, 30])], expect: { first: "timer" } },
  { code: 125, name: "Change Gold", list: [c(125, [0, 0, 100])], expect: { first: "gold" } },
  { code: 126, name: "Change Items", list: [c(126, [1, 0, 0, 2])], expect: { first: "item" } },
  { code: 127, name: "Change Weapons", list: [c(127, [1, 0, 0, 1])], expect: { first: "item" } },
  { code: 128, name: "Change Armors", list: [c(128, [1, 0, 0, 1])], expect: { first: "item" } },
  { code: 129, name: "Change Party Member", list: [c(129, [1, 0, 0])], expect: { first: "party" } },
  // §8.4 system settings → all M2·C / M4·B / report placeholders
  { code: 132, name: "Change Battle BGM", list: [c(132, [{ name: "B" }])], expect: { todo: 132 } },
  { code: 133, name: "Change Victory ME", list: [c(133, [{ name: "V" }])], expect: { todo: 133 } },
  { code: 134, name: "Change Save Access", list: [c(134, [0])], expect: { todo: 134 } },
  { code: 135, name: "Change Menu Access", list: [c(135, [0])], expect: { todo: 135 } },
  { code: 136, name: "Change Encounter", list: [c(136, [0])], expect: { todo: 136 } },
  { code: 137, name: "Change Formation Access", list: [c(137, [0])], expect: { todo: 137 } },
  { code: 138, name: "Change Window Color", list: [c(138, [[0, 0, 0]])], expect: { todo: 138 } },
  { code: 139, name: "Change Defeat ME", list: [c(139, [{ name: "D" }])], expect: { todo: 139 } },
  { code: 140, name: "Change Vehicle BGM", list: [c(140, [0, { name: "V" }])], expect: { todo: 140 } },
  // §8.5 movement & map
  { code: 201, name: "Transfer Player", list: [c(201, [0, 2, 4, 4, 2, 0])], expect: { first: "transfer" } },
  { code: 202, name: "Set Vehicle Location", list: [c(202, [0, 0, 1, 1])], expect: { todo: 202 } },
  { code: 203, name: "Set Event Location", list: [c(203, [1, 0, 2, 2])], expect: { todo: 203 } },
  { code: 204, name: "Scroll Map", list: [c(204, [2, 3, 4])], expect: { first: "scrollMap" } },
  { code: 205, name: "Set Movement Route", list: [c(205, [-1, { list: [c(1), c(0)], wait: true }])], expect: { first: "move" } },
  { code: 206, name: "Get on/off Vehicle", list: [c(206)], expect: { todo: 206 } },
  { code: 211, name: "Change Transparency", list: [c(211, [0])], expect: { first: "transparency" } },
  { code: 212, name: "Show Animation", list: [c(212, [-1, 3, true])], expect: { first: "playAnim" } },
  { code: 213, name: "Show Balloon Icon", list: [c(213, [-1, 1, false])], expect: { first: "balloon" } },
  { code: 214, name: "Erase Event", list: [c(214)], expect: { first: "erase" } },
  { code: 216, name: "Change Followers", list: [c(216, [0])], expect: { todo: 216 } },
  { code: 217, name: "Gather Followers", list: [c(217)], expect: { drop: true } },
  { code: 281, name: "Change Map Name Display", list: [c(281, [0])], expect: { drop: true } },
  { code: 282, name: "Change Tileset", list: [c(282, [2])], expect: { todo: 282 } },
  { code: 283, name: "Change Battle Back", list: [c(283, ["b1", "b2"])], expect: { todo: 283 } },
  { code: 284, name: "Change Parallax", list: [c(284, ["p"])], expect: { todo: 284 } },
  { code: 285, name: "Get Location Info", list: [c(285, [1, 0, 0, 0])], expect: { todo: 285 } },
  // §8.6 screen effects
  { code: 221, name: "Fadeout Screen", list: [c(221)], expect: { first: "tint" } },
  { code: 222, name: "Fadein Screen", list: [c(222)], expect: { first: "tint" } },
  { code: 223, name: "Tint Screen", list: [c(223, [[0, 0, 0, 0], 60, false])], expect: { first: "tint" } },
  { code: 224, name: "Flash Screen", list: [c(224, [[255, 255, 255, 170], 15, false])], expect: { first: "flash" } },
  { code: 225, name: "Shake Screen", list: [c(225, [5, 5, 30, true])], expect: { first: "shake" } },
  { code: 236, name: "Set Weather", list: [c(236, ["rain", 5, 60, false])], expect: { first: "weather" } },
  // §8.7 timing
  { code: 230, name: "Wait", list: [c(230, [60])], expect: { first: "wait" } },
  // §8.8 pictures
  { code: 231, name: "Show Picture", list: [c(231, [1, "P", 0, 0, 0, 0, 100, 100, 255, 0])], expect: { first: "showPic" } },
  { code: 232, name: "Move Picture", list: [c(232, [1, 0, 0, 0, 0, 100, 100, 255, 0, 30, 0])], expect: { first: "movePic" } },
  { code: 233, name: "Rotate Picture", list: [c(233, [1, 5])], expect: { first: "rotatePic" } },
  { code: 234, name: "Tint Picture", list: [c(234, [1, [0, 0, 0, 0], 60, false])], expect: { first: "tintPic" } },
  { code: 235, name: "Erase Picture", list: [c(235, [1])], expect: { first: "erasePic" } },
  // §8.9 audio & video
  { code: 241, name: "Play BGM", list: [c(241, [{ name: "Town" }])], expect: { first: "music" } },
  { code: 242, name: "Fadeout BGM", list: [c(242, [2])], expect: { first: "music" } },
  { code: 243, name: "Save BGM", list: [c(243)], expect: { todo: 243 } },
  { code: 244, name: "Resume BGM", list: [c(244)], expect: { todo: 244 } },
  { code: 245, name: "Play BGS", list: [c(245, [{ name: "S" }])], expect: { todo: 245 } },
  { code: 246, name: "Fadeout BGS", list: [c(246, [2])], expect: { todo: 246 } },
  { code: 249, name: "Play ME", list: [c(249, [{ name: "M" }])], expect: { todo: 249 } },
  { code: 250, name: "Play SE", list: [c(250, [{ name: "Cursor" }])], expect: { first: "se" } },
  { code: 251, name: "Stop SE", list: [c(251)], expect: { todo: 251 } },
  { code: 261, name: "Play Movie", list: [c(261, ["m"])], expect: { drop: true } },
  // §8.10 scene control
  { code: 301, name: "Battle Processing", list: [c(301, [0, 1, true, true])], expect: { first: "battle" } },
  { code: 302, name: "Shop Processing", list: [c(302, [0, 1, 0, 0])], expect: { first: "shop" } },
  { code: 303, name: "Name Input", list: [c(303, [1, 8])], expect: { first: "nameInput" } },
  { code: 351, name: "Open Menu Screen", list: [c(351)], expect: { drop: true } },
  { code: 352, name: "Open Save Screen", list: [c(352)], expect: { first: "save" } },
  { code: 353, name: "Game Over", list: [c(353)], expect: { first: "gameover" } },
  { code: 354, name: "Return to Title", list: [c(354)], expect: { first: "totitle" } },
  // §8.11 actor/party data
  { code: 311, name: "Change HP (party+const)", list: [c(311, [0, 0, 0, 0, 50, false])], expect: { first: "heal" } },
  { code: 312, name: "Change MP (party+const)", list: [c(312, [0, 0, 0, 0, 20])], expect: { first: "heal" } },
  { code: 313, name: "Change State", list: [c(313, [0, 0, 0, 1])], expect: { todo: 313 } },
  { code: 314, name: "Recover All", list: [c(314, [0, 0])], expect: { first: "heal" } },
  { code: 315, name: "Change EXP", list: [c(315, [0, 1, 0, 0, 100])], expect: { todo: 315 } },
  { code: 316, name: "Change Level", list: [c(316, [0, 1, 0, 0, 1])], expect: { todo: 316 } },
  { code: 317, name: "Change Parameters", list: [c(317, [0, 1, 0, 0, 0, 10])], expect: { todo: 317 } },
  { code: 318, name: "Change Skills", list: [c(318, [0, 1, 0, 1])], expect: { todo: 318 } },
  { code: 319, name: "Change Equipment", list: [c(319, [1, 0, 1])], expect: { todo: 319 } },
  { code: 320, name: "Change Name", list: [c(320, [1, "X"])], expect: { todo: 320 } },
  { code: 321, name: "Change Class", list: [c(321, [1, 2, false])], expect: { todo: 321 } },
  { code: 322, name: "Change Actor Images", list: [c(322, [1, "F", 0, "C", 0])], expect: { todo: 322 } },
  { code: 323, name: "Change Vehicle Image", list: [c(323, [0, "V", 0])], expect: { todo: 323 } },
  { code: 324, name: "Change Nickname", list: [c(324, [1, "N"])], expect: { todo: 324 } },
  { code: 325, name: "Change Profile", list: [c(325, [1, "P"])], expect: { todo: 325 } },
  { code: 326, name: "Change TP", list: [c(326, [0, 1, 0, 0, 10])], expect: { todo: 326 } },
  // §8.12 enemy/battle in-troop
  { code: 331, name: "Change Enemy HP", list: [c(331, [0, 0, 0, 20])], expect: { todo: 331 } },
  { code: 332, name: "Change Enemy MP", list: [c(332, [0, 0, 0, 20])], expect: { todo: 332 } },
  { code: 333, name: "Change Enemy State", list: [c(333, [0, 0, 1])], expect: { todo: 333 } },
  { code: 334, name: "Enemy Recover All", list: [c(334, [0])], expect: { todo: 334 } },
  { code: 335, name: "Enemy Appear", list: [c(335, [0])], expect: { todo: 335 } },
  { code: 336, name: "Enemy Transform", list: [c(336, [0, 2])], expect: { todo: 336 } },
  { code: 337, name: "Show Battle Animation", list: [c(337, [0, 0, 2])], expect: { todo: 337 } },
  { code: 339, name: "Force Action", list: [c(339, [0, 0, 1, 0])], expect: { todo: 339 } },
  { code: 340, name: "Abort Battle", list: [c(340)], expect: { todo: 340 } },
  { code: 342, name: "Change Enemy TP", list: [c(342, [0, 0, 0, 10])], expect: { todo: 342 } },
  // §8.13 script / plugin
  { code: 355, name: "Script", list: [c(355, ["$gameSwitches.value(1)"])], expect: { todo: 355 } },
  { code: 356, name: "Plugin Command (MV)", list: [c(356, ["Foo bar"])], expect: { todo: 356 } },
  { code: 357, name: "Plugin Command (MZ)", list: [c(357, ["Foo", "bar", "bar", {}])], expect: { todo: 357 } },
];

describe("SPEC: one row per MZ event-command code (matrix §8)", () => {
  it.each(SPEC)("code $code — $name", (row) => {
    const { cmds } = tr(row.list);
    if ("drop" in row.expect) {
      expect(cmds).toHaveLength(0);
    } else if ("todo" in row.expect) {
      expect(cmds[0]).toBeDefined();
      expect((cmds[0] as any).t).toBe("mzTodo");
      expect((cmds[0] as any).code).toBe(row.expect.todo);
      expect((cmds[0] as any).label).toMatch(/coming in a later update|Atlas keeps going/);
    } else {
      expect((cmds[0] as any).t).toBe(row.expect.first);
    }
  });

  it("every SPEC code is unique (no accidental dupes)", () => {
    const codes = SPEC.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

// ============================================================================
// Real-translation field fidelity (the `=` rows carry data, not just a type).
// ============================================================================
describe("real translations carry their fields (matrix §8)", () => {
  it("101 Show Text folds 401 lines + MZ speaker name", () => {
    const cmd = t0([c(101, ["Face", 0, 0, 2, "Mara"]), c(401, ["Line one"]), c(401, ["Line two"])]) as any;
    expect(cmd.t).toBe("text");
    expect(cmd.name).toBe("Mara");
    expect(cmd.text).toBe("Line one\nLine two");
  });
  it("101 without a 5th param (MV) has no speaker name", () => {
    const cmd = t0([c(101, ["Face", 0, 0, 2]), c(401, ["Hi"])]) as any;
    expect(cmd.name).toBeUndefined();
  });
  it("102 Show Choices builds per-option branches (402/404)", () => {
    const cmd = t0([
      c(102, [["Yes", "No"], 1]),
      c(402, [0, "Yes"]), c(121, [5, 5, 0], 1), c(0, [], 1),
      c(402, [1, "No"]), c(0, [], 1),
      c(404),
    ]) as any;
    expect(cmd.options).toEqual(["Yes", "No"]);
    expect(cmd.branches[0][0].t).toBe("switch");
    expect(cmd.branches[0][0].id).toBe(5);
    expect(cmd.branches[1]).toEqual([]);
  });
  it("111 Conditional Branch maps common condition types", () => {
    expect((t0([c(111, [0, 2, 0])]) as any).cond).toEqual({ kind: "switch", id: 2, val: true });
    expect((t0([c(111, [0, 2, 1])]) as any).cond.val).toBe(false); // OFF
    expect((t0([c(111, [1, 3, 0, 10, 1])]) as any).cond).toEqual({ kind: "var", id: 3, cmp: ">=", val: 10 });
    expect((t0([c(111, [8, 4])]) as any).cond).toEqual({ kind: "item", itemKind: "item", id: 4 });
    expect((t0([c(111, [7, 500, 0])]) as any).cond).toEqual({ kind: "gold", cmp: ">=", val: 500 });
  });
  it("111 with then + else + 411/412 nests both blocks", () => {
    const cmd = t0([
      c(111, [0, 1, 0]),
      c(125, [0, 0, 10], 1),
      c(411),
      c(125, [1, 0, 5], 1),
      c(412),
    ]) as any;
    expect(cmd.then[0]).toMatchObject({ t: "gold", op: "add" });
    expect(cmd.else[0]).toMatchObject({ t: "gold", op: "sub" });
  });
  it("111 with an unmappable condition becomes mzTodo + drops bodies", () => {
    const { cmds, report } = tr([c(111, [12, "some.script()"]), c(125, [0, 0, 9], 1), c(412)]);
    expect((cmds[0] as any).t).toBe("mzTodo");
    expect((cmds[0] as any).code).toBe(111);
    expect(cmds).toHaveLength(1); // then-body dropped
    expect(report.lines.some((l) => l.kind === "todo")).toBe(true);
  });
  it("112 Loop captures its body + Break Loop", () => {
    const cmd = t0([c(112), c(113, [], 1), c(413)]) as any;
    expect(cmd.t).toBe("loop");
    expect(cmd.body[0].t).toBe("breakLoop");
  });
  it("121 Control Switches expands a range", () => {
    const cmds = tr([c(121, [2, 4, 0])]).cmds as any[];
    expect(cmds.map((x) => x.id)).toEqual([2, 3, 4]);
    expect(cmds.every((x) => x.t === "switch" && x.val === true)).toBe(true);
  });
  it("122 Control Variables: const set/add + random, else mzTodo", () => {
    expect(t0([c(122, [1, 1, 0, 0, 7])])).toMatchObject({ t: "var", op: "set", val: 7 });
    expect(t0([c(122, [1, 1, 1, 0, 3])])).toMatchObject({ t: "var", op: "add", val: 3 });
    expect(t0([c(122, [1, 1, 0, 2, 1, 6])])).toMatchObject({ t: "var", op: "rnd", val: 1, val2: 6 });
    expect((t0([c(122, [1, 1, 0, 3, 0, 0])]) as any).t).toBe("mzTodo"); // game-data operand
  });
  it("201 Transfer maps coords + RM facing → Atlas Dir", () => {
    expect(t0([c(201, [0, 2, 5, 6, 4, 0])])).toEqual({ t: "transfer", mapId: 2, x: 5, y: 6, dir: 1 });
    expect((t0([c(201, [1, 0, 0, 0, 0, 0])]) as any).t).toBe("mzTodo"); // variable destination
  });
  it("224 Flash maps color/opacity/duration", () => {
    expect(t0([c(224, [[255, 0, 0, 128], 20, true])])).toMatchObject({ t: "flash", color: "#ff0000", duration: 20, wait: true });
  });
  it("225 Shake + 230 Wait + 236 Weather + 250 SE carry values", () => {
    expect(t0([c(225, [7, 8, 40, false])])).toMatchObject({ t: "shake", power: 7, speed: 8, duration: 40, wait: false });
    expect(t0([c(230, [45])])).toEqual({ t: "wait", frames: 45 });
    expect(t0([c(236, ["snow", 3, 30, false])])).toEqual({ t: "weather", kind: "snow", power: 3 });
    expect(t0([c(250, [{ name: "Coin" }])])).toEqual({ t: "se", name: "asset:audio/Coin" });
  });
  it("241/242 BGM → asset key / stop-with-fade", () => {
    expect(t0([c(241, [{ name: "Field" }])])).toEqual({ t: "music", theme: "asset:audio/Field" });
    expect(t0([c(242, [3])])).toEqual({ t: "music", theme: "none", fadeMs: 3000 });
  });
  it("301 Battle Processing carries troop + escape/lose", () => {
    expect(t0([c(301, [0, 4, false, true])])).toEqual({ t: "battle", troopId: 4, escape: false, lose: true });
  });
  it("301 + 601/602/603 battle-result branches → battle then mzTodo markers", () => {
    const { cmds } = tr([
      c(301, [0, 1, true, true]),
      c(601), c(101, ["", 0, 0, 2, ""], 1), c(401, ["win"], 1), c(0, [], 1),
      c(602), c(0, [], 1),
      c(603), c(353, [], 1), c(0, [], 1),
      c(604),
    ]);
    expect((cmds[0] as any).t).toBe("battle");
    expect(cmds.slice(1).map((x: any) => x.t)).toEqual(["mzTodo", "mzTodo", "mzTodo"]);
    expect(cmds.slice(1).map((x: any) => x.code)).toEqual([601, 602, 603]);
  });
  it("302 Shop gathers 302 + 605 goods", () => {
    const cmd = t0([c(302, [0, 1, 0, 0]), c(605, [1, 2, 0, 0]), c(605, [2, 3, 0, 0])]) as any;
    expect(cmd.t).toBe("shop");
    expect(cmd.goods).toEqual([{ kind: "item", id: 1 }, { kind: "weapon", id: 2 }, { kind: "armor", id: 3 }]);
  });
  it("311/312 only party-wide constant heals map; targeted → mzTodo", () => {
    expect(t0([c(311, [0, 0, 0, 0, 50, false])])).toMatchObject({ t: "heal", hp: 50 });
    expect(t0([c(312, [0, 0, 0, 0, 20])])).toMatchObject({ t: "heal", mp: 20 });
    expect((t0([c(311, [0, 3, 0, 0, 50, false])]) as any).t).toBe("mzTodo"); // single actor
  });
  it("355 Script folds 655 lines into one preserved placeholder", () => {
    const { cmds } = tr([c(355, ["if (a) {"]), c(655, ["  b();"]), c(655, ["}"])]);
    expect(cmds).toHaveLength(1);
    expect((cmds[0] as any).code).toBe(355);
    expect((cmds[0] as any).params[0]).toBe("if (a) {\n  b();\n}");
  });

  // ---- M2·A presentation flips (matrix §8.6/§8.8, §16) ----
  it("124 Control Timer maps start/stop + seconds", () => {
    expect(t0([c(124, [0, 30])])).toEqual({ t: "timer", op: "start", seconds: 30 });
    expect(t0([c(124, [1, 0])])).toEqual({ t: "timer", op: "stop", seconds: 0 });
  });
  it("204 Scroll Map maps direction/distance/speed", () => {
    expect(t0([c(204, [8, 5, 3])])).toEqual({ t: "scrollMap", dir: "up", distance: 5, speed: 3, wait: true });
    expect((t0([c(204, [6, 2, 4])]) as any).dir).toBe("right");
  });
  it("213 Show Balloon Icon maps target + balloon id", () => {
    expect(t0([c(213, [-1, 3, false])])).toEqual({ t: "balloon", target: "player", balloonId: 3, wait: false });
    expect(t0([c(213, [0, 1, true])])).toMatchObject({ target: "this", wait: true });
    expect((t0([c(213, [7, 2, false])]) as any).target).toBe(7); // a specific event id
  });
  it("221/222/223 all map to a screen tint (fade = tone→black/normal)", () => {
    expect(t0([c(221)])).toEqual({ t: "tint", tone: [-255, -255, -255, 0], frames: 24, wait: true });
    expect(t0([c(222)])).toEqual({ t: "tint", tone: [0, 0, 0, 0], frames: 24, wait: true });
    expect(t0([c(223, [[-68, -68, 0, 68], 90, true])])).toEqual({ t: "tint", tone: [-68, -68, 0, 68], frames: 90, wait: true });
  });
  it("231 Show Picture carries slot/position/scale/opacity + an asset key", () => {
    const cmd = t0([c(231, [2, "Sign", 1, 0, 240, 180, 150, 120, 200, 1])]) as any;
    expect(cmd).toMatchObject({ t: "showPic", id: 2, origin: 1, x: 240, y: 180, scaleX: 150, scaleY: 120, opacity: 200, blend: 1 });
    expect(cmd.name).toBe("asset:pictures/sign");
  });
  it("231 with a variable-designated position reports + falls back to 0,0", () => {
    const { cmds, report } = tr([c(231, [1, "P", 0, 1, 3, 4, 100, 100, 255, 0])]);
    expect(cmds[0]).toMatchObject({ t: "showPic", x: 0, y: 0 });
    expect(report.lines.some((l) => l.what === "a picture placed by a variable")).toBe(true);
  });
  it("232/233/234/235 move/rotate/tint/erase carry their fields", () => {
    expect(t0([c(232, [1, 0, 0, 100, 50, 80, 80, 128, 2, 45, 1])])).toMatchObject({ t: "movePic", id: 1, x: 100, y: 50, scaleX: 80, opacity: 128, blend: 2, frames: 45, wait: true });
    expect(t0([c(233, [3, 7])])).toEqual({ t: "rotatePic", id: 3, speed: 7 });
    expect(t0([c(234, [2, [50, 0, 0, 0], 30, false])])).toEqual({ t: "tintPic", id: 2, tone: [50, 0, 0, 0], frames: 30, wait: false });
    expect(t0([c(235, [4])])).toEqual({ t: "erasePic", id: 4 });
  });
  it("105 Show Scrolling Text folds 405 lines with speed/noFast", () => {
    const cmd = t0([c(105, [4, true]), c(405, ["Line 1"]), c(405, ["Line 2"])]) as any;
    expect(cmd).toMatchObject({ t: "scrollText", speed: 4, noFast: true });
    expect(cmd.text).toBe("Line 1\nLine 2");
  });

  // ---- M2·B message flips (matrix §8.1/§8.10, §13, §16) ----
  it("103 Input Number → inputNumber with variable + digit count", () => {
    expect(t0([c(103, [7, 4])])).toEqual({ t: "inputNumber", varId: 7, digits: 4 });
    expect((t0([c(103, [3, 99])]) as any).digits).toBe(8); // clamped to 8
    expect((t0([c(103, [3, 0])]) as any).digits).toBe(1);  // clamped to 1
  });
  it("104 Select Item → selectItem, preserving the category param", () => {
    expect(t0([c(104, [8, 2])])).toEqual({ t: "selectItem", varId: 8, itemType: 2 });
  });
  it("303 Name Input → nameInput with actor + max length", () => {
    expect(t0([c(303, [2, 10])])).toEqual({ t: "nameInput", actorId: 2, maxChars: 10 });
    expect((t0([c(303, [1, 99])]) as any).maxChars).toBe(16); // clamped to 16
  });
  it("101 maps window background + position (only the non-defaults)", () => {
    const dim = t0([c(101, ["", 0, 1, 0, "Bo"]), c(401, ["Hi"])]) as any;
    expect(dim).toMatchObject({ t: "text", background: 1, position: 0, name: "Bo" });
    const plain = t0([c(101, ["", 0, 0, 2]), c(401, ["Hi"])]) as any;
    expect(plain.background).toBeUndefined();
    expect(plain.position).toBeUndefined();
  });
});

// ============================================================================
// Move routes (§9) — via 205.
// ============================================================================
describe("move-route steps (matrix §9)", () => {
  const steps = (route: RmCommand[]): string[] =>
    (t0([c(205, [0, { list: route, wait: false }])]) as any).steps;
  it("maps the direct move/turn/jump/wait vocabulary", () => {
    expect(steps([c(1), c(2), c(3), c(4), c(12), c(16), c(17), c(18), c(19), c(14), c(0)]))
      .toEqual(["down", "left", "right", "up", "forward", "turn_down", "turn_left", "turn_right", "turn_up", "jump"]);
  });
  it("decomposes diagonals + reports simplification", () => {
    const report = new ImportReport();
    const cmd = translateCommands([c(205, [0, { list: [c(5), c(8), c(0)] }])], report)[0] as any;
    expect(cmd.steps).toEqual(["down", "left", "up", "right"]);
    expect(report.lines.some((l) => l.what === "some movement details")).toBe(true);
  });
  it("drops non-representable steps (speed/random/script) but keeps the moves", () => {
    expect(steps([c(1), c(29, [4]), c(9), c(45, ["x()"]), c(4), c(0)])).toEqual(["down", "up"]);
  });
  it("205 aimed at another event (id>0) → mzTodo", () => {
    expect((t0([c(205, [3, { list: [c(1)] }])]) as any).t).toBe("mzTodo");
  });
});

// ============================================================================
// Escape-code passthrough (§13) — M1·C keeps message text verbatim.
// ============================================================================
describe("message escape codes pass through verbatim (matrix §13)", () => {
  it("keeps \\V \\N \\C \\I \\G untouched in the text", () => {
    const cmd = t0([c(101, ["", 0, 0, 2, ""]), c(401, ["\\N[1]: \\C[2]fire\\C[0] \\I[64] \\V[1] \\G"])]) as any;
    expect(cmd.text).toBe("\\N[1]: \\C[2]fire\\C[0] \\I[64] \\V[1] \\G");
  });
});

// ============================================================================
// mzTodo shape (decision D3).
// ============================================================================
describe("mzTodo placeholder shape (D3)", () => {
  // Codes 313 (Change State) / 315 (Change EXP) stay mzTodo until M2·C, so they
  // still exercise the shape (103/104/303 flipped to real commands in M2·B).
  it("preserves the raw code + params and carries a friendly label", () => {
    const cmd = t0([c(313, [0, 0, 0, 1])]) as any;
    expect(cmd).toMatchObject({ t: "mzTodo", code: 313 });
    expect(cmd.params).toEqual([0, 0, 0, 1]);
    expect(typeof cmd.label).toBe("string");
    expect(cmd.label.length).toBeGreaterThan(0);
  });
  it("aggregates repeats into one report line (D11) with the raw code", () => {
    const { report } = tr([c(313, []), c(313, []), c(315, [])]);
    const state = report.lines.find((l) => l.code === 313);
    expect(state?.count).toBe(2);
    expect(report.lines.find((l) => l.code === 315)?.count).toBe(1);
  });
});

// ============================================================================
// Event-page conversion (matrix §2 events[].pages[]).
// ============================================================================
describe("map-event page conversion (matrix §2)", () => {
  const report = new ImportReport();
  const translate = makeTranslator(report);
  const ev = (pages: any[]): RmEvent => ({ id: 1, name: "E", x: 3, y: 4, pages });

  it("maps trigger / priority / through / charset / dir", () => {
    const [e] = convertMapEvents([null, ev([{
      conditions: {}, image: { characterName: "Hero", characterIndex: 2, direction: 4 },
      moveType: 1, trigger: 1, priorityType: 2, through: true, list: [c(0)],
    }])], translate, report);
    expect(e).toMatchObject({ id: 1, name: "E", x: 3, y: 4 });
    const p = e.pages[0];
    expect(p).toMatchObject({ trigger: "touch", priority: "above", through: true, moveType: "random", charset: "hero-2", dir: 1 });
  });
  it("maps page conditions (switch/var/selfswitch)", () => {
    const [e] = convertMapEvents([null, ev([{
      conditions: { switch1Valid: true, switch1Id: 7, variableValid: true, variableId: 2, variableValue: 5, selfSwitchValid: true, selfSwitchCh: "B" },
      image: {}, trigger: 0, list: [c(0)],
    }])], translate, report);
    expect(e.pages[0].cond).toEqual({ switchId: 7, varId: 2, varVal: 5, selfSw: "B" });
  });
  it("reports two-switch AND (keeps the first) and item/actor conditions", () => {
    const r = new ImportReport();
    convertMapEvents([null, ev([{
      conditions: { switch1Valid: true, switch1Id: 1, switch2Valid: true, switch2Id: 2, itemValid: true, itemId: 3 },
      image: {}, trigger: 0, list: [c(0)],
    }])], makeTranslator(r), r);
    expect(r.lines.some((l) => l.what === "two-switch page checks")).toBe(true);
    expect(r.lines.some((l) => l.what === "item/hero page checks")).toBe(true);
  });
  it("runs the page command list through the translator", () => {
    const [e] = convertMapEvents([null, ev([{
      conditions: {}, image: {}, trigger: 0,
      list: [c(117, [2]), c(0)],
    }])], translate, report);
    expect(e.pages[0].commands[0]).toEqual({ t: "commonEvent", commonEventId: 2 });
  });
});

// ============================================================================
// Full fixture round-trip + bootable project (the M1·C proof).
// ============================================================================
function walk(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, base));
    else out.push(relative(base, abs).replace(/\\/g, "/"));
  }
  return out;
}
const nodeFns: FsReadFns = {
  async listFiles(r) { return walk(r, r); },
  async readText(abs) { return readFileSync(abs, "utf8"); },
  async readBytes(abs) { return new Uint8Array(readFileSync(abs)); },
  join: (r, rel) => join(r, rel),
};
const fixture = (name: string): string => fileURLToPath(new URL("../tests/fixtures/" + name, import.meta.url));
const load = (name: string): Promise<MzProjectResult> => importMzProject(fsSource(fixture(name), nodeFns));
const byId = <T extends { id: number }>(arr: T[], id: number): T => arr.find((x) => x.id === id) as T;

describe("fixture round-trip: MZ 'Cove Test' events (matrix §2/§8)", () => {
  let mz: MzProjectResult;
  let mv: MzProjectResult;
  beforeAll(async () => { mz = await load("mz-project"); mv = await load("mv-project"); });

  it("common events translate their bodies", () => {
    const heal = byId(mz.db.commonEvents, 1); // Flash + Wait
    expect(heal.commands.map((x: any) => x.t)).toEqual(["flash", "wait"]);
    const rain = byId(mz.db.commonEvents, 2); // Weather + Script(→mzTodo)
    expect(rain.commands.map((x: any) => x.t)).toEqual(["weather", "mzTodo"]);
    expect((rain.commands[1] as any).code).toBe(355);
  });

  it("troop battle-event pages translate (text now; 337/331 → mzTodo M3·C)", () => {
    const troop = byId(mz.db.troops, 1);
    expect(troop.pages[0].commands[0]).toMatchObject({ t: "text" });
    expect(troop.pages[1].commands.map((x: any) => x.t)).toEqual(["mzTodo", "mzTodo"]);
    expect(troop.pages[1].commands.map((x: any) => x.code)).toEqual([337, 331]);
  });

  it("Harbor map events convert (Finn dialog, Chest, ToCave transfer)", () => {
    const harbor = byId(mz.maps, 1);
    const finn = byId(harbor.events, 1);
    const cmds = finn.pages[0].commands as any[];
    expect(cmds.map((x) => x.t)).toEqual(["text", "choices", "commonEvent"]);
    expect(cmds[0].name).toBe("Finn"); // MZ speaker name
    expect(cmds[0].text).toContain("\\N[1]"); // escape codes verbatim
    expect(cmds[1].branches[0][0]).toMatchObject({ t: "switch", id: 3, val: true });
    expect(cmds[2].commonEventId).toBe(1);

    const chest = byId(harbor.events, 2);
    expect(chest.pages).toHaveLength(2);
    expect(chest.pages[0].commands.map((x: any) => x.t)).toEqual(["gold", "se", "selfsw"]);
    expect(chest.pages[0].commands[0]).toMatchObject({ t: "gold", op: "add", val: 100 });
    expect(chest.pages[1].cond).toMatchObject({ selfSw: "A" });

    const toCave = byId(harbor.events, 4);
    expect(toCave.pages[0].trigger).toBe("touch");
    expect(toCave.pages[0].commands[0]).toMatchObject({ t: "transfer", mapId: 2, x: 4, y: 4 });

    // M2·A flipped pictures: Show Picture / Wait / Erase Picture now translate.
    const sign = byId(harbor.events, 3);
    expect(sign.pages[0].commands.map((x: any) => x.t)).toEqual(["showPic", "wait", "erasePic"]);
    expect(sign.pages[0].commands[0]).toMatchObject({ t: "showPic", id: 1 });
    expect((sign.pages[0].commands[0] as any).name).toMatch(/^asset:pictures\//);
  });

  it("Cave Ambush event: battle + result-branch placeholders + script", () => {
    const cave = byId(mz.maps, 2);
    const ambush = byId(cave.events, 2);
    const ts = ambush.pages[0].commands.map((x: any) => x.t);
    expect(ts[0]).toBe("battle");
    expect(ts.filter((x: string) => x === "mzTodo").length).toBe(4); // 601,602,603 + script 355
  });

  it("MV plugin command 356 and MZ 357 both become mzTodo", () => {
    const mvBanner = byId(byId(mv.maps, 1).events, 6).pages[0].commands[0] as any;
    const mzBanner = byId(byId(mz.maps, 1).events, 6).pages[0].commands[0] as any;
    expect(mvBanner).toMatchObject({ t: "mzTodo", code: 356 });
    expect(mzBanner).toMatchObject({ t: "mzTodo", code: 357 });
  });

  it("the import report never silently drops (has todo/partial lines for deferred commands)", () => {
    const whats = mz.report.lines.map((l) => l.what);
    // Pictures flipped to real commands in M2·A, but the report is still honest:
    // the picture ART needs re-adding, so a partial line stands in for it.
    expect(whats).toContain("picture image files");
    expect(whats).toContain("a script snippet");
    expect(mz.report.countOf("todo")).toBeGreaterThan(0);
  });

  it("assembles into a bootable, schema-valid project with populated events", () => {
    const base = JSON.parse(readFileSync(fixture("../../Atlas_Quest.json"), "utf8")) as Project;
    const proj = assembleProject(base, mz);
    expect(isProjectLike(proj)).toBe(true);
    validateProject(proj, "import"); // must not throw
    const harbor = byId(proj.maps, 1);
    expect(harbor.events.length).toBeGreaterThan(0);
    // every emitted command has a string discriminant (no undefined nodes)
    const allCmds: any[] = [];
    for (const m of proj.maps) for (const e of m.events) for (const pg of e.pages) allCmds.push(...pg.commands);
    expect(allCmds.every((x) => typeof x.t === "string")).toBe(true);
  });
});
