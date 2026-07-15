"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeContext {
  constructor() { this.operations = []; this.imageSmoothingEnabled = true; }
  drawImage(...args) { this.operations.push(["drawImage", ...args]); }
}
class FakeCanvas {
  constructor() { this.width = 0; this.height = 0; this.context = new FakeContext(); }
  getContext() { return this.context; }
  toDataURL() { return "data:image/png;base64,combined-atlas"; }
}
class FakeImage {
  set src(value) {
    this._src = value;
    queueMicrotask(() => value === "broken" ? this.onerror() : this.onload());
  }
  get src() { return this._src; }
}

function loadAssets() {
  const styles = new Map();
  const document = {
    documentElement: { style: { setProperty(key, value) { styles.set(key, value); } } },
    createElement(tag) {
      if (tag === "canvas") return new FakeCanvas();
      if (tag === "span") return { className: "", title: "", style: { setProperty() {} } };
      throw new Error("unexpected element " + tag);
    },
  };
  const window = {};
  const quietConsole = { ...console, warn() {} };
  const context = vm.createContext({ console: quietConsole, document, Image: FakeImage, location: { href: "https://example.test/index.html" }, queueMicrotask, URL, window });
  vm.runInContext(fs.readFileSync("js/assets.js", "utf8"), context, { filename: "js/assets.js" });
  return { Assets: window.Assets, styles };
}

test("custom icon cells extend the atlas without shifting broken saved cells", async () => {
  const { Assets, styles } = loadAssets();
  await Assets.loadIconSet(["custom-a", "broken", "custom-b"]);
  assert.equal(Assets.BASE_ICON_COUNT, 128);
  assert.equal(Assets.ICON_COUNT, 131);
  assert.equal(styles.get("--icon-set-url"), 'url("data:image/png;base64,combined-atlas")');
  assert.match(Assets.iconHtml(130), /--icon-x:-64px;--icon-y:-512px/);
  const customCanvas = Assets.iconCanvas(130);
  assert.equal(customCanvas.context.operations.length, 1);
  assert.equal(customCanvas.context.operations[0][1].width, 256);
  assert.equal(customCanvas.context.operations[0][1].height, 544);

  await Assets.loadIconSet([]);
  assert.equal(Assets.ICON_COUNT, 128);
  assert.match(styles.get("--icon-set-url"), /^url\("https:\/\/example\.test\/img\/system\/icon_set\.png\?v=/);
});

test("new and current projects normalize their custom icon collection", () => {
  const context = vm.createContext({ console, Assets: { T: {} } });
  vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });
  vm.runInContext(fs.readFileSync("js/data.js", "utf8"), context, { filename: "js/data.js" });
  const fresh = vm.runInContext("DataDefaults.newProject().assets.icons", context);
  assert.deepEqual(Array.from(fresh), []);
  context.project = {
    meta: { engine: "rpgatlas", formatVersion: 2 },
    assets: { tiles: {}, icons: ["data:image/png;base64,one", null, "https://example.test/icon.png"] },
  };
  const migrated = vm.runInContext("RA.migrateProject(project)", context);
  assert.deepEqual(Array.from(migrated.assets.icons), ["data:image/png;base64,one"]);
});
