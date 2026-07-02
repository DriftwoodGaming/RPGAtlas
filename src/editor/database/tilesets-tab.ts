/* RPGAtlas — src/editor/database/tilesets-tab.ts
   The Database "Tilesets" tab: per-tile passage (8 directions), special flags
   (bush/ladder/counter/damage), and terrain tags, with a tile grid + detail
   panel and a tileset list.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, editorState as S } from "../editor-state";
import { h, tIn, field, row } from "../dom";
import { confirmBox } from "../modals";
import { touch } from "../persistence";

// Passage byte: bits 0-7 = N E S W NE SE SW NW (1 = passable)
// Flag byte: bit 0=bush bit 1=ladder bit 2=counter bit 3=damage
// terrain: 0-7 tag number
const TS_DIRS = [
  [7, "↖", "NW"], [0, "↑", "N"],  [4, "↗", "NE"],
  [3, "←", "W"],  [-1, "●", ""],  [1, "→", "E"],
  [6, "↙", "SW"], [2, "↓", "S"],  [5, "↘", "SE"],
];
const TS_FLAGS = [
  { bit: 0, label: "Bush", tip: "Player is drawn behind this tile" },
  { bit: 1, label: "Ladder", tip: "Player faces up and passes through (walk south looks like climbing)" },
  { bit: 2, label: "Counter", tip: "NPCs can interact with the player from across this tile" },
  { bit: 3, label: "Damage Floor", tip: "Player takes damage each step on this tile" },
];

export function tilesetTab() {
  if (!Array.isArray(S.proj.tilesets) || !S.proj.tilesets.length) {
    S.proj.tilesets = [{ id: 1, name: "Default", tileProps: {} }];
  }

  const wrap = h("div", { class: "dbtab" });
  const listEl = h("ul", { class: "dblist" });
  const formEl = h("div", { class: "dbform" });
  let cur = S.proj.tilesets[0] || null;
  let selTileIdx = -1;
  let tileBtns: any[] = [];
  let detailEl: any = null;

  function tileDefaultPass(idx: any) {
    const tile = Assets.tiles[idx];
    return (tile && tile.pass) ? 0xFF : 0x00;
  }
  function getTileProps(ts: any, idx: any) {
    const key = Assets.tiles[idx] && Assets.tiles[idx].key;
    return (ts.tileProps[key]) || { pass: tileDefaultPass(idx), flag: 0, terrain: 0 };
  }
  function saveTileProps(idx: any, update: any) {
    const key = Assets.tiles[idx].key;
    cur.tileProps[key] = Object.assign({}, getTileProps(cur, idx), update);
    touch();
    redrawDetail();
  }

  function redrawDetail() {
    if (!detailEl) return;
    detailEl.innerHTML = "";
    if (selTileIdx < 1 || !cur) {
      detailEl.appendChild(h("div", { class: "dim" }, "Select a tile above to configure its passage, flags, and terrain tag."));
      return;
    }
    const tile = Assets.tiles[selTileIdx];
    const props = getTileProps(cur, selTileIdx);

    // Tile preview + label
    const prev = document.createElement("canvas");
    prev.width = 48; prev.height = 48;
    prev.style.cssText = "image-rendering:pixelated;border:1px solid #2c2f44;border-radius:4px;flex:0 0 auto";
    prev.getContext("2d")!.drawImage(Assets.tileCanvas(selTileIdx), 0, 0);
    detailEl.appendChild(h("div", { class: "ts-tile-heading" }, prev,
      h("div", null,
        h("div", { style: "font-weight:600;margin-bottom:2px" }, tile.name),
        h("div", { class: "dim", style: "font-size:11px" }, tile.key + " · tile " + selTileIdx)
      )
    ));

    // Passage
    detailEl.appendChild(h("div", { class: "subhead" }, "Passage — 8 directions"));
    detailEl.appendChild(h("div", { class: "dim" }, "Click a direction to toggle. Green = passable, red = blocked."));
    const passGrid = h("div", { class: "ts-pass-grid" });
    for (const [bit, glyph] of TS_DIRS) {
      if (bit === -1) {
        const any = (props.pass & 0x0F) !== 0;
        passGrid.appendChild(h("div", { class: "ts-pass-center" + (any ? " passable" : " blocked") }, glyph));
      } else {
        const isPass = !!(props.pass & (1 << (bit as number)));
        passGrid.appendChild(h("button", {
          class: "ts-pass-btn" + (isPass ? " passable" : " blocked"),
          onclick() { saveTileProps(selTileIdx, { pass: isPass ? (props.pass & ~(1 << (bit as number))) : (props.pass | (1 << (bit as number))) }); },
        }, glyph));
      }
    }
    detailEl.appendChild(passGrid);
    detailEl.appendChild(h("div", { class: "ts-pass-actions" },
      h("button", { class: "mini", onclick() { saveTileProps(selTileIdx, { pass: 0xFF }); } }, "Allow all"),
      h("button", { class: "mini", onclick() { saveTileProps(selTileIdx, { pass: 0x00 }); } }, "Block all"),
      h("button", { class: "mini", onclick() {
        const key = Assets.tiles[selTileIdx].key;
        delete cur.tileProps[key];
        touch(); redrawDetail();
      } }, "Reset to default"),
    ));

    // Special flags
    detailEl.appendChild(h("div", { class: "subhead" }, "Special flags"));
    const flagWrap = h("div", { class: "ts-flags" });
    for (const fd of TS_FLAGS) {
      const on = !!(props.flag & (1 << fd.bit));
      const cb = h("input", { type: "checkbox", title: fd.tip, ...(on ? { checked: "" } : {}),
        onchange(e: any) {
          const p = getTileProps(cur, selTileIdx);
          saveTileProps(selTileIdx, { flag: e.target.checked ? (p.flag | (1 << fd.bit)) : (p.flag & ~(1 << fd.bit)) });
        },
      });
      flagWrap.appendChild(h("label", { class: "ts-flag-label", title: fd.tip }, cb, " " + fd.label));
    }
    detailEl.appendChild(flagWrap);

    // Terrain tag
    detailEl.appendChild(h("div", { class: "subhead" }, "Terrain tag"));
    detailEl.appendChild(row(field("Tag (0 = none, 1–7)",
      h("input", { type: "number", min: 0, max: 7, value: props.terrain || 0, style: "width:70px",
        onchange(e: any) { saveTileProps(selTileIdx, { terrain: Math.max(0, Math.min(7, Number(e.target.value) || 0)) }); },
      })
    )));
    detailEl.appendChild(h("div", { class: "dim" },
      "Terrain tags let scripts and plugins classify tile types (e.g., 1=shallow water, 2=grass). Tag 0 means no special terrain."
    ));
  }

  function selectTile(idx: any) {
    tileBtns.forEach((b, i) => b.classList.toggle("sel", i + 1 === idx));
    selTileIdx = idx;
    redrawDetail();
  }

  function redrawForm() {
    formEl.innerHTML = "";
    tileBtns = [];
    selTileIdx = -1;
    detailEl = null;
    if (!cur) return;

    const nameInp = tIn(cur, "name");
    nameInp.addEventListener("input", redrawList);
    formEl.appendChild(row(field("Name", nameInp)));

    formEl.appendChild(h("div", { class: "subhead" }, "Tiles"));
    formEl.appendChild(h("div", { class: "dim" }, "Click a tile to configure passage, special flags, and terrain tag."));

    const tileGrid = h("div", { class: "ts-tile-grid" });
    for (let i = 1; i < Assets.tiles.length; i++) {
      const tile = Assets.tiles[i];
      const btn = h("button", { class: "ts-tile-btn", title: tile.name, onclick() { selectTile(i); } });
      const src = Assets.tileCanvas(i);
      const thumb = document.createElement("canvas");
      thumb.width = 32; thumb.height = 32;
      thumb.style.cssText = "image-rendering:pixelated;display:block";
      thumb.getContext("2d")!.drawImage(src, 0, 0, src.width, src.height, 0, 0, 32, 32);
      btn.appendChild(thumb);
      tileBtns.push(btn);
      tileGrid.appendChild(btn);
    }
    formEl.appendChild(tileGrid);

    detailEl = h("div", { class: "ts-tile-detail" });
    formEl.appendChild(detailEl);
    redrawDetail();
  }

  function redrawList() {
    listEl.innerHTML = "";
    for (const ts of S.proj.tilesets) {
      const li = h("li", { class: ts === cur ? "sel" : "", onclick() { cur = ts; selTileIdx = -1; redrawList(); redrawForm(); } },
        h("span", { class: "db-entry-id" }, ts.id + ":"),
        h("span", null, ts.name || "—"));
      listEl.appendChild(li);
    }
  }

  const btns = h("div", { class: "dbbtns" },
    h("button", { onclick() {
      const e = { id: RA.nextId(S.proj.tilesets), name: "Tileset", tileProps: {} };
      S.proj.tilesets.push(e);
      cur = e; touch(); redrawList(); redrawForm();
    } }, "+ New"),
    h("button", { onclick() {
      if (!cur) return;
      if (S.proj.tilesets.length <= 1) { alert("Keep at least one tileset."); return; }
      confirmBox("Delete \"" + cur.name + "\"?", () => {
        S.proj.tilesets.splice(S.proj.tilesets.indexOf(cur), 1);
        cur = S.proj.tilesets[0] || null;
        touch(); redrawList(); redrawForm();
      });
    } }, "Delete"),
  );

  cur = S.proj.tilesets[0] || null;
  redrawList(); redrawForm();
  wrap.appendChild(h("div", { class: "dbside" }, btns, listEl));
  wrap.appendChild(formEl);
  return wrap;
}
