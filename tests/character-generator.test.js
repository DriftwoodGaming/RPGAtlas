/* RPGAtlas — Character Generator art-style regression tests. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

class FakeContext {
  constructor() {
    this.operations = [];
    this.fillStyle = "";
    this.globalCompositeOperation = "source-over";
    this.imageSmoothingEnabled = true;
  }
  fillRect(...args) { this.operations.push(["fillRect", this.fillStyle, ...args]); }
  clearRect(...args) { this.operations.push(["clearRect", ...args]); }
  drawImage(...args) { this.operations.push(["drawImage", ...args]); }
  save() { this.operations.push(["save"]); }
  restore() { this.operations.push(["restore"]); }
  translate(...args) { this.operations.push(["translate", ...args]); }
  scale(...args) { this.operations.push(["scale", ...args]); }
}

class FakeCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.context = new FakeContext();
  }
  getContext(kind) {
    assert.equal(kind, "2d");
    return this.context;
  }
}

function loadAssets() {
  const window = {};
  const context = vm.createContext({
    console,
    window,
    document: {
      createElement(tag) {
        assert.equal(tag, "canvas");
        return new FakeCanvas();
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, "js", "assets.js"), "utf8"), context, {
    filename: "js/assets.js",
  });
  return window.Assets;
}

const baseParams = {
  artStyle: "classic",
  bodyType: "balanced",
  outfit: "tunic",
  accessory: "none",
  skin: "#f0c8a0",
  hair: "#75442b",
  eyes: "#315d78",
  style: "short",
  shirt: "#3567a5",
  pants: "#273b5c",
  hat: "#d1a84b",
  accent: "#e2b84e",
};

test("character generator exposes four stable art styles", () => {
  const Assets = loadAssets();
  assert.deepEqual(
    Array.from(Assets.CHARACTER_ART_STYLES, (style) => style.id),
    ["classic", "chibi", "heroic", "storybook"],
  );
  assert.ok(Assets.CHARACTER_ART_STYLES.every((style) => style.name && style.description));
});

test("legacy and malformed custom characters fall back to Classic Pixel", () => {
  const Assets = loadAssets();
  const legacyIndex = Assets.registerHuman("legacy-style", "Legacy", {
    skin: baseParams.skin, hair: baseParams.hair, style: baseParams.style,
    shirt: baseParams.shirt, pants: baseParams.pants, hat: baseParams.hat,
  });
  const invalidIndex = Assets.registerHuman("invalid-style", "Invalid", {
    ...baseParams,
    artStyle: "oil-painting",
  });
  assert.equal(Assets.charsets[legacyIndex].params.artStyle, "classic");
  assert.equal(Assets.charsets[invalidIndex].params.artStyle, "classic");
  assert.equal(Assets.charsets[legacyIndex].params.bodyType, "balanced");
  assert.equal(Assets.charsets[legacyIndex].params.outfit, "tunic");
  assert.equal(Assets.charsets[legacyIndex].params.accessory, "none");
  assert.equal(Assets.charsets[legacyIndex].params.eyes, "#2d3348");
  assert.equal(Assets.charsets[legacyIndex].params.directions, 4);
});

test("each art style builds distinct geometry across all eight directions and walk frames", () => {
  const Assets = loadAssets();
  const signatures = [];
  for (const style of Assets.CHARACTER_ART_STYLES) {
    const index = Assets.registerHuman("style-" + style.id, style.name, {
      ...baseParams,
      artStyle: style.id,
      directions: 8,
    });
    const preview = Assets.humanPreviewCanvas({ ...baseParams, artStyle: style.id }, 0, 1);
    const blocks = preview.context.operations.filter(([op]) => op === "fillRect");
    assert.ok(blocks.length > 12, style.id + " draws a complete sprite directly");
    assert.equal(preview.context.operations.filter(([op]) => op === "drawImage").length, 0,
      style.id + " is geometry, not a post-processing filter");
    signatures.push(JSON.stringify(blocks));

    for (let dir = 0; dir < 8; dir++) {
      for (let frame = 0; frame < 3; frame++) {
        assert.ok(Assets.charFrameCanvas(index, dir, frame).context.operations.length > 0,
          `${style.id} direction ${dir} frame ${frame}`);
      }
    }
    const sheet = Assets.charSheetCanvas(index);
    assert.equal(sheet.width, 144, style.id + " sheet width");
    assert.equal(sheet.height, 384, style.id + " sheet height");
  }
  assert.equal(new Set(signatures).size, 4, "all four styles use different pixel constructions");
});

test("four-direction characters keep side fallback while eight-direction exports add dedicated rows", () => {
  const Assets = loadAssets();
  const fourIndex = Assets.registerHuman("four-dir", "Four", { ...baseParams, directions: 4 });
  assert.equal(Assets.charFrameCanvas(fourIndex, 4, 1), Assets.charFrameCanvas(fourIndex, 1, 1));
  assert.equal(Assets.charSheetCanvas(fourIndex).height, 192);
  assert.equal(Assets.charSheetCanvas(fourIndex, 8).height, 384);

  const eightIndex = Assets.registerHuman("eight-dir", "Eight", { ...baseParams, directions: 8 });
  const diagonal = Assets.charFrameCanvas(eightIndex, 4, 1);
  assert.notEqual(diagonal, Assets.charFrameCanvas(eightIndex, 1, 1));
  assert.ok(diagonal.context.operations.some(([op]) => op === "drawImage"));
  assert.equal(Assets.charSheetCanvas(eightIndex).height, 384);
});

test("the editor exposes thumbnails, build controls, palette controls, and coordinated randomizers", () => {
  const source = fs.readFileSync(path.join(root, "src", "editor", "tools", "character-generator.ts"), "utf8");
  const css = fs.readFileSync(path.join(root, "css", "editor.css"), "utf8");
  assert.match(source, /field\("Sprite art style"/);
  assert.match(source, /cg-style-card/);
  assert.match(source, /cg-style-thumb/);
  assert.match(source, /optionIn\("bodyType"/);
  assert.match(source, /optionIn\("outfit"/);
  assert.match(source, /optionIn\("accessory"/);
  assert.match(source, /colorIn\("eyes"\)/);
  assert.match(source, /colorIn\("accent"\)/);
  assert.match(source, /Randomize look/);
  assert.match(source, /Surprise me/);
  assert.match(source, /directionModeCard\(8/);
  assert.match(source, /Export 4-dir PNG/);
  assert.match(source, /Export 8-dir PNG/);
  assert.match(source, /cg-direction-grid/);
  assert.match(css, /\.cg-style-grid/);
  assert.match(css, /\.cg-style-card\.sel/);
  assert.match(css, /\.cg-direction-grid/);
  assert.match(css, /\.cg-preview-stage/);
});
