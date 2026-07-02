/* RPGAtlas — src/shared/schema.ts
   Typed project-document schema (Phase 1 Stage D). This file is the contract
   every later phase builds against: the full discriminated types are derived
   from js/data.js defaults + Atlas_Quest.json ground truth, with lightweight
   hand-rolled runtime guards used at project load/import boundaries only.

   Seed state: Project is a named alias while the Stage D implementation fills
   in the real shape (see docs/phase-1-spec.md, Stage D). GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The whole project document (localStorage "rpgatlas_project" / .json file). */
export type Project = any;
