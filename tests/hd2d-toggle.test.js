"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const engineSource = fs.readFileSync("js/engine.js", "utf8");

function extractFunction(source, name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " exists");
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Could not extract " + name);
}

const hdMapEnabled = Function(`
  ${extractFunction(engineSource, "hdMapEnabled")}
  return hdMapEnabled;
`)();

assert.equal(hdMapEnabled(null), false);
assert.equal(hdMapEnabled({}), false);
assert.equal(
  hdMapEnabled({
    hd2d: { enabled: false, tilt: 25, bloom: true, dof: true, fog: { color: "#101018" }, lights: true, ambient: 0.45 },
    lights: [{ rx: 1, ry: 1, color: "#ffff00", radius: 64 }],
  }),
  false,
  "explicitly disabled HD-2D stays flat even when other HD-2D options are present",
);
assert.equal(
  hdMapEnabled({ hd2d: { enabled: true, tilt: 50, ambient: 0.45 } }),
  true,
  "explicitly enabled HD-2D renders through the perspective path",
);
assert.equal(
  hdMapEnabled({ hd2d: { tilt: 50, ambient: 0.45 } }),
  true,
  "legacy HD-2D settings without an explicit toggle still opt in",
);
assert.equal(
  hdMapEnabled({ lights: [{ rx: 1, ry: 1, color: "#ffff00", radius: 64 }] }),
  true,
  "legacy map lights without an explicit toggle still opt in",
);

console.log("HD-2D toggle tests passed.");
