import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function importBrowserModule(relativePath) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}
// Some runtime files (e.g. runtime/messages.js) are loaded as classic <script>s in the
// browser and export via the window global rather than ESM exports. Evaluate those the
// same way the browser does, with a window shim, and return what they hung off it.
async function importClassicScript(relativePath, sandbox = {}) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  const context = vm.createContext({ window: {}, console, ...sandbox });
  vm.runInContext(source, context, { filename: relativePath });
  return context.window;
}
const {
  buildStandaloneGame,
  exportProjectFile,
  loadStoredProject,
  safeFileName,
  saveProject,
} = await importBrowserModule("js/editor/project-io.js");
const { createMessageSystem } = await importClassicScript("js/runtime/messages.js");
const {
  createEditorI18n,
  EDITOR_LOCALE_STORAGE_KEY,
  normalizeEditorLocale,
} = await importBrowserModule("js/editor/i18n.js");

class MemoryStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
  }
  getItem(key) {
    return this.entries.has(key) ? this.entries.get(key) : null;
  }
  setItem(key, value) {
    this.entries.set(key, String(value));
  }
  removeItem(key) {
    this.entries.delete(key);
  }
}

assert.equal(normalizeEditorLocale("fr-CA"), "fr");
assert.equal(normalizeEditorLocale("unknown"), "en");
const localeStorage = new MemoryStorage();
const i18n = createEditorI18n({ storage: localeStorage, browserLocale: "es-MX" });
assert.equal(i18n.locale, "es");
assert.equal(i18n.t("Save Project"), "Guardar proyecto");
assert.equal(i18n.t("Untranslated editor text"), "Untranslated editor text");
assert.equal(
  i18n.t("Heights — painting {value} with {tool}", { value: 3, tool: "Lápiz" }),
  "Heights — painting 3 with Lápiz",
);
i18n.setLocale("de-DE");
assert.equal(i18n.locale, "de");
assert.equal(i18n.t("Maps"), "Karten");
assert.equal(localeStorage.getItem(EDITOR_LOCALE_STORAGE_KEY), "de");
assert.deepEqual(i18n.locales().map((locale) => locale.id), ["en", "es", "fr", "de"]);

const storage = new MemoryStorage({
  driftwood_project: JSON.stringify({ meta: { engine: "driftwood" }, system: {} }),
});
const migrated = loadStoredProject(storage, (project) => ({
  ...project,
  meta: { engine: "rpgatlas", version: 3 },
}));
assert.equal(migrated.meta.engine, "rpgatlas");
assert.ok(storage.getItem("rpgatlas_project"));
assert.equal(storage.getItem("driftwood_project"), null);

saveProject(storage, { meta: { engine: "rpgatlas" } });
assert.match(storage.getItem("rpgatlas_project"), /rpgatlas/);
assert.equal(safeFileName("My: Game!", "fallback"), "My_Game");

const originalShowSaveFilePicker = globalThis.showSaveFilePicker;
try {
  let pickerOptions = null;
  const pickerWrites = [];
  globalThis.showSaveFilePicker = async (options) => {
    pickerOptions = options;
    return {
      name: "Chosen_Project.json",
      async createWritable() {
        return {
          async write(blob) {
            pickerWrites.push(await blob.text());
          },
          async close() {
            pickerWrites.push("closed");
          },
        };
      },
    };
  };
  const pickedExport = await exportProjectFile({
    meta: { engine: "rpgatlas" },
    system: { title: "Picker: Quest!" },
  });
  assert.equal(pickerOptions.suggestedName, "Picker_Quest.json");
  assert.deepEqual(pickerOptions.types[0].accept, { "application/json": [".json"] });
  assert.deepEqual(pickedExport, { method: "picker", fileName: "Chosen_Project.json" });
  assert.match(pickerWrites[0], /"title": "Picker: Quest!"/);
  assert.equal(pickerWrites[1], "closed");

  globalThis.showSaveFilePicker = async () => {
    const error = new Error("cancelled");
    error.name = "AbortError";
    throw error;
  };
  assert.deepEqual(
    await exportProjectFile({ system: { title: "Cancel Test" } }),
    { cancelled: true, fileName: "Cancel_Test.json" },
  );
} finally {
  globalThis.showSaveFilePicker = originalShowSaveFilePicker;
}

const messages = createMessageSystem({
  Assets: {},
  el() {},
  esc(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  },
  getPlugins: () => ({
    textProcessors: [(html) => html.replace("Gold", "<b>Gold</b>")],
  }),
  getProject: () => ({
    actors: [{ id: 2, name: "Mira" }],
    system: { currency: "Gold" },
  }),
  getState: () => ({ vars: { 4: 12 }, gold: 90 }),
  getUiLayer() {},
  pushUI() {},
  removeUI() {},
});
assert.equal(messages.convertText("\\n[2] has \\v[4]."), "Mira has 12.");
assert.equal(messages.richText("\\g"), "90 <b>Gold</b>");

const originalFetch = globalThis.fetch;
const originalFileReader = globalThis.FileReader;
globalThis.fetch = async (resource) => {
  const filePath = path.join(root, String(resource).replace(/\//g, path.sep));
  try {
    const bytes = await fs.readFile(filePath);
    return new Response(bytes, { status: 200 });
  } catch {
    return new Response("", { status: 404 });
  }
};
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = "data:application/octet-stream;base64," +
        Buffer.from(buffer).toString("base64");
      this.onload();
    }, (error) => {
      this.error = error;
      this.onerror();
    });
  }
};

try {
  const game = await buildStandaloneGame(
    { system: { title: "Module Test" } },
    { exportUsedExternalAssets: async () => [] },
  );
  assert.equal(game.baseName, "Module_Test");
  // messages.js ships as a classic script that hangs createMessageSystem off window
  // (matching index.html/play.html); engine.js then runs as a module and reads it.
  assert.match(game.html, /window\.createMessageSystem = createMessageSystem;/);
  assert.match(game.html, /<script type="module">/);
  if (process.env.RPGATLAS_WRITE_STANDALONE_SMOKE) {
    await fs.writeFile(path.join(root, "tests", "standalone-smoke.html"), game.html);
  }
} finally {
  globalThis.fetch = originalFetch;
  globalThis.FileReader = originalFileReader;
}

console.log("Module tests passed.");
