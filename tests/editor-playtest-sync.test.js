"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const workspaceSource = fs.readFileSync("src/editor/workspace.ts", "utf8");
const mapRenderSource = fs.readFileSync("src/editor/map-editor/map-render.ts", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");

assert.match(
  workspaceSource,
  /function playtestUrl\(\) \{ return "play\.html\?playtest=" \+ Date\.now\(\); \}/,
  "browser playtests use a fresh play.html URL",
);

assert.match(
  workspaceSource,
  /window\.open\(playtestUrl\(\), "rpgatlas_play"\)/,
  "Playtest command opens the cache-busted browser URL",
);

// Phase 8 Stage A: the render body moved into renderMapView(g, map, v), so
// the mode reads are v.mode (the classic editor binds v to S via viewFromS).
assert.match(
  mapRenderSource,
  /if \(v\.mode !== "pass" && v\.mode !== "height" && v\.mode !== "region"\) \{/,
  "editor draws event pins outside the overlay paint modes (pass/height/region)",
);

assert.match(
  mapRenderSource,
  /const interactiveEvents = v\.mode === "event" \|\| v\.mode === "start";/,
  "event editing states still get the stronger interactive marker treatment",
);

assert.match(
  indexSource,
  /<script type="module" src="\/src\/editor\/main\.ts"><\/script>/,
  "index.html loads the editor via the Vite module entry (cache-busting is handled by Vite: native serving in dev, content-hashed asset in build)",
);

console.log("Editor playtest sync tests passed.");
