/* RPGAtlas — src/editor/map-editor/status.ts
   Status bar text + transient flash messages.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 1):
   logic unchanged, closure vars routed through editor-state.ts; calls into
   not-yet-extracted sections go through editorHooks.
   Copyright (C) 2026 RPGAtlas contributors - GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, TOOL_LABELS, LAYER_LABELS, t, editorState as S, curMap } from "../editor-state";
import { $ } from "../dom";
import { effectivePass } from "./map-render";
import { topLayerAt, getCell, eventAt } from "./painting";
import { tileId } from "../../shared/tile-flags";

  export function setStatus() {
    const m = curMap();
    let s = m ? m.name + " (" + m.width + "×" + m.height + ")" : "";
    s += "  ·  " + (S.mode === "map" ? t(TOOL_LABELS[S.tool]) + " / " + t(LAYER_LABELS[S.layer])
      : S.mode === "event" ? t("Event mode (double-click = new/edit, drag = move, right-click = menu)")
      : S.mode === "pass" ? t("Passability (click cycles auto → ✕ block → ○ pass → ⌒ ledge)")
      : S.mode === "height" ? t("Heights — painting {value} with {tool} (keys 0–9 set the value, right-click picks, Eraser clears)", {
        value: S.heightVal,
        tool: t(TOOL_LABELS[S.tool]),
      })
      : S.mode === "region" ? t("Regions — painting id {value} with {tool} (digits set the id, -/= step it, right-click picks, Eraser clears)", {
        value: S.regionVal,
        tool: t(TOOL_LABELS[S.tool]),
      })
      : t("Click the map to set the start position"));
    if (S.hoverCell && m) {
      s += "  ·  " + S.hoverCell.x + "," + S.hoverCell.y;
      if (S.mode === "map") {
        const ln = S.layer === "auto" ? topLayerAt(S.hoverCell.x, S.hoverCell.y) : S.layer;
        const t = tileId(getCell(S.hoverCell.x, S.hoverCell.y, ln)); // mask Stage-E flags
        s += "  ·  " + ln + ": " + (Assets.tiles[t] ? Assets.tiles[t].name : "?");
      }
      if (S.mode === "pass") {
        s += "  ·  " + (effectivePass(S.hoverCell.x, S.hoverCell.y) ? "○ " + t("passable") : "✕ " + t("blocked")) +
          (m.passOv[S.hoverCell.y * m.width + S.hoverCell.x] ? " (" + t("override") + ")" : "");
      }
      const ev = S.mode !== "pass" && S.mode !== "height" && eventAt(S.hoverCell.x, S.hoverCell.y);
      if (ev) s += "  ·  " + ev.name;
    }
    if (S.mode === "map" && S.selection) s += "  ·  " + t("selection") + " " + (S.selection.x2 - S.selection.x1 + 1) + "×" + (S.selection.y2 - S.selection.y1 + 1);
    if (S.mode === "map") s += "  ·  " + t("brush") + ": " + (Assets.tiles[S.selectedTile] ? Assets.tiles[S.selectedTile].name : "?");
    $("status-text").textContent = s;
    $("zoom-ind").textContent = Math.round(S.zoom * 100) + "%";
  }
  let statusFlashT: any = null;
  export function flashStatus(msg: any) {
    $("status-text").textContent = msg;
    clearTimeout(statusFlashT);
    statusFlashT = setTimeout(setStatus, 2400);
  }
