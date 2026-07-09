/* RPGAtlas — tests-unit/recents.test.ts
   Recent-projects registry logic (src/shared/recents.ts, Harbor H1·C §5.2). Covers
   upsert moves-to-front, dedupe by path, cap enforcement, remove, annotate splits
   present/missing while preserving order, and corrupt-JSON → []. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  touchRecent,
  removeRecent,
  annotateRecents,
  parseRecents,
  RECENTS_CAP,
  type Recent,
} from "../src/shared/recents";

const R = (path: string, name = path, lastOpened = 0): Recent => ({ path, name, lastOpened });

describe("touchRecent", () => {
  it("unshifts a brand-new entry to the front (newest-first)", () => {
    const out = touchRecent([R("/a"), R("/b")], R("/c"));
    expect(out.map((e) => e.path)).toEqual(["/c", "/a", "/b"]);
  });

  it("dedupes by exact path, moving the touched entry to the front", () => {
    const out = touchRecent([R("/a"), R("/b"), R("/c")], R("/b", "B", 99));
    expect(out.map((e) => e.path)).toEqual(["/b", "/a", "/c"]);
    expect(out[0].lastOpened).toBe(99); // the new entry wins
  });

  it("enforces the cap, dropping the oldest", () => {
    let list: Recent[] = [];
    for (let i = 0; i < RECENTS_CAP + 5; i++) list = touchRecent(list, R(`/p${i}`));
    expect(list).toHaveLength(RECENTS_CAP);
    expect(list[0].path).toBe(`/p${RECENTS_CAP + 4}`); // most recent
    expect(list.some((e) => e.path === "/p0")).toBe(false); // oldest gone
  });
});

describe("removeRecent", () => {
  it("drops exactly the matching path and preserves the rest in order", () => {
    const out = removeRecent([R("/a"), R("/b"), R("/c")], "/b");
    expect(out.map((e) => e.path)).toEqual(["/a", "/c"]);
  });
  it("is a no-op when the path is absent", () => {
    const list = [R("/a"), R("/b")];
    expect(removeRecent(list, "/z")).toEqual(list);
  });
});

describe("annotateRecents", () => {
  it("tags each entry missing=!exists, preserving order", () => {
    const exists = (p: string) => p === "/here";
    const out = annotateRecents([R("/here"), R("/gone"), R("/here2")], exists);
    expect(out.map((e) => [e.path, e.missing])).toEqual([
      ["/here", false],
      ["/gone", true],
      ["/here2", true],
    ]);
  });
});

describe("parseRecents", () => {
  it("parses a valid array, dropping malformed entries", () => {
    const json = JSON.stringify([
      { name: "A", path: "/a", lastOpened: 1 },
      { name: "B", path: "/b" }, // missing lastOpened → dropped
      { path: "/c", lastOpened: 2 }, // missing name → dropped
      "nonsense",
    ]);
    expect(parseRecents(json).map((e) => e.path)).toEqual(["/a"]);
  });

  it("corrupt JSON, non-array, or empty → []", () => {
    expect(parseRecents("not json")).toEqual([]);
    expect(parseRecents('{"not":"an array"}')).toEqual([]);
    expect(parseRecents("")).toEqual([]);
    expect(parseRecents("[]")).toEqual([]);
  });
});
