/* RPGAtlas — src/editor/project-manager/templates.ts
   Template → ready document (Project Harbor, Phase H2·A/B). `project_create` is
   template-agnostic (H1 §3.1): the manager resolves the child's chosen template
   into a complete, blob-free, FORMAT_VERSION-2 project document with the existing
   TS builders and hands the bytes to Rust. This module is only reachable through
   the dynamically-imported manager chunk, so the ~187 KB Atlas Quest sample it
   bundles never loads for the pure browser build.
   docs/harbor-2-spec.md §1.2. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { DataDefaults, RA } from "../editor-state";
import { validateProject } from "../../shared/schema";
import { FALLBACK_FOLDER_NAME } from "../../shared/project-name";
import type { TemplateId } from "../../shared/project-templates";
// Vite `?raw` keeps the type `string` (no 15k-line inferred JSON type in tsc) and
// bundles the sample's bytes into this lazy manager chunk. The sample is blob-free.
import atlasQuestRaw from "../../../Atlas_Quest.json?raw";

/** Build the ready project document for `templateId`, titled with the child's
 *  display name. Every path runs the result through `migrateProject` +
 *  `validateProject(…, "load")` so a template can never boot a broken editor —
 *  exactly the load-boundary the browser's stored-project path already passes. */
export function buildTemplateDocument(templateId: TemplateId, displayName: string): any {
  const title = (displayName || "").trim() || FALLBACK_FOLDER_NAME;
  let doc: any;

  if (templateId === "atlas-quest") {
    // The curated example adventure (the bundled sample project).
    doc = JSON.parse(atlasQuestRaw);
  } else if (templateId === "blank") {
    // "A tiny empty world": one fresh grass map, start position centred on it,
    // and the sample's quests dropped so nothing points at maps that aren't here.
    doc = DataDefaults.newProject();
    const map = DataDefaults.newMap(1, "My First Map", 20, 15);
    doc.maps = [map];
    doc.system.startMapId = map.id;
    doc.system.startX = Math.floor(map.width / 2);
    doc.system.startY = Math.floor(map.height / 2);
    doc.quests = [];
  } else {
    // "starter": today's first-run project (DataDefaults), unchanged.
    doc = DataDefaults.newProject();
  }

  // The folder leaf is sanitized separately; the document carries the child's
  // original chosen name as the game's display title.
  doc.system.title = title;
  return validateProject(RA.migrateProject(doc), "load");
}
