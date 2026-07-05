/* RPGAtlas — tests-unit/mz-import-db.test.ts
   Project Compass M1·A: fixture database round-trips. Runs the full
   intake → sniff → convert pipeline (via an fs-backed MzFileSource) over the
   hand-authored MV + MZ "Cove Test" fixtures and asserts the converted Atlas DB
   records + import-report lines against the signed parity matrix.
   GPL-3.0-or-later (see LICENSE). */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { fsSource, importMzDatabase, type FsReadFns, type MzImportResult } from "../src/editor/importers/mz";

const root = (name: string): string =>
  fileURLToPath(new URL("../tests/fixtures/" + name, import.meta.url));

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
  async listFiles(r) {
    return walk(r, r);
  },
  async readText(abs) {
    return readFileSync(abs, "utf8");
  },
  async readBytes(abs) {
    return new Uint8Array(readFileSync(abs));
  },
  join: (r, rel) => join(r, rel),
};

async function load(name: string): Promise<MzImportResult> {
  return importMzDatabase(fsSource(root(name), nodeFns));
}

let mv: MzImportResult;
let mz: MzImportResult;
beforeAll(async () => {
  mv = await load("mv-project");
  mz = await load("mz-project");
});

const byId = <T extends { id: number }>(arr: T[], id: number): T =>
  arr.find((x) => x.id === id) as T;

describe("format sniffing", () => {
  it("reads the marker files", () => {
    expect(mv.format).toBe("mv");
    expect(mz.format).toBe("mz");
  });
});

describe("System conversion (§1)", () => {
  it("maps title / currency / switches / variables / party", () => {
    const s = mv.db.system;
    expect(s.title).toBe("Cove Test");
    expect(s.currency).toBe("G");
    // Leading placeholder dropped; index = id − 1.
    expect(s.switches).toEqual(["Door Unlocked", "Boss Defeated", "Met Finn"]);
    expect(s.variables).toEqual(["Gold Found", "Steps Taken", "Puzzle State"]);
    expect(s.party).toEqual([1, 2]);
    expect(s.startDir).toBe(0);
    expect(s.battleView).toBe("side");
  });
  it("synthesizes string-keyed element / skill types and id-keyed equip types", () => {
    const t = mv.db.system.types!;
    expect(t.elements.map((e) => e.key)).toEqual(["physical", "fire", "ice", "thunder", "water", "earth"]);
    expect(t.skillTypes).toEqual([
      { key: "magic", name: "Magic" },
      { key: "special", name: "Special" },
    ]);
    expect(t.weaponTypes).toEqual([
      { id: 1, name: "Dagger" },
      { id: 2, name: "Sword" },
    ]);
    expect(t.equipTypes[0]).toEqual({ id: 1, name: "Weapon" });
  });
  it("converts windowTone RGB → hex (gray dropped) and vehicles", () => {
    expect(mv.db.system.windowColor).toBe("#100030");
    const boat = mv.db.system.vehicles!.boat!;
    expect(boat.mapId).toBe(1);
    expect(boat.x).toBe(4);
    expect(boat.y).toBe(9);
    expect(boat.music).toBe("asset:audio/Ship");
  });
  it("reads MZ-only advanced{} sizing and mz-only option reports", () => {
    expect(mz.db.system.screenWidth).toBe(816);
    expect(mz.db.system.fontSize).toBe(26);
    expect(mz.db.system.windowOpacity).toBe(Math.round((192 / 255) * 100));
    // MV has no advanced block → those fields are left for the base default.
    expect(mv.db.system.fontSize).toBeUndefined();
  });
});

