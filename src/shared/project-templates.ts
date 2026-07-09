/* RPGAtlas — src/shared/project-templates.ts
   Project template descriptors (Project Harbor, Phase H1·C). Pure descriptor list
   for the Project Manager (H2) — NO document bytes here. `project_create` is
   template-agnostic: the manager resolves the chosen template into a complete
   blob-free document with the existing TS builders (DataDefaults / sample-map) at
   wire-up time and hands the bytes to Rust (§3.1). Copy is kid-friendly + final.
   docs/harbor-1-spec.md §5.3. GPL-3.0-or-later (see LICENSE). */

export type TemplateId = "blank" | "starter" | "atlas-quest";

export interface TemplateDescriptor {
  id: TemplateId;
  label: string;
  description: string;
}

/** The three starter choices, in manager display order. */
export const TEMPLATES: TemplateDescriptor[] = [
  {
    id: "blank",
    label: "Empty map",
    description: "A tiny empty world. Best when you want to build everything yourself.",
  },
  {
    id: "starter",
    label: "Starter game",
    description: "A ready-to-edit little game with the basics already set up.",
  },
  {
    id: "atlas-quest",
    label: "Atlas Quest sample",
    description:
      "Our example adventure — poke around to see how a finished game fits together.",
  },
];

/** Narrowing guard for an unknown template id from IPC/UI. */
export function isTemplateId(x: unknown): x is TemplateId {
  return x === "blank" || x === "starter" || x === "atlas-quest";
}
