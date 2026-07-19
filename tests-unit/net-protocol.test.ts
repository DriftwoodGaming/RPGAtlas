/* RPGAtlas — tests-unit/net-protocol.test.ts
   Beacon wire protocol v1 (src/shared/net/protocol.ts). Two jobs:
   (1) WIRE-SAFETY — every message type round-trips encode→decode identically.
   The loopback transport (MP2) passes objects by reference and skips
   serialization entirely, so this suite is the only thing proving these
   shapes survive a real wire; it must cover every union arm.
   (2) STRICTNESS — the decoders are the server's first line against hostile
   input (MP5·D fuzz gate builds on them): malformed frames come back
   {ok:false} with a reason, never a throw. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_LEN,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_NAME_LEN,
  PROTOCOL_VERSION,
  decodeClientMessage,
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from "../src/shared/net/protocol";

const CODE = "XY3KM9PQ7";
const TOKEN = "a".repeat(32);

const roundTripClient = (msg: ClientMessage) => {
  const r = decodeClientMessage(encodeMessage(msg));
  expect(r.ok, r.ok ? "" : r.error).toBe(true);
  if (r.ok) expect(r.msg).toEqual(msg);
};
const roundTripServer = (msg: ServerMessage) => {
  const r = decodeServerMessage(encodeMessage(msg));
  expect(r.ok, r.ok ? "" : r.error).toBe(true);
  if (r.ok) expect(r.msg).toEqual(msg);
};
const rejectClient = (value: unknown, reason: RegExp) => {
  const r = decodeClientMessage(typeof value === "string" ? value : JSON.stringify(value));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(reason);
};
const rejectServer = (value: unknown, reason: RegExp) => {
  const r = decodeServerMessage(typeof value === "string" ? value : JSON.stringify(value));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(reason);
};

describe("protocol constants", () => {
  it("is protocol version 1 (bump only on breaking shape changes)", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe("client→server round-trips (every union arm is wire-safe)", () => {
  it("hello / join / resume", () => {
    roundTripClient({ t: "hello", proto: PROTOCOL_VERSION, name: "Riko the Bold" });
    roundTripClient({ t: "join" }); // no code = create a room
    roundTripClient({ t: "join", code: CODE });
    roundTripClient({ t: "resume", code: CODE, token: TOKEN });
  });

  it("input intents: move (walk + run), face, act", () => {
    roundTripClient({ t: "input", seq: 0, intent: { k: "move", dir: "up" } });
    roundTripClient({ t: "input", seq: 41, intent: { k: "move", dir: "left", run: true } });
    roundTripClient({ t: "input", seq: 42, intent: { k: "face", dir: "down" } });
    roundTripClient({ t: "input", seq: 43, intent: { k: "act" } });
  });

  it("replies: every directive kind's answer", () => {
    roundTripClient({ t: "reply", id: 7, value: { kind: "message", done: true } });
    roundTripClient({ t: "reply", id: 8, value: { kind: "choices", choice: 2 } });
    roundTripClient({ t: "reply", id: 9, value: { kind: "choices", canceled: true } });
    roundTripClient({ t: "reply", id: 10, value: { kind: "numberInput", value: 1234 } });
    roundTripClient({ t: "reply", id: 11, value: { kind: "nameInput", value: "Terra" } });
    roundTripClient({
      t: "reply",
      id: 12,
      value: {
        kind: "shop",
        transactions: [
          { op: "buy", itemType: "item", id: 1, count: 3 },
          { op: "sell", itemType: "weapon", id: 4, count: 1 },
        ],
      },
    });
  });

  it("emote and chat (preset + free text)", () => {
    roundTripClient({ t: "emote", emote: "heart" });
    roundTripClient({ t: "chat", preset: 3 });
    roundTripClient({ t: "chat", text: "let's check the cave" });
  });
});

describe("server→client round-trips (every union arm is wire-safe)", () => {
  it("welcome / snapshot / delta", () => {
    roundTripServer({
      t: "welcome",
      proto: PROTOCOL_VERSION,
      playerId: 1,
      roomCode: CODE,
      resumeToken: TOKEN,
      tick: 0,
    });
    roundTripServer({ t: "snapshot", tick: 60, world: { mapId: 1, players: [{ x: 3, y: 4 }] } });
    roundTripServer({ t: "delta", tick: 61, ack: 41, changes: { moved: [[1, 4, 4]] } });
    roundTripServer({ t: "delta", tick: 62, changes: null }); // heartbeat-shaped delta
  });

  it("directives: every kind", () => {
    roundTripServer({
      t: "directive",
      id: 7,
      directive: { kind: "message", text: "Welcome to Driftwood Shore!", speaker: "Elder", pos: "bottom" },
    });
    roundTripServer({
      t: "directive",
      id: 8,
      directive: { kind: "choices", options: ["Yes", "No"], prompt: "Set sail?", cancelable: true },
    });
    roundTripServer({ t: "directive", id: 9, directive: { kind: "numberInput", digits: 4 } });
    roundTripServer({ t: "directive", id: 10, directive: { kind: "nameInput", maxLen: 12, actorId: 1 } });
    roundTripServer({
      t: "directive",
      id: 11,
      directive: {
        kind: "shop",
        goods: [{ itemType: "item", id: 1, price: 50 }],
        currencyId: 2,
      },
    });
  });

  it("presence: join / leave / emote / say (preset + text)", () => {
    roundTripServer({ t: "presence", tick: 10, kind: "join", playerId: 2, name: "Mira" });
    roundTripServer({ t: "presence", tick: 11, kind: "leave", playerId: 2 });
    roundTripServer({ t: "presence", tick: 12, kind: "emote", playerId: 1, emote: "wave" });
    roundTripServer({ t: "presence", tick: 13, kind: "say", playerId: 1, preset: 0 });
    roundTripServer({ t: "presence", tick: 14, kind: "say", playerId: 1, text: "over here!" });
  });

  it("kick and error", () => {
    roundTripServer({ t: "kick", code: "room-closed" });
    roundTripServer({ t: "kick", code: "kicked", detail: "owner kick" });
    roundTripServer({ t: "error", code: "room-not-found" });
    roundTripServer({ t: "error", code: "proto-mismatch", fatal: true, detail: "client v0" });
  });
});

describe("decoder strictness (hostile input comes back {ok:false}, never a throw)", () => {
  it("rejects non-JSON, non-object roots, and missing/unknown types", () => {
    rejectClient("not json at all", /not JSON/);
    rejectClient("[1,2,3]", /root/);
    rejectClient("null", /root/);
    rejectClient('"hello"', /root/);
    rejectClient({}, /missing message type/);
    rejectClient({ t: "teleport-hack" }, /unknown client message type/);
    rejectServer({ t: "hello", proto: 1, name: "x" }, /unknown server message type/); // wrong direction
  });

  it("rejects oversized client frames", () => {
    const huge = JSON.stringify({ t: "chat", text: "x".repeat(MAX_CLIENT_MESSAGE_BYTES) });
    rejectClient(huge, /too large/);
  });

  it("hello: name must be present, sized, and control-char-free", () => {
    rejectClient({ t: "hello", proto: 1 }, /bad name/);
    rejectClient({ t: "hello", proto: 1, name: "" }, /bad name/);
    rejectClient({ t: "hello", proto: 1, name: "x".repeat(MAX_NAME_LEN + 1) }, /bad name/);
    rejectClient({ t: "hello", proto: 1, name: "line\nbreak" }, /bad name/);
    rejectClient({ t: "hello", proto: -1, name: "ok" }, /bad proto/);
  });

  it("join/resume: only canonical codes and real tokens pass", () => {
    rejectClient({ t: "join", code: "XY3-KM9-PQ7" }, /bad code/); // display form ≠ wire form
    rejectClient({ t: "join", code: "xy3km9pq7" }, /bad code/); // client must normalize first
    rejectClient({ t: "resume", code: CODE, token: "short" }, /bad token/);
    rejectClient({ t: "resume", token: TOKEN }, /bad code/);
  });

  it("input: seq must be a nonnegative integer, intents must be well-formed", () => {
    rejectClient({ t: "input", seq: -1, intent: { k: "act" } }, /bad seq/);
    rejectClient({ t: "input", seq: 1.5, intent: { k: "act" } }, /bad seq/);
    rejectClient({ t: "input", seq: "1", intent: { k: "act" } }, /bad seq/);
    rejectClient({ t: "input", seq: 1, intent: { k: "move", dir: "northwest" } }, /bad dir/);
    rejectClient({ t: "input", seq: 1, intent: { k: "fly" } }, /unknown intent/);
    rejectClient({ t: "input", seq: 1, intent: null }, /intent must be an object/);
  });

  it("reply: unknown kinds and malformed shop transcripts fail", () => {
    rejectClient({ t: "reply", id: 1, value: { kind: "sudo" } }, /unknown reply kind/);
    rejectClient({ t: "reply", id: 1, value: { kind: "choices", choice: 1, canceled: true } }, /canceled excludes/);
    rejectClient(
      { t: "reply", id: 1, value: { kind: "shop", transactions: [{ op: "buy", itemType: "item", id: 1, count: 0 }] } },
      /bad count/,
    );
    rejectClient(
      { t: "reply", id: 1, value: { kind: "shop", transactions: [{ op: "steal", itemType: "item", id: 1, count: 1 }] } },
      /bad op/,
    );
  });

  it("chat: exactly one of text/preset, within limits", () => {
    rejectClient({ t: "chat" }, /exactly one/);
    rejectClient({ t: "chat", text: "hi", preset: 1 }, /exactly one/);
    rejectClient({ t: "chat", text: "x".repeat(MAX_CHAT_LEN + 1) }, /bad text/);
    rejectClient({ t: "chat", preset: 2.5 }, /bad preset/);
  });

  it("server frames validate too (a client must survive a hostile server)", () => {
    rejectServer({ t: "welcome", proto: 1, playerId: 1, roomCode: "nope", resumeToken: TOKEN, tick: 0 }, /bad roomCode/);
    rejectServer({ t: "snapshot", tick: 1 }, /missing world/);
    rejectServer({ t: "directive", id: 1, directive: { kind: "choices", options: [] } }, /bad options/);
    rejectServer({ t: "presence", tick: 1, kind: "join", playerId: 1 }, /join needs name/);
    rejectServer({ t: "presence", tick: 1, kind: "say", playerId: 1 }, /exactly one/);
    rejectServer({ t: "kick", code: "vibes" }, /bad code/);
    rejectServer({ t: "error", code: "whoops" }, /bad code/);
  });
});

describe("forward compatibility (additive evolution inside protocol v1)", () => {
  it("unknown extra fields on a known message are accepted and preserved", () => {
    const r = decodeClientMessage(
      JSON.stringify({ t: "hello", proto: 1, name: "Riko", passportPub: "future-field" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.msg as unknown as Record<string, unknown>).passportPub).toBe("future-field");
  });
});
