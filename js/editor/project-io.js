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
  storage.setItem("rpgatlas_project", JSON.stringify(project));
}

export function safeFileName(name, fallback) {
  return (name || fallback).replace(/[^\w\- ]+/g, "").trim().replace(/ +/g, "_") || fallback;
}

function htmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scriptText(value) {
  return String(value).replace(/<\/script/gi, "<\\/script");
}

async function fetchBuildSource(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load " + path + " (" + response.status + ").");
  return response.text();
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

export function exportProjectFile(project) {
  const blob = new Blob([JSON.stringify(project, null, 1)], { type: "application/json" });
  const title = project.system.title || "rpgatlas-project";
  downloadBlob(blob, safeFileName(title, "rpgatlas-project") + ".json");
}

export async function buildStandaloneGame(project, Assets) {
  const paths = [
    "css/play.css",
    "js/assets.js",
    "js/sfx.js",
    "js/data.js",
    "js/runtime/messages.js",
    "js/engine.js",
  ];
  const [files, usedAssets, iconSet] = await Promise.all([
    Promise.all(paths.map(fetchBuildSource)),
    Assets.exportUsedExternalAssets(project),
    fetchDataUrl("img/system/icon_set.png"),
  ]);

  const title = project.system.title || "RPGAtlas Game";
  const baseName = safeFileName(title, "RPGAtlas_Game");
  const gameId = safeFileName(title, "rpgatlas-game").toLowerCase();
  const projectJson = JSON.stringify(project).replace(/</g, "\\u003c");
  const assetsJson = JSON.stringify(usedAssets).replace(/</g, "\\u003c");
  const messageModuleUrl = "data:text/javascript;charset=utf-8," + encodeURIComponent(files[4]);
  const importMap = JSON.stringify({
    imports: {
      "./runtime/messages.js": messageModuleUrl,
    },
  }).replace(/</g, "\\u003c");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlText(title)}</title>
<style>${scriptText(files[0])}</style>
</head>
<body>
  <div id="stage"><canvas id="gamecanvas"></canvas></div>
  <script id="rpgatlas-project" type="application/json">${projectJson}</script>
  <script id="rpgatlas-assets" type="application/json">${assetsJson}</script>
  <script>
window.RPGATLAS_PROJECT = JSON.parse(document.getElementById("rpgatlas-project").textContent);
window.RPGATLAS_ASSETS = JSON.parse(document.getElementById("rpgatlas-assets").textContent);
window.RPGATLAS_ICON_SET = ${JSON.stringify(iconSet)};
window.RPGATLAS_GAME_ID = ${JSON.stringify(gameId)};
  <\/script>
  <script>${scriptText(files[1])}<\/script>
  <script>${scriptText(files[2])}<\/script>
  <script>${scriptText(files[3])}<\/script>
  <script>
window.RPGAtlasDeps = { Assets, DataDefaults, GLRender: window.GLRender, Music, RA, Sfx };
  <\/script>
  <script type="importmap">${importMap}<\/script>
  <script type="module">${scriptText(files[5])}<\/script>
</body>
</html>
`;
  return { html, baseName };
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
