"use strict";

// Multi-currency wallet (src/engine/state/game-state.ts): currency id 1 is an
// alias for the classic G.gold purse, ids >= 2 live in G.wallet with the same
// 0..9,999,999 clamp, and currencyName resolves display labels from the
// Currency Types list. The real js/data.js RA runs inside the vm context so
// typeList is the shipping implementation; the game-state helpers are bundled
// on top with esbuild (the tests/interpreter.test.js pattern).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

const root = path.resolve(__dirname, "..");

const context = vm.createContext({ console, Assets: { T: {}, TILE: 48 } });
vm.runInContext(fs.readFileSync("js/plugins.js", "utf8"), context, { filename: "js/plugins.js" });
vm.runInContext(fs.readFileSync("js/data.js", "utf8"), context, { filename: "js/data.js" });
// The classic-script globals the bundle reads at eval (src/shared/deps.js).
vm.runInContext(
  "window = { RPGAtlasDeps: { Assets: Assets, RA: RA, Sfx: {}, RPGAtlasQuests: {} } };" +
  "module = { exports: {} }; exports = module.exports;",
  context,
);

const entry = `
  export { G, currencyBalance, addCurrency, currencyName, currencyRewardTotals } from ${JSON.stringify(
    path.join(root, "src/engine/state/game-state.ts").replace(/\\/g, "/"),
  )};
  export { ctx } from ${JSON.stringify(
    path.join(root, "src/engine/state/engine-context.ts").replace(/\\/g, "/"),
  )};
`;
const bundled = buildSync({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true,
  format: "cjs",
  write: false,
  platform: "node",
  logLevel: "silent",
}).outputFiles[0].text;
// Function-scope the bundle: its top-level `var`s (e.g. a re-exported
// DataDefaults) must not collide with js/data.js's global consts in this
// shared context.
vm.runInContext(
  "(function (module, exports, window) {\n" + bundled + "\n})(module, exports, window);",
  context,
  { filename: "game-state.bundle.js" },
);
const api = vm.runInContext("module.exports", context);

const { G, ctx, currencyBalance, addCurrency, currencyName, currencyRewardTotals } = api;
ctx.proj = {
  system: {
    currency: "G",
    types: {
      currencyTypes: [
        { id: 1, name: "Gold" },
        { id: 2, name: "Gems" },
        { id: 3, name: "Tokens" },
      ],
    },
  },
};

// Fresh state ships an empty wallet alongside the classic gold purse.
assert.equal(G.gold, 0, "G starts with zero gold");
assert.deepEqual(Object.keys(G.wallet), [], "G starts with an empty wallet");

// Id 1 (and 0/absent) is the classic purse — one balance, three spellings.
addCurrency(1, 50);
assert.equal(G.gold, 50, "addCurrency(1) moves classic gold");
assert.equal(currencyBalance(1), 50, "currencyBalance(1) reads classic gold");
assert.equal(currencyBalance(0), 50, "currency id 0 falls back to classic gold");
assert.equal(currencyBalance(undefined), 50, "an absent currency id is classic gold");

// Wallet ids get their own balance and never touch gold.
addCurrency(2, 30);
assert.equal(currencyBalance(2), 30, "addCurrency(2) fills the wallet balance");
assert.equal(G.wallet[2], 30, "wallet balances live in G.wallet by id");
assert.equal(G.gold, 50, "wallet changes never touch classic gold");

// Both directions clamp exactly like gold: floor 0, cap 9,999,999.
addCurrency(2, -100);
assert.equal(currencyBalance(2), 0, "wallet balances clamp at zero");
addCurrency(3, 12000000);
assert.equal(currencyBalance(3), 9999999, "wallet balances cap at 9,999,999");
addCurrency(1, -100);
assert.equal(G.gold, 0, "the classic purse keeps its zero floor through the helper");

// A load of an old save leaves no wallet — the helpers recreate it on demand.
delete G.wallet;
assert.equal(currencyBalance(2), 0, "a missing wallet reads as zero everywhere");
addCurrency(2, 5);
assert.equal(G.wallet[2], 5, "addCurrency recreates a missing wallet");

// Display names: id 1 keeps the system currency unit, wallet ids use the
// Currency Types entry name, unknown ids degrade to "?".
assert.equal(currencyName(1), "G", "currency 1 shows the system.currency unit");
assert.equal(currencyName(2), "Gems", "wallet currencies show their list name");
assert.equal(currencyName(99), "?", "unknown currency ids degrade to ?");

// Per-enemy currency rewards: totals merge per currency across the defeated,
// ordered by first appearance; malformed rows pay nothing.
const toHost = (v) => JSON.parse(JSON.stringify(v));
const slime = { currencyRewards: [{ currencyId: 2, amount: 2 }, { currencyId: 3, amount: 1 }] };
const bat = { currencyRewards: [{ currencyId: 2, amount: 3 }] };
const plain = {}; // pre-wallet enemy: no rows at all
assert.deepEqual(
  toHost(currencyRewardTotals([slime, bat, plain, slime])),
  [{ currencyId: 2, amount: 7 }, { currencyId: 3, amount: 2 }],
  "reward rows merge per currency across every defeated enemy",
);
assert.deepEqual(toHost(currencyRewardTotals([plain])), [],
  "enemies without rows pay nothing (the classic victory)");
assert.deepEqual(toHost(currencyRewardTotals([])), [], "no defeated enemies, no rewards");
assert.deepEqual(
  toHost(currencyRewardTotals([{ currencyRewards: [
    { currencyId: 0, amount: 5 },   // missing/invalid currency
    { currencyId: 2, amount: 0 },   // zero pays nothing
    { currencyId: 3, amount: -4 },  // rewards never subtract
    { currencyId: 1, amount: 5 },   // classic gold IS allowed as a row
  ] }])),
  [{ currencyId: 1, amount: 5 }],
  "malformed rows are skipped; classic-gold rows are honored",
);

console.log("Currency wallet tests passed");
