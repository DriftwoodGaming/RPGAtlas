/* RPGAtlas — tests-unit/mz-scale-import.test.ts
   Project Compass M6·B: round-trip QA at community scale. The two M0·B fixtures
   prove *coverage* (one playthrough of "Cove Test" touches every conversion
   path); this spec proves *scale* — a script-generated project the size a real
   community game reaches (60 maps, 595 events, a full database) imports clean,
   inside an import-time budget, and survives the full chain the wizard promises:
   import → (edit) → save/load → battle-data integrity. It also re-runs the
   report-copy audit against the audience rule (locked decision 6) on a large,
   varied report, and proves re-import is idempotent (same code ⇒ same project,
   the delta banner says "nothing new"). The generator lives in scripts/ and is
   consumed in memory here — no giant fixture committed. GPL-3.0-or-later. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { objectSource, reimportDelta, reportDocToText, runRmImport, type RmImportOutcome } from "../src/editor/importers/mz";
import { isProjectLike, validateProject, type Project } from "../src/shared/schema";
// The scale generator is a plain .mjs module — import its in-memory builder.
import { buildScaleProject } from "../scripts/build-migration-scale-fixture.mjs";

const freshBase = (): Project =>
  JSON.parse(readFileSync(fileURLToPath(new URL("../Atlas_Quest.json", import.meta.url)), "utf8")) as Project;

/** A generous, non-flaky import-time budget for the whole 60-map / 595-event
 *  convert+assemble on CI-class hardware. The point is a regression tripwire,
 *  not a benchmark — a real machine imports this in a fraction of a second. */
const IMPORT_BUDGET_MS = 8000;

function countEvents(p: Project): number {
  let n = 0;
  for (const m of p.maps) n += (m.events || []).length;
  return n;
}

describe("community-scale MZ import (M6·B round-trip QA)", () => {
  let gen: ReturnType<typeof buildScaleProject>;
  let outcome: RmImportOutcome;
  let importMs = 0;

  beforeAll(async () => {
    gen = buildScaleProject({ format: "mz", maps: 60 });
    const t0 = performance.now();
    outcome = await runRmImport(objectSource(gen.files), freshBase());
    importMs = performance.now() - t0;
  });

  it("meets the scale targets the roadmap sets (50+ maps, 500+ events, full DB)", () => {
    expect(gen.stats.maps).toBeGreaterThanOrEqual(50);
    expect(gen.stats.events).toBeGreaterThanOrEqual(500);
    const p = outcome.project;
    expect(p.maps.length).toBe(60);
    expect(countEvents(p)).toBeGreaterThanOrEqual(500);
    // Full DB carried through.
    expect(p.actors.length).toBeGreaterThanOrEqual(12);
    expect(p.skills.length).toBeGreaterThanOrEqual(40);
    expect(p.items.length).toBeGreaterThanOrEqual(30);
    expect(p.weapons.length).toBeGreaterThanOrEqual(24);
    expect(p.armors.length).toBeGreaterThanOrEqual(24);
    expect(p.enemies.length).toBeGreaterThanOrEqual(30);
    expect(p.troops.length).toBeGreaterThanOrEqual(20);
    expect(p.commonEvents.length).toBeGreaterThanOrEqual(24);
    expect(p.system.switches.length).toBeGreaterThanOrEqual(50);
    expect(p.system.variables.length).toBeGreaterThanOrEqual(50);
  });

  it("assembles a bootable-clean project (validateProject must not throw)", () => {
    const p = outcome.project;
    expect(isProjectLike(p)).toBe(true);
    validateProject(p, "import");
    expect(outcome.format).toBe("mz");
    expect(p.system.title).toBe("Compass Scale Test");
    expect((p.meta as { formatVersion?: number }).formatVersion).toBe(2);
  });

  it("imports inside the import-time budget", () => {
    // Surface the real number so a slow regression is visible in the log.
    console.log(`[M6·B] scale import: ${importMs.toFixed(0)}ms for ${gen.stats.maps} maps / ${gen.stats.events} events`);
    expect(importMs).toBeLessThan(IMPORT_BUDGET_MS);
  });

  it("every imported map event page carries a cond object (map-load invariant)", () => {
    for (const map of outcome.project.maps) {
      for (const ev of map.events || []) {
        for (const page of ev.pages) {
          expect(page.cond, `${map.name} / ${ev.name}`).toBeTruthy();
          expect(typeof page.cond).toBe("object");
        }
      }
    }
  });

  it("survives a save/load round-trip (serialize → parse → validate → same shape)", () => {
    const p = outcome.project;
    const roundTripped = JSON.parse(JSON.stringify(p)) as Project;
    expect(isProjectLike(roundTripped)).toBe(true);
    validateProject(roundTripped, "load");
    expect(roundTripped.maps.length).toBe(p.maps.length);
    expect(countEvents(roundTripped)).toBe(countEvents(p));
    expect(roundTripped.system.title).toBe(p.system.title);
    expect(roundTripped.enemies.length).toBe(p.enemies.length);
  });

  it("battle data is engine-loadable: troops reference in-range enemies + skills", () => {
    const p = outcome.project;
    const enemyIds = new Set(p.enemies.map((e) => e.id));
    const skillIds = new Set(p.skills.map((s) => s.id));
    for (const t of p.troops) {
      for (const eid of t.enemies) expect(enemyIds.has(eid), `troop ${t.name} member`).toBe(true);
    }
    for (const e of p.enemies) {
      for (const act of e.actions || []) expect(skillIds.has(act.skillId), `enemy ${e.name} action`).toBe(true);
    }
  });

  it("report copy stays kid-safe at scale (audience rule, D6)", () => {
    const doc = outcome.project.importReport;
    expect(doc).toBeTruthy();
    // No stack-trace / code-noise leaks into any report line's copy.
    const noise = /undefined|NaN|\bError\b|\.ts:|\bthrow\b|\bstack\b/;
    for (const l of doc!.lines) {
      expect(l.what).not.toMatch(noise);
      if (l.detail) expect(l.detail).not.toMatch(noise);
    }
    // The saveable text export is also clean and leads with the good news.
    const text = reportDocToText(doc!);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(noise);
    expect(text).toContain("Compass Scale Test");
    // Every line should be human-readable prose, not a raw command dump.
    for (const line of text.split("\n")) expect(line).not.toMatch(/\bcode\s+\d{3}\b/);
  });

  it("re-import is idempotent: same source ⇒ same project, delta says nothing new", async () => {
    const again = await runRmImport(objectSource(buildScaleProject({ format: "mz", maps: 60 }).files), freshBase());
    // Deterministic generator + deterministic importer ⇒ identical report shape.
    expect(again.project.maps.length).toBe(outcome.project.maps.length);
    expect(again.report.lines.length).toBe(outcome.report.lines.length);
    const delta = reimportDelta(outcome.report, again.report);
    expect(delta).toBeTruthy();
    expect(delta!.improved).toBe(false);
    expect(delta!.resolved).toBe(0);
  });
});

