/* RPGAtlas — tests-unit/project-errors.test.ts
   Kid-friendly error copy (src/shared/project-errors.ts, Harbor H1·C §5.4 + gate
   amendment 4). Asserts EVERY taxonomy code returns non-empty title + body (no code
   can ship without copy), the MISSING_ASSET state copy is present, and an unknown
   code falls back to IO. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  projectErrorCopy,
  MISSING_ASSET_COPY,
  type ProjectErrorCode,
} from "../src/shared/project-errors";

const ALL_CODES: ProjectErrorCode[] = [
  "FOLDER_EXISTS",
  "NO_PERMISSION",
  "DISK_FULL",
  "MISSING",
  "NOT_A_PROJECT",
  "UNSAFE_PATH",
  "SECOND_INSTANCE",
  "IO",
];

describe("projectErrorCopy", () => {
  it("every code returns non-empty, distinct title + body", () => {
    const titles = new Set<string>();
    for (const code of ALL_CODES) {
      const { title, body } = projectErrorCopy(code);
      expect(title.trim().length, `${code} title`).toBeGreaterThan(0);
      expect(body.trim().length, `${code} body`).toBeGreaterThan(0);
      titles.add(title);
    }
    // Each code has its own headline (no accidental copy-paste collisions).
    expect(titles.size).toBe(ALL_CODES.length);
  });

  it("an unknown code falls back to the IO copy (never throws)", () => {
    const io = projectErrorCopy("IO");
    // @ts-expect-error deliberately passing an off-taxonomy code
    expect(projectErrorCopy("NOPE")).toEqual(io);
  });
});

describe("MISSING_ASSET_COPY (gate amendment 4)", () => {
  it("carries non-empty title + body", () => {
    expect(MISSING_ASSET_COPY.title.trim().length).toBeGreaterThan(0);
    expect(MISSING_ASSET_COPY.body.trim().length).toBeGreaterThan(0);
  });
});
