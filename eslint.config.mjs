/* RPGAtlas — eslint.config.mjs (ESLint 9 flat config)
   Scoped deliberately: lint covers new code (src/, tests-unit/) and the repo's
   config/tooling files. The existing js/ frontend (classic scripts) is
   intentionally NOT linted so this toolchain lands with zero diffs to legacy
   source; those
   files are converted module-by-module in later phases. GPL-3.0-or-later. */

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    // Never lint build output, deps, the desktop crate, legacy JS, or the
    // node:test suites (owned elsewhere). Both monoliths (engine.js, editor.js)
    // are fully dissolved into typed src/ modules as of Phase 1 Stages B and C,
    // so everything under src/ is linted.
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "js/**",
      "tests/**",
      "tools/**",
      "wiki/**",
      // Project Beacon MP5: the bundled server output (esbuild) + the DO's
      // generated worker are build artifacts, not source.
      "server/dist/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // Project Beacon MP1·C — the headless-world lint wall. Everything under
    // src/shared/sim/ is the DOM-free, instanced world core: a Beacon server
    // runs it with no browser, no engine singletons, no audio deck. Seal it off
    // from DOM globals and from the client/engine/renderer/audio module layers
    // so a future edit can't quietly reach back into the presentation half and
    // break instancing (or crash the server). Only pure shared modules and
    // other sim modules may be imported here.
    files: ["src/shared/sim/**/*.{ts,js}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/engine/**", // engine (client/composition) modules
                "**/deps", // the window-bridge facade (window at eval)
                "**/deps.js",
                "**/audio-deck", // audio output
                "**/audio-deck.js",
                "**/renderer/**", // rendering
                "**/render-glue*",
                "**/platform/**", // per-device storage / host façades
                "three", // the WebGL renderer
              ],
              message:
                "src/shared/sim/ is the headless world core (Beacon MP1): it must not import DOM/engine/renderer/audio/platform modules. Keep it pure — only shared pure modules and other sim modules.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "sim core is headless — no window (MP1·C lint wall)." },
        { name: "document", message: "sim core is headless — no document (MP1·C lint wall)." },
        { name: "location", message: "sim core is headless — no location (MP1·C lint wall)." },
        { name: "localStorage", message: "sim core is headless — no localStorage (MP1·C lint wall)." },
        { name: "navigator", message: "sim core is headless — no navigator (MP1·C lint wall)." },
        { name: "Image", message: "sim core is headless — no Image (MP1·C lint wall)." },
      ],
    },
  },
];
