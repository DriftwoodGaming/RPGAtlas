/* RPGAtlas — src/editor/tools/resource-manager.ts
   The Resource Manager modal: browse every generated tile / character / enemy /
   icon and export PNGs.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, editorState as S } from "../editor-state";
import { h } from "../dom";
import { modal } from "../modals";

function downloadCanvas(c: any, name: any) {
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = name + ".png";
  a.click();
}
function copyCanvas(src: any, scale?: any) {
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * (scale || 1));
  c.height = Math.round(src.height * (scale || 1));
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
export function openResourceManager() {
  const tabBar = h("div", { class: "tabs" });
  const body = h("div");
  function resCell(canvas: any, name: any, dlName: any, dlCanvas?: any) {
    return h("div", { class: "res-cell" },
      canvas,
      h("span", { class: "res-name", title: name }, name),
      h("button", { class: "mini", onclick() { downloadCanvas(dlCanvas || canvas, dlName); } }, "PNG"));
  }
  const tabs = [
    { label: "Tiles", build() {
      const grid = h("div", { class: "res-grid" });
      Assets.tiles.forEach((t: any, i: any) => {
        if (i === 0) return;
        grid.appendChild(resCell(copyCanvas(Assets.tileCanvas(i)), t.name + (t.pass ? " ○" : " ✕"), "tile-" + t.key, Assets.tileCanvas(i)));
      });
      return h("div", null,
        h("div", { style: "margin-bottom:8px" },
          h("button", { onclick() { downloadCanvas(Assets.tilesetCanvas(), "rpgatlas-tileset"); } }, "Export full tileset PNG"),
          h("span", { class: "dim" }, "  ○ = passable, ✕ = blocked (override per map in Passability mode)")),
        grid);
    } },
    { label: "Characters", build() {
      const grid = h("div", { class: "res-grid" });
      Assets.charsets.forEach((cs: any, i: any) => {
        grid.appendChild(resCell(copyCanvas(Assets.charFrameCanvas(i, 0, 1), 1.5),
          cs.name + (cs.custom ? " ★" : ""), "char-" + cs.key, Assets.charSheetCanvas(i)));
      });
      return h("div", null,
        h("div", { class: "dim", style: "margin-bottom:8px" }, "PNG exports the full 3-frame × 4-direction walking sheet. ★ = made in the Character Generator."),
        grid);
    } },
    { label: "Enemies", build() {
      const grid = h("div", { class: "res-grid" });
      for (const e of S.proj.enemies) {
        grid.appendChild(resCell(copyCanvas(Assets.enemyCanvas(e.sprite, e.color, 96)),
          e.name, "enemy-" + e.name.toLowerCase().replace(/\W+/g, "-"), Assets.enemyCanvas(e.sprite, e.color, 264)));
      }
      return h("div", null,
        h("div", { class: "dim", style: "margin-bottom:8px" }, "Battlers from this project's Enemies database (edit them in the Database)."),
        grid);
    } },
    { label: "Icons", build() {
      const grid = h("div", { class: "res-grid" });
      for (let i = 0; i < Assets.ICON_COUNT; i++) {
        grid.appendChild(resCell(copyCanvas(Assets.iconCanvas(i), 1.5),
          "Icon " + i, "icon-" + String(i).padStart(2, "0"), Assets.iconCanvas(i)));
      }
      const added = Assets.ICON_COUNT - Assets.BASE_ICON_COUNT;
      return h("div", null,
        h("div", { class: "dim", style: "margin-bottom:8px" },
          Assets.BASE_ICON_COUNT + " built-in icons" + (added ? " plus " + added + " added to this project" : "") +
          ". Assign them anywhere the Database shows Choose Icon."),
        grid);
    } },
  ];
  function show(i: any) {
    tabBar.querySelectorAll("button").forEach((b: any, bi: any) => b.classList.toggle("sel", bi === i));
    body.innerHTML = "";
    body.appendChild(tabs[i].build());
  }
  tabs.forEach((t, i) => tabBar.appendChild(h("button", { onclick: () => show(i) }, t.label)));
  modal({ title: "Resource Manager", wide: true, content: h("div", null, tabBar, body) });
  show(0);
}
