/* RPGAtlas — tests-unit/net-directives.test.ts
   Project Beacon MP3·A: the presentation-directive engine. Pure/headless —
   a world, a loopback pair, a WorldHost, a ClientSession, and a fake
   directive renderer stand in for the whole modal seam; no engine/DOM module
   loads. Covers the C3 lifecycle (emit → validate reply → resume), the
   escape-value table, hostile-reply rejection, pending concurrency (parallel
   events), auto-resolve, participants resolution, the blocking set, and the
   presentation port's handler-facing returns. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import { createWorld } from "../src/shared/sim/world";
import { createLoopbackPair } from "../src/shared/net/transport";
import { WorldHost } from "../src/engine/net/world-host";
import { ClientSession } from "../src/engine/net/client-session";
import {
  autoResolveDirectivesFor,
  beginBlocking,
  createPresentationPort,
  deliverReply,
  DEFAULT_PLAYER,
  emitDirective,
  endBlocking,
  escapeValueOf,
  isBlocked,
  participantsOf,
  validateReplyValue,
} from "../src/shared/sim/directives";
import type { Directive, DirectiveReplyValue } from "../src/shared/net/protocol";

/** A world wired exactly like solo-session.ts wires the default world. */
function makeSession(render?: (d: Directive) => Promise<DirectiveReplyValue>) {
  const world = createWorld();
  const link = createLoopbackPair();
  const host = new WorldHost(world, link.server);
  const session = new ClientSession(link.client, world);
  if (render) session.setDirectiveRenderer(render);
  return { world, host, session };
}

describe("directive lifecycle over the loopback seam", () => {
  it("emit → client renders → reply resumes the awaiting world-side promise", async () => {
    const seen: Directive[] = [];
    const { world } = makeSession(async (d) => {
      seen.push(d);
      return { kind: "message", done: true };
    });
    const v = await emitDirective(world, DEFAULT_PLAYER, { kind: "message", text: "hi" });
    expect(v).toEqual({ kind: "message", done: true });
    expect(seen).toEqual([{ kind: "message", text: "hi" }]);
    expect(world.directives.pending.size).toBe(0); // resolved and cleaned
  });

  it("the WorldHost installs the outbound send at construction", () => {
    const { world } = makeSession();
    expect(typeof world.directives.send).toBe("function");
  });

  it("directive ids are per-world monotonic", async () => {
    const ids: number[] = [];
    const world = createWorld();
    world.directives.send = (_p, frame) => {
      ids.push(frame.id);
      deliverReply(world, DEFAULT_PLAYER, frame.id, { kind: "message", done: true });
    };
    await emitDirective(world, DEFAULT_PLAYER, { kind: "message", text: "a" });
    await emitDirective(world, DEFAULT_PLAYER, { kind: "message", text: "b" });
    expect(ids).toEqual([1, 2]);
  });

  it("a clientless world (no send) resolves with the escape value — never hangs", async () => {
    const world = createWorld();
    const v = await emitDirective(world, DEFAULT_PLAYER, {
      kind: "choices",
      options: ["A", "B"],
    });
    expect(v).toEqual({ kind: "choices", choice: 0 });
  });

  it("two pendings (parallel + blocking event) resolve independently by id", async () => {
    const world = createWorld();
    const frames: { id: number; directive: Directive }[] = [];
    world.directives.send = (_p, f) => frames.push(f);
    const p1 = emitDirective(world, 0, { kind: "message", text: "blocking" });
    const p2 = emitDirective(world, 0, { kind: "choices", options: ["x", "y"] });
    expect(world.directives.pending.size).toBe(2);
    // Answer out of order — ids route each reply to its own pending.
    expect(deliverReply(world, 0, frames[1].id, { kind: "choices", choice: 1 })).toBe(true);
    expect(deliverReply(world, 0, frames[0].id, { kind: "message", done: true })).toBe(true);
    expect(await p2).toEqual({ kind: "choices", choice: 1 });
    expect(await p1).toEqual({ kind: "message", done: true });
  });
});