describe("Classes (§2/§5)", () => {
  it("fits the param curve to base + linear growth", () => {
    const c = byId(mv.db.classes, 1);
    expect(c.base.mhp).toBe(400);
    expect(c.growth.mhp).toBe(41); // (4418 − 400) / 98
    expect(c.base.atk).toBe(28);
  });
  it("converts the representable trait codes and drops luk", () => {
    const c = byId(mv.db.classes, 1);
    // 11 element (ice), 21 param (atk ×1.1 → 110), 43 skill (M3·B `add:`
    // prefix — the grant is real now), 51 equip-type.
    expect(c.traits).toContainEqual({ type: "element", key: "ice", value: 50 });
    expect(c.traits).toContainEqual({ type: "param", key: "atk", value: 110 });
    expect(c.traits).toContainEqual({ type: "skill", key: "add:3", value: 100 });
    expect(c.traits).toContainEqual({ type: "equip", key: "weaponType", value: 2 });
    // 21 dataId 7 (luk) never becomes a param trait.
    expect(c.traits.some((t) => t.type === "param" && t.value === 120)).toBe(false);
  });
  it("converts ex-param hit/eva/cri to special traits (M3·A, §5 code 22)", () => {
    // Wanderer carries {code:22, dataId:0, value:0.95} → hitChance 95% (the
    // MZ-default actor hit rate; amended from 0.05 when the trait became
    // real in M3·A so the imported fixture battle plays like a real import).
    const c = byId(mv.db.classes, 1);
    expect(c.traits).toContainEqual({ type: "special", key: "hitChance", value: 95 });
  });
  it("converts the M3·B trait codes — special flags, add-skill-type, state rate 0", () => {
    // Wanderer's code-62 dataId-1 flag (Guard) is a real trait now…
    expect(byId(mv.db.classes, 1).traits).toContainEqual({ type: "special", key: "guardFlag", value: 100 });
    // …and the old "advanced battler bonuses" todo line is gone (only party
    // abilities, an M3·C feature, would still land there).
    expect(mv.report.lines.some((l) => /advanced battler bonuses/i.test(l.what))).toBe(false);
    // Scout: code 13 (state rate 0 = immune-by-rate) + code 41 (Add Skill Type).
    const scout = byId(mv.db.classes, 2);
    expect(scout.traits).toContainEqual({ type: "state", key: "1", value: 0 });
    expect(scout.traits).toContainEqual({ type: "skill", key: "addType:special", value: 100 });
  });
  it("keeps learnings (note dropped)", () => {
    expect(byId(mv.db.classes, 1).learnings).toEqual([
      { level: 2, skillId: 1 },
      { level: 4, skillId: 2 },
    ]);
  });
});

describe("Actors (§2, D6)", () => {
  it("reduces multi-slot equips to one weapon + one armor and reports the rest", () => {
    const mara = byId(mv.db.actors, 1);
    expect(mara.level).toBe(3);
    expect(mara.weaponId).toBe(1);
    expect(mara.armorId).toBe(1); // first non-zero armor of [1,1,0,2,3] past slot 0
    expect(mara.charset).toBe("people");
    const finn = byId(mv.db.actors, 2);
    expect(finn.weaponId).toBe(2);
    expect(finn.armorId).toBe(4);
    expect(mv.report.lines.some((l) => /extra equipment/i.test(l.what))).toBe(true);
  });
  it("merges the actor-level trait onto the actor's class (D6)", () => {
    // Mara's Fire element-rate trait rides onto class 1.
    expect(byId(mv.db.classes, 1).traits).toContainEqual({ type: "element", key: "fire", value: 50 });
    expect(mv.report.lines.some((l) => /personal bonuses/i.test(l.what))).toBe(true);
  });
});

