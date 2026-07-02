/* RPGAtlas — editor.js
   Map editor, event editor, database editor.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
"use strict";

import * as host from "../../js/editor/host.js";
import { PATCH_NOTES } from "../../js/patch-notes.js?v=4";
import {
  Assets, AtlasBuiltins, DataDefaults, GLRender, Music, RA, Sfx,
  editorI18n,
  TILE, LAYER_ORDER, LAYER_LABELS, TOOL_LABELS, ZOOMS,
  editorState as S,
  editorHooks,
  curMap,
} from "./editor-state";
import {
  $, h, esc, tIn, nIn, sel, chk, rangeIn, field, row,
  dbOpts, switchOpts, varOpts, cmpOpts, charsetOpts,
  DIR_OPTS, SE_NAMES, MUSIC_OPTS,
  elementSelOpts, skillTypeSelOpts, typeSelOpts, stringSelOpts,
} from "./dom";
import { modalRoot, modal, confirmBox, closePopupMenu, showPopupMenu } from "./modals";
import {
  touch, saveNow, loadStored, desktopSave, exportProject,
  openStandaloneExport, importProject,
} from "./persistence";
import { renderMap, renderPalette, effectivePass, normRect } from "./map-editor/map-render";
import { pushUndo, undo, redo, snapshotOf, applySnapshot } from "./map-editor/history";
import {
  eventAt, heightsOf, newEventAt, deleteSelectedEvent, openCanvasMenu,
  onCanvasDown, onCanvasMove, onCanvasUp, onCanvasDbl,
  cellFromMouse, topLayerAt, getCell,
} from "./map-editor/painting";
import { canCopy, copySelection, startPaste, clearSelection } from "./map-editor/clipboard";
import { setStatus, flashStatus } from "./map-editor/status";
import { rebuildMapList, addMap, deleteMap, openMapGenProps, openMapProps } from "./map-editor/map-list";
import { toggleHdPreview, isHdPreviewOpen } from "./map-editor/hd-preview";
import { cmdListWidget, walkCommands } from "./event-editor/command-list";
import { openEventEditor } from "./event-editor/event-editor";
import { ICONS } from "./icons";
import { openDatabase } from "./database";

(() => {
  const t = editorI18n.t;

  function playtestUrl() { return "play.html?playtest=" + Date.now(); }

  // Cross-boundary hook registrations: functions that still live in this
  // closure but are called from the extracted modules (see editor-state.ts).
  // Function declarations hoist, so registering here is safe.
  Object.assign(editorHooks, {
    refreshToolbar,
    setMode,
    rebuildAll,
  });









  // ============================ command definitions ============================
  // Extracted verbatim to src/editor/event-editor/command-defs.ts (Package 2):
  // cmdSummary, textCodesHelp, CMD_DEFS, cmdDef, mountForm, editCommand, pickCommand.

  // ============================ command list widget ============================
  // Extracted verbatim to src/editor/event-editor/command-list.ts (Package 2):
  // buildCmdRows, cmdListWidget.


  // ============================ database ============================
  // Extracted verbatim to src/editor/database/* (Phase 1 Stage C, Package 3):
  //   shared.ts        — listFormTab, nameRefresher, iconPickerField, STAT/PARAM keys,
  //                       TRAIT_SKILL_TYPES, traitDefault, skillTypeTraitOpts
  //   system-tab.ts    — System, Controls tabs
  //   battler-tabs.ts  — Actors, Classes, Skills, Enemies, States tabs
  //   item-tabs.ts     — Items, Weapons, Armors, Troops, Common Events tabs
  //   quests-tab.ts    — Quests tab
  //   tilesets-tab.ts  — Tilesets tab
  //   types-tab.ts     — Types tab + nameListTab (Switches, Variables)
  //   index.ts         — dbTabs() + openDatabase() modal shell/rail (imported above)


  // ============================ plugin manager ============================
  const PLUGIN_TEMPLATE = `/* RPGAtlas plugin — runs once when the game boots.
 * Available objects:
 *   atlas.project / atlas.map / atlas.player / atlas.scene
 *   atlas.SCREEN_W atlas.SCREEN_H atlas.TILE   atlas.Assets / atlas.Sfx / atlas.Music
 *   atlas.onMapLoad(fn)        fn(map) after every map load
 *   atlas.onUpdate(fn)         fn() every frame on the map scene
 *   atlas.onRender(ctx, info)  draw over the map each frame (info: w,h,t,map,camX,camY)
 *   atlas.onMessageText(fn)    transform message HTML (text codes)
 *   atlas.setTransition({out,in})   custom transfer effect
 *   atlas.registerCommand(type, fn) handle a custom event command
 *   atlas.startBattle(troopId)      start a battle, resolves "win"/"lose"/"escape"
 *   game.setSwitch/getSwitch/setVar/getVar/addGold/callCommonEvent/party/state
 * Tip: the bundled Atlas_* plugins (Add → Built-in…) show real examples.
 * A hook that throws is disabled (see the browser console). */
