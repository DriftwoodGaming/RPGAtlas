/* RPGAtlas — src/editor/advanced/adv-transform.ts
   Brush flip / rotate for the Advanced editor (Phase 8 Stage E).

   X / Y / R toggle the brush's horizontal-flip / vertical-flip / 90°-clockwise-
   rotation. The transform rides on advState.brushFlags and is folded into the
   painted value for PLAIN tiles only (autotile groups resolve their own shape);
   see adv-paint.brushValue. These are registered editor commands (palette- and
   menu-reachable, not just raw keys) whose key bindings fire only while the
   Advanced panel is focused, so X/Y/R keep their Standard-editor meanings
   elsewhere. Toggling composes the way a user expects after a rotation (H after
   a 90° turn flips the on-screen horizontal axis) via the pure tile-flags
   helpers. Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later. */

import { toggleH, toggleV, rotateCW } from "../../shared/tile-flags";
import { advState, advHooks } from "./adv-state";

/** Panel-focus predicate the key bindings gate on (bound on mount so boot.ts's
 *  key table doesn't import the dock). Returns true only when the Advanced panel
 *  is the focused dock panel. */
export const advFocus = { isFocused: () => false };

export function flipBrushH() {
  advState.brushFlags = toggleH(advState.brushFlags);
  advHooks.rebuildLayers();
  advHooks.render();
}
export function flipBrushV() {
  advState.brushFlags = toggleV(advState.brushFlags);
  advHooks.rebuildLayers();
  advHooks.render();
}
export function rotateBrush() {
  advState.brushFlags = rotateCW(advState.brushFlags);
  advHooks.rebuildLayers();
  advHooks.render();
}
export function resetBrushTransform() {
  advState.brushFlags = { h: false, v: false, r: false };
  advHooks.rebuildLayers();
  advHooks.render();
}
