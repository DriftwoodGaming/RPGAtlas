/* RPGAtlas — src/renderer/index.ts
   The RendererAdapter seam's renderer-selection point. Since Phase 2 parity
   sign-off (Stage E) the three.js HD-2D renderer is the ONLY renderer — the
   classic raw-WebGL2 script (js/renderer.js) is retired and no longer ships.
   A leftover ?renderer=classic just logs a note and gets the three renderer.

   Hosts (engine render-glue/map-runtime, editor hd-viewport) import Renderer
   from HERE — the process-wide instance of the classic surface
   (available/setMap/renderFrame/isLost). See docs/phase-2-spec.md.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createThreeRenderer } from "./three-renderer.js";

try {
  const q = new URLSearchParams(window.location.search).get("renderer");
  if (q === "classic") {
    console.warn(
      "RPGAtlas: the classic renderer was retired at Phase 2 exit — using the three.js renderer.",
    );
  }
} catch {
  /* no DOM (sandboxed export preview) — nothing to check */
}

/** The process-wide HD-2D renderer. */
export const Renderer: any = createThreeRenderer();

/** Which backend is live — kept for diagnostics/tests. */
export const rendererBackend: string = "three";