atlas.onMapLoad((map) => {
  console.log("Entered " + map.name);
});`;

  function openPluginManager() {
    const plugins = S.proj.plugins;
    let cur = plugins[0] || null;
    const list = h("ul", { class: "plug-list" });
    const nameIn = h("input", { type: "text", placeholder: "Plugin name", oninput(e) { if (cur) { cur.name = e.target.value; touch(); redrawList(); } } });
    const pluginIdIn = h("input", { type: "text", placeholder: "Plugin ID, e.g. atlas.weather", oninput(e) { if (cur) { cur.pluginId = e.target.value.trim(); touch(); redrawList(); } } });
    const versionIn = h("input", { type: "text", placeholder: "Version", oninput(e) { if (cur) { cur.version = e.target.value.trim(); touch(); } } });
    const authorIn = h("input", { type: "text", placeholder: "Author", oninput(e) { if (cur) { cur.author = e.target.value; touch(); } } });
    const depsIn = h("input", { type: "text", placeholder: "Dependencies: atlas.core, other.plugin", oninput(e) { if (cur) { cur.dependencies = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); touch(); redrawList(); } } });
    const descIn = h("textarea", { class: "plug-desc", placeholder: "Description", spellcheck: "true", oninput(e) { if (cur) { cur.description = e.target.value; touch(); } } });
    const codeTa = h("textarea", { spellcheck: "false", oninput(e) { if (cur) { cur.code = e.target.value; touch(); } } });
    function pluginIdentity(pl) { return String(pl && (pl.pluginId || pl.key || pl.name || ("plugin." + pl.id)) || "").trim(); }
    function pluginStatus(pl) {
      const id = pluginIdentity(pl);
      if (!id) return { label: "missing id", cls: "warn" };
      if (plugins.some((other) => other !== pl && pluginIdentity(other) === id)) return { label: "duplicate id", cls: "warn" };
      const missing = (pl.dependencies || []).filter((dep) => !plugins.some((other) => other.on && pluginIdentity(other) === dep));
      if (pl.on && missing.length) return { label: "missing dep", cls: "warn" };
      return { label: pl.on ? "ready" : "disabled", cls: pl.on ? "ok" : "off" };
    }
    function redrawList() {
      list.innerHTML = "";
      plugins.forEach((pl) => {
        const st = pluginStatus(pl);
        const cb = h("input", { type: "checkbox",
          onclick(e) { e.stopPropagation(); },
          onchange(e) { pl.on = e.target.checked; touch(); redrawList(); },
          ...(pl.on ? { checked: "" } : {}) });
        const kids = [cb, h("span", { class: "plug-name" }, pl.name || "(unnamed)")];
        if (pl.builtin) kids.push(h("span", { class: "plug-badge" }, "built-in"));
        kids.push(h("span", { class: "plug-status " + st.cls }, st.label));
        list.appendChild(h("li", {
          class: (pl === cur ? "sel" : "") + (pl.on ? "" : " off"),
          onclick() { cur = pl; redrawList(); redrawForm(); },
        }, ...kids));
      });
    }
    function addBuiltinPicker() {
      const missing = typeof AtlasBuiltins !== "undefined" ? AtlasBuiltins.missingFor(plugins) : [];
      if (!missing.length) { flashStatus("All bundled plugins are already in this project"); return; }
      const box = h("div", { class: "minilist" });
      const picker = modal({ title: "Add Bundled Plugin", content: box, buttons: [{ label: "Cancel" }] });
      missing.forEach((spec) => {
        box.appendChild(h("div", { class: "minirow", style: "align-items:flex-start" },
          h("div", { style: "flex:1" }, h("b", null, spec.key), h("div", { class: "dim" }, spec.desc)),
          h("button", { class: "mini", onclick() {
            const id = RA.nextId(plugins.length ? plugins : [{ id: 0 }]);
            const pl = AtlasBuiltins.make(spec.key, id);
            plugins.push(pl); cur = pl;
            touch(); redrawList(); redrawForm(); picker.close();
          } }, "Add")));
      });
    }
    function redrawForm() {
      nameIn.value = cur ? cur.name : "";
      pluginIdIn.value = cur ? (cur.pluginId || cur.key || "") : "";
      versionIn.value = cur ? (cur.version || "") : "";
      authorIn.value = cur ? (cur.author || "") : "";
      depsIn.value = cur ? (cur.dependencies || []).join(", ") : "";
      descIn.value = cur ? (cur.description || "") : "";
      codeTa.value = cur ? cur.code : "";
      nameIn.disabled = pluginIdIn.disabled = versionIn.disabled = authorIn.disabled = depsIn.disabled = descIn.disabled = codeTa.disabled = !cur;
    }
    function move(d) {
      if (!cur) return;
      const i = plugins.indexOf(cur), ni = i + d;
      if (ni < 0 || ni >= plugins.length) return;
      plugins.splice(i, 1); plugins.splice(ni, 0, cur);
      touch(); redrawList();
    }
    const side = h("div", { class: "plug-side" },
      h("div", { class: "dbbtns" },
        h("button", { onclick() {
          const id = RA.nextId(plugins.length ? plugins : [{ id: 0 }]);
          const pl = { id: id, name: "New Plugin", pluginId: "plugin." + id, version: "1.0.0", author: "", description: "", dependencies: [], on: true, code: PLUGIN_TEMPLATE };
          plugins.push(pl); cur = pl;
          touch(); redrawList(); redrawForm();
        } }, "+ New"),
        h("button", { title: "Add one of the engine's bundled plugins", onclick: addBuiltinPicker }, "+ Built-in…"),
        h("button", { onclick() {
          if (!cur) return;
          confirmBox('Delete plugin "' + cur.name + '"?', () => {
            plugins.splice(plugins.indexOf(cur), 1);
            cur = plugins[0] || null;
            touch(); redrawList(); redrawForm();
          });
        } }, "Delete"),
        h("button", { class: "mini", title: "Run earlier", onclick: () => move(-1) }, "↑"),
        h("button", { class: "mini", title: "Run later", onclick: () => move(1) }, "↓"),
      ),
      list,
      h("div", { class: "dim" }, "Checked plugins run top-to-bottom at game boot."),
    );
    const meta = h("div", { class: "plug-meta" },
      h("label", null, "Name", nameIn),
      h("label", null, "Plugin ID", pluginIdIn),
      h("label", null, "Version", versionIn),
      h("label", null, "Author", authorIn),
      h("label", { class: "wide" }, "Dependencies", depsIn),
      h("label", { class: "wide" }, "Description", descIn));
    const form = h("div", { class: "plug-form" }, meta, codeTa);
    const minSideW = 220, minFormW = 360;
    let draggingSplit = false, dragStartX = 0, dragStartW = 0;
    function clampSideW(w) {
      const max = Math.max(minSideW, wrap.getBoundingClientRect().width - minFormW);
      return Math.max(minSideW, Math.min(max, w));
    }
    const split = h("div", {
      class: "plug-split",
      title: "Drag to resize the plugin list",
      onpointerdown(e) {
        draggingSplit = true;
        dragStartX = e.clientX;
        dragStartW = side.getBoundingClientRect().width;
        split.classList.add("dragging");
        split.setPointerCapture(e.pointerId);
        e.preventDefault();
      },
      onpointermove(e) {
        if (!draggingSplit) return;
        side.style.width = clampSideW(dragStartW + e.clientX - dragStartX) + "px";
      },
      onpointerup(e) {
        draggingSplit = false;
        split.classList.remove("dragging");
        if (split.hasPointerCapture(e.pointerId)) split.releasePointerCapture(e.pointerId);
      },
      onpointercancel(e) {
        draggingSplit = false;
        split.classList.remove("dragging");
        if (split.hasPointerCapture(e.pointerId)) split.releasePointerCapture(e.pointerId);
      },
    });
    const wrap = h("div", { class: "plug-wrap" }, side, split, form);
    redrawList(); redrawForm();
    modal({ title: "Plugin Manager", wide: true, resizable: true, dismissable: false, class: "plugin-modal",
      content: wrap,
      buttons: [{ label: "Close", primary: true }] });
  }

  // ============================ audio manager ============================
  function openAudioManager() {
    let playingTheme = null;
    const seGrid = h("div", { class: "audio-grid" });
    for (const n of SE_NAMES) seGrid.appendChild(h("button", { onclick() { Sfx.play(n); } }, "▶ " + n));
    const musGrid = h("div", { class: "audio-grid" });
    const musBtns = [];
    for (const t of Sfx.THEMES) {
      const b = h("button", { onclick() {
        if (playingTheme === t) { Music.stop(); playingTheme = null; }
        else { Music.play(t); playingTheme = t; }
        musBtns.forEach((x) => x.b.classList.toggle("playing", x.t === playingTheme));
      } }, "♪ " + t);
      musBtns.push({ t, b });
      musGrid.appendChild(b);
    }
    modal({
      title: "Audio Manager",
      wide: true,
      content: h("div", null,
        h("div", { class: "subhead" }, "Sound effects (used by the Play Sound event command)"),
        seGrid,
        h("div", { class: "subhead" }, "Music themes (click to preview, click again to stop)"),
        musGrid,
        h("div", { class: "dim", style: "margin-top:10px" },
          "Assign a theme per map in Map Properties. Battles always use “battle”, the title screen “title”, defeat “gameover”. All audio is generated procedurally — no files, no copyright."),
      ),
      onClose() { Music.stop(); },
    });
  }

  // ============================ event searcher ============================
  function openEventSearcher() {
    const results = h("div", { class: "search-results" });
    const input = h("input", { type: "text", placeholder: "Search…", onkeydown(e) { if (e.key === "Enter") run(); } });
    const kindSel = h("select", null,
      h("option", { value: "text" }, "Message text"),
      h("option", { value: "name" }, "Event name"),
      h("option", { value: "switch" }, "Switch ID"),
      h("option", { value: "var" }, "Variable ID"),
    );
    let dlg = null;
    function run() {
      const kind = kindSel.value;
      const query = input.value.trim();
      const idQ = Number(query);
      results.innerHTML = "";
      if (!query || ((kind === "switch" || kind === "var") && (!idQ || isNaN(idQ)))) {
        results.appendChild(h("div", { class: "search-row dim" }, kind === "switch" || kind === "var" ? "Enter a numeric ID." : "Enter a search term."));
        return;
      }
      const ql = query.toLowerCase();
      const matches = [];
      for (const m of S.proj.maps) {
        for (const ev of m.events) {
          ev.pages.forEach((pg, pi) => {
            let hit = null;
            if (kind === "name") {
              if (pi === 0 && ev.name.toLowerCase().includes(ql)) hit = ev.name;
            } else if (kind === "text") {
              walkCommands(pg.commands, (c) => {
                if (hit) return;
                if (c.t === "text" && ((c.text || "") + " " + (c.name || "")).toLowerCase().includes(ql)) hit = "“" + c.text.split("\n")[0].slice(0, 50) + "”";
                else if (c.t === "choices" && c.options.some((o) => o.toLowerCase().includes(ql))) hit = "Choices: " + c.options.join(" / ");
              });
            } else if (kind === "switch") {
              if (pg.cond.switchId === idQ) hit = "page condition (switch ON)";
              walkCommands(pg.commands, (c) => {
                if (hit) return;
                if (c.t === "switch" && c.id === idQ) hit = "Control Switch command";
                else if (c.t === "if" && c.cond && c.cond.kind === "switch" && c.cond.id === idQ) hit = "Conditional Branch";
              });
            } else {
              if (pg.cond.varId === idQ) hit = "page condition (variable ≥)";
              walkCommands(pg.commands, (c) => {
                if (hit) return;
                if (c.t === "var" && c.id === idQ) hit = "Control Variable command";
                else if (c.t === "if" && c.cond && c.cond.kind === "var" && c.cond.id === idQ) hit = "Conditional Branch";
              });
            }
            if (hit != null) matches.push({ m, ev, pi, hit });
          });
        }
      }
      if (!matches.length) {
        results.appendChild(h("div", { class: "search-row dim" }, "No matches."));
        return;
      }
      for (const r of matches) {
        results.appendChild(h("div", { class: "search-row", onclick() {
          dlg.close();
          S.curMapId = r.m.id;
          setMode("event");
          S.selectedEvent = r.ev;
          rebuildMapList(); renderMap(); refreshToolbar();
          const sc = $("mapscroll");
          sc.scrollLeft = r.ev.x * TILE * S.zoom - sc.clientWidth / 2;
          sc.scrollTop = r.ev.y * TILE * S.zoom - sc.clientHeight / 2;
          openEventEditor(r.ev);
        } },
          h("b", null, r.m.name + " — " + r.ev.name),
          " (" + r.ev.x + "," + r.ev.y + ") page " + (r.pi + 1),
          h("span", { class: "dim" }, r.hit)));
      }
    }
    const bar = h("div", { class: "search-bar" },
      field("Find", input), field("In", kindSel),
      h("button", { class: "primary", onclick: run }, "Search"));
    dlg = modal({ title: "Event Searcher", wide: true, content: h("div", null, bar, results) });
    setTimeout(() => input.focus(), 50);
  }

  // ============================ resource manager ============================
  function downloadCanvas(c, name) {
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = name + ".png";
    a.click();
  }
  function copyCanvas(src, scale) {
    const c = document.createElement("canvas");
    c.width = Math.round(src.width * (scale || 1));
    c.height = Math.round(src.height * (scale || 1));
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function openResourceManager() {
    const tabBar = h("div", { class: "tabs" });
    const body = h("div");
    function resCell(canvas, name, dlName, dlCanvas) {
      return h("div", { class: "res-cell" },
        canvas,
        h("span", { class: "res-name", title: name }, name),
        h("button", { class: "mini", onclick() { downloadCanvas(dlCanvas || canvas, dlName); } }, "PNG"));
    }
    const tabs = [
      { label: "Tiles", build() {
        const grid = h("div", { class: "res-grid" });
        Assets.tiles.forEach((t, i) => {
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
        Assets.charsets.forEach((cs, i) => {
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
        return h("div", null,
          h("div", { class: "dim", style: "margin-bottom:8px" },
            "64 icons from img/system/icon_set.png. Assign them in the Classes, Skills, Items, Weapons, and Armors tabs."),
          grid);
      } },
    ];
    function show(i) {
      tabBar.querySelectorAll("button").forEach((b, bi) => b.classList.toggle("sel", bi === i));
      body.innerHTML = "";
      body.appendChild(tabs[i].build());
    }
    tabs.forEach((t, i) => tabBar.appendChild(h("button", { onclick: () => show(i) }, t.label)));
    modal({ title: "Resource Manager", wide: true, content: h("div", null, tabBar, body) });
    show(0);
  }

  // ============================ character generator ============================
  function openCharGenerator() {
    const SKINS = ["#f0c8a0", "#e8b890", "#d8a070", "#c08858", "#9a6a40", "#f0d0b0"];
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const randCol = () => "#" + [0, 0, 0].map(() => ("0" + Math.floor(40 + Math.random() * 200).toString(16)).slice(-2)).join("");
    function randomWork() {
      return { name: "New Hero", style: pick(Assets.HAIR_STYLES), skin: pick(SKINS),
        hair: randCol(), shirt: randCol(), pants: randCol(), hat: randCol() };
    }
    let editing = null; // entry in proj.customChars being edited, or null for a new one
    let work = randomWork();
    const PV_KEY = "cg_preview";
    let animF = 0;

    const previews = [0, 1, 2, 3].map(() => {
      const c = document.createElement("canvas");
      c.width = TILE; c.height = TILE;
      return c;
    });
    function paramsOf(w) { return { skin: w.skin, hair: w.hair, style: w.style, shirt: w.shirt, pants: w.pants, hat: w.hat }; }
    function redrawPreview() {
      const idx = Assets.registerHuman(PV_KEY, "preview", paramsOf(work));
      const frame = [0, 1, 2, 1][animF % 4];
      previews.forEach((c, dir) => {
        const g = c.getContext("2d");
        g.clearRect(0, 0, TILE, TILE);
        g.drawImage(Assets.charFrameCanvas(idx, dir, frame), 0, 0);
      });
    }
    const animTimer = setInterval(() => { animF++; redrawPreview(); }, 170);

    const formBox = h("div", { class: "cg-form" });
    const listEl = h("ul", { class: "dblist" });
    function colorIn(key) {
      return h("input", { type: "color", value: work[key], oninput(e) { work[key] = e.target.value; redrawPreview(); } });
    }
    function redrawForm() {
      formBox.innerHTML = "";
      const nameIn = h("input", { type: "text", value: work.name, oninput(e) { work.name = e.target.value; } });
      const styleSel = h("select", { onchange(e) { work.style = e.target.value; redrawPreview(); } },
        ...Assets.HAIR_STYLES.map((s) => h("option", { value: s, ...(s === work.style ? { selected: "" } : {}) }, s)));
      const skinSel = h("select", { onchange(e) { work.skin = e.target.value; redrawPreview(); } },
        ...SKINS.map((s, i) => h("option", { value: s, ...(s === work.skin ? { selected: "" } : {}) }, "skin " + (i + 1))));
      formBox.appendChild(row(field("Name", nameIn), field("Hair style", styleSel)));
      formBox.appendChild(row(field("Skin", skinSel), field("Hair", colorIn("hair")),
        field("Shirt", colorIn("shirt")), field("Pants", colorIn("pants")), field("Hat", colorIn("hat"))));
      formBox.appendChild(h("div", { class: "cg-preview" }, ...previews));
      formBox.appendChild(h("div", { class: "frow", style: "margin-top:8px; gap:6px" },
        h("button", { onclick() { const n = work.name; work = randomWork(); work.name = n; redrawForm(); redrawPreview(); } }, "🎲 Randomize"),
        h("button", { class: "primary", onclick: save }, editing ? "Update “" + editing.name + "”" : "Save as new character"),
        editing ? h("button", { onclick() { editing = null; redrawForm(); } }, "Cancel edit") : null,
      ));
    }
    function save() {
      if (!work.name.trim()) work.name = "Hero";
      if (editing) {
        editing.name = work.name;
        editing.params = paramsOf(work);
        Assets.registerHuman(editing.key, editing.name, editing.params);
      } else {
        const id = RA.nextId(S.proj.customChars.length ? S.proj.customChars : [{ id: 0 }]);
        const entry = { id, key: "cg" + id, name: work.name, params: paramsOf(work) };
        S.proj.customChars.push(entry);
        Assets.registerHuman(entry.key, entry.name, entry.params);
        editing = entry;
      }
      touch();
      redrawList(); redrawForm();
      flashStatus("Character saved — pick it as a sprite for actors and events");
    }
    function redrawList() {
      listEl.innerHTML = "";
      for (const c of S.proj.customChars) {
        listEl.appendChild(h("li", { class: c === editing ? "sel" : "", onclick() {
          editing = c;
          work = Object.assign({ name: c.name }, c.params);
          redrawForm(); redrawPreview();
        } }, c.name));
      }
      if (!S.proj.customChars.length) listEl.appendChild(h("li", { class: "dim" }, "(none yet)"));
    }
    const side = h("div", { class: "cg-side" },
      h("div", { class: "subhead", style: "margin:0" }, "Saved characters"),
      listEl,
      h("button", { onclick() {
        if (!editing) return;
        confirmBox('Delete "' + editing.name + '"? Actors/events using it will show no sprite.', () => {
          Assets.removeCharset(editing.key);
          S.proj.customChars.splice(S.proj.customChars.indexOf(editing), 1);
          editing = null;
          touch(); redrawList(); redrawForm(); renderMap();
        });
      } }, "Delete selected"),
      h("div", { class: "dim" }, "Saved characters appear in every sprite picker (marked ★ in the Resource Manager)."),
    );
    redrawList(); redrawForm(); redrawPreview();
    modal({
      title: "Character Generator",
      wide: true,
      dismissable: false,
      content: h("div", { class: "cg-wrap" }, side, formBox),
      buttons: [{ label: "Close", primary: true }],
      onClose() {
        clearInterval(animTimer);
        Assets.removeCharset(PV_KEY);
        renderMap();
      },
    });
  }

  // ============================ help / about ============================
  function refreshLocalizedChrome() {
    editorI18n.localizeStatic();
    buildMenubar();
    buildToolbar();
    refreshToolbar();
    setStatus();
    const saveIndicator = $("save-ind");
    if (saveIndicator.textContent.startsWith("●")) saveIndicator.textContent = "● " + t("unsaved");
    else if (saveIndicator.textContent.startsWith("⚠")) saveIndicator.textContent = "⚠ " + t("save failed");
    else saveIndicator.textContent = "✓ " + t("saved");
  }
  function openLanguageSettings() {
    let selectedLocale = editorI18n.locale;
    const languageSelect = h("select", {
      onchange(e) { selectedLocale = e.target.value; },
    }, ...editorI18n.locales().map((locale) =>
      h("option", { value: locale.id, ...(locale.id === selectedLocale ? { selected: "" } : {}) }, locale.label)));
    modal({
      title: "Interface Language",
      content: h("div", null,
        h("p", null, t("Choose the language used by the editor. Project content is not translated.")),
        field("Language", languageSelect)),
      buttons: [
        { label: "Apply", primary: true, onClick(close) {
          editorI18n.setLocale(selectedLocale);
          close();
          refreshLocalizedChrome();
        } },
        { label: "Cancel" },
      ],
    });
  }
  function openPatchNotes() {
    const list = h("div", { class: "patch-notes" });
    PATCH_NOTES.forEach((note) => {
      const items = h("ul");
      (note.items || []).forEach((item) => items.appendChild(h("li", null, item)));
      list.appendChild(h("article", { class: "patch-note" },
        h("div", { class: "patch-note-head" },
          h("h3", null, note.title),
          h("time", null, note.date)),
        h("p", null, note.summary),
        items));
    });
    modal({
      title: "RPGAtlas - Patch Notes",
      wide: true,
      content: list,
      buttons: [{ label: "Close", primary: true }],
    });
  }
  function openHelp() {
    modal({
      title: "RPGAtlas — Quick Help",
      wide: true,
      content: h("div", { class: "helpbox", html: `
