/* RPGAtlas — src/editor/importers/mz/sniff.ts
   Project Compass M1·A: tell MV from MZ (matrix §0). The marker file is
   authoritative (`Game.rpgproject` = MV · `Game.rmmzproject` = MZ); when a
   project is dragged in without its marker we fall back to data cues — MZ-only
   `System.advanced`/`tileSize`/`locale`, the Effekseer-vs-sheet Animations
   model, and the encrypted-asset extension. Copyright (C) 2026 RPGAtlas
   contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { MzFormat, RmSystem } from "./raw-types";

export interface SniffInput {
  /** Relative file paths present in the intake (any separator). */
  paths?: string[];
  /** Parsed `System.json`, if already available. */
  system?: RmSystem | null;
  /** Parsed `Animations.json`, if already available. */
  animations?: any[] | null;
}

export interface SniffResult {
  format: MzFormat;
  /** How the call was made: `marker` (the Game.* file), `data` (a cue), or
   *  `guess` (nothing decisive — defaulted to MV). */
  confidence: "marker" | "data" | "guess";
  reasons: string[];
}

function basename(p: string): string {
  return String(p || "").replace(/\\/g, "/").split("/").pop() || "";
}

/** Decide MV vs MZ. Marker file wins; then data cues; then default MV. */
export function sniffFormat(input: SniffInput): SniffResult {
  const reasons: string[] = [];
  const paths = input.paths || [];
  const bases = paths.map(basename);

  // 1. Marker file — authoritative.
  if (bases.some((b) => b.toLowerCase() === "game.rmmzproject")) {
    return { format: "mz", confidence: "marker", reasons: ["found Game.rmmzproject marker"] };
  }
  if (bases.some((b) => b.toLowerCase() === "game.rpgproject")) {
    return { format: "mv", confidence: "marker", reasons: ["found Game.rpgproject marker"] };
  }

  // 2. Data cues.
  const sys = input.system;
  if (sys) {
    if (sys.advanced != null) reasons.push("System.advanced present (MZ)");
    if (sys.tileSize != null) reasons.push("System.tileSize present (MZ)");
    if (sys.locale != null) reasons.push("System.locale present (MZ)");
  }
  const anims = (input.animations || []).filter(Boolean) as any[];
  if (anims.some((a) => a && typeof a.effectName === "string" && a.effectName)) {
    reasons.push("Animations use Effekseer effectName (MZ)");
  }
  const mvAnim = anims.some(
    (a) => a && (Array.isArray(a.frames) || typeof a.animation1Name === "string"),
  );
  if (mvAnim) reasons.push("Animations are sheet-based frames (MV)");
  if (paths.some((p) => /\.(png_|ogg_)$/i.test(p))) reasons.push("encrypted .png_/.ogg_ assets (MZ)");
  if (paths.some((p) => /\.(rpgmvp|rpgmvo)$/i.test(p))) reasons.push("encrypted .rpgmvp/.rpgmvo assets (MV)");

  const mzHits = reasons.filter((r) => r.endsWith("(MZ)")).length;
  const mvHits = reasons.filter((r) => r.endsWith("(MV)")).length;
  if (mzHits > mvHits) return { format: "mz", confidence: "data", reasons };
  if (mvHits > mzHits) return { format: "mv", confidence: "data", reasons };

  // 3. Nothing decisive — default MV (the older format is the safer assumption:
  //    every MV field also exists in MZ, so an MZ-as-MV read only misses extras).
  return { format: "mv", confidence: "guess", reasons: [...reasons, "no decisive cue — defaulted to MV"] };
}
