"use strict";

// Project Compass M2·B — the message escape-code renderer (js/runtime/messages.js).
// createMessageSystem is a classic script exposed on `window`; we load it (plus
// js/plugins.js for the Atlas_TextCodes \c/\i pass) in a vm with stub deps and
// assert richText() expands the full MZ/MV escape-code set. This is the
// "escape-code renderer" test the roadmap's M2·B step calls for. The typewriter's
// DOM-driven pacing (which consumes the .msg-ctl markers asserted here) is proven
// in the player e2e where a real DOM exists.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({
  console,
  window: {
    Atlas: {
      util: {
        color(code) {
          if (typeof code === "string" && code[0] === "#") return code;
          return code === "2" ? "#ffd86a" : code === "14" ? "#ffe08a" : "#ffffff";
        },
      },
      register() {},
    },
  },
});
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });
vm.runInContext(fs.readFileSync("js/runtime/messages.js", "utf8"), context, { filename: "js/runtime/messages.js" });

// The Atlas_TextCodes text processor (\c, \i, [b]/[i]/[color]/[size]).
const textProc = vm.runInContext(`
  (() => {
    let processor = null;
    const atlas = {
      Assets: { iconHtml: (i, c) => '<span class="' + c + '" data-icon="' + i + '"></span>' },
      onMessageText(fn) { processor = fn; },
    };
    AtlasBuiltins.specByKey("Atlas_TextCodes").fn(atlas, {});
    return processor;
  })()
`, context);

const state = {
  vars: { 1: 42, 5: 7 },
  gold: 250,
  party: [{ name: "Mara", actorId: 1 }, { name: "Finn", actorId: 2 }],
};
const project = { system: { currency: "G" }, actors: [{ id: 1, name: "Mara" }, { id: 2, name: "Finn" }] };

const ms = context.window.createMessageSystem({
  Assets: {},
  el: () => ({}),
  esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  getPlugins: () => ({ textProcessors: [textProc] }),
  getProject: () => project,
  getState: () => state,
  getUiLayer: () => ({}),
  pushUI() {},
  removeUI() {},
});
const rt = (s) => ms.richText(s);

// --- substitution codes ------------------------------------------------------
assert.equal(rt("HP \\v[1]"), "HP 42", "\\v[n] → variable value");
assert.equal(rt("\\n[1]"), "Mara", "\\n[n] → actor name");
assert.equal(rt("\\p[2]"), "Finn", "\\p[n] → nth party member's name");
assert.equal(rt("\\g"), "250 G", "\\g → gold + currency");

// --- gold badge (\$) ---------------------------------------------------------
assert.match(rt("Have \\$!"), /<span class="msg-gold">250 G<\/span>/, "\\$ → inline gold badge");

// --- relative size stack (\{ \}) --------------------------------------------
assert.match(rt("a\\{big\\}norm"), /<span style="font-size:24px">big<\/span>norm/, "\\{ opens a bigger size, \\} closes it");
assert.match(rt("\\}small"), /<span style="font-size:12px">small<\/span>/, "\\} alone shrinks the text");

// --- pacing / flow markers (typed by the typewriter) -------------------------
assert.match(rt("a\\.b"), /<span class="msg-ctl" data-wait="15"><\/span>/, "\\. → ¼s wait marker");
assert.match(rt("a\\|b"), /<span class="msg-ctl" data-wait="60"><\/span>/, "\\| → 1s wait marker");
assert.match(rt("a\\!b"), /<span class="msg-ctl" data-btn="1"><\/span>/, "\\! → wait-for-button marker");
assert.match(rt("a\\>b"), /<span class="msg-ctl" data-instant="1"><\/span>/, "\\> → instant-on marker");
assert.match(rt("a\\<b"), /<span class="msg-ctl" data-instant="0"><\/span>/, "\\< → instant-off marker");
assert.match(rt("a\\^"), /<span class="msg-ctl" data-nowait="1"><\/span>/, "\\^ → no-input-wait marker");

// --- MZ extras (\px \py \fs) -------------------------------------------------
assert.equal(rt("\\px[40]\\py[10]hi"), "hi", "\\px / \\py positioning is stripped");
// \fs sets the size for the rest of the message, so it opens a size span (no close).
assert.match(rt("\\fs[28]big"), /<span style="font-size:28px">big/, "\\fs[n] sets the font size");

// --- literal backslash (\\) --------------------------------------------------
assert.equal(rt("a\\\\b"), "a\\b", "\\\\ renders one literal backslash");
assert.equal(rt("\\\\v[1]"), "\\v[1]", "an escaped backslash guards the next code from expanding");

// --- colour + icons still come from the plugin -------------------------------
assert.match(rt("\\c[2]hot\\c[0]"), /<span style="color:#ffd86a">hot<\/span>/, "\\c[n] still colours via the plugin");
assert.match(rt("\\c[14]x"), /<span style="color:#ffe08a">x<\/span>/, "extended palette index (MZ range) resolves");
assert.match(rt("\\i[12]"), /class="msg-icon" data-icon="12"/, "\\i[n] still draws an icon via the plugin");

// --- name box reuses richText (speaker names expand codes too) ---------------
assert.equal(rt("\\n[2]"), "Finn", "name-box text runs through the same code expansion");

console.log("Message escape-code renderer tests passed.");
