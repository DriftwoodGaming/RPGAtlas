/* RPGAtlas — js/standalone-template.mjs
   The single-file standalone game HTML assembler (Phase 7 Stage E). Pure
   string work over pre-fetched sources, importable from BOTH the browser
   export path (js/editor/project-io.js) and Node tooling
   (scripts/package-game-exe.mjs) — like js/build-manifest.mjs, keeping the
   in-editor export and the native game packager from ever drifting apart.
   GPL-3.0-or-later (see LICENSE). */

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

/**
 * Assemble the self-contained game HTML.
 * @param project  the project document (plain object)
 * @param files    STANDALONE_EXPORT_FILES sources IN ORDER: files[0] is the
 *                 CSS, the last entry is the player module bundle, everything
 *                 between is a classic script.
 * @param usedAssets  RPGATLAS_ASSETS payload (used external images + audio)
 * @param iconSet  data URL of img/system/icon_set.png
 * @returns { html, baseName, gameId }
 */
export function assembleStandaloneHtml(project, files, usedAssets, iconSet) {
  const title = project.system.title || "RPGAtlas Game";
  const baseName = safeFileName(title, "RPGAtlas_Game");
  const gameId = safeFileName(title, "rpgatlas-game").toLowerCase();
  const projectJson = JSON.stringify(project).replace(/</g, "\\u003c");
  const assetsJson = JSON.stringify(usedAssets).replace(/</g, "\\u003c");
  // files[0] is the CSS and the last entry is the player bundle (module); every
  // file between them is a classic script inlined in manifest order.
  const classicScripts = files
    .slice(1, -1)
    .map((source) => `  <script>${scriptText(source)}<\/script>`)
    .join("\n");

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
${classicScripts}
  <script>
window.RPGAtlasDeps = { Assets, DataDefaults, Music, RA, Sfx };
  <\/script>
  <script type="module">${scriptText(files[files.length - 1])}<\/script>
</body>
</html>
`;
  return { html, baseName, gameId };
}

/**
 * Web-zip variant (Phase 7 Stage E): wire the single-file HTML up as an
 * installable, offline-capable PWA. Only the zip export calls this — the
 * plain single-file HTML export stays untouched (a lone .html file has no
 * sibling manifest/sw to reference).
 */
export function injectPwaHooks(html) {
  return html.replace(
    "</head>",
    `<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#101018">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<script>
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
}
<\/script>
</head>`,
  );
}

/** manifest.webmanifest for the web-zip export. */
export function webManifestFor(title) {
  const name = String(title || "RPGAtlas Game");
  return JSON.stringify({
    name,
    short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
    start_url: "./index.html",
    scope: "./",
    display: "standalone",
    orientation: "landscape",
    background_color: "#0a0b10",
    theme_color: "#101018",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  }, null, 1);
}

/** Cache-first service worker for the web-zip export. `version` should change
 *  whenever the game content changes (the exporter hashes the HTML) so a
 *  re-uploaded build replaces the old cache on the next visit. */
export function serviceWorkerFor(version) {
  const cacheName = "rpgatlas-game-" + version;
  return `/* RPGAtlas game service worker — cache-first offline play. */
const CACHE = ${JSON.stringify(cacheName)};
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)),
  );
});
`;
}
