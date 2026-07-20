/* RPGAtlas — tests-unit/moderation.test.ts
   Project Beacon MP9·A: the client-local mute set (net/moderation.ts). Muting is
   instant + local and never crosses the wire (D6) — it only decides whether a
   player's bubbles are drawn on THIS device. GPL-3.0-or-later. */

import { describe, expect, it, beforeEach } from "vitest";
import { isMuted, toggleMute, setMuted, clearMuted } from "../src/engine/net/moderation";

describe("client-local mute", () => {
  beforeEach(() => clearMuted());

  it("nothing is muted by default (free hot path in solo)", () => {
    expect(isMuted(1)).toBe(false);
    expect(isMuted(99)).toBe(false);
  });

  it("toggle flips and reports the new state", () => {
    expect(toggleMute(3)).toBe(true);
    expect(isMuted(3)).toBe(true);
    expect(toggleMute(3)).toBe(false);
    expect(isMuted(3)).toBe(false);
  });

  it("setMuted is idempotent; clearMuted drops everything", () => {
    setMuted(4, true);
    setMuted(4, true);
    expect(isMuted(4)).toBe(true);
    setMuted(5, true);
    clearMuted();
    expect(isMuted(4)).toBe(false);
    expect(isMuted(5)).toBe(false);
  });
});
