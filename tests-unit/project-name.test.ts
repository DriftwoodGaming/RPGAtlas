/* RPGAtlas — tests-unit/project-name.test.ts
   The project-name → folder-leaf sanitizer (src/shared/project-name.ts, Harbor
   H1·C §5.1). Covers illegal chars, trailing dot/space, reserved device names,
   empty/whitespace, over-length, preserved unicode/casing, and idempotence.
   Control characters are built with String.fromCharCode so the source stays clean
   ASCII. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  sanitizeFolderName,
  FALLBACK_FOLDER_NAME,
  MAX_FOLDER_NAME,
} from "../src/shared/project-name";

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const BS = String.fromCharCode(8);
const DEL = String.fromCharCode(127);

describe("sanitizeFolderName", () => {
  it("replaces Windows-reserved characters with spaces (then collapses)", () => {
    expect(sanitizeFolderName('a<b>c:d"e/f\\g|h?i*j')).toBe("a b c d e f g h i j");
  });

  it("strips control characters entirely (removed, not turned into spaces)", () => {
    expect(sanitizeFolderName(`My${TAB}Game${LF}2`)).toBe("MyGame2");
    expect(sanitizeFolderName(`A${BS}B${DEL}C`)).toBe("ABC");
  });

  it("collapses internal whitespace runs and trims", () => {
    expect(sanitizeFolderName("  My    Cool   Game  ")).toBe("My Cool Game");
  });

  it("strips trailing dots and spaces (illegal Windows name ending)", () => {
    expect(sanitizeFolderName("My Game...")).toBe("My Game");
    expect(sanitizeFolderName("My Game.  ")).toBe("My Game");
    // a leading dot is fine (only trailing is illegal)
    expect(sanitizeFolderName(".hidden")).toBe(".hidden");
  });

  it("empty / whitespace-only / all-punctuation → fallback", () => {
    expect(sanitizeFolderName("")).toBe(FALLBACK_FOLDER_NAME);
    expect(sanitizeFolderName("    ")).toBe(FALLBACK_FOLDER_NAME);
    expect(sanitizeFolderName("....")).toBe(FALLBACK_FOLDER_NAME);
    expect(sanitizeFolderName("///")).toBe(FALLBACK_FOLDER_NAME);
  });

  it("prefixes reserved device names (any case, with or without extension)", () => {
    expect(sanitizeFolderName("CON")).toBe("_CON");
    expect(sanitizeFolderName("con")).toBe("_con");
    expect(sanitizeFolderName("Com1")).toBe("_Com1");
    expect(sanitizeFolderName("lpt9.txt")).toBe("_lpt9.txt");
    expect(sanitizeFolderName("NUL")).toBe("_NUL");
    // not actually reserved — COM10 and "console" pass through untouched
    expect(sanitizeFolderName("COM10")).toBe("COM10");
    expect(sanitizeFolderName("console")).toBe("console");
  });

  it("truncates to MAX_FOLDER_NAME and re-strips exposed trailing dot/space", () => {
    const long = "x".repeat(200);
    expect(sanitizeFolderName(long).length).toBe(MAX_FOLDER_NAME);
    // a dot landing exactly at the boundary is stripped after truncation
    const boundary = "y".repeat(MAX_FOLDER_NAME - 1) + "." + "z".repeat(10);
    expect(sanitizeFolderName(boundary)).toBe("y".repeat(MAX_FOLDER_NAME - 1));
  });

  it("preserves unicode and casing", () => {
    expect(sanitizeFolderName("Café Quest")).toBe("Café Quest");
    expect(sanitizeFolderName("MyGAME")).toBe("MyGAME");
    expect(sanitizeFolderName("勇者の冒険")).toBe("勇者の冒険");
  });

  it("is idempotent", () => {
    for (const raw of ["a:b/c", "CON", "  spaced  ", "trail...", "x".repeat(200), "😀 Game"]) {
      const once = sanitizeFolderName(raw);
      expect(sanitizeFolderName(once)).toBe(once);
    }
  });
});
