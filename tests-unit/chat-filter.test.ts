/* RPGAtlas — tests-unit/chat-filter.test.ts
   Project Beacon MP9·A: the free-text chat profanity filter. Proves the common
   cases are masked (case/punctuation/leet/elongation/accents), the sentence
   shape survives, innocent words are NOT over-masked (the Scunthorpe rescue),
   and the honest-scope limits (spaced single letters, non-Latin) are documented
   AS tests so the behavior can't silently drift. GPL-3.0-or-later. */

import { describe, it, expect } from "vitest";
import { censorChat, isCleanChat } from "../src/shared/net/chat-filter";

describe("censorChat — masks profanity", () => {
  it("masks a plain bad word, preserving length + surrounding text", () => {
    const r = censorChat("you are a fuck");
    expect(r.changed).toBe(true);
    expect(r.clean).toBe("you are a ****");
  });

  it("is case-insensitive", () => {
    expect(censorChat("SHIT").clean).toBe("****");
    expect(censorChat("ShItTy").changed).toBe(true);
  });

  it("catches punctuation-separated letters within one token", () => {
    expect(censorChat("f.u.c.k").clean).toBe("*.*.*.*"); // punctuation kept, letters masked
    expect(censorChat("s-h-i-t you").changed).toBe(true);
  });

  it("catches light leetspeak", () => {
    expect(censorChat("sh1t").changed).toBe(true);
    expect(censorChat("@sshole").changed).toBe(true);
    expect(censorChat("b1tch").changed).toBe(true);
  });

  it("catches letter elongation", () => {
    expect(censorChat("fuuuuck").changed).toBe(true);
    expect(censorChat("shiiiit").changed).toBe(true);
  });

  it("masks a bad word embedded in a longer token (severe substring)", () => {
    expect(censorChat("fuckwit").clean).toBe("*******");
    expect(censorChat("motherfucker").changed).toBe(true);
  });

  it("folds accents/diacritics", () => {
    expect(censorChat("coño").changed).toBe(true); // → cono
    expect(censorChat("pendejó").changed).toBe(true);
  });

  it("masks common non-English words (best-effort)", () => {
    expect(censorChat("merde").changed).toBe(true); // fr/pt
    expect(censorChat("scheiße").changed).toBe(true); // de (ß→ss)
    expect(censorChat("cazzo").changed).toBe(true); // it
    expect(censorChat("mierda").changed).toBe(true); // es
  });
});

describe("censorChat — does NOT over-mask innocent text", () => {
  it("leaves ordinary sentences untouched", () => {
    for (const s of [
      "hello there friend",
      "let's go to the castle",
      "I need healing please",
      "nice one, follow me!",
      "the class is assembling",
    ]) {
      const r = censorChat(s);
      expect(r.changed).toBe(false);
      expect(r.clean).toBe(s);
    }
  });

  it("does not flag innocent words that contain a bad word as a substring (Scunthorpe)", () => {
    // whole-token WORD entries: "ass"/"cock"/"dick" must not flag these
    for (const s of ["assassin", "assembly", "class", "grass", "pass", "cockpit", "cockroach", "peacock", "dickens", "dickinson", "shiitake", "scunthorpe"]) {
      expect(isCleanChat(s), s).toBe(true);
    }
  });

  it("keeps whitespace exactly (multiple spaces, tabs)", () => {
    const r = censorChat("go   fuck\tthere");
    expect(r.clean).toBe("go   ****\tthere");
  });
});

describe("censorChat — honest limits (documented, asserted so they can't drift silently)", () => {
  it("does NOT catch single letters spaced with whole words between", () => {
    // "f u c k" spelled as separate one-letter tokens is not caught — this is
    // why mute + report + kick are the real tools (wiki safety page, MP9·B).
    expect(isCleanChat("f u c k")).toBe(true);
  });

  it("does NOT filter non-Latin scripts (Cyrillic/CJK pass through)", () => {
    expect(isCleanChat("привет мир")).toBe(true);
  });

  it("returns the input verbatim when clean", () => {
    const s = "Great job everyone :)";
    expect(censorChat(s)).toEqual({ clean: s, changed: false });
  });
});
