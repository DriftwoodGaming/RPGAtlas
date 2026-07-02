/* RPGAtlas — src/editor/event-editor/location-picker.ts
   Visual transfer-location picker modal.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 2):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, TILE, LAYER_ORDER, editorState as S } from "../editor-state";
import { h, sel, field, dbOpts } from "../dom";
import { modal } from "../modals";

  // ============================ visual location picker ============================
  // Shows the chosen map; click a tile to set a destination. cb({ mapId, x, y }).
  export function openLocationPicker(initMapId: any, initX: any, initY: any, cb: any) {
    const PS = 24; // picker pixels per tile
    const pick = { mapId: RA.byId(S.proj.maps, initMapId) ? initMapId : S.proj.maps[0].id, x: initX, y: initY };
    const canvas = h("canvas", { class: "locpick-canvas" });
    const ctx = canvas.getContext("2d");
    const scroll = h("div", { class: "locpick-scroll" }, canvas);
    const info = h("span", { class: "dim", style: "margin-left:auto; align-self:center" });
    const pMap = () => RA.byId(S.proj.maps, pick.mapId) || S.proj.maps[0];
    function draw() {
      const m = pMap();
      canvas.width = m.width * PS; canvas.height = m.height * PS;
      ctx.setTransform(PS / TILE, 0, 0, PS / TILE, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#15151d"; ctx.fillRect(0, 0, m.width * TILE, m.height * TILE);
      for (const ln of LAYER_ORDER) {
        const arr = m.layers[ln];
        for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) Assets.drawTile(ctx, arr[y * m.width + x], x * TILE, y * TILE);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = TILE / PS;
      ctx.beginPath();
      for (let x = 0; x <= m.width; x++) { ctx.moveTo(x * TILE, 0); ctx.lineTo(x * TILE, m.height * TILE); }
      for (let y = 0; y <= m.height; y++) { ctx.moveTo(0, y * TILE); ctx.lineTo(m.width * TILE, y * TILE); }
      ctx.stroke();
      for (const ev of m.events) { // faint event markers for orientation
        ctx.fillStyle = "rgba(120,200,255,0.20)";
        ctx.fillRect(ev.x * TILE + 3, ev.y * TILE + 3, TILE - 6, TILE - 6);
      }
      if (S.proj.system.startMapId === m.id) {
        ctx.fillStyle = "rgba(110,230,140,0.5)";
        ctx.fillRect(S.proj.system.startX * TILE + 8, S.proj.system.startY * TILE + 8, TILE - 16, TILE - 16);
      }
      if (pick.x >= 0 && pick.y >= 0 && pick.x < m.width && pick.y < m.height) {
        ctx.fillStyle = "rgba(255,216,106,0.32)";
        ctx.fillRect(pick.x * TILE, pick.y * TILE, TILE, TILE);
        ctx.strokeStyle = "#ffd86a"; ctx.lineWidth = 3 * TILE / PS;
        ctx.strokeRect(pick.x * TILE + 1, pick.y * TILE + 1, TILE - 2, TILE - 2);
      }
      info.textContent = m.name + " (" + m.width + "×" + m.height + ")  ·  destination " + pick.x + ", " + pick.y;
    }
    canvas.addEventListener("mousedown", (e: any) => {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / PS), y = Math.floor((e.clientY - r.top) / PS);
      const m = pMap();
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) return;
      pick.x = x; pick.y = y; draw();
    });
    const mapSel = sel(pick, "mapId", dbOpts(S.proj.maps), () => {
      const m = pMap();
      pick.x = Math.min(pick.x, m.width - 1); pick.y = Math.min(pick.y, m.height - 1);
      draw();
    });
    const content = h("div", null,
      h("div", { class: "frow", style: "align-items:center" }, field("Map", mapSel), info),
      h("div", { class: "dim", style: "margin:4px 0" }, "Click a tile to set the transfer destination."),
      scroll,
    );
    draw();
    modal({
      title: "Pick Transfer Location", wide: true, dismissable: false, content,
      buttons: [
        { label: "OK", primary: true, onClick(close: any) { cb({ mapId: pick.mapId, x: pick.x, y: pick.y }); close(); } },
        { label: "Cancel" },
      ],
    });
  }
