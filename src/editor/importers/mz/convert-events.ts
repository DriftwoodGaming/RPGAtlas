/* RPGAtlas — src/editor/importers/mz/convert-events.ts
   Project Compass M1·A: the two command-bearing DB record kinds — CommonEvents
   and Troops(+pages) — as STRUCTURAL shells (matrix §2). The command-list body
   goes through an injected `CommandTranslator` that defaults to a no-op here;
   M1·C builds the real `translate-commands.ts` and injects it (the translation
   table is the spine — see docs/MZ_MV_MIGRATION_ROADMAP.md). This module owns
   the record structure; M1·C owns the command vocabulary. Copyright (C) 2026
   RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import type {
  AnyCommand,
  CommonEvent,
  Troop,
  TroopPage,
  TroopPageCond,
} from "../../../shared/schema";
import type { ImportReport } from "./report";
import type { RmCommand, RmCommonEvent, RmList, RmTroop, RmTroopPage } from "./raw-types";

/** Translates an MZ command list into Atlas commands. **Implemented in M1·C**
 *  (`translate-commands.ts`); M1·A defaults to the no-op so the record shells
 *  convert now and pick up real bodies when M1·C injects the translator. */
export type CommandTranslator = (list: RmCommand[]) => AnyCommand[];

const noTranslate: CommandTranslator = () => [];

const COMMON_TRIGGER: Record<number, CommonEvent["trigger"]> = {
  0: "none",
  1: "auto",
  2: "parallel",
};

const notNull = <T>(x: T | null): x is T => x != null;

export function convertCommonEvents(
  list: RmList<RmCommonEvent>,
  _report: ImportReport,
  translate: CommandTranslator = noTranslate,
): CommonEvent[] {
  const out: CommonEvent[] = [];
  for (const c of (list || []).filter(notNull)) {
    out.push({
      id: c.id,
      name: c.name,
      trigger: COMMON_TRIGGER[c.trigger] ?? "none",
      switchId: c.switchId || 0,
      commands: translate(c.list || []),
    });
  }
  return out;
}

/** MZ span 0 battle · 1 turn · 2 moment → Atlas span. */
function troopSpan(span: number): TroopPage["span"] {
  return span === 2 ? "moment" : span === 1 ? "turn" : "battle";
}

/** RM's flat page-condition block → Atlas `TroopPageCond` (matrix §2/§8.5;
 *  `turnEnding` joined in M3·C). */
function troopCond(c: RmTroopPage["conditions"]): TroopPageCond {
  const cond: TroopPageCond = {};
  if (!c) return cond;
  if (c.turnEnding) cond.turnEnd = true;
  if (c.turnValid) cond.turn = { a: c.turnA || 0, b: c.turnB || 0 };
  if (c.enemyValid) cond.enemyHpBelow = { index: c.enemyIndex || 0, pct: c.enemyHp ?? 100 };
  if (c.actorValid) cond.actorHpBelow = { actorId: c.actorId || 0, pct: c.actorHp ?? 100 };
  if (c.switchValid) cond.switchId = c.switchId || 0;
  return cond;
}

export function convertTroops(
  list: RmList<RmTroop>,
  report: ImportReport,
  translate: CommandTranslator = noTranslate,
): Troop[] {
  const out: Troop[] = [];
  for (const t of (list || []).filter(notNull)) {
    const members = t.members || [];
    const troop: Troop = {
      id: t.id,
      name: t.name,
      enemies: members.map((m) => m.enemyId),
      pages: (t.pages || []).map((p) => ({
        cond: troopCond(p.conditions),
        span: troopSpan(p.span),
        commands: translate(p.list || []),
      })),
    };
    if (members.some((m) => m.x || m.y)) {
      report.bump("troop-layout", () => ({
        area: "Troops",
        kind: "partial",
        what: "enemy battle positions",
        detail: "Atlas arranges enemies in its own formation",
      }));
    }
    // M3·C: hidden members → `hiddenSlots` (revealed by Enemy Appear).
    const hiddenSlots = members
      .map((m, i) => (m.hidden ? i : -1))
      .filter((i) => i >= 0);
    if (hiddenSlots.length) troop.hiddenSlots = hiddenSlots;
    out.push(troop);
  }
  return out;
}