describe("reply validation (C3.2 layers b + c)", () => {
  function pendingWorld(directive: Directive) {
    const world = createWorld();
    world.directives.send = () => {};
    const promise = emitDirective(world, 0, directive);
    return { world, promise, id: 1 };
  }

  it("stale, foreign, and duplicate replies are dropped and counted", async () => {
    const { world, promise, id } = pendingWorld({ kind: "message", text: "x" });
    expect(deliverReply(world, 0, 99, { kind: "message", done: true })).toBe(false); // stale id
    expect(deliverReply(world, 5, id, { kind: "message", done: true })).toBe(false); // foreign player
    expect(deliverReply(world, 0, id, { kind: "message", done: true })).toBe(true);
    expect(deliverReply(world, 0, id, { kind: "message", done: true })).toBe(false); // duplicate
    expect(world.directives.dropped).toBe(3);
    await promise;
  });

  it("an invalid reply is dropped but the pending stays answerable", async () => {
    const { world, promise, id } = pendingWorld({ kind: "choices", options: ["a", "b"] });
    expect(deliverReply(world, 0, id, { kind: "choices", choice: 2 })).toBe(false); // out of range
    expect(deliverReply(world, 0, id, { kind: "message", done: true })).toBe(false); // kind mismatch
    expect(world.directives.pending.size).toBe(1); // still pending — hostile frames can't kill it
    expect(deliverReply(world, 0, id, { kind: "choices", choice: 1 })).toBe(true);
    expect(await promise).toEqual({ kind: "choices", choice: 1 });
  });

  it("semantic matrix per kind", () => {
    const choices: Directive = { kind: "choices", options: ["a", "b", "c"] };
    expect(validateReplyValue(choices, { kind: "choices", choice: 2 })).toBeNull();
    expect(validateReplyValue(choices, { kind: "choices", choice: 3 })).toMatch(/range/);
    expect(validateReplyValue(choices, { kind: "choices", canceled: true })).toMatch(/not cancelable/);
    const cancelable: Directive = { kind: "choices", options: ["a"], cancelable: true };
    expect(validateReplyValue(cancelable, { kind: "choices", canceled: true })).toBeNull();
    const num: Directive = { kind: "numberInput", digits: 3 };
    expect(validateReplyValue(num, { kind: "numberInput", value: 999 })).toBeNull();
    expect(validateReplyValue(num, { kind: "numberInput", value: 1000 })).toMatch(/digits/);
    const name: Directive = { kind: "nameInput", maxLen: 4 };
    expect(validateReplyValue(name, { kind: "nameInput", value: "Mira" })).toBeNull();
    expect(validateReplyValue(name, { kind: "nameInput", value: "Marina" })).toMatch(/long/);
    const shop: Directive = { kind: "shop", goods: [{ itemType: "item", id: 1, price: 5 }] };
    expect(
      validateReplyValue(shop, {
        kind: "shop",
        transactions: [{ op: "buy", itemType: "item", id: 1, count: 2 }],
      }),
    ).toBeNull();
    expect(
      validateReplyValue(shop, {
        kind: "shop",
        transactions: [{ op: "steal", itemType: "item", id: 1, count: 1 } as never],
      }),
    ).toMatch(/bad op/);
  });
});

describe("escape values + auto-resolve (C3.4)", () => {
  it("the escape table", () => {
    expect(escapeValueOf({ kind: "message", text: "x" })).toEqual({ kind: "message", done: true });
    expect(escapeValueOf({ kind: "choices", options: ["a"] })).toEqual({ kind: "choices", choice: 0 });
    expect(escapeValueOf({ kind: "choices", options: ["a"], cancelable: true })).toEqual({
      kind: "choices",
      canceled: true,
    });
    expect(escapeValueOf({ kind: "numberInput", digits: 2, initial: 7 })).toEqual({
      kind: "numberInput",
      value: 7,
    });
    expect(escapeValueOf({ kind: "numberInput", digits: 2 })).toEqual({ kind: "numberInput", value: 0 });
    expect(escapeValueOf({ kind: "nameInput", maxLen: 8, initial: "Bo" })).toEqual({
      kind: "nameInput",
      value: "Bo",
    });
    expect(escapeValueOf({ kind: "shop", goods: [] })).toEqual({ kind: "shop", transactions: [] });
  });

  it("a disconnecting player's pendings all resolve with escapes; others' stay", async () => {
    const world = createWorld();
    world.directives.send = () => {};
    const gone = emitDirective(world, 1, { kind: "message", text: "x" });
    const gone2 = emitDirective(world, 1, { kind: "numberInput", digits: 2, initial: 3 });
    emitDirective(world, 2, { kind: "message", text: "stays" });
    expect(autoResolveDirectivesFor(world, 1)).toBe(2);
    expect(await gone).toEqual({ kind: "message", done: true });
    expect(await gone2).toEqual({ kind: "numberInput", value: 3 });
    expect(world.directives.pending.size).toBe(1); // player 2's untouched
  });
});

