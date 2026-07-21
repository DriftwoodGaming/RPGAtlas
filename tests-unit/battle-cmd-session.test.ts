/* RPGAtlas — tests-unit/battle-cmd-session.test.ts
   Project Beacon post-2.0 R-3 (mp-9-spec §RELEASE RE-GATE): the one-live
   battleCmd session registry. The teardown contract is proven headlessly
   (window closing is injected, no DOM): opening the next round's session
   kills the previous one, the round-guarded dismissal spares the fresh round
   under either arrival order, the battle-end/leave dismissal kills
   unconditionally, and a normally-completed session is never re-killed.
   GPL-3.0-or-later (see LICENSE). */

import { afterEach, describe, expect, it } from "vitest";
import {
  dismissCmdSession,
  dismissCmdSessionBefore,
  openCmdSession,
  SUPERSEDED,
} from "../src/engine/scenes/battle-cmd-session";

// The registry is module-global (one live session per tab) — reset between tests.
afterEach(() => dismissCmdSession());

describe("R-3 battleCmd session registry", () => {
  it("opening the next round's session tears the previous one down", async () => {
    const closed: unknown[] = [];
    const a = openCmdSession(1, (w) => closed.push(w));
    a.track("win-1");
    a.track("win-2");
    const b = openCmdSession(2, () => {
      throw new Error("the fresh session's windows must not close");
    });
    expect(a.dead).toBe(true);
    expect(closed).toEqual(["win-1", "win-2"]);
    await expect(a.superseded).resolves.toBe(SUPERSEDED);
    expect(b.dead).toBe(false);
  });

  it("a pending window await unblocks through the superseded race", async () => {
    const a = openCmdSession(3, () => {});
    const unanswered = new Promise<number>(() => {}); // a window nobody answers
    const race = Promise.race([unanswered, a.superseded]);
    dismissCmdSession();
    expect(await race).toBe(SUPERSEDED);
  });

  it("round-guarded dismissal kills older rounds only", () => {
    const closed: unknown[] = [];
    const a = openCmdSession(4, (w) => closed.push(w));
    a.track("stale");
    dismissCmdSessionBefore(4); // the session's own round event — must survive
    expect(a.dead).toBe(false);
    dismissCmdSessionBefore(5); // a newer round's event — the window is stale
    expect(a.dead).toBe(true);
    expect(closed).toEqual(["stale"]);
  });

  it("done() ends the session cleanly — later dismissals touch nothing", () => {
    const closed: unknown[] = [];
    const a = openCmdSession(1, (w) => closed.push(w));
    a.track("answered");
    a.done();
    dismissCmdSession();
    dismissCmdSessionBefore(99);
    expect(a.dead).toBe(false);
    expect(closed).toEqual([]);
  });

  it("dismissing with no live session is a no-op", () => {
    dismissCmdSession();
    dismissCmdSessionBefore(7);
  });
});
