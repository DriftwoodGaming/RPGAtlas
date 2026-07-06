/* RPGAtlas — tests-unit/post11-options.test.ts
   Post-1.1 "left out on purpose" shrink: the five MZ System/battler options
   that finally have an Atlas home — autosave, custom menu commands, item-menu
   categories, the Luck stat, and two-weapon fighting (dual wield). Pure-unit
   coverage over the importer converters and the shared luck math; the fixture
   round-trip assertions live in mz-import-db / mz-import-wizard.
   GPL-3.0-or-later (see LICENSE). */

import { describe, expect, it } from "vitest";
import { convertSystem, paramsFromArray } from "../src/editor/importers/mz/convert-system";
import { convertTrait, type TraitConvertCtx } from "../src/editor/importers/mz/traits";
import { convertActors, convertClasses } from "../src/editor/importers/mz/convert-battlers";
import { ImportReport } from "../src/editor/importers/mz/report";
import { lukEffectRate } from "../src/engine/scenes/battle-logic";
import type { RmActor, RmClass, RmSystem } from "../src/editor/importers/mz/raw-types";

const sys = (extra: Partial<RmSystem>): RmSystem =>
  ({ gameTitle: "T", ...extra }) as RmSystem;

const traitCtx = (report: ImportReport): TraitConvertCtx => ({
  elementKeyByIndex: ["", "fire"],
  skillTypeKeyByIndex: ["", "magic"],
  report,
  area: "Classes",
  owner: "the Test class",
});

describe("autosave (MZ optAutosave)", () => {
  it("converts to system.autosave with a converted line", () => {
    const report = new ImportReport();
    const { system } = convertSystem(sys({ optAutosave: true }), report);
    expect(system.autosave).toBe(true);
    const line = report.lines.find((l) => /autosave/i.test(l.what));
    expect(line).toBeTruthy();
    expect(line!.kind).toBe("converted");
  });
  it("stays absent when off (no line, no field)", () => {
    const report = new ImportReport();
    const { system } = convertSystem(sys({ optAutosave: false }), report);
    expect(system.autosave).toBeUndefined();
    expect(report.lines.some((l) => /autosave/i.test(l.what))).toBe(false);
  });
});

describe("custom menu commands (MZ menuCommands)", () => {
  it("converts hidden commands to explicit false keys", () => {
    const report = new ImportReport();
    const { system } = convertSystem(
      sys({ menuCommands: [true, false, true, true, false, true] }),
      report,
    );
    expect(system.menuCommands).toEqual({
      item: true, skill: false, equip: true, status: true, formation: false, save: true,
    });
    const line = report.lines.find((l) => /menu commands/i.test(l.what));
    expect(line).toBeTruthy();
    expect(line!.kind).toBe("converted");
  });
  it("an all-true array sets nothing (absent = the identical classic menu)", () => {
    const report = new ImportReport();
    const { system } = convertSystem(sys({ menuCommands: [true, true, true, true, true, true] }), report);
    expect(system.menuCommands).toBeUndefined();
    expect(report.lines.some((l) => /menu commands/i.test(l.what))).toBe(false);
  });
});

describe("item-menu categories (MZ itemCategories)", () => {
  it("converts the four tabs, keeping the picks", () => {
    const report = new ImportReport();
    const { system } = convertSystem(sys({ itemCategories: [true, false, false, true] }), report);
    expect(system.itemCategories).toEqual({ item: true, weapon: false, armor: false, keyItem: true });
    const line = report.lines.find((l) => /item menu categories/i.test(l.what));
    expect(line).toBeTruthy();
    expect(line!.kind).toBe("converted");
  });
  it("no array → no categories (classic single list)", () => {
    const report = new ImportReport();
    expect(convertSystem(sys({}), report).system.itemCategories).toBeUndefined();
  });
  it("the old 'left out' skip lines are gone for all three options", () => {
    const report = new ImportReport();
    convertSystem(
      sys({
        optAutosave: true,
        itemCategories: [true, true, true, true],
        menuCommands: [true, false, true, true, true, true],
      }),
      report,
    );
    expect(report.lines.some((l) => l.kind === "skipped" && /autosave|categor|menu command/i.test(String(l.what)))).toBe(false);
  });
});