<h3>Drawing maps</h3>
<ul>
<li><b>Tools</b>: Pen <kbd>Q</kbd>, Eraser <kbd>W</kbd>, Rectangle <kbd>E</kbd>, Circle <kbd>R</kbd>, Fill <kbd>T</kbd>, Shadow Pen <kbd>Y</kbd>. Right-click = pick tile from the map.</li>
<li><b>Layers</b>: Auto <kbd>&#96;</kbd> places terrain on Layer 1 and stacks decorations on Layers 2–3 automatically. <kbd>1</kbd>–<kbd>4</kbd> select Ground / Decor / Decor&nbsp;2 / Overhead directly (Overhead draws above the player).</li>
<li><b>Shadow Pen</b>: left-click paints a half-tile shadow quadrant, right-click erases it.</li>
<li><b>Modes</b>: press <kbd>Tab</kbd> (<kbd>Shift</kbd>+<kbd>Tab</kbd> reverse) to cycle Map → Event → Passability → Height. <b>Height Mode</b>: paint HD-2D elevation with Pen / Rectangle / Circle / Fill. Keys <kbd>0</kbd>–<kbd>9</kbd> set the value, right-click picks it up, Eraser clears. Raised tiles become 3D blocks when the map's HD-2D rendering is on.</li>
<li><b>HD-2D</b>: enable per map in Game ▸ Map Properties (camera tilt, bloom, depth of field, fog, point lights). Game ▸ HD-2D Preview opens a live panel that follows your edits — drag it to pan. Lights are events named “light #rrggbb radius”.</li>
<li><b>Selection</b>: Shift+drag selects an area. Cut <kbd>Ctrl+X</kbd> / Copy <kbd>Ctrl+C</kbd> / Paste <kbd>Ctrl+V</kbd>, then click to stamp (Esc cancels). Works for events too.</li>
<li>Undo <kbd>Ctrl+Z</kbd> · Redo <kbd>Ctrl+Y</kbd> · Zoom <kbd>+</kbd>/<kbd>−</kbd>, <kbd>Ctrl</kbd>+wheel, <kbd>Ctrl+0</kbd> = 100%. Press <kbd>?</kbd> for the full keyboard shortcut list.</li>
</ul>
<h3>Passability</h3>
<ul>
<li>By default the topmost decoration tile decides (○ passable / ✕ blocked); otherwise the ground tile.</li>
<li>In <b>Passability mode</b> click a tile to cycle: auto → force ✕ → force ○. Overridden tiles get a yellow corner badge.</li>
</ul>
<h3>Events</h3>
<ul>
<li>In <b>Event mode</b> double-click a cell to create/edit an event; drag to move; <kbd>Del</kbd> deletes. <b>Right-click</b> for a menu: New Event, <b>Quick Events</b> (Transfer / Sign / Chest), Cut/Copy/Paste, and Set Start Position Here. Each event has <b>pages</b> — the last page whose conditions hold is active.</li>
<li>Triggers: Action button (Z), Player touch, Autorun (blocks play), Parallel (background). Use Self-Switches for chest-like one-time events.</li>
<li><b>Event Searcher</b> (Tools menu) finds text, names, or switch/variable usage across all maps.</li>
</ul>
<h3>Tools</h3>
<ul>
<li><b>Database</b>: actors, classes, skills, items, equipment, enemies, troops, common events, states, types, switches, variables, system.</li>
<li><b>System tab</b>: screen size, UI area, screen scale, fonts &amp; font size, window opacity, system sounds &amp; music, side-view or front-view battles, start-transparent player.</li>
<li><b>States</b>: poison / stun / regen-style battle effects, inflicted or cured by skills.</li>
<li><b>Plugin Manager</b>: project-embedded JavaScript that runs at game boot, with map-load and per-frame hooks.</li>
<li><b>Character Generator</b>: build original walking sprites; they appear in every sprite picker.</li>
<li><b>Resource Manager</b>: browse every generated tile/character/battler and export PNGs.</li>
<li><b>Custom assets</b>: copy images into the shared <code>img/characters</code>, <code>facesets</code>, <code>enemies</code>, or <code>tilesets</code> folders, then reload the editor.</li>
</ul>
<h3>Playtesting & saving</h3>
<ul>
<li><b>▶ Playtest</b> opens the player. In game: Arrows/WASD move, Shift dashes, Z/Enter confirms, X/Esc menu/cancel.</li>
<li>Your project autosaves to this browser (<kbd>Ctrl+S</kbd> forces it). Use File ▸ Export for a .json backup; Open to load one.</li>
<li><b>Export Standalone Game</b> creates a Windows .exe or cross-platform .html that runs without the editor or engine folder.</li>
</ul>
<h3>License</h3>
<p>RPGAtlas is free and open source software under the <b>GNU GPLv3</b>. The content you create — maps, story, database, characters — is yours. Exported games bundle the engine runtime, which stays under the GPL (its readable source ships inside every export).</p>
` }),
    });
  }
  function openKeyboardShortcuts() {
    const box = h("div", { class: "helpbox" });
    const kbd = (s) => h("kbd", null, s);
    const keys = (...labels) => {
      const out = [];
      labels.forEach((l, i) => { if (i) out.push(" / "); out.push(kbd(l)); });
      return out;
    };
    const line = (chips, desc) => h("li", null, ...chips, h("span", { class: "cl-desc" }, " — " + desc));
    const aKey = (id) => ACT[id].key;
    const aLabel = (id) => actionLabel(ACT[id]);
    const section = (title, rows) => {
      box.appendChild(h("h3", null, title));
      const ul = h("ul", { class: "code-legend-list" });
      rows.forEach((r) => ul.appendChild(r));
      box.appendChild(ul);
    };

    const toolIds = ["tool-pen", "tool-erase", "tool-rect", "tool-circle", "tool-fill", "tool-shadow"];
    const layerIds = ["layer-auto", "layer-ground", "layer-decor", "layer-decor2", "layer-over"];

    section("Modes", [
      line(keys("Tab"), "next mode  (Map → Event → Passability → Height, wraps)"),
      line(keys("Shift", "Tab"), "previous mode"),
      h("li", { class: "dim" }, "Set Start Position is reached from the Mode menu, not the Tab cycle."),
    ]);
    section("Tools  (Map or Height mode)", toolIds.map((id) => line(keys(aKey(id)), aLabel(id))));
    section("Layers  (Map mode)", layerIds.map((id) => line(keys(aKey(id)), aLabel(id))));
    section("Height mode", [line(keys("0–9"), "set the painted elevation value")]);
    section("Edit & file", ["undo", "redo", "cut", "copy", "paste", "save"].map((id) => line(keys(aKey(id)), aLabel(id))));
    section("View", [
      line(keys("+", "−"), "zoom in / out  (Ctrl + wheel also zooms)"),
      line(keys(aKey("zoom1")), "zoom to 100%"),
    ]);
    section("Application", ["db", "hdpreview", "play"].map((id) => line(keys(aKey(id)), aLabel(id))));
    section("Selection & events", [
      line(keys("Shift", "drag"), "select an area of tiles"),
      line(keys("Del"), "delete the selected event (Event mode)"),
      line(keys("Esc"), "clear selection / cancel paste / deselect"),
    ]);
    box.appendChild(h("div", { class: "dim", style: "margin-top:10px;font-size:12px" },
      "Tool and layer keys do nothing outside their mode — switch with Tab first. Toolbar and menu clicks switch mode automatically. F1 and F5 take over the browser's Help and Reload while the editor is focused."));

    modal({ title: "Keyboard Shortcuts", wide: true, content: box, dialogKeys: true });
  }
  function openAbout() {
    modal({
      title: "About RPGAtlas",
      content: h("div", { class: "helpbox", html: `
