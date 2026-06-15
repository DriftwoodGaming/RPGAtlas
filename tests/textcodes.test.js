"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({
  console,
  window: {
    Atlas: {
      util: {
        color(code) {
          return code === "2" ? "#ffd86a" : "#ffffff";
        },
      },
      register() {},
    },
  },
});
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });

const output = vm.runInContext(`
  (() => {
    let processor = null;
    const atlas = {
      Assets: {
        iconHtml(index, className) {
          return '<span class="' + className + '" data-icon="' + index + '"></span>';
        },
      },
      onMessageText(fn) { processor = fn; },
    };
    AtlasBuiltins.specByKey("Atlas_TextCodes").fn(atlas, {});
    return processor("Take \\\\i[12] and \\\\c[2]shine\\\\c[0].");
  })()
`, context);

assert.match(output, /class="msg-icon" data-icon="12"/);
assert.match(output, /<span style="color:#ffd86a">shine<\/span>/);
assert.doesNotMatch(output, /\\i\[12\]/);

console.log("Text code tests passed.");
