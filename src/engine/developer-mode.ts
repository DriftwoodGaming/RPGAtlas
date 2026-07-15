/* RPGAtlas — editor-playtest-only developer controls.
   These controls are derived from the runtime host, never project data, so
   exported games cannot inherit or expose them. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const DEVELOPER_THROUGH_ACTION = "developerThrough";

/** True only for play.html launched by the editor's Playtest command.
 *  Standalone/deployed games always provide RPGATLAS_PROJECT, which wins even
 *  if somebody appends a forged ?playtest query string to the deployed URL. */
export function isEditorPlaytest(win: any): boolean {
  if (!win || win.RPGATLAS_PROJECT) return false;
  const search =
    win.location && typeof win.location.search === "string"
      ? win.location.search
      : "";
  return new URLSearchParams(search).has("playtest");
}

/** Add the fixed Ctrl developer action without changing project/player input
 *  data. Returning the original bindings outside playtest keeps deployed input
 *  byte-for-byte identical. */
export function withDeveloperPlaytestBindings(
  bindings: any,
  enabled: boolean,
): any {
  if (!enabled) return bindings;
  return {
    ...bindings,
    keyboard: {
      ...(bindings.keyboard || {}),
      [DEVELOPER_THROUGH_ACTION]: ["ControlLeft", "ControlRight"],
    },
  };
}
