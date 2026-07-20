/* RPGAtlas — src/shared/net/chat-filter.ts
   Project Beacon MP9·A: the opt-in free-text chat profanity filter (D4). Pure and
   DOM-free (vitest runs env=node; the SERVER imports it as the authority, the
   client imports it to pre-mask its own outgoing bubble — same code, same result).

   HONEST SCOPE (documented in the wiki safety page, MP9·B). A word-list filter is
   a courtesy layer, NOT a safety guarantee — the real protections are structural:
   free-text chat is OFF by default (a game dev must opt in per game, D4), muting
   is instant + client-local, and every player can report while the room owner /
   world operator can kick + ban. This filter catches the common cases well:
     - case, punctuation, and spacing WITHIN a token ("F.U.C.K", "sh!t");
     - light leetspeak ("sh1t", "@ss", "fvck"→no, "fu(k"→no — only the common
       digit/symbol swaps below, kept small so innocent text stays intact);
     - letter elongation ("fuuuck", "shiiit");
     - accents/diacritics (folded so "coño"/"pendejó" normalize).
   It does NOT defeat a determined evader (single letters spaced with whole words
   between them, novel slang, non-Latin scripts — Cyrillic/CJK aren't letter-
   normalized here and pass through). English is the fullest list; the other
   shipped locales get a best-effort set of the most common words. That honesty is
   the point: mute + report + kick are the tools that actually keep a room safe.

   Design: per-token. A message is split on whitespace; each token is normalized
   (lowercased, diacritics folded, a small leet map applied, non-letters dropped)
   to a "core". A token is masked (its letters/digits → '*') when its core either
   CONTAINS a SEVERE root (substring, letter-elongation tolerant — for the worst
   words, where innocent substrings are near-zero and an allow-list rescues the
   classic collisions like "scunthorpe") or EQUALS a listed WORD (whole-token,
   elongation + simple-plural tolerant — for shorter/milder words where a
   substring test would flag innocent words, the Scunthorpe problem). Masking the
   whole offending token keeps the sentence shape without leaking the word.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/** SEVERE roots: matched as a SUBSTRING of a token's core, tolerant of letter
 *  elongation. Curated to words that essentially never occur inside innocent
 *  words (the ALLOW_CORES set below rescues the rare classic collisions). */
const SEVERE: readonly string[] = [
  "fuck", "shit", "cunt", "nigger", "nigga", "faggot", "bitch", "bastard",
  "asshole", "whore", "slut", "motherfuck", "bullshit", "dickhead",
];

/** Tokens whose FULL core matches one of these are left alone even if a SEVERE
 *  substring would otherwise flag them (the Scunthorpe rescue). */
const ALLOW_CORES: ReadonlySet<string> = new Set([
  "scunthorpe", "shiitake", "shitake", "cockburn", "penistone", "assassin",
]);

/** WORD list: matched as a WHOLE token (elongation + trailing simple-plural
 *  tolerant), so "ass" flags but "assassin" does not, and "cock" flags but
 *  "cockpit"/"peacock" do not. English first, then a best-effort set for the
 *  other shipped Latin-script locales (es/fr/de/pt/it). Non-Latin scripts
 *  (ja/zh/ko/ru) are not letter-normalized and are documented as unfiltered. */
const WORDS: readonly string[] = [
  // English
  "ass", "damn", "hell", "crap", "dick", "cock", "pussy", "prick", "twat",
  "wanker", "bollocks", "bugger", "douche", "jackass", "dumbass", "piss",
  "tit", "boob", "hoe", "skank", "arse", "bloody", "goddamn", "wank",
  // Spanish
  "mierda", "puta", "puto", "joder", "cabron", "cono", "gilipollas", "polla", "zorra", "pendejo",
  // French
  "merde", "putain", "connard", "salope", "salaud", "encule", "pute", "bordel",
  // German
  "scheisse", "scheiss", "arschloch", "hurensohn", "fotze", "wichser", "arsch",
  // Portuguese
  "caralho", "foda", "buceta", "porra", "cuzao", "viado",
  // Italian
  "cazzo", "stronzo", "puttana", "vaffanculo", "troia",
];

