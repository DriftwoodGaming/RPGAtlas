/* RPGAtlas - editor/project-io.js
   Project persistence and standalone build/export helpers.
   GPL-3.0-or-later (see LICENSE). */

export function loadStoredProject(storage, migrateProject) {
  try {
    const legacy = !storage.getItem("rpgatlas_project");
    const raw = storage.getItem("rpgatlas_project") || storage.getItem("driftwood_project");
    if (!raw) return null;

    const project = JSON.parse(raw);
    if (!project || !project.meta ||
        (project.meta.engine !== "rpgatlas" && project.meta.engine !== "driftwood")) {
      return null;
    }

    const migrated = migrateProject(project);
    if (legacy) {
      try {
        storage.setItem("rpgatlas_project", JSON.stringify(migrated));
        storage.removeItem("driftwood_project");
      } catch (error) {
        console.warn(error);
      }
    }
    return migrated;
  } catch (error) {
    console.warn(error);
    return null;
  }
}

export function saveProject(storage, project) {
  // Autosaves must stay blob-free (Phase 6): assets.external carries embedded
  // asset data URLs only inside SAVED FILES — this device's library already
  // holds those blobs, and localStorage has the quota the library exists to
  // escape. Shallow-copy so the live project is untouched.
  if (project && project.assets && project.assets.external) {
    const assets = Object.assign({}, project.assets);
    delete assets.external;
    project = Object.assign({}, project, { assets });
  }
  storage.setItem("rpgatlas_project", JSON.stringify(project));
}

export function safeFileName(name, fallback) {
  return (name || fallback).replace(/[^\w\- ]+/g, "").trim().replace(/ +/g, "_") || fallback;
}

// htmlText/scriptText moved to js/standalone-template.mjs with the HTML assembly.

async function fetchBuildSource(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load " + path + " (" + response.status + ").");
  return response.text();
}

// The standalone-export file list lives in the shared build manifest, and the
// HTML assembly in the shared template module, so the in-editor export, the
// Tauri staging step, the packaged exe, AND the native game packager never
// drift apart. In the browser (Vite serves js/*.mjs) a direct dynamic import
// resolves; in the Node test harness this module is evaluated from a data:
// URL where a relative import cannot be resolved, so we fall back to fetching
// the module source and importing it as a data: URL.
async function importViaFetch(fetchPath) {
  const source = await fetchBuildSource(fetchPath);
  // btoa() is Latin1-only; the module sources have UTF-8 comment characters,
  // so encode the bytes first. This path only runs in the Node test harness.
  const base64 = btoa(
    String.fromCharCode(...new TextEncoder().encode(source)),
  );
  return import("data:text/javascript;base64," + base64);
}
// NOTE: the relative imports below stay LITERAL so Vite statically bundles
// them into the built editor (a variable-specifier import would try to
// resolve against /assets/ at runtime and 404 in builds).
async function loadBuildManifest() {
  try {
    return await import("../build-manifest.mjs");
  } catch {
    return importViaFetch("js/build-manifest.mjs");
  }
}
export async function loadStandaloneTemplate() {
  try {
    return await import("../standalone-template.mjs");
  } catch {
    return importViaFetch("js/standalone-template.mjs");
  }
}

// The player runtime is fetched from a different URL depending on where the
// editor is running: under `npm run dev` the atlas-player-bundle plugin serves
// a freshly-bundled IIFE at PLAYER_BUNDLE_DEV_URL, whereas a built / previewed /
// Tauri / EXE editor loads the emitted PLAYER_BUNDLE_FILE sitting next to
// index.html. import.meta.env.DEV (injected by Vite) is the discriminator; it
// is absent in the Node test harness (data: URL), where we keep the dist path.
function resolvePlayerBundleUrl(manifest) {
  let isDev = false;
  try {
    isDev = Boolean(import.meta.env && import.meta.env.DEV);
  } catch {
    isDev = false;
  }
  return isDev ? manifest.PLAYER_BUNDLE_DEV_URL : manifest.PLAYER_BUNDLE_FILE;
}

async function loadStandaloneExportPaths() {
  const manifest = await loadBuildManifest();
  const paths = manifest.STANDALONE_EXPORT_FILES.slice();
  // The manifest lists the player bundle by its dist filename; swap in the
  // environment-correct URL (dev middleware vs emitted file). The bundle is
  // always the last positional entry — see build-manifest.mjs.
  const bundleUrl = resolvePlayerBundleUrl(manifest);
  paths[paths.length - 1] = bundleUrl;
  return paths;
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fetchDataUrl(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load " + path + " (" + response.status + ").");
  return blobDataUrl(await response.blob());
}

export function downloadBlob(blob, fileName) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 5000);
}

async function saveBlobWithPicker(blob, fileName) {
  const picker = globalThis.showSaveFilePicker;
  if (typeof picker !== "function") return null;

  const handle = await picker({
    suggestedName: fileName,
    types: [{
      description: "RPGAtlas project",
      accept: { "application/json": [".json"] },
    }],
  });
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
  return handle;
}

export async function exportProjectFile(project) {
  const blob = new Blob([JSON.stringify(project, null, 1)], { type: "application/json" });
  const title = project.system.title || "rpgatlas-project";
  const fileName = safeFileName(title, "rpgatlas-project") + ".json";
  try {
    const handle = await saveBlobWithPicker(blob, fileName);
    if (handle) return { method: "picker", fileName: handle.name || fileName };
  } catch (error) {
    if (error && error.name === "AbortError") return { cancelled: true, fileName };
    throw error;
  }
  downloadBlob(blob, fileName);
  return { method: "download", fileName };
}

export async function buildStandaloneGame(project, Assets) {
  const paths = await loadStandaloneExportPaths();
  const [template, files, usedAssets, iconSet] = await Promise.all([
    loadStandaloneTemplate(),
    Promise.all(paths.map(fetchBuildSource)),
    Assets.exportUsedExternalAssets(project),
    fetchDataUrl("img/system/icon_set.png"),
  ]);
  // The HTML assembly lives in js/standalone-template.mjs (shared with the
  // native game packager, scripts/package-game-exe.mjs).
  return template.assembleStandaloneHtml(project, files, usedAssets, iconSet);
}

export async function exportStandaloneHtml(project, Assets) {
  const game = await buildStandaloneGame(project, Assets);
  downloadBlob(new Blob([game.html], { type: "text/html;charset=utf-8" }), game.baseName + ".html");
}

export async function exportWindowsExecutable(project, Assets) {
  const [game, launcherResponse] = await Promise.all([
    buildStandaloneGame(project, Assets),
    fetch("bin/RPGAtlasLauncher.exe"),
  ]);
  if (!launcherResponse.ok) {
    throw new Error("Could not load the Windows launcher (" + launcherResponse.status + ").");
  }

  const marker = new TextEncoder().encode("RPGATLAS_GAME_PAYLOAD_V1\n");
  const payload = new TextEncoder().encode(game.html);
  downloadBlob(
    new Blob([await launcherResponse.arrayBuffer(), marker, payload],
      { type: "application/vnd.microsoft.portable-executable" }),
    game.baseName + ".exe",
  );
}
