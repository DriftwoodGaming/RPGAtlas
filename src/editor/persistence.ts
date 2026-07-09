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
// Project Harbor H3: desktop folder saving. The active host (real project_save, or
// the ?fakehost test host) writes <root>/game.rpgatlas; the mirror bookkeeping lets a
// crash between the mirror write and the folder write be detected on the next boot.
import { activeManagerHost } from "./project-manager/manager-host";
import { MIRROR_META_KEY, stringifyMirrorMeta, type MirrorMeta } from "../shared/folder-sync";
import { viewportDirty } from "./map-editor/hd-viewport";
import { worldDirty } from "./map-editor/world-view";
import { advDirty } from "./advanced/adv-panel";
import { noteEdit } from "./edit-scope";

// The editor's project store over localStorage. The migrator runs the project
// through RA.migrateProject then the load-boundary schema guard, so both
// loadStored() and the first-run gate see the same behavior as before.
const projectRepo = new BrowserProjectRepository(
  (project: any) => validateProject(RA.migrateProject(project), "load"),
);

  let saveTimer: any = null;

  // Project Harbor H3·A: with a project folder open, autosave writes
  // <root>/game.rpgatlas via the active host's project_save (atomic + rolling backup)
  // and localStorage stays a crash-recovery mirror. folderRoot is bound by the Project
  // Manager (bindFolderProject) the instant a game is chosen — under real desktop AND
  // the ?fakehost test host — so folderRoot != null is the single "a folder game is
  // open" gate. The pure browser build never binds it, so saveNow() there is
  // byte-identical to before (mirror only).
  let folderRoot: string | null = null;
  // The exact bytes we believe are on disk (opened, or last written) — the H3·B
  // external-change baseline. Set at bind time to the opened document.
  let lastSavedJson: string | null = null;
  // Set by touch() on any edit; cleared once a folder save persists it. Gates the
  // folder write so merely opening a game (or a post-boot normalization save) never
  // rolls a backup for content the folder already holds.
  let folderDirty = false;
  // Serialize folder writes: project_save is atomic (tmp-then-rename), but overlapping
  // calls still waste backups; coalesce a save requested mid-write into one re-run.
  let folderSaveInFlight = false;
  let folderSaveQueued = false;

  /** Called by the Project Manager (bootChosen) when a folder game is chosen: record
   *  the root and the exact on-disk bytes we booted from. `dirty` is true only when the
   *  in-memory project intentionally differs from disk (H3·B crash recovery restored a
   *  newer mirror), so the next autosave writes the recovered content back to the folder. */
  export function bindFolderProject(root: string, diskDocument: string, dirty = false): void {
    folderRoot = root;
    lastSavedJson = diskDocument;
    folderDirty = dirty;
    folderSaveInFlight = false;
    folderSaveQueued = false;
  }

  /** The open folder root, or null (browser / no folder game). Read by H3·B. */
  export function openFolderRoot(): string | null { return folderRoot; }
  /** The bytes we last wrote to / opened from the folder file (H3·B baseline). */
  export function folderBaseline(): string | null { return lastSavedJson; }
  /** H3·B: accept a re-read disk state as the new baseline (stops re-nagging), and
   *  optionally mark the folder out of date so our version overwrites it next save. */
  export function noteDiskBaseline(diskDoc: string, dirty: boolean): void {
    lastSavedJson = diskDoc;
    if (dirty) folderDirty = true;
  }

  function writeMirrorMeta(root: string, folderConfirmed: boolean): void {
    try {
      const meta: MirrorMeta = { root, savedAt: Date.now(), folderConfirmed };
      localStorage.setItem(MIRROR_META_KEY, stringifyMirrorMeta(meta));
    } catch {
      /* storage may be unavailable — the mirror simply loses its bookkeeping */
    }
  }

  export function touch() {
    $("save-ind").textContent = "● " + t("unsaved");
    folderDirty = true;                       // H3·A: the folder file is now out of date
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
    viewportDirty(); // keep the live HD-2D viewport in sync with edits
    worldDirty();    // and the World View map-connection graph
    advDirty();      // and the Advanced Map Editor (Phase 8)
    noteEdit();      // unified undo: extend an active scoped-edit window (Stage F)
  }

  export function saveNow() {
    // The localStorage mirror is always written first — synchronously, on every build.
    // It is the crash-recovery copy AND the same-origin playtest bridge (play.html reads
    // rpgatlas_project), so it must be current before anything opens the player.
    let mirrorOk = true;
    try {
      projectRepo.saveProject(S.proj);
    } catch (e: any) {
      mirrorOk = false;
      console.error(e);
    }
    if (folderRoot) {
      // A project folder is open: the folder file is the truth. Record that the mirror
      // is (about to be) ahead of the folder, then persist to the folder.
      if (folderDirty) writeMirrorMeta(folderRoot, false);
      saveToFolder();
    } else {
      // Browser (or desktop before a game is chosen): localStorage IS the truth.
      $("save-ind").textContent = mirrorOk ? "✓ " + t("saved") : "⚠ " + t("save failed");
    }
  }

  // Persist the live document into <root>/game.rpgatlas (atomic + rolling backup) via
  // the active host — the real project_save on desktop, the fake host under ?fakehost.
  // Skips entirely when nothing changed since the last folder write, so opening a game
  // (or a post-boot normalization save) never rolls a spurious backup.
  function saveToFolder(): void {
    const root = folderRoot;
    if (!root) return;
    const json = JSON.stringify(S.proj);
    if (!folderDirty || json === lastSavedJson) {
      // The folder already holds this content — confirm the mirror and tick saved.
      folderDirty = false;
      writeMirrorMeta(root, true);
      $("save-ind").textContent = "✓ " + t("saved");
      return;
    }
    if (folderSaveInFlight) { folderSaveQueued = true; return; }
    folderSaveInFlight = true;
    folderDirty = false;
    activeManagerHost()
      .save(root, json)
      .then(() => {
        lastSavedJson = json;
        writeMirrorMeta(root, true);
        $("save-ind").textContent = "✓ " + t("saved");
      })
      .catch((e: any) => {
        folderDirty = true;                   // let a later save retry
        $("save-ind").textContent = "⚠ " + t("save failed");
        console.error(e);
      })
      .finally(() => {
        folderSaveInFlight = false;
        if (folderSaveQueued) { folderSaveQueued = false; saveToFolder(); }
      });
  }

  /** Ctrl+S / File ▸ Save on desktop: flush any pending autosave to the folder now
   *  (no debounce). The atomic write + the mirror both run inside saveNow(). */
  export function desktopFlush(): void {
    clearTimeout(saveTimer);
    saveNow();
    flashStatus("Saved to your game's folder");
  }

  export function loadStored() {
    return projectRepo.loadProject();
  }

  function baseName(p: any) { return String(p).replace(/^.*[\\/]/, ""); }

  // Export = a shareable single-file copy: the native Save dialog + embedded used
  // assets (so a .json opens complete on another device). Distinct from autosave, which
  // writes the blob-free game.rpgatlas into the project folder (H3·A). Kept on the
  // proven save_project dialog command (host.saveProjectToFile), unchanged from before.
  export async function exportDesktopFile(): Promise<void> {
    try {
      const bundled = await embedUsedAssets(S.proj);
      const path = await host.saveProjectToFile(bundled); // native Save dialog
      if (!path) { flashStatus("Export cancelled — your game is still saved in its folder"); return; }
      flashStatus("Exported a shareable copy to " + baseName(path));
    } catch (e: any) {
      flashStatus("Export failed: " + e.message);
    }
  }

  export async function exportProject() {
    if (host.isTauri) { await exportDesktopFile(); return; } // Export keeps the dialog
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
  // Exported: the Console's `build web` drives the same pipeline as the dialog.
  export async function exportWebZip() {
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
  // Console `build exe` / `build html` entry points — same builders the
  // Export Standalone Game dialog buttons call.
  export function exportWindowsExeFile() {
    return writeWindowsExecutable(S.proj, assetsWithAudio);
  }
  export function exportStandaloneHtmlFile() {
    return writeStandaloneHtml(S.proj, assetsWithAudio);
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
