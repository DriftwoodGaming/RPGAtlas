/* RPGAtlas — tests-unit/folder-sync.test.ts
   Pure desktop-folder-save decision cores (src/shared/folder-sync.ts, Harbor H3 §2/§3).
   Covers mirror-meta parsing (round-trip + corrupt → null), crash-recovery classification
   (every guard: absent mirror, absent/wrong-root meta, identical content, confirmed save,
   and the one true "offer" case), and external-change classification (none / reload /
   conflict). GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  parseMirrorMeta,
  stringifyMirrorMeta,
  decideRecovery,
  decideExternalChange,
  type MirrorMeta,
} from "../src/shared/folder-sync";

const META = (over: Partial<MirrorMeta> = {}): MirrorMeta => ({
  root: "/Games/Hero",
  savedAt: 1000,
  folderConfirmed: false,
  ...over,
});

describe("parseMirrorMeta", () => {
  it("round-trips a valid meta", () => {
    const m = META({ folderConfirmed: true, savedAt: 42 });
    expect(parseMirrorMeta(stringifyMirrorMeta(m))).toEqual(m);
  });

  it("null / empty / malformed / missing-field → null (never throws)", () => {
    expect(parseMirrorMeta(null)).toBeNull();
    expect(parseMirrorMeta("")).toBeNull();
    expect(parseMirrorMeta("not json")).toBeNull();
    expect(parseMirrorMeta("[]")).toBeNull();
    expect(parseMirrorMeta(JSON.stringify({ root: "/a", savedAt: 1 }))).toBeNull(); // no folderConfirmed
    expect(parseMirrorMeta(JSON.stringify({ root: "/a", savedAt: "1", folderConfirmed: false }))).toBeNull();
  });
});

describe("decideRecovery", () => {
  const root = "/Games/Hero";
  const folderDoc = '{"disk":true}';
  const mirrorDoc = '{"mirror":true}';

  it("no mirror → use-folder", () => {
    expect(
      decideRecovery({ root, folderDoc, mirrorDoc: null, mirrorMeta: META() }),
    ).toBe("use-folder");
  });

  it("no meta → use-folder (can't claim the mirror is newer)", () => {
    expect(
      decideRecovery({ root, folderDoc, mirrorDoc, mirrorMeta: null }),
    ).toBe("use-folder");
  });

  it("meta for a different game → use-folder (never cross-recover)", () => {
    expect(
      decideRecovery({ root, folderDoc, mirrorDoc, mirrorMeta: META({ root: "/Games/Other" }) }),
    ).toBe("use-folder");
  });

  it("mirror identical to the file → use-folder (nothing to recover)", () => {
    expect(
      decideRecovery({ root, folderDoc, mirrorDoc: folderDoc, mirrorMeta: META() }),
    ).toBe("use-folder");
  });

  it("folder save was confirmed → use-folder (respects an external edit made while closed)", () => {
    expect(
      decideRecovery({ root, folderDoc, mirrorDoc, mirrorMeta: META({ folderConfirmed: true }) }),
    ).toBe("use-folder");
  });

  it("mirror differs, same game, never confirmed → offer-mirror (crash evidence)", () => {
    expect(
      decideRecovery({ root, folderDoc, mirrorDoc, mirrorMeta: META({ folderConfirmed: false }) }),
    ).toBe("offer-mirror");
  });
});

describe("decideExternalChange", () => {
  it("file unchanged since we wrote it → none (regardless of the dirty flag)", () => {
    expect(decideExternalChange({ diskDoc: "A", lastSavedDoc: "A", hasLocalEdits: false })).toBe("none");
    expect(decideExternalChange({ diskDoc: "A", lastSavedDoc: "A", hasLocalEdits: true })).toBe("none");
  });

  it("file changed on disk, no unsaved edits → reload (safe)", () => {
    expect(decideExternalChange({ diskDoc: "B", lastSavedDoc: "A", hasLocalEdits: false })).toBe("reload");
  });

  it("file changed on disk AND we have unsaved edits → conflict", () => {
    expect(decideExternalChange({ diskDoc: "B", lastSavedDoc: "A", hasLocalEdits: true })).toBe("conflict");
  });
});
