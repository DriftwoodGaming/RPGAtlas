/* RPGAtlas — src/engine/scenes/battle-cmd-session.ts
   Project Beacon post-2.0 R-3 (mp-9-spec §RELEASE RE-GATE): the one-live
   battleCmd command-session registry. When a command round hits its 30 s AFK
   deadline the authority escape-resolves it to all-guard and moves on — but
   the unanswered command windows on THIS client knew nothing about the
   deadline and stayed open, stacking under the next round's windows
   (answering a stale one sends a reply for a dead directive id, which the
   server drops). This registry lets the stale UI die instead: at most one
   command session is live, and it is torn down when a newer round's
   battleCmd arrives (open supersedes), when a newer round's `round` event or
   the battle `end` event lands (co-op.ts), or when the online session itself
   ends (leaveRelay).

   Pure coordination — the window teardown is injected — so the node vitest
   suite can prove the supersession contract without a DOM. Remote-overlay-
   only by construction: solo never receives battle directives, so nothing
   here runs in a single-player game. GPL-3.0-or-later (see LICENSE). */

/** Raced/thrown through the render loop when its session dies under it. */
export const SUPERSEDED: unique symbol = Symbol("battleCmd superseded");

export interface CmdSession {
  /** The battle round this session is asking about (directive `round`). */
  readonly round: number;
  /** True once torn down — the render loop bails at its next await. */
  readonly dead: boolean;
  /** Resolves with {@link SUPERSEDED} on teardown; raced against each
   *  window's answer so a pending await unblocks. Never settles for a
   *  session that completes normally. */
  readonly superseded: Promise<typeof SUPERSEDED>;
  /** Register a window this session opened; teardown closes it. */
  track(win: unknown): void;
  /** Normal completion — unregister without closing anything. */
  done(): void;
}

interface LiveSession extends CmdSession {
  kill(): void;
}

let live: LiveSession | null = null;

/** Open the session for one battleCmd render. Whatever session is still live
 *  is a previous round the authority already escape-resolved (or an older
 *  battle's leftovers) — it dies right here. */
export function openCmdSession(round: number, closeWin: (win: unknown) => void): CmdSession {
  dismissCmdSession();
  let onDead!: (v: typeof SUPERSEDED) => void;
  const superseded = new Promise<typeof SUPERSEDED>((r) => (onDead = r));
  const windows: unknown[] = [];
  let deadFlag = false;
  const sess: LiveSession = {
    round,
    get dead() {
      return deadFlag;
    },
    superseded,
    track: (win) => {
      windows.push(win);
    },
    done: () => {
      if (live === sess) live = null;
    },
    kill: () => {
      deadFlag = true;
      onDead(SUPERSEDED);
      for (const w of windows.splice(0)) closeWin(w);
    },
  };
  live = sess;
  return sess;
}

/** Tear down the live command session, if any (battle `end`, leaving the
 *  online session). */
export function dismissCmdSession(): void {
  const s = live;
  if (!s) return;
  live = null;
  s.kill();
}

/** Tear down the live session only if it asks about an OLDER round than `n`
 *  (the `round` battle event): a stale window dies, while the window a fresh
 *  battleCmd just opened for round `n` survives — the arrival order between
 *  the event (outbox, rides the next delta) and the directive (sent
 *  immediately) varies, so an unguarded dismiss could kill the fresh one. */
export function dismissCmdSessionBefore(n: number): void {
  if (live && live.round < n) dismissCmdSession();
}