describe("the Luck stat (post-1.1, ex-D7)", () => {
  it("paramsFromArray keeps index 7", () => {
    expect(paramsFromArray([0, 0, 12, 0, 0, 0, 2, 3])).toEqual({ atk: 12, agi: 2, luk: 3 });
    expect(paramsFromArray([1, 2, 3, 4, 5, 6, 7])).toEqual({
      mhp: 1, mmp: 2, atk: 3, def: 4, mat: 5, mdf: 6, agi: 7,
    });
  });
  it("class curves fit the luk row like the other seven", () => {
    const curve = (b: number, g: number): number[] => {
      const row = [0];
      for (let lv = 1; lv <= 99; lv++) row.push(b + g * (lv - 1));
      return row;
    };
    const cls: RmClass = {
      id: 1, name: "C", traits: [], learnings: [],
      params: [curve(100, 10), curve(20, 2), curve(10, 1), curve(10, 1), curve(10, 1), curve(10, 1), curve(10, 1), curve(5, 1)],
    } as unknown as RmClass;
    const out = convertClasses([null, cls], new ImportReport(), [""], [""]);
    expect(out[0].base.luk).toBe(5);
    expect(out[0].growth.luk).toBe(1);
  });
  it("param-rate and debuff-rate traits map dataId 7 to luk keys", () => {
    const report = new ImportReport();
    expect(convertTrait({ code: 21, dataId: 7, value: 1.2 }, traitCtx(report)))
      .toEqual({ type: "param", key: "luk", value: 120 });
    expect(convertTrait({ code: 12, dataId: 7, value: 0.5 }, traitCtx(report)))
      .toEqual({ type: "param", key: "debuff:luk", value: 50 });
    expect(report.lines).toHaveLength(0);
  });
  it("lukEffectRate: MZ math, exactly 1 when neither side has Luck", () => {
    expect(lukEffectRate(0, 0)).toBe(1); // the native draw-conservation case
    expect(lukEffectRate(50, 0)).toBeCloseTo(1.05);
    expect(lukEffectRate(0, 100)).toBeCloseTo(0.9);
    expect(lukEffectRate(0, 2000)).toBe(0); // floored, never negative
  });
});

describe("two-weapon fighting (trait 55, post-1.1)", () => {
  it("dataId 1 converts to the dualWield special with a converted line", () => {
    const report = new ImportReport();
    expect(convertTrait({ code: 55, dataId: 1, value: 0 }, traitCtx(report)))
      .toEqual({ type: "special", key: "dualWield", value: 100 });
    const line = report.lines.find((l) => /two-weapon/i.test(l.what));
    expect(line).toBeTruthy();
    expect(line!.kind).toBe("converted");
  });
  it("dataId 0 (normal slot type) stays a silent no-op", () => {
    const report = new ImportReport();
    expect(convertTrait({ code: 55, dataId: 0, value: 0 }, traitCtx(report))).toBeNull();
    expect(report.lines).toHaveLength(0);
  });
  it("a dual-wield hero's slot-2 equip lands on weapon2Id, not armor", () => {
    const report = new ImportReport();
    const classes = convertClasses(
      [null, {
        id: 1, name: "Fencer", params: [],
        traits: [{ code: 55, dataId: 1, value: 0 }], learnings: [],
      } as unknown as RmClass],
      report, [""], [""],
    );
    const actors = convertActors(
      [null, {
        id: 1, name: "Twin", classId: 1, initialLevel: 1,
        equips: [3, 4, 7], // weapon, second WEAPON, then the real armor
      } as unknown as RmActor],
      classes, report, [""], [""],
    );
    expect(actors[0].weaponId).toBe(3);
    expect(actors[0].weapon2Id).toBe(4);
    expect(actors[0].armorId).toBe(7);
    // No bogus "extra equipment" line for the second weapon itself.
    expect(report.lines.some((l) => /extra equipment/i.test(String(l.what)))).toBe(false);
  });
  it("without dual wield, slot 2 is still read as armor (classic path)", () => {
    const report = new ImportReport();
    const classes = convertClasses(
      [null, { id: 1, name: "Plain", params: [], traits: [], learnings: [] } as unknown as RmClass],
      report, [""], [""],
    );
    const actors = convertActors(
      [null, { id: 1, name: "Solo", classId: 1, initialLevel: 1, equips: [3, 9] } as unknown as RmActor],
      classes, report, [""], [""],
    );
    expect(actors[0].weaponId).toBe(3);
    expect(actors[0].armorId).toBe(9);
    expect(actors[0].weapon2Id).toBeUndefined();
  });
});