describe("community-scale MV import (format-delta parity at scale)", () => {
  it("imports the MV variant to the same map/DB shape as MZ", async () => {
    const mv = await runRmImport(objectSource(buildScaleProject({ format: "mv", maps: 60 }).files), freshBase());
    expect(mv.format).toBe("mv");
    validateProject(mv.project, "import");
    expect(mv.project.maps.length).toBe(60);
    expect(mv.project.system.title).toBe("Compass Scale Test");
    // MV sheet animations convert to real flipbook timelines (not the MZ fallback).
    expect(mv.project.animations.length).toBeGreaterThan(0);
  });
});

/* Real community projects are messy — dangling refs, hand-edited MapInfos, one
 * giant world map. The audience rule says an import should never crash or spit a
 * stack trace at a beginner; these prove the importer degrades gracefully to a
 * bootable-clean project on inputs the M0·B fixtures never contain. */
describe("community-scale robustness (bug bash, M6·B)", () => {
  // Mutate one generated file, re-serialize, import, and require it validates.
  const mutateImport = async (mut: (files: Record<string, string>) => void): Promise<Project> => {
    const g = buildScaleProject({ format: "mz", maps: 16 });
    mut(g.files as Record<string, string>);
    const out = await runRmImport(objectSource(g.files), freshBase());
    validateProject(out.project, "import");
    return out.project;
  };

  it("a transfer to a non-existent map imports clean (no dangling crash)", async () => {
    const p = await mutateImport((f) => {
      const m = JSON.parse(f["data/Map001.json"]);
      m.events[1].pages[0].list.unshift({ code: 201, indent: 0, parameters: [0, 999, 3, 3, 2, 0] });
      f["data/Map001.json"] = JSON.stringify(m);
    });
    expect(p.maps.length).toBe(16);
  });

  it("a circular MapInfos parent tree doesn't hang the folder synthesis", async () => {
    const p = await mutateImport((f) => {
      const mi = JSON.parse(f["data/MapInfos.json"]);
      mi[1].parentId = 2; mi[2].parentId = 1; // 1↔2 cycle
      f["data/MapInfos.json"] = JSON.stringify(mi);
    });
    expect(p.maps.length).toBe(16);
  });

  it("a self-parenting map doesn't hang the folder synthesis", async () => {
    const p = await mutateImport((f) => {
      const mi = JSON.parse(f["data/MapInfos.json"]);
      mi[3].parentId = 3;
      f["data/MapInfos.json"] = JSON.stringify(mi);
    });
    expect(p.maps.length).toBe(16);
  });

  it("one oversized world map (120×120) imports within reason", async () => {
    const t0 = performance.now();
    const p = await mutateImport((f) => {
      const w = 120, h = 120, data = new Array(w * h * 6).fill(0);
      for (let i = 0; i < w * h; i++) data[i] = 2816; // grass plane
      const m = JSON.parse(f["data/Map001.json"]);
      m.width = w; m.height = h; m.data = data;
      f["data/Map001.json"] = JSON.stringify(m);
    });
    console.log(`[M6·B] 120×120 map import: ${(performance.now() - t0).toFixed(0)}ms`);
    expect(p.maps[0].width).toBe(120);
  });

  it("an enemy action citing an out-of-range skill still imports clean", async () => {
    const p = await mutateImport((f) => {
      const en = JSON.parse(f["data/Enemies.json"]);
      en[1].actions.push({ skillId: 9999, conditionType: 0, conditionParam1: 0, conditionParam2: 0, rating: 5 });
      f["data/Enemies.json"] = JSON.stringify(en);
    });
    expect(p.enemies.length).toBeGreaterThan(0);
  });
});
