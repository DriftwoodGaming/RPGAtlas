/* RPGAtlas — server/src/core/chat.ts
   Project Beacon MP9·A: the server-side chat helpers. The D4 policy itself
   (chatModeOf + resolveSay: presets always pass, free text only under
   chatMode:"text" and then censorChat-masked) lives in the SHARED filter so the
   local co-op host enforces it identically (src/shared/net/chat-filter.ts); this
   module re-exports it and adds the server-only social (say/emote) rate bucket.
   GPL-3.0-or-later (see LICENSE). */

export { chatModeOf, resolveSay, type ChatMode } from "../../../src/shared/net/chat-filter.js";

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
