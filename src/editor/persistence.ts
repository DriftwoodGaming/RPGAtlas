/* RPGAtlas — src/editor/persistence.ts
   Autosave / load / project import & export (wraps js/editor/project-io.js).
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 1):
   logic unchanged, closure vars already routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  buildStandaloneGame,
  downloadBlob,
  exportProjectFile,
  exportStandaloneHtml as writeStandaloneHtml,
  exportWindowsExecutable as writeWindowsExecutable,
  loadStandaloneTemplate,
} from "../../js/editor/project-io.js";
import { buildWebZipEntries, buildZip, renderGameIcon } from "./export-web";
import * as host from "../../js/editor/host.js";
import { isProjectLike, validateProject } from "../shared/schema";
import { BrowserProjectRepository } from "../platform/browser/project-repository";
import {
  consumeEmbeddedAssets,
  embedUsedAssets,
  exportUsedAudioAssets,
  libraryImageEntries,
} from "../shared/asset-library";
import { Assets, RA, t, editorState as S, editorHooks } from "./editor-state";
import { $, h } from "./dom";
import { modal } from "./modals";
import { flashStatus } from "./map-editor/status";
import { viewportDirty } from "./map-editor/hd-viewport";
import { worldDirty } from "./map-editor/world-view";
import { noteEdit } from "./edit-scope";

// The editor's project store over localStorage. The migrator runs the project
// through RA.migrateProject then the load-boundary schema guard, so both
// loadStored() and the first-run gate see the same behavior as before.
const projectRepo = new BrowserProjectRepository(
  (project: any) => validateProject(RA.migrateProject(project), "load"),
);

  let saveTimer: any = null;
  export function touch() {
    $("save-ind").textContent = "● " + t("unsaved");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
    viewportDirty(); // keep the live HD-2D viewport in sync with edits
    worldDirty();    // and the World View map-connection graph
    noteEdit();      // unified undo: extend an active scoped-edit window (Stage F)
  }
  export function saveNow() {
    try {
      projectRepo.saveProject(S.proj);
      $("save-ind").textContent = "✓ " + t("saved");
    } catch (e: any) {
      $("save-ind").textContent = "⚠ " + t("save failed");
      console.error(e);
    }
  }
  export function loadStored() {
    return projectRepo.loadProject();
  }
  // Desktop: the .json file the project is bound to. Save (Ctrl+S) writes here
  // silently once set; the first save — or Export (Save As) — prompts for it.
  let currentProjectPath: any = null;
  function baseName(p: any) { return String(p).replace(/^.*[\\/]/, ""); }
  export async function desktopSave(saveAs?: any) {
    saveNow(); // keep the local autosave as a crash-recovery copy
    try {
      // Saved FILES carry the used library assets embedded (Phase 6), so a
      // .json opens complete on another device; autosaves stay blob-free.
      const bundled = await embedUsedAssets(S.proj);
      if (saveAs || !currentProjectPath) {
        const path = await host.saveProjectToFile(bundled); // native Save dialog
        if (!path) { flashStatus("Saved locally — file save cancelled"); return; }
        currentProjectPath = path;
      } else {
        await host.saveProjectToPath(currentProjectPath, bundled); // silent overwrite
      }
      flashStatus("Project saved to " + baseName(currentProjectPath));
    } catch (e: any) {
      flashStatus("Save failed: " + e.message);
    }
  }
  export async function exportProject() {
    if (host.isTauri) { desktopSave(true); return; } // Export = Save As on desktop
    try {
      const result = await exportProjectFile(await embedUsedAssets(S.proj));
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
  // Standalone exports embed images through the js/assets.js used-asset walk;
  // audio lives only in the library, so this wrapper merges the used audio
  // entries into the same RPGATLAS_ASSETS payload (Phase 6).
  const assetsWithAudio = {
    ...Assets,
    async exportUsedExternalAssets(project: any) {
      const images = await Assets.exportUsedExternalAssets(project);
      return images.concat(await exportUsedAudioAssets(project));
    },
  };
  // Web / itch.io zip (Phase 7 Stage E): the standalone HTML at the zip root
  // (itch.io's HTML5 layout) wired up as an installable, offline-capable PWA.
  async function exportWebZip() {
    const [game, template] = await Promise.all([
      buildStandaloneGame(S.proj, assetsWithAudio),
      loadStandaloneTemplate(),
    ]);
    const title = S.proj.system.title || "RPGAtlas Game";
    const [icon192, icon512] = await Promise.all([
      renderGameIcon(title, 192).then(async (b: Blob) => new Uint8Array(await b.arrayBuffer())),
      renderGameIcon(title, 512).then(async (b: Blob) => new Uint8Array(await b.arrayBuffer())),
    ]);
    const entries = buildWebZipEntries(game.html, title, template, icon192, icon512);
    const zipBytes = buildZip(entries);
    downloadBlob(new Blob([zipBytes as any], { type: "application/zip" }), game.baseName + "-web.zip");
  }
  export function openStandaloneExport() {
    const content = h("div", null,
      h("p", null, "Build the current project as one self-contained game file. The editor, engine folder, web server, and project .json are not required."),
      h("p", null, "Windows EXE includes a small launcher that extracts the game and opens it in the player's default browser. Standalone HTML works across platforms. Web (.zip) is ready to upload to itch.io or any static host — players can install it as an app and replay offline."),
      h("p", { class: "dim" }, "The launcher is unsigned, so Windows may show a security warning. Save slots are kept in the player's browser. A fully native desktop EXE (no browser) can be built from the repo with: node scripts/package-game-exe.mjs <project.json> (needs the Rust toolchain)."),
    );
    modal({
      title: "Export Standalone Game",
      content,
      buttons: [
        { label: "Windows EXE", primary: true, async onClick(close: any) {
          try {
            await writeWindowsExecutable(S.proj, assetsWithAudio);
            close();
            flashStatus("Windows game executable exported");
          } catch (e: any) {
            alert("Game export failed: " + e.message);
          }
        } },
        { label: "Standalone HTML", async onClick(close: any) {
          try {
            await writeStandaloneHtml(S.proj, assetsWithAudio);
            close();
            flashStatus("Standalone HTML game exported");
          } catch (e: any) {
            alert("Game export failed: " + e.message);
          }
        } },
        { label: "Web / itch.io (.zip)", async onClick(close: any) {
          try {
            await exportWebZip();
            close();
            flashStatus("Web game zip exported (itch.io-ready, offline-capable)");
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
        if (!isProjectLike(p)) throw new Error("Not an RPGAtlas project file.");
        S.proj = validateProject(RA.migrateProject(p), "import");
        // Embedded assets (Phase 6): intake into this device's library
        // (hash-deduped), strip from the document, then live-register the
        // image entries so pickers/tiles see them without a reload.
        await consumeEmbeddedAssets(S.proj);
        Assets.registerCustomChars(S.proj.customChars);
        // registerExternalAssets discovers-if-needed, binds the shipped
        // catalog AND any just-consumed library entries in one pass.
        await Assets.registerExternalAssets(libraryImageEntries(), S.proj);
        S.curMapId = S.proj.maps[0].id;
        S.selectedEvent = null;
        S.undoStack.length = 0; S.redoStack.length = 0;
        editorHooks.rebuildAll();
        touch();
      } catch (e: any) { alert("Import failed: " + e.message); }
    };
    r.readAsText(file);
  }
