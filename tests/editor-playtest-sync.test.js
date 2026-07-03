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

assert.match(
  mapRenderSource,
  /if \(S\.mode !== "pass" && S\.mode !== "height" && S\.mode !== "region"\) \{/,
  "editor draws event pins outside the overlay paint modes (pass/height/region)",
);

assert.match(
  mapRenderSource,
  /const interactiveEvents = S\.mode === "event" \|\| S\.mode === "start";/,
  "event editing states still get the stronger interactive marker treatment",
);

assert.match(
  indexSource,
  /<script type="module" src="\/src\/editor\/main\.ts"><\/script>/,
  "index.html loads the editor via the Vite module entry (cache-busting is handled by Vite: native serving in dev, content-hashed asset in build)",
);

console.log("Editor playtest sync tests passed.");
