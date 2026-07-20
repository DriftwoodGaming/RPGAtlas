/* RPGAtlas — tests-unit/directives-broadcast.test.ts
   Project Beacon MP7·B: "Show Message To → Everyone" broadcasts a message
   directive to every player in the room, fire-and-forget to peers, awaiting only
   the triggering player's reply (so an absent peer can never hang the event).
   Solo has no peers, so a broadcast collapses to the single local message —
   byte-identical. Pure/headless. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import { createWorld } from "../src/shared/sim/world";
import { addPlayer } from "../src/shared/sim/players";
import { createPresentationPort, deliverReply, roomPlayersOf } from "../src/shared/sim/directives";

describe("roomPlayersOf", () => {
  it("a solo world is just the local player [0]", () => {
    expect(roomPlayersOf(createWorld())).toEqual([0]);
  });

  it("includes the local player plus every roster peer", () => {
    const w = createWorld();
    addPlayer(w, 2, "B");
    addPlayer(w, 3, "C");
    expect(roomPlayersOf(w).sort((a, b) => a - b)).toEqual([0, 2, 3]);
  });
});

describe('presentation.message "to: all" (MP7·B)', () => {
  it("solo → a single message to the local player (byte-identical)", async () => {
    const w = createWorld();
    const got: number[] = [];
    w.directives.send = (pid, frame) => { got.push(pid); deliverReply(w, pid, (frame as { id: number }).id, { kind: "message", done: true }); };
    await createPresentationPort(w).message({ playerId: 0 }, { text: "hi", to: "all" });
    expect(got).toEqual([0]);
    expect(w.directives.pending.size).toBe(0);
  });

  it("co-op → reaches every room player; awaits only the origin, never hangs on a silent peer", async () => {
    const w = createWorld();
    addPlayer(w, 2, "B");
    addPlayer(w, 3, "C");
    const got: number[] = [];
    // Peers 2 & 3 never dismiss (no reply); only the origin (0) answers.
    w.directives.send = (pid, frame) => {
      got.push(pid);
      if (pid === 0) deliverReply(w, pid, (frame as { id: number }).id, { kind: "message", done: true });
    };
    await createPresentationPort(w).message({ playerId: 0 }, { text: "hi", to: "all" });
    expect(got.sort((a, b) => a - b)).toEqual([0, 2, 3]);
    // origin resolved + cleaned; the two peers' fire-and-forget copies still pend
    expect(w.directives.pending.size).toBe(2);
  });

  it("without to:'all', only the origin gets the message (classic single-player path)", async () => {
    const w = createWorld();
    addPlayer(w, 2, "B");
    const got: number[] = [];
    w.directives.send = (pid, frame) => { got.push(pid); deliverReply(w, pid, (frame as { id: number }).id, { kind: "message", done: true }); };
    await createPresentationPort(w).message({ playerId: 0 }, { text: "hi" });
    expect(got).toEqual([0]);
  });
});
