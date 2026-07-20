/* RPGAtlas — server/src/core/chat.ts
   Project Beacon MP9·A: the server-side chat gate, shared by the friend-room
   (room.ts) and world-zone (zone.ts) paths so the D4 posture is enforced
   identically in both. Presets always pass; free text passes ONLY when the
   hosted game opted into `chatMode: "text"` (the MP7 DB toggle), and is then
   run through the authoritative profanity filter (censorChat). A per-member
   social token bucket (tick-based, deterministic) caps say/emote spam beyond
   the connection's general message bucket. GPL-3.0-or-later (see LICENSE). */

import { censorChat } from "../../../src/shared/net/chat-filter.js";

export type ChatMode = "off" | "presets" | "text";

/** The hosted game's communication mode (D4). Defaults to the safest option
 *  ("off" = emotes + presets only) for any project that doesn't set it —
 *  identical to the MP5 posture, so a game that never touched the DB toggle
 *  keeps free text rejected. */
export function chatModeOf(proj: unknown): ChatMode {
  const mp = (proj as { system?: { multiplayer?: { chatMode?: unknown } } } | null)?.system?.multiplayer;
  const m = mp && mp.chatMode;
  return m === "text" ? "text" : m === "presets" ? "presets" : "off";
}

/** Resolve a `chat` frame to the `say` payload the server should broadcast, or
 *  a rejection. A preset always passes (the always-on layer, D4). Free text
 *  passes only under `chatMode: "text"`, censored by the shared filter — the
 *  server MASKS rather than rejects profanity (friendlier, keeps chat flowing).
 *  Empty-after-mask text is fine; the client renders the masked string. */
export function resolveSay(
  proj: unknown,
  msg: { text?: string; preset?: number },
): { ok: true; say: { text?: string; preset?: number } } | { ok: false; error: "chat-disabled" } {
  if (msg.text !== undefined) {
    if (chatModeOf(proj) !== "text") return { ok: false, error: "chat-disabled" };
    return { ok: true, say: { text: censorChat(msg.text).clean } };
  }
  return { ok: true, say: { preset: msg.preset } };
}

/* ── social (say/emote) rate limiting ───────────────────────────────────────
   Tick-based so it needs no wall clock and is deterministic in tests. The
   general message bucket (server.ts, 40/s) caps floods and strikes the link;
   this is a gentler cap on the VISIBLE bubble spam vector — exhausting it drops
   the say/emote silently (never strikes a kid off the link for chatting). */

const SOCIAL_BURST = 6;
const SOCIAL_REFILL_TICKS = 30; // one token per 30 ticks ≈ 2/s at 60 Hz

export interface SocialBucket {
  tokens: number;
  lastTick: number;
}

export function newSocialBucket(tick: number): SocialBucket {
  return { tokens: SOCIAL_BURST, lastTick: tick };
}

/** Spend one social token; returns false when the bucket is empty (drop the
 *  say/emote). Refills lazily from elapsed ticks. */
export function spendSocial(b: SocialBucket, tick: number): boolean {
  const refill = Math.floor((tick - b.lastTick) / SOCIAL_REFILL_TICKS);
  if (refill > 0) {
    b.tokens = Math.min(SOCIAL_BURST, b.tokens + refill);
    b.lastTick = tick;
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
