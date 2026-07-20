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

  it("MP2·B additive intents: move+dir8 (8-way), attack, and the §C5 menu verbs", () => {
    // Eight-direction movement survives the wire via dir8 (down-right = 5).
    roundTripClient({ t: "input", seq: 44, intent: { k: "move", dir: "down", run: true, dir8: 5 } });
    roundTripClient({ t: "input", seq: 45, intent: { k: "move", dir: "up", dir8: 0 } });
    roundTripClient({ t: "input", seq: 46, intent: { k: "attack" } });
    // §C5 world-write menu verbs (defined now, routed live once the world-side
    // verb API is extracted).
    roundTripClient({ t: "input", seq: 47, intent: { k: "useItem", id: 3 } });
    roundTripClient({ t: "input", seq: 48, intent: { k: "useItem", id: 3, target: 2 } });
    roundTripClient({ t: "input", seq: 49, intent: { k: "equip", actor: 1, slot: "weapon2", id: 4 } });
    roundTripClient({ t: "input", seq: 50, intent: { k: "equip", actor: 1, slot: "armor", id: 0 } }); // 0 = remove
    roundTripClient({ t: "input", seq: 51, intent: { k: "formation", from: 0, to: 2 } });
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
    // MP3·B kinds.
    roundTripClient({ t: "reply", id: 13, value: { kind: "selectItem", id: 5 } });
    roundTripClient({ t: "reply", id: 14, value: { kind: "selectItem", id: 0 } }); // nothing chosen
    roundTripClient({ t: "reply", id: 15, value: { kind: "scrollText", done: true } });
  });

  it("emote and chat (preset + free text)", () => {
    roundTripClient({ t: "emote", emote: "heart" });
    roundTripClient({ t: "chat", preset: 3 });
    roundTripClient({ t: "chat", text: "let's check the cave" });
  });

  it("MP7·C custom: any JSON-safe payload round-trips (the plugin net surface)", () => {
    roundTripClient({ t: "custom", data: { kind: "wave", at: [3, 4] } });
    roundTripClient({ t: "custom", data: "just a string" });
    roundTripClient({ t: "custom", data: 42 });
    roundTripClient({ t: "custom", data: null });
    roundTripClient({ t: "custom", data: [1, 2, { deep: true }] });
  });

  it("MP9·E keepalive: a bare ping round-trips (F-4 liveness frame)", () => {
    roundTripClient({ t: "ping" });
    // Forward-compat: an extra field on a ping is accepted (additive within v1).
    const r = decodeClientMessage(JSON.stringify({ t: "ping", nonce: 7 }));
    expect(r.ok).toBe(true);
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
    // MP3·A additive field: the RM 101 window backdrop rides as a name.
    roundTripServer({
      t: "directive",
      id: 12,
      directive: { kind: "message", text: "…", background: "dim", pos: "top" },
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
    // MP3·B additive kinds (D-A4 selectItem, D-B2 scrollText).
    roundTripServer({ t: "directive", id: 13, directive: { kind: "selectItem", itemType: 1 } });
    roundTripServer({ t: "directive", id: 14, directive: { kind: "selectItem" } }); // itemType optional
    roundTripServer({
      t: "directive",
      id: 15,
      directive: { kind: "scrollText", text: "Long ago, on Driftwood Shore…", speed: 3, noFast: true },
    });
    roundTripServer({ t: "directive", id: 16, directive: { kind: "scrollText", text: "" } }); // minimal
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

  it("MP7·C custom: relayed payload with sender id round-trips", () => {
    roundTripServer({ t: "custom", from: 2, data: { kind: "wave" } });
    roundTripServer({ t: "custom", from: 5, data: null });
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

  it("MP2·B intents: dir8 range, equip slot, and menu-verb operands are validated", () => {
    rejectClient({ t: "input", seq: 1, intent: { k: "move", dir: "up", dir8: 8 } }, /bad dir8/);
    rejectClient({ t: "input", seq: 1, intent: { k: "move", dir: "up", dir8: -1 } }, /bad dir8/);
    rejectClient({ t: "input", seq: 1, intent: { k: "move", dir: "up", dir8: 1.5 } }, /bad dir8/);
    rejectClient({ t: "input", seq: 1, intent: { k: "useItem" } }, /bad id/);
    rejectClient({ t: "input", seq: 1, intent: { k: "useItem", id: 1, target: -1 } }, /bad target/);
    rejectClient({ t: "input", seq: 1, intent: { k: "equip", actor: 0, slot: "ring", id: 1 } }, /bad slot/);
    rejectClient({ t: "input", seq: 1, intent: { k: "equip", actor: 0, slot: "weapon" } }, /bad id/);
    rejectClient({ t: "input", seq: 1, intent: { k: "formation", from: 0 } }, /bad to/);
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
    rejectClient({ t: "reply", id: 1, value: { kind: "selectItem", id: -1 } }, /bad id/);
    rejectClient({ t: "reply", id: 1, value: { kind: "scrollText", done: false } }, /done must be true/);
  });

  it("chat: exactly one of text/preset, within limits", () => {
    rejectClient({ t: "chat" }, /exactly one/);
    rejectClient({ t: "chat", text: "hi", preset: 1 }, /exactly one/);
    rejectClient({ t: "chat", text: "x".repeat(MAX_CHAT_LEN + 1) }, /bad text/);
    rejectClient({ t: "chat", preset: 2.5 }, /bad preset/);
  });

  it("custom: data key is required; oversized frames still rejected by the byte cap", () => {
    rejectClient({ t: "custom" }, /missing data/);
    rejectServer({ t: "custom", data: {} }, /bad from/); // server frame needs `from`
    rejectServer({ t: "custom", from: -1, data: {} }, /bad from/);
    // the frame byte cap bounds an opaque payload (no per-field size check needed)
    rejectClient(JSON.stringify({ t: "custom", data: "x".repeat(MAX_CLIENT_MESSAGE_BYTES) }), /too large/);
  });

  it("server frames validate too (a client must survive a hostile server)", () => {
    rejectServer({ t: "welcome", proto: 1, playerId: 1, roomCode: "nope", resumeToken: TOKEN, tick: 0 }, /bad roomCode/);
    rejectServer({ t: "snapshot", tick: 1 }, /missing world/);
    rejectServer({ t: "directive", id: 1, directive: { kind: "choices", options: [] } }, /bad options/);
    rejectServer({ t: "directive", id: 1, directive: { kind: "message", text: "x", background: "sparkly" } }, /bad background/);
    rejectServer({ t: "directive", id: 1, directive: { kind: "selectItem", itemType: -1 } }, /bad itemType/);
    rejectServer({ t: "directive", id: 1, directive: { kind: "scrollText" } }, /bad text/);
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

describe("MP6·A additive arms (party verbs + co-op battle directives)", () => {
  it("party intents round-trip and validate", () => {
    roundTripClient({ t: "input", seq: 60, intent: { k: "partyInvite", target: 3 } });
    roundTripClient({ t: "input", seq: 61, intent: { k: "partyLeave" } });
    rejectClient({ t: "input", seq: 62, intent: { k: "partyInvite" } }, /bad target/);
    rejectClient({ t: "input", seq: 63, intent: { k: "partyInvite", target: -1 } }, /bad target/);
  });

  it("battleJoin: directive + loadout reply round-trip; junk rejects", () => {
    roundTripServer({
      t: "directive",
      id: 9,
      directive: { kind: "battleJoin", troopId: 4, from: "Riko" },
    });
    roundTripClient({
      t: "reply",
      id: 9,
      value: {
        kind: "battleJoin",
        party: [
          { actorId: 1, level: 5, hp: 42, mp: 7, weaponId: 2, row: "back", states: [{ id: 3, turns: 2 }] },
          { actorId: 2, level: 3, hp: 20, mp: 0 },
        ],
      },
    });
    roundTripClient({ t: "reply", id: 9, value: { kind: "battleJoin", party: [] } }); // sit out
    rejectServer({ t: "directive", id: 9, directive: { kind: "battleJoin", troopId: 4 } }, /bad from/);
    rejectClient({ t: "reply", id: 9, value: { kind: "battleJoin", party: [{ actorId: 0, level: 1, hp: 1, mp: 0 }] } }, /bad actorId/);
    rejectClient({ t: "reply", id: 9, value: { kind: "battleJoin", party: [{ actorId: 1, level: 100, hp: 1, mp: 0 }] } }, /bad level/);
    rejectClient(
      { t: "reply", id: 9, value: { kind: "battleJoin", party: [{ actorId: 1, level: 1, hp: 1, mp: 0, row: "middle" }] } },
      /bad row/,
    );
  });

  it("battleCmd: view directive + command reply round-trip; junk rejects", () => {
    roundTripServer({
      t: "directive",
      id: 10,
      directive: {
        kind: "battleCmd",
        round: 2,
        canEscape: true,
        yours: [
          {
            idx: 4,
            name: "Mage",
            hp: 12,
            mhp: 20,
            mp: 9,
            mmp: 10,
            tp: 15,
            states: [3],
            skills: [{ id: 2, name: "Spark", mpCost: 3, usable: true }],
            canAct: true,
          },
        ],
        allies: [{ name: "Hero", hp: 30, mhp: 30 }],
        enemies: [{ i: 0, name: "Slime", hp: 10, mhp: 10, alive: true }],
      },
    });
    roundTripClient({
      t: "reply",
      id: 10,
      value: {
        kind: "battleCmd",
        cmds: [
          { type: "attack", enemy: 0 },
          { type: "skill", id: 2, ally: 4 },
          { type: "item", id: 1, ally: 0 },
          { type: "guard" },
          { type: "escape" },
        ],
      },
    });
    rejectServer(
      { t: "directive", id: 10, directive: { kind: "battleCmd", round: 1, canEscape: true, yours: [], allies: [], enemies: [] } },
      /bad enemies/,
    );
    rejectClient({ t: "reply", id: 10, value: { kind: "battleCmd", cmds: [{ type: "attack" }] } }, /needs enemy/);
    rejectClient({ t: "reply", id: 10, value: { kind: "battleCmd", cmds: [{ type: "dance" }] } }, /unknown cmd type/);
  });
});

describe("MP8·A additive arms (passport hello + challenge + handoff)", () => {
  it("hello with passport pub/sig round-trips; junk pub/sig rejects", () => {
    const pub = "A".repeat(88); // raw P-256 point, base64url ≈ 88 chars
    const sig = "B".repeat(96);
    roundTripClient({ t: "hello", proto: 1, name: "Riko", pub, sig });
    roundTripClient({ t: "hello", proto: 1, name: "Riko" }); // classic anonymous hello unchanged
    rejectClient({ t: "hello", proto: 1, name: "Riko", pub: "not base64url!" }, /bad pub/);
    rejectClient({ t: "hello", proto: 1, name: "Riko", pub: "short" }, /bad pub/);
    rejectClient({ t: "hello", proto: 1, name: "Riko", pub, sig: "x".repeat(1000) }, /bad sig/);
  });

  it("challenge round-trips; junk nonce rejects", () => {
    roundTripServer({ t: "challenge", nonce: "N".repeat(32) });
    rejectServer({ t: "challenge", nonce: "" }, /bad nonce/);
    rejectServer({ t: "challenge", nonce: "!!" }, /bad nonce/);
    rejectServer({ t: "challenge" }, /bad nonce/);
  });

  it("handoff round-trips (with and without url); junk rejects", () => {
    roundTripServer({ t: "handoff", mapId: 7, token: TOKEN });
    roundTripServer({ t: "handoff", mapId: 7, token: TOKEN, url: "wss://zones.example/rt?zone=7" });
    rejectServer({ t: "handoff", mapId: -1, token: TOKEN }, /bad mapId/);
    rejectServer({ t: "handoff", mapId: 7, token: "nope" }, /bad token/);
    rejectServer({ t: "handoff", mapId: 7, token: TOKEN, url: "x" }, /bad url/);
  });

  it("auth-failed is a valid error code", () => {
    roundTripServer({ t: "error", code: "auth-failed", fatal: true });
  });
});

describe("MP9·A additive arms (moderation: mod + report + not-allowed)", () => {
  it("client mod (kick/ban/report, with and without reason) round-trips", () => {
    roundTripClient({ t: "mod", action: "kick", target: 3 });
    roundTripClient({ t: "mod", action: "ban", target: 4 });
    roundTripClient({ t: "mod", action: "report", target: 5, reason: "being mean" });
  });

  it("mod rejects a bad action, target, or oversized reason", () => {
    rejectClient({ t: "mod", action: "nuke", target: 1 }, /bad action/);
    rejectClient({ t: "mod", action: "kick", target: -1 }, /bad target/);
    rejectClient({ t: "mod", action: "kick", target: 2.5 }, /bad target/);
    rejectClient({ t: "mod", action: "report", target: 1, reason: "x".repeat(200) }, /bad reason/);
  });

  it("server report (owner inbox) round-trips; junk rejects", () => {
    roundTripServer({ t: "report", from: 2, target: 3 });
    roundTripServer({ t: "report", from: 2, target: 3, name: "Griefer", reason: "spam" });
    rejectServer({ t: "report", from: -1, target: 3 }, /bad from/);
    rejectServer({ t: "report", from: 2, target: "x" }, /bad target/);
    rejectServer({ t: "report", from: 2, target: 3, name: "x".repeat(MAX_NAME_LEN + 1) }, /bad name/);
  });

  it("not-allowed is a valid error code", () => {
    roundTripServer({ t: "error", code: "not-allowed" });
  });
});