describe("Skills (§2/§6/§7)", () => {
  it("stores the damage formula verbatim (D1/A5) and maps type/element/scope", () => {
    const fire = byId(mv.db.skills, 2);
    expect(fire.type).toBe("magic");
    expect(fire.element).toBe("fire");
    expect(fire.formula).toBe("a.mat * 2 - b.mdf + v[3]");
    expect(fire.mp).toBe(8);
    expect(fire.scope).toBe("enemy");
    expect(fire.animationId).toBe(2);
    // Add-State effect (code 21) → stateId/chance/op.
    expect(fire.stateId).toBe(1);
    expect(fire.stateChance).toBe(50);
    expect(fire.stateOp).toBe("add");
  });
  it("maps a heal skill (damage type 3) with recover + common-event effects", () => {
    const heal = byId(mv.db.skills, 3);
    expect(heal.type).toBe("heal");
    expect(heal.power).toBe(100); // Recover HP flat (effect 11 value2)
    expect(heal.commonEventId).toBe(1); // effect 44
    expect(heal.scope).toBe("ally");
    expect(heal.formula).toBe("(a.mat * 2) + 50");
  });
  it("keeps the basic Attack formula and a trivial-formula skill has none", () => {
    expect(byId(mv.db.skills, 1).formula).toBe("a.atk * 4 - b.def * 2");
    expect(byId(mv.db.skills, 4).formula).toBeUndefined(); // Guard formula "0"
  });
  it("stores the MZ pipeline companions with the formula (M3·A)", () => {
    const attack = byId(mv.db.skills, 1);
    expect(attack.variance).toBe(20);
    expect(attack.critical).toBe(true);
    // Heal has variance 0 / critical false → the optional fields stay absent.
    const heal = byId(mv.db.skills, 3);
    expect(heal.variance).toBeUndefined();
    expect(heal.critical).toBeUndefined();
  });
  it("converts the M3·B skill fields — TP, attack element/states, stype, buffs", () => {
    // Attack: elementId −1 → attackElement; effect 21 dataId 0 → attackStates
    // (MZ's real default Attack skill shape).
    const attack = byId(mv.db.skills, 1);
    expect(attack.attackElement).toBe(true);
    expect(attack.attackStates).toBe(true);
    // Guard: tpCost stored (M1 dropped it).
    expect(byId(mv.db.skills, 4).tpCost).toBe(25);
    // Heal keeps its MZ skill type for seal gating (`stype`), the visible
    // type stays Atlas's "heal".
    const heal = byId(mv.db.skills, 3);
    expect(heal.type).toBe("heal");
    expect(heal.stype).toBe("magic");
    // Firebolt: Add Debuff DEF 4 rounds (effect 32).
    expect(byId(mv.db.skills, 2).buffs).toEqual([{ stat: "def", op: "debuff", turns: 4 }]);
    // War Chant: ATK buff 5 rounds + remove DEF debuff + Gain TP (31/34/13).
    const chant = byId(mv.db.skills, 5);
    expect(chant.buffs).toEqual([
      { stat: "atk", op: "buff", turns: 5 },
      { stat: "def", op: "removeDebuff" },
    ]);
    expect(chant.gainTp).toBe(10);
    expect(chant.scope).toBe("allies");
  });
  it("every fixture formula compiles — no reject report lines (M3·A)", () => {
    for (const r of [mv, mz]) {
      expect(r.report.lines.filter((l) => /can't run/i.test(l.what))).toHaveLength(0);
      // The pre-M3·A "turns on in a later update" line is gone: formulas work.
      expect(r.report.lines.filter((l) => /damage formulas$/i.test(l.what))).toHaveLength(0);
    }
  });
});

describe("Items / Weapons / Armors (§2)", () => {
  it("maps item recover + reports key-item / non-consumable", () => {
    const potion = byId(mv.db.items, 1);
    expect(potion.hp).toBe(200);
    expect(potion.price).toBe(50);
    expect(potion.formula).toBeUndefined(); // "0"
    expect(mv.report.lines.some((l) => /key item/i.test(l.what))).toBe(true);
    expect(mv.report.lines.some((l) => /reusable/i.test(l.what))).toBe(true);
  });
  it("converts item state effects + grow/learn (M3·B — the Antidote cures)", () => {
    const antidote = byId(mv.db.items, 2);
    expect(antidote.stateId).toBe(1);
    expect(antidote.stateOp).toBe("remove");
    const tonic = byId(mv.db.items, 4);
    expect(tonic.grow).toEqual([{ stat: "mat", amount: 3 }]);
    expect(tonic.learn).toEqual([2]);
  });
  it("converts weapon/armor params dropping luk", () => {
    expect(byId(mv.db.weapons, 1).params).toEqual({ atk: 12, agi: 2 }); // luk 3 dropped
    expect(byId(mv.db.armors, 1).params).toEqual({ def: 8, mdf: 2 });
  });
  it("merges equip trait rows onto the wearers' classes (M3·B, D6)", () => {
    const wanderer = byId(mv.db.classes, 1);
    // Cutlass (Mara's starting weapon): code 31 → attack element Fire.
    expect(wanderer.traits).toContainEqual({ type: "element", key: "attack:fire", value: 100 });
    // Leather Vest (her starting armor): code 21 def ×1.05 → 105.
    expect(wanderer.traits).toContainEqual({ type: "param", key: "def", value: 105 });
    expect(mv.report.lines.some((l) => l.area === "Equipment" && /moved onto/i.test(l.detail))).toBe(true);
    // Sailor's Charm: trait-bearing but nobody starts with it → honest line.
    expect(mv.report.lines.some((l) => /Sailor's Charm/i.test(l.what))).toBe(true);
  });
});

describe("Enemies (§2/§8)", () => {
  it("converts stats, actions, and action conditions", () => {
    const slime = byId(mv.db.enemies, 1);
    expect(slime.stats).toEqual({ mhp: 120, atk: 14, def: 8, mat: 4, mdf: 6, agi: 10 });
    expect(slime.exp).toBe(15);
    expect(slime.gold).toBe(10);
    expect(slime.actions).toEqual([
      { skillId: 1, weight: 5 }, // conditionType 0 → always (no cond)
      { skillId: 2, weight: 4, cond: { kind: "turn", a: 2, b: 3 } },
    ]);
  });
  it("converts enemy traits for real (M3·B — enemies carry their own)", () => {
    const slime = byId(mv.db.enemies, 1);
    expect(slime.traits).toContainEqual({ type: "element", key: "ice", value: 200 });
    expect(slime.traits).toContainEqual({ type: "special", key: "counterAttack", value: 10 });
    expect(mv.report.lines.some((l) => /enemy resistances/i.test(l.what))).toBe(false);
  });
  it("reports drops and unsupported action conditions", () => {
    expect(mv.report.lines.some((l) => /item drops/i.test(l.what))).toBe(true);
    // Crab uses a party-level condition (type 5) → deferred to M3·C.
    expect(mv.report.lines.some((l) => /advanced enemy action/i.test(l.what))).toBe(true);
  });
});

describe("States (§2)", () => {
  it("maps restriction / turns / hpTurn from the hrg trait", () => {
    const poison = byId(mv.db.states, 1);
    expect(poison.restrict).toBe("none");
    expect(poison.minTurns).toBe(3);
    expect(poison.maxTurns).toBe(5);
    expect(poison.hpTurn).toBe(-10); // trait code 22 dataId 7 (hrg) −0.1 → −10
    // The hrg trait rides hpTurn only — never duplicated as a state trait.
    expect(poison.traits).toBeUndefined();
    const sleep = byId(mv.db.states, 2);
    expect(sleep.restrict).toBe("act"); // restriction 4
  });
  it("maps the M3·B removal-timing set (walking / damage / battle end)", () => {
    const poison = byId(mv.db.states, 1);
    expect(poison.stepsToRemove).toBe(100);
    expect(poison.removeByDamage).toBe(100);
    expect(poison.removeAtEnd).toBeUndefined(); // removeAtBattleEnd false
    const sleep = byId(mv.db.states, 2);
    expect(sleep.removeAtEnd).toBe(true); // the MZ removeAtBattleEnd field
    expect(sleep.removeByDamage).toBe(100);
    expect(sleep.stepsToRemove).toBeUndefined(); // removeByWalking false
  });
});

describe("Troops + CommonEvents (§2) — record shells + M1·C-translated bodies", () => {
  it("converts troop enemies, page spans and conditions", () => {
    const troop = byId(mv.db.troops, 1);
    expect(troop.enemies).toEqual([1, 1, 2]);
    expect(troop.pages!.length).toBe(2);
    expect(troop.pages![0].span).toBe("turn");
    expect(troop.pages![0].cond).toEqual({ turn: { a: 2, b: 0 } });
    expect(troop.pages![1].span).toBe("battle");
    expect(troop.pages![1].cond).toEqual({ enemyHpBelow: { index: 0, pct: 50 } });
    // Command bodies are now filled by the M1·C translator (default seam).
    expect(troop.pages![0].commands.map((x) => x.t)).toEqual(["text"]);
    expect(mv.report.lines.some((l) => /appear mid-battle/i.test(l.what))).toBe(true);
  });
  it("converts common-event triggers + switch + M1·C command bodies", () => {
    const heal = byId(mv.db.commonEvents, 1);
    expect(heal.trigger).toBe("none");
    expect(heal.switchId).toBe(1);
    expect(byId(mv.db.commonEvents, 2).trigger).toBe("parallel");
    expect(heal.commands.map((x) => x.t)).toEqual(["flash", "wait"]); // M1·C
  });
});

describe("luk locked skip (§5/§7, D7)", () => {
  it("aggregates every dropped Luck value into a single report line", () => {
    const luk = mv.report.lines.filter((l) => /luck/i.test(l.what));
    expect(luk.length).toBe(1);
    expect(luk[0].count).toBeGreaterThan(1); // curve + param trait + equip + enemy stats
  });
});

describe("MV vs MZ parity", () => {
  it("produces the same core DB from both formats", () => {
    expect(mz.db.skills.length).toBe(mv.db.skills.length);
    expect(byId(mz.db.skills, 2).formula).toBe(byId(mv.db.skills, 2).formula);
    expect(byId(mz.db.actors, 1).weaponId).toBe(byId(mv.db.actors, 1).weaponId);
    expect(byId(mz.db.enemies, 1).stats).toEqual(byId(mv.db.enemies, 1).stats);
    // …but only MZ carries the advanced-block sizing.
    expect(mz.db.system.fontSize).toBe(26);
    expect(mv.db.system.fontSize).toBeUndefined();
  });
  it("imports the TP gauge flag (M3·B — the MZ fixture shows TP, MV doesn't)", () => {
    expect(mz.db.system.displayTp).toBe(true);
    expect(mv.db.system.displayTp).toBeUndefined();
  });
});
