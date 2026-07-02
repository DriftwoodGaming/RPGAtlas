/* RPGAtlas — src/editor/persistence.ts
   Autosave / load / project import & export (wraps js/editor/project-io.js).
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 1):
   logic unchanged, closure vars already routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  exportProjectFile,
  exportStandaloneHtml as writeStandaloneHtml,
  exportWindowsExecutable as writeWindowsExecutable,
  loadStoredProject,
  saveProject,
} from "../../js/editor/project-io.js";
import * as host from "../../js/editor/host.js";
import { Assets, RA, t, editorState as S, editorHooks } from "./editor-state";
import { $, h } from "./dom";
import { modal } from "./modals";
import { flashStatus } from "./map-editor/status";
import { hdMarkDirty } from "./map-editor/hd-preview";

  let saveTimer: any = null;
  export function touch() {
    $("save-ind").textContent = "● " + t("unsaved");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
    hdMarkDirty(); // keep the HD-2D preview in sync with edits
  }
  export function saveNow() {
    try {
      saveProject(localStorage, S.proj);
      $("save-ind").textContent = "✓ " + t("saved");
    } catch (e: any) {
      $("save-ind").textContent = "⚠ " + t("save failed");
      console.error(e);
    }
  }
  export function loadStored() {
    return loadStoredProject(localStorage, (project: any) => RA.migrateProject(project));
  }
  // Desktop: the .json file the project is bound to. Save (Ctrl+S) writes here
  // silently once set; the first save — or Export (Save As) — prompts for it.
  let currentProjectPath: any = null;
  function baseName(p: any) { return String(p).replace(/^.*[\\/]/, ""); }
  export async function desktopSave(saveAs?: any) {
    saveNow(); // keep the local autosave as a crash-recovery copy
    try {
      if (saveAs || !currentProjectPath) {
        const path = await host.saveProjectToFile(S.proj); // native Save dialog
        if (!path) { flashStatus("Saved locally — file save cancelled"); return; }
        currentProjectPath = path;
      } else {
        await host.saveProjectToPath(currentProjectPath, S.proj); // silent overwrite
      }
      flashStatus("Project saved to " + baseName(currentProjectPath));
    } catch (e: any) {
      flashStatus("Save failed: " + e.message);
    }
  }
  export async function exportProject() {
    if (host.isTauri) { desktopSave(true); return; } // Export = Save As on desktop
    try {
      const result = await exportProjectFile(S.proj);
      if (result && result.cancelled) {
        flashStatus("Project export cancelled");
      } else if (result && result.method === "picker") {
        flashStatus("Project exported to " + result.fileName);
      } else if (result) {
        flashStatus("Project export downloaded as " + result.fileName);
      }
    } catch (e: any) {
      alert("Project export failed: " + ((e && e.message) || e));
    }
  }
  export function openStandaloneExport() {
    const content = h("div", null,
      h("p", null, "Build the current project as one self-contained game file. The editor, engine folder, web server, and project .json are not required."),
      h("p", null, "Windows EXE includes a small launcher that extracts the game and opens it in the player's default browser. Standalone HTML works across platforms."),
      h("p", { class: "dim" }, "The launcher is unsigned, so Windows may show a security warning. Save slots are kept in the player's browser."),
    );
    modal({
      title: "Export Standalone Game",
      content,
      buttons: [
        { label: "Windows EXE", primary: true, async onClick(close: any) {
          try {
            await writeWindowsExecutable(S.proj, Assets);
            close();
            flashStatus("Windows game executable exported");
          } catch (e: any) {
            alert("Game export failed: " + e.message);
          }
        } },
        { label: "Standalone HTML", async onClick(close: any) {
          try {
            await writeStandaloneHtml(S.proj, Assets);
            close();
            flashStatus("Standalone HTML game exported");
          } catch (e: any) {
            alert("Game export failed: " + e.message);
          }
        } },
        { label: "Cancel" },
      ],
    });
  }
  export function importProject(file: any) {
    const r: any = new FileReader();
    r.onload = async () => {
      try {
        const p = JSON.parse(r.result);
        if (!p || !p.meta || (p.meta.engine !== "rpgatlas" && p.meta.engine !== "driftwood")) throw new Error("Not an RPGAtlas project file.");
        S.proj = RA.migrateProject(p);
        Assets.registerCustomChars(S.proj.customChars);
        await Assets.loadExternalAssets(S.proj);
        S.curMapId = S.proj.maps[0].id;
        S.selectedEvent = null;
        S.undoStack.length = 0; S.redoStack.length = 0;
        editorHooks.rebuildAll();
        touch();
      } catch (e: any) { alert("Import failed: " + e.message); }
    };
    r.readAsText(file);
  }
