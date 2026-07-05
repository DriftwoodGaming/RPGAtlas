/* RPGAtlas — src/editor/importers/mz/report.ts
   Project Compass M1·A: the import-report collector. Converters push STRUCTURED
   lines here (area / kind / subject / detail / count / raw code); the wizard in
   M1·D turns them into the kid-friendly "what it was → what happened → what you
   can do" copy locked by decision D11. Nothing user-facing renders in M1·A —
   this is just the data channel so no conversion is a silent drop (locked
   decision 6). Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later. */

/** How a source thing fared: fully `converted`, converted with a caveat
 *  (`partial`), intentionally `skipped`, or preserved-but-not-yet-real
 *  (`todo` — the `mzTodo` / "coming in a later update" bucket). */
export type ReportKind = "converted" | "partial" | "skipped" | "todo";

export interface ReportLine {
  /** Section label — "System", "Actors", "Skills", … */
  area: string;
  kind: ReportKind;
  /** The thing, named by *its* name where possible ("the Luck stat"). */
  what: string;
  /** Engineering shorthand explanation; M1·D rewrites for the audience. */
  detail?: string;
  /** For aggregated lines ("Luck appeared in N places"). */
  count?: number;
  /** Raw MZ command/trait/effect code when relevant (mzTodo re-import key). */
  code?: number;
}

/** Ordered, de-duplicating report collector. `add` appends a line; `bump`
 *  maintains a single aggregated counter line keyed by `key` (the `luk` /
 *  SV-battler / face aggregates all funnel through one line each). */
export class ImportReport {
  readonly lines: ReportLine[] = [];
  private readonly counters = new Map<string, ReportLine>();

  add(line: ReportLine): void {
    this.lines.push(line);
  }

  /** Increment (creating on first use) the aggregated line for `key`. */
  bump(key: string, make: () => ReportLine): void {
    let line = this.counters.get(key);
    if (!line) {
      line = make();
      line.count = 0;
      this.counters.set(key, line);
      this.lines.push(line);
    }
    line.count = (line.count ?? 0) + 1;
  }

  /** Lines in a given area (test/inspection convenience). */
  inArea(area: string): ReportLine[] {
    return this.lines.filter((l) => l.area === area);
  }

  /** Total lines of a kind (test/inspection convenience). */
  countOf(kind: ReportKind): number {
    return this.lines.filter((l) => l.kind === kind).length;
  }
}
