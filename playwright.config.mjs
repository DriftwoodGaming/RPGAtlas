/* RPGAtlas — playwright.config.mjs
   End-to-end + golden-image harness (Phase 0 safety net).

   We test the BUILT app, not the dev server: webServer runs `npm run build`
   then `npm run preview` on a fixed port, so specs exercise the exact
   dist/ output that ships (byte-identical passthrough per vite.config.mjs).

   Determinism notes:
   - Chromium is launched with flags that force software rendering
     (SwiftShader/ANGLE) so WebGL2 (js/renderer.js HD-2D path) rasterizes
     identically across machines/CI instead of depending on whatever GPU
     happens to be present in headless mode.
   - Golden screenshots use a small maxDiffPixelRatio tolerance rather than
     pixel-perfect equality, to absorb sub-pixel AA/text differences.
   - See tests-e2e/README.md for how goldens are captured/updated and what
     they protect against (the Phase 2 renderer port).
   GPL-3.0-or-later. */

import { defineConfig, devices } from "@playwright/test";

// Overridable so parallel checkouts/worktrees (Phase 1 multi-agent work) can
// run their own preview server instead of silently reusing another checkout's
// (reuseExistingServer below is keyed on the URL).
const PORT = Number(process.env.RPGATLAS_E2E_PORT) || 4173;
// Vite's preview server binds the IPv6 loopback ([::1]) by default on this
// toolchain; "localhost" resolves correctly there whereas a hardcoded
// 127.0.0.1 (IPv4-only) does not on every machine. Use --host to pin an
// explicit interface if that ever changes.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests-e2e",
  snapshotPathTemplate: "{testDir}/__snapshots__/{platform}/{testFileName}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Capped rather than Playwright's default (CPU core count): SwiftShader
  // software-rendering the HD-2D WebGL2 path is heavy enough per-worker that
  // running the full suite at full local parallelism can starve the
  // renderer-golden specs into a "tearing down context" timeout on a busy
  // dev machine. 1 in CI (already serialized), capped at 2 locally.
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    },
  },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: {
      args: [
        // Force consistent software GPU rendering (SwiftShader/ANGLE) so
        // WebGL2 golden captures are stable across machines and CI, rather
        // than varying with whatever real GPU/driver is present.
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--disable-gpu-sandbox",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