/** Small leet map — only the swaps common enough that including them does not
 *  wreck innocent text. Applied AFTER lowercasing + diacritic folding. */
const LEET: Readonly<Record<string, string>> = {
  "0": "o", "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a",
  "5": "s", "$": "s", "7": "t", "8": "b", "9": "g", "+": "t",
};

/** Escape a single character for use in a RegExp. */
function escapeRe(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fold diacritics + a couple of ligatures, lowercase. "Coño"→"cono",
 *  "Scheiß"→"scheiss". */
function foldCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/** A token's "core": folded, leet-mapped, letters only (a-z). */
function coreOf(token: string): string {
  const folded = foldCase(token);
  let out = "";
  for (const ch of folded) {
    const mapped = LEET[ch] ?? ch;
    if (mapped >= "a" && mapped <= "z") out += mapped;
  }
  return out;
}

// SEVERE substring regex: each root's letters allowed to repeat ("fuuuck").
const SEVERE_RE = new RegExp(
  "(?:" + SEVERE.map((w) => w.split("").map((c) => escapeRe(c) + "+").join("")).join("|") + ")",
);

// WORD whole-token regex: elongation + optional simple plural (…s / …es).
const WORD_RE = new RegExp(
  "^(?:" +
    WORDS.map((w) => w.split("").map((c) => escapeRe(c) + "+").join("")).join("|") +
    ")(?:e?s)?$",
);

/** True when a single token's core is profane (used by both passes). */
function tokenIsProfane(token: string): boolean {
  const core = coreOf(token);
  if (core.length < 2) return false;
  if (ALLOW_CORES.has(core)) return false;
  if (SEVERE_RE.test(core)) return true;
  return WORD_RE.test(core);
}

/** Mask a token's letters/digits with '*', keeping its punctuation + length. */
function maskToken(token: string): string {
  let out = "";
  for (const ch of token) {
    out += /[\p{L}\p{N}]/u.test(ch) ? "*" : ch;
  }
  return out;
}

export interface CensorResult {
  /** The message with every profane token masked. */
  clean: string;
  /** True when at least one token was masked. */
  changed: boolean;
}

/** Censor one chat message. The server calls this authoritatively before it
 *  broadcasts a free-text `say`; the client calls it to pre-mask its own bubble
 *  so the sender sees the same thing everyone else will. Whitespace is preserved
 *  exactly (split keeps the separators), so the sentence shape is unchanged. */
export function censorChat(text: string): CensorResult {
  // Split into alternating [word, sep, word, sep, …] so we can rejoin verbatim.
  const parts = text.split(/(\s+)/);
  let changed = false;
  for (let i = 0; i < parts.length; i += 2) {
    const token = parts[i];
    if (token && tokenIsProfane(token)) {
      parts[i] = maskToken(token);
      changed = true;
    }
  }
  return { clean: parts.join(""), changed };
}

/** Convenience: is this message clean as-is (nothing would be masked)? */
export function isCleanChat(text: string): boolean {
  return !censorChat(text).changed;
}

/* ── chat policy (D4) — shared by the server authority AND the local co-op
      host so the gate is identical on every transport ─────────────────────── */

export type ChatMode = "off" | "presets" | "text";

/** The hosted game's communication mode (D4). Defaults to the safest option
 *  ("off" = emotes + presets only) for any project that doesn't set it, so a
 *  game that never touched the DB toggle keeps free text rejected. */
export function chatModeOf(proj: unknown): ChatMode {
  const mp = (proj as { system?: { multiplayer?: { chatMode?: unknown } } } | null)?.system?.multiplayer;
  const m = mp && mp.chatMode;
  return m === "text" ? "text" : m === "presets" ? "presets" : "off";
}

/** Resolve a `chat` frame to the `say` payload to broadcast, or a rejection. A
 *  preset always passes (the always-on layer). Free text passes only under
 *  `chatMode:"text"`, censored — the authority MASKS rather than rejects
 *  profanity (friendlier, keeps chat flowing). */
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