<div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
  <img src="img/system/rpgatlas-logo.svg" alt="" width="56" height="56">
  <div>
    <div style="font-size:20px;font-weight:800">RPG<span style="font-weight:300">Atlas</span></div>
    <div class="dim">Chart your world. Tell your story.</div>
  </div>
</div>
<p><b>RPGAtlas</b> — a free and open source RPG maker that runs entirely in your browser.</p>
<ul>
<li>No build step or dependencies — built-in art and audio are generated procedurally, with optional shared custom images from the <code>img</code> folder.</li>
<li>Free software under the <b>GNU GPLv3</b> — use it, study it, share it, improve it.</li>
<li>Your game's content (maps, story, data, art) is yours — sell it, remix it, no credit required. Exported games include the engine runtime, which remains GPL-licensed.</li>
</ul>
<p class="dim">Editor: index.html · Player: play.html · Data: one portable .json project file.</p>
` }),
    });
  }

  // ============================ icons (original line art) ============================
  // Extracted verbatim to src/editor/icons.ts (Package 3): ICONS (imported above).

  // ============================ actions / menus / toolbar ============================
  const ACT = {};
  function act(id, def) {
    def.labelKey = def.label;
    def.tipKey = def.tip;
    ACT[id] = def;
  }
  function actionLabel(action) { return t(action.labelKey); }
  function actionTip(action) { return t(action.tipKey || action.labelKey); }
  function runAct(id) {
    const a = ACT[id];
    if (!a || (a.enabled && !a.enabled())) return;
    a.run();
    refreshToolbar();
  }

  act("new", { label: "New Project…", icon: "new", tip: "New project (resets to the bundled sample game)", run() {
    confirmBox("Start a fresh project (the bundled sample game)? Your current project will be replaced — Export first if you want to keep it.", () => {
      S.proj = DataDefaults.newProject();
      Assets.registerCustomChars(S.proj.customChars);
      Assets.bindExternalAssets(S.proj);
      S.curMapId = S.proj.maps[0].id;
      S.selectedEvent = null; S.selection = null; S.pasteMode = null;
      S.undoStack.length = 0; S.redoStack.length = 0;
      rebuildAll(); touch();
    });
  } });
  act("open", { label: "Open Project (.json)…", icon: "open", tip: "Open / import a project file", run() { $("import-file").click(); } });
  act("save", { label: "Save Project", icon: "save", key: "Ctrl+S",
    tip: host.isTauri ? "Save the project to its file" : "Save the project to this browser now",
    run() {
      if (host.isTauri) { desktopSave(false); return; }
      saveNow();
      flashStatus("Project saved to this browser — use File ▸ Export for a backup file");
    } });
  act("export", { label: "Export Project As File…", run: exportProject });
  act("build", { label: "Export Standalone Game…", run: openStandaloneExport });
  act("play", { label: "Playtest", icon: "play", key: "F5", tip: "Save and run the game", run() {
    saveNow();
    if (host.isTauri) {
      host.openPlaytest().catch((e) => alert("Could not open play-test window: " + ((e && e.message) || e)));
    } else {
      window.open(playtestUrl(), "rpgatlas_play");
    }
  } });
  act("mapprops", { label: "Map Properties…", run: openMapProps });
  act("hdpreview", { label: "HD-2D Preview", icon: "hd2d", key: "F2", tip: "Toggle the live HD-2D preview panel (uses this map's HD-2D settings)", active: () => isHdPreviewOpen(), run: toggleHdPreview });

  act("undo", { label: "Undo", icon: "undo", key: "Ctrl+Z", enabled: () => S.undoStack.length > 0, run: undo });
  act("redo", { label: "Redo", icon: "redo", key: "Ctrl+Y", enabled: () => S.redoStack.length > 0, run: redo });
  act("cut", { label: "Cut", icon: "cut", key: "Ctrl+X", tip: "Cut the selected area / event", enabled: canCopy, run: () => copySelection(true) });
  act("copy", { label: "Copy", icon: "copy", key: "Ctrl+C", tip: "Copy the selected area / event (Shift+drag selects tiles)", enabled: canCopy, run: () => copySelection(false) });
  act("paste", { label: "Paste", icon: "paste", key: "Ctrl+V", tip: "Paste — then click the map to place", enabled: () => !!(S.clipTiles || S.clipEvent), run: startPaste });
  act("deselect", { label: "Clear Selection", key: "Esc", enabled: () => !!(S.selection || S.pasteMode), run: clearSelection });

  act("mode-map", { label: "Map (Tile) Mode", icon: "map", key: "Tab ⇆", tip: "Tile layer — draw the map", active: () => S.mode === "map", run: () => setMode("map") });
  act("mode-event", { label: "Event Mode", icon: "event", key: "Tab ⇆", tip: "Event layer — place and edit events", active: () => S.mode === "event", run: () => setMode("event") });
  act("mode-pass", { label: "Passability Mode", icon: "pass", key: "Tab ⇆", tip: "Passability — click tiles to cycle auto → ✕ block → ○ pass", active: () => S.mode === "pass", run: () => setMode("pass") });
  act("mode-height", { label: "Height Mode (HD-2D)", icon: "height", key: "Tab ⇆",
    tip: "Heights — paint HD-2D elevation with the Pen / Rectangle / Circle / Fill tools (digits 0–9 set the value)",
    active: () => S.mode === "height", run: () => setMode("height") });
  act("mode-start", { label: "Set Start Position…", active: () => S.mode === "start", run() {
    setMode("start");
    flashStatus("Click the map to set the player start position");
  } });

  [["auto", "`"], ["ground", "1"], ["decor", "2"], ["decor2", "3"], ["over", "4"]].forEach(([ln, key]) => {
    act("layer-" + ln, { label: LAYER_LABELS[ln], icon: "layer-" + ln, key,
      active: () => S.layer === ln && S.mode === "map",
      run() { if (S.mode !== "map") setMode("map"); setLayer(ln); } });
  });
  [["pen", "Q"], ["erase", "W"], ["rect", "E"], ["circle", "R"], ["fill", "T"], ["shadow", "Y"]].forEach(([t, key]) => {
    act("tool-" + t, { label: TOOL_LABELS[t], icon: t, key,
      tip: t === "shadow" ? "Shadow Pen — left paints a shadow quadrant, right erases" : TOOL_LABELS[t],
      active: () => S.tool === t && (S.mode === "map" || S.mode === "height"),
      run() { if (S.mode !== "map" && S.mode !== "height") setMode("map"); setTool(t); } });
  });

  act("zoomin", { label: "Zoom In", icon: "zoomin", key: "+", run: () => zoomStep(1) });
  act("zoomout", { label: "Zoom Out", icon: "zoomout", key: "−", run: () => zoomStep(-1) });
  act("zoom1", { label: "Zoom 1:1", icon: "zoom1", key: "0", tip: "Set zoom to 100%", active: () => Math.abs(S.zoom - 1) < 0.01, run: () => setZoom(1) });
  act("zoomfit", { label: "Fit Map In View", run: () => zoomFit() });

  act("db", { label: "Database…", icon: "db", key: "F1", tip: "Database — actors, items, enemies, switches…", run: openDatabase });
  act("plugins", { label: "Plugin Manager…", icon: "plugins", tip: "Plugin Manager — project JavaScript run at game boot", run: openPluginManager });
  act("audio", { label: "Audio Manager…", icon: "audio", tip: "Audio Manager — preview sounds and music", run: openAudioManager });
  act("search", { label: "Event Searcher…", icon: "search", tip: "Event Searcher — find text / switches / variables across maps", run: openEventSearcher });
  act("resources", { label: "Resource Manager…", icon: "resources", tip: "Resource Manager — browse and export generated assets", run: openResourceManager });
  act("chargen", { label: "Character Generator…", icon: "chargen", tip: "Character Generator — build original walking sprites", run: openCharGenerator });
  act("language", { label: "Interface Language…", run: openLanguageSettings });
  act("patchnotes", { label: "Patch Notes", run: openPatchNotes });
  act("shortcuts", { label: "Keyboard Shortcuts…", key: "?", run: openKeyboardShortcuts });
  act("help", { label: "Quick Help", run: openHelp });
  act("about", { label: "About RPGAtlas", run: openAbout });

  const TOOLBAR = [
    ["new", "open", "save"],
    ["cut", "copy", "paste"],
    ["undo", "redo"],
    ["mode-map", "mode-event", "mode-pass", "mode-height"],
    ["layer-auto", "layer-ground", "layer-decor", "layer-decor2", "layer-over"],
    ["tool-pen", "tool-erase", "tool-rect", "tool-circle", "tool-fill", "tool-shadow"],
    ["zoomin", "zoomout", "zoom1"],
    ["db", "plugins", "audio", "search", "resources", "chargen"],
    ["hdpreview", "play"],
  ];
  function buildToolbar() {
    const bar = $("toolbar");
    bar.innerHTML = "";
    TOOLBAR.forEach((group, gi) => {
      if (gi) bar.appendChild(h("span", { class: "tb-sep" }));
      for (const id of group) {
        const a = ACT[id];
        const btn = h("button", {
          class: "tbtn" + (id === "play" ? " play-btn" : ""),
          title: actionTip(a) + (a.key ? "  (" + a.key + ")" : ""),
          onclick: () => runAct(id),
        });
        btn.innerHTML = ICONS[a.icon] || "";
        if (id === "play") btn.appendChild(document.createTextNode(actionLabel(a)));
        a.btn = btn;
        bar.appendChild(btn);
      }
    });
  }
  function refreshToolbar() {
    for (const id of Object.keys(ACT)) {
      const a = ACT[id];
      if (!a.btn) continue;
      a.btn.classList.toggle("sel", !!(a.active && a.active()));
      a.btn.disabled = !!(a.enabled && !a.enabled());
    }
  }

  const MENUS = [
    { label: "File", items: ["new", "open", "save", "export", "build", "-", "play"] },
    { label: "Edit", items: ["undo", "redo", "-", "cut", "copy", "paste", "-", "deselect"] },
    { label: "Mode", items: ["mode-map", "mode-event", "mode-pass", "mode-height", "-", "mode-start"] },
    { label: "Draw", items: ["tool-pen", "tool-erase", "tool-rect", "tool-circle", "tool-fill", "tool-shadow"] },
    { label: "Layer", items: ["layer-auto", "layer-ground", "layer-decor", "layer-decor2", "layer-over"] },
    { label: "Scale", items: ["zoomin", "zoomout", "zoom1", "zoomfit"] },
    { label: "Tools", items: ["db", "plugins", "audio", "search", "resources", "chargen"] },
    { label: "Game", items: ["play", "build", "-", "mapprops", "hdpreview", "mode-start"] },
    { label: "Help", items: ["language", "-", "shortcuts", "patchnotes", "help", "about"] },
  ];
  let menuOpenRef = null;
  let menuDismissBound = false;
  function closeMenus() {
    if (!menuOpenRef) return;
    menuOpenRef.drop.remove();
    menuOpenRef.lab.classList.remove("open");
    menuOpenRef = null;
  }
  function openMenuFor(menu, lab) {
    closeMenus();
    const drop = h("div", { class: "menu-drop" });
    for (const it of menu.items) {
      if (it === "-") { drop.appendChild(h("div", { class: "menu-sep" })); continue; }
      const a = ACT[it];
      const dis = !!(a.enabled && !a.enabled());
      drop.appendChild(h("div", {
        class: "menu-item" + (dis ? " disabled" : ""),
        onclick() { if (dis) return; closeMenus(); a.run(); refreshToolbar(); },
      },
        h("span", { class: "mi-check" }, a.active && a.active() ? "✓" : ""),
        h("span", { class: "mi-label" }, actionLabel(a)),
        a.key ? h("span", { class: "mi-key" }, a.key) : null));
    }
    const r = lab.getBoundingClientRect();
    drop.style.left = r.left + "px";
    drop.style.top = (r.bottom + 2) + "px";
    document.body.appendChild(drop);
    lab.classList.add("open");
    menuOpenRef = { drop, lab };
  }
  function buildMenubar() {
    const nav = $("menus");
    nav.innerHTML = "";
    for (const menu of MENUS) {
      const lab = h("span", { class: "menu-label" }, t(menu.label));
      lab.addEventListener("mousedown", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (menuOpenRef && menuOpenRef.lab === lab) closeMenus();
        else openMenuFor(menu, lab);
      });
      lab.addEventListener("mouseenter", () => {
        if (menuOpenRef && menuOpenRef.lab !== lab) openMenuFor(menu, lab);
      });
      nav.appendChild(lab);
    }
    if (!menuDismissBound) {
      document.addEventListener("mousedown", (e) => {
        if (menuOpenRef && !menuOpenRef.drop.contains(e.target)) closeMenus();
      });
      menuDismissBound = true;
    }
  }

  // ============================ modes / zoom ============================
  function setMode(m) {
    S.mode = m;
    S.selectedEvent = null;
    S.pasteMode = null;
    renderMap(); refreshToolbar(); setStatus();
  }
  const MODE_CYCLE = ["map", "event", "pass", "height"]; // "start" intentionally excluded
  function cycleMode(dir) {
    let i = MODE_CYCLE.indexOf(S.mode);
    if (i < 0) i = 0; // "start"/unexpected -> enter at "map"
    const n = MODE_CYCLE.length;
    setMode(MODE_CYCLE[(i + dir + n) % n]);
  }
  function setTool(t) {
    S.tool = t;
    renderMap(); refreshToolbar(); setStatus();
  }
  function setLayer(l) {
    S.layer = l;
    renderMap(); refreshToolbar(); setStatus();
  }
  function setZoom(z, pivot) {
    z = Math.max(0.15, Math.min(3, z));
    const sc = $("mapscroll");
    const px = pivot ? pivot.x : sc.clientWidth / 2;
    const py = pivot ? pivot.y : sc.clientHeight / 2;
    const wx = (sc.scrollLeft + px - 14) / S.zoom;  // 14 = #mapscroll padding
    const wy = (sc.scrollTop + py - 14) / S.zoom;
    S.zoom = z;
    renderMap();
    sc.scrollLeft = wx * S.zoom + 14 - px;
    sc.scrollTop = wy * S.zoom + 14 - py;
    setStatus(); refreshToolbar();
  }
  function zoomStep(d, pivot) {
    let best = 0, bd = Infinity;
    ZOOMS.forEach((z, i) => { const dd = Math.abs(z - S.zoom); if (dd < bd) { bd = dd; best = i; } });
    setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, best + d))], pivot);
  }
  function zoomFit() {
    const m = curMap(), sc = $("mapscroll");
    if (!m) return;
    setZoom(Math.min((sc.clientWidth - 30) / (m.width * TILE), (sc.clientHeight - 30) / (m.height * TILE), 1.5));
  }

  // ============================ boot / wiring ============================
  function rebuildAll() {
    if (!RA.byId(S.proj.maps, S.curMapId)) S.curMapId = S.proj.maps[0].id;
    rebuildMapList();
    renderPalette();
    renderMap();
    refreshToolbar();
    setStatus();
  }

  async function boot() {
    S.proj = loadStored() || DataDefaults.newProject();
    Assets.registerCustomChars(S.proj.customChars);
    await Promise.all([Assets.loadIconSet(), Assets.loadExternalAssets(S.proj)]);
    S.mapCanvas = $("mapcanvas");
    S.mapCtx = S.mapCanvas.getContext("2d");
    S.palCanvas = $("palette");

    editorI18n.localizeStatic();
    buildMenubar();
    buildToolbar();

    // palette
    S.palCanvas.addEventListener("mousedown", (e) => {
      const r = S.palCanvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / TILE), y = Math.floor((e.clientY - r.top) / TILE);
      const id = y * Assets.PALETTE_COLS + x;
      if (id >= 0 && Assets.tiles[id]) { S.selectedTile = id; renderPalette(); setStatus(); }
    });
    S.palCanvas.addEventListener("mousemove", (e) => {
      const r = S.palCanvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / TILE), y = Math.floor((e.clientY - r.top) / TILE);
      const id = y * Assets.PALETTE_COLS + x;
      S.palCanvas.title = Assets.tiles[id] ? Assets.tiles[id].name : "";
    });

    // map canvas
    S.mapCanvas.addEventListener("mousedown", onCanvasDown);
    S.mapCanvas.addEventListener("mousemove", onCanvasMove);
    window.addEventListener("mouseup", onCanvasUp);
    S.mapCanvas.addEventListener("dblclick", onCanvasDbl);
    S.mapCanvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (S.suppressNextCtxMenu) { S.suppressNextCtxMenu = false; return; }
      if (S.mode === "event") openCanvasMenu(e);
    });
    S.mapCanvas.addEventListener("mouseleave", () => { S.hoverCell = null; S.hoverQuad = 0; renderMap(); });

    // ctrl+wheel zooms around the cursor
    $("mapscroll").addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = $("mapscroll").getBoundingClientRect();
      zoomStep(e.deltaY < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });

    $("import-file").addEventListener("change", (e) => {
      if (e.target.files[0]) importProject(e.target.files[0]);
      e.target.value = "";
    });
    $("map-add").addEventListener("click", addMap);
    $("map-del").addEventListener("click", deleteMap);
    $("map-gen").addEventListener("click", openMapGenProps);

    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (modalRoot().children.length) return;
      if (e.code === "Escape") {
        if (menuOpenRef) { closeMenus(); return; }
        if (S.pasteMode || S.selection) { clearSelection(); return; }
        if (S.selectedEvent) { S.selectedEvent = null; renderMap(); refreshToolbar(); }
        return;
      }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openKeyboardShortcuts(); return; }
      // Mode cycle (always available). Tab forward, Shift+Tab back. Skip when Ctrl/Meta held.
      if (e.code === "Tab" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); cycleMode(e.shiftKey ? -1 : 1); return; }

      if (e.ctrlKey || e.metaKey) {
        switch (e.code) {
          case "KeyZ": e.preventDefault(); undo(); break;
          case "KeyY": e.preventDefault(); redo(); break;
          case "KeyX": e.preventDefault(); copySelection(true); break;
          case "KeyC": e.preventDefault(); copySelection(false); break;
          case "KeyV": e.preventDefault(); startPaste(); break;
          case "KeyS": e.preventDefault(); runAct("save"); break;
        }
        return;
      }
      // Application shortcuts — global (any mode). F1/F5 override the browser's Help/Reload.
      switch (e.code) {
        case "F1": e.preventDefault(); runAct("db");        return;
        case "F2": e.preventDefault(); runAct("hdpreview"); return;
        case "F5": e.preventDefault(); runAct("play");      return;
      }
      // Height mode consumes ALL digits for the painted elevation (0–9). Must stay above the layer gate.
      if (S.mode === "height" && /^Digit\d$/.test(e.code)) {
        S.heightVal = Number(e.code.slice(5));
        setStatus();
        return;
      }
      // Tools
      if (S.mode === "map" || S.mode === "height") {
        switch (e.code) {
          case "KeyQ": setTool("pen");    return;
          case "KeyW": setTool("erase");  return;
          case "KeyE": setTool("rect");   return;
          case "KeyR": setTool("circle"); return;
          case "KeyT": setTool("fill");   return;
          case "KeyY": setTool("shadow"); return;
        }
      }
      // Layers
      if (S.mode === "map") {
        switch (e.code) {
          case "Backquote": setLayer("auto");   return;
          case "Digit1":    setLayer("ground"); return;
          case "Digit2":    setLayer("decor");  return;
          case "Digit3":    setLayer("decor2"); return;
          case "Digit4":    setLayer("over");   return;
        }
      }
      switch (e.code) {
        case "Equal": case "NumpadAdd": zoomStep(1); break;
        case "Minus": case "NumpadSubtract": zoomStep(-1); break;
        case "Digit0": case "Numpad0": setZoom(1); break; // reset to 100% (height mode consumes 0 above)
        case "Delete": case "Backspace":
          if (S.mode === "event") deleteSelectedEvent();
          break;
      }
    });

    setTool("pen");
    setLayer("auto");
    setMode("map");
    rebuildAll();
    saveNow();
  }
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