describe("participants + the blocking set (participants-only pause)", () => {
  it("player origin targets its player; world origin targets the map participants (solo: 0)", () => {
    const world = createWorld();
    expect(participantsOf(world, { playerId: 4 })).toEqual([4]);
    expect(participantsOf(world, { playerId: null })).toEqual([DEFAULT_PLAYER]);
    expect(participantsOf(world, undefined)).toEqual([DEFAULT_PLAYER]); // defensive default
  });

  it("begin/end blocking pause exactly the given participants", () => {
    const world = createWorld();
    beginBlocking(world, [0, 3]);
    expect(isBlocked(world, 0)).toBe(true);
    expect(isBlocked(world, 3)).toBe(true);
    expect(isBlocked(world, 1)).toBe(false);
    endBlocking(world, [3]);
    expect(isBlocked(world, 3)).toBe(false);
    expect(isBlocked(world, 0)).toBe(true); // others' pauses unaffected
    endBlocking(world, [0]);
    expect(world.blocking.size).toBe(0);
  });
});

describe("the presentation port (handler-facing surface)", () => {
  it("message resolves void; choices → index or -1; shop → transcript", async () => {
    const answers: Record<string, DirectiveReplyValue> = {
      message: { kind: "message", done: true },
      choices: { kind: "choices", choice: 1 },
      shop: { kind: "shop", transactions: [{ op: "buy", itemType: "item", id: 2, count: 1 }] },
      numberInput: { kind: "numberInput", value: 42 },
      nameInput: { kind: "nameInput", value: "Zed" },
    };
    const { world } = makeSession(async (d) => answers[d.kind]);
    const port = createPresentationPort(world);
    const origin = { playerId: 0 };
    await expect(port.message(origin, { text: "hi" })).resolves.toBeUndefined();
    await expect(port.choices(origin, { options: ["a", "b"] })).resolves.toBe(1);
    await expect(port.numberInput(origin, { digits: 2 })).resolves.toBe(42);
    await expect(port.nameInput(origin, { maxLen: 8 })).resolves.toBe("Zed");
    await expect(
      port.shop(origin, { goods: [{ itemType: "item", id: 2, price: 10 }] }),
    ).resolves.toEqual([{ op: "buy", itemType: "item", id: 2, count: 1 }]);
  });

  it("canceled cancelable choices resolve -1", async () => {
    const { world } = makeSession(async () => ({ kind: "choices", canceled: true }));
    const port = createPresentationPort(world);
    await expect(
      port.choices({ playerId: 0 }, { options: ["a"], cancelable: true }),
    ).resolves.toBe(-1);
  });

  it("localEcho mirrors the world's loopback posture", () => {
    const { world } = makeSession();
    const port = createPresentationPort(world);
    expect(port.localEcho).toBe(false);
    world.directives.localEcho = true;
    expect(port.localEcho).toBe(true);
  });

  it("a world-context origin reaches the solo player's renderer", async () => {
    const rendered: Directive[] = [];
    const { world } = makeSession(async (d) => {
      rendered.push(d);
      return { kind: "message", done: true };
    });
    const port = createPresentationPort(world);
    await port.message({ playerId: null }, { text: "autorun cutscene line" });
    expect(rendered.length).toBe(1);
  });
});
