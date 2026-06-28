"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const editorSource = fs.readFileSync("js/editor.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");

assert.match(
  editorSource,
  /function playtestUrl\(\) \{ return "play\.html\?playtest=" \+ Date\.now\(\); \}/,
  "browser playtests use a fresh play.html URL",
);

assert.match(
  editorSource,
  /window\.open\(playtestUrl\(\), "rpgatlas_play"\)/,
  "Playtest command opens the cache-busted browser URL",
);

assert.match(
  editorSource,
  /if \(mode !== "pass" && mode !== "height"\) \{/,
  "editor draws event pins outside Event mode",
);

assert.match(
  editorSource,
  /const interactiveEvents = mode === "event" \|\| mode === "start";/,
  "event editing states still get the stronger interactive marker treatment",
);

assert.match(
  indexSource,
  /js\/editor\.js\?v=62/,
  "index.html bumps the editor module cache key",
);

console.log("Editor playtest sync tests passed.");
