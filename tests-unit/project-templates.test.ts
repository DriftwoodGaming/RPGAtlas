/* RPGAtlas — tests-unit/project-templates.test.ts
   Template descriptors (src/shared/project-templates.ts, Harbor H1·C §5.3). Every
   TemplateId has a non-empty label + description; isTemplateId accepts exactly the
   three ids and rejects everything else. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  TEMPLATES,
  isTemplateId,
  type TemplateId,
} from "../src/shared/project-templates";

const ALL_IDS: TemplateId[] = ["blank", "starter", "atlas-quest"];

describe("TEMPLATES", () => {
  it("has a descriptor for every id with non-empty label + description", () => {
    for (const id of ALL_IDS) {
      const d = TEMPLATES.find((t) => t.id === id);
      expect(d, `descriptor for ${id}`).toBeDefined();
      expect(d!.label.length).toBeGreaterThan(0);
      expect(d!.description.length).toBeGreaterThan(0);
    }
  });

  it("lists exactly the three ids, once each, in manager order", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["blank", "starter", "atlas-quest"]);
  });
});

describe("isTemplateId", () => {
  it("accepts the three real ids", () => {
    for (const id of ALL_IDS) expect(isTemplateId(id)).toBe(true);
  });
  it("rejects anything else", () => {
    for (const x of ["", "Blank", "sample", 0, null, undefined, {}]) {
      expect(isTemplateId(x)).toBe(false);
    }
  });
});
