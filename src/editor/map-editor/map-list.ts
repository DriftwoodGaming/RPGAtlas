/* RPGAtlas — src/editor/map-editor/map-list.ts
   Map list, add/delete map, random map generator, map properties, resize.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 1):
   logic unchanged, closure vars routed through editor-state.ts; calls into
   not-yet-extracted sections go through editorHooks.
   Copyright (C) 2026 RPGAtlas contributors - GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, DataDefaults, RA, LAYER_ORDER, editorState as S, curMap } from "../editor-state";
import { $, h, tIn, nIn, sel, chk, field, row, dbOpts, MUSIC_OPTS } from "../dom";
import { modal, confirmBox } from "../modals";
import { touch } from "../persistence";
import { renderMap } from "./map-render";
import { heightsOf } from "./painting";
import { setStatus, flashStatus } from "./status";
import { viewportDirty } from "./hd-viewport";
import { walkCommands } from "../event-editor/command-list";

  // ============================ map list ============================
  export function rebuildMapList() {
    const ul = $("maplist");
    ul.innerHTML = "";
    for (const m of S.proj.maps) {
      const li = h("li", {
        class: m.id === S.curMapId ? "sel" : "",
        onclick() { S.curMapId = m.id; S.selectedEvent = null; rebuildMapList(); renderMap(); setStatus(); },
        ondblclick() { openMapProps(); },
      }, m.id + ": " + m.name);
      ul.appendChild(li);
    }
  }
  export function addMap() {
    const id = RA.nextId(S.proj.maps);
    const m = DataDefaults.newMap(id, "Map " + id, 20, 15, Assets.T.grass);
    S.proj.maps.push(m);
    S.curMapId = id;
    rebuildMapList(); renderMap(); touch();
    openMapProps();
  }
  export function deleteMap() {
    if (S.proj.maps.length <= 1) { alert("A project needs at least one map."); return; }
    const m = curMap();
    confirmBox('Delete map "' + m.name + '"? This cannot be undone.', () => {
      const danglers: any[] = [];
      for (const om of S.proj.maps) {
        if (om.id === m.id) continue;
        for (const ev of om.events) {
          walkCommands(ev.pages.flatMap((pg: any) => pg.commands || []), (c: any) => {
            if (c.t === "transfer" && c.mapId === m.id) danglers.push(om.name + " → " + ev.name);
          });
        }
      }
      S.proj.maps = S.proj.maps.filter((x: any) => x.id !== m.id);
      if (S.proj.system.startMapId === m.id) S.proj.system.startMapId = S.proj.maps[0].id;
      S.curMapId = S.proj.maps[0].id;
      rebuildMapList(); renderMap(); touch();
      if (danglers.length) {
        alert('Map "' + m.name + '" was deleted, but these events still have a Transfer Player command targeting it and need to be fixed manually:\n\n' + danglers.join("\n"));
      }
    });
  }

  export function openMapGenProps() {
    const work = {
      name: "Random Map",
      width: 24,
      height: 18,
      theme: "grassland",
      style: "wilderness",
      density: "medium",
      setStart: true
    };

    const content = h("div", null,
      field("Name", tIn(work, "name")),
      row(
        field("Width", nIn(work, "width", 8, 100)),
        field("Height", nIn(work, "height", 8, 100))
      ),
      field("Theme", sel(work, "theme", [
        { v: "grassland", l: "Grassland / Forest" },
        { v: "desert", l: "Desert / Oasis" },
        { v: "cave", l: "Cave / Lava" },
        { v: "snow", l: "Snow / Ice" },
        { v: "swamp", l: "Swamp / Marsh" }
      ])),
      field("Generator Style", sel(work, "style", [
        { v: "wilderness", l: "Wilderness (Open)" },
        { v: "cellular", l: "Cave (Cellular Automata)" },
        { v: "maze", l: "Maze / Labyrinth" },
        { v: "islands", l: "Islands" }
      ])),
      field("Object Density", sel(work, "density", [
        { v: "sparse", l: "Sparse" },
        { v: "medium", l: "Medium" },
        { v: "dense", l: "Dense" }
      ])),
      h("label", { class: "fld" },
        h("span", null, "Set as Starting Map"),
        chk(work, "setStart")
      )
    );

    modal({
      title: "Generate Random Map",
      content,
      buttons: [
        { label: "Generate", primary: true, onClick(close: any) {
          const m = performMapGeneration(work);
          S.proj.maps.push(m);
          S.curMapId = m.id;
          if (work.setStart) {
            S.proj.system.startMapId = m.id;
            S.proj.system.startX = m.tempStartX;
            S.proj.system.startY = m.tempStartY;
          }
          delete m.tempStartX;
          delete m.tempStartY;
          
          close();
          rebuildMapList();
          renderMap();
          touch();
          flashStatus(`Generated map "${m.name}"`);
        } },
        { label: "Cancel" }
      ]
    });
  }

  export function performMapGeneration(opts: any) {
    const w = parseInt(opts.width) || 20;
    const h = parseInt(opts.height) || 15;
    const n = w * h;
    const id = RA.nextId(S.proj.maps);
    
    let music = "field";
    if (opts.theme === "grassland" || opts.theme === "swamp") music = "town";
    if (opts.theme === "cave") music = "cave";
    
    const m: any = {
      id, name: opts.name || ("Random Map " + id), width: w, height: h,
      tilesetId: (S.proj.tilesets && S.proj.tilesets[0]) ? S.proj.tilesets[0].id : 1,
      music,
      encounters: { troops: [], rate: 0 },
      layers: {
        ground: new Array(n).fill(0),
        decor: new Array(n).fill(0),
        decor2: new Array(n).fill(0),
        over: new Array(n).fill(0),
      },
      shadows: new Array(n).fill(0),
      passOv: new Array(n).fill(0),
      events: [],
    };
    
    const T = Assets.T;
    
    const themes: any = {
      grassland: {
        floor: T.grass,
        patches: [
          { t: T.flowers, p: 0.08 },
          { t: T.tallgrass, p: 0.12 },
          { t: T.dirt, p: 0.05 }
        ],
        water: T.water,
        deepwater: T.deepwater,
        wall: T.cliff,
        decor: [
          { t: T.tree, w: 4 },
          { t: T.pine, w: 3 },
          { t: T.bush, w: 3 },
          { t: T.rock, w: 2 },
          { t: T.flowerpot, w: 1 }
        ]
      },
      desert: {
        floor: T.sand,
        patches: [
          { t: T.dirt, p: 0.08 }
        ],
        water: T.water,
        deepwater: T.deepwater,
        wall: T.wall_brick,
        decor: [
          { t: T.cactus, w: 6 },
          { t: T.deadtree, w: 3 },
          { t: T.rock, w: 3 }
        ]
      },
      cave: {
        floor: T.cavefloor,
        patches: [
          { t: T.crystalfloor, p: 0.15 }
        ],
        water: T.lava,
        deepwater: T.lava,
        wall: T.cavewall,
        decor: [
          { t: T.mushroom, w: 4 },
          { t: T.rock, w: 4 },
          { t: T.crystals, w: 3 },
          { t: T.lava_rock, w: 1 }
        ]
      },
      snow: {
        floor: T.snow,
        patches: [
          { t: T.ice, p: 0.15 }
        ],
        water: T.water,
        deepwater: T.deepwater,
        wall: T.wall_stone,
        decor: [
          { t: T.snowtree, w: 5 },
          { t: T.pine, w: 4 },
          { t: T.rock, w: 2 },
          { t: T.pillar, w: 1 }
        ]
      },
      swamp: {
        floor: T.dirt,
        patches: [
          { t: T.grass, p: 0.15 }
        ],
        water: T.swamp,
        deepwater: T.swamp,
        wall: T.wall_wood,
        decor: [
          { t: T.deadtree, w: 5 },
          { t: T.waterlily, w: 3 },
          { t: T.rock, w: 2 },
          { t: T.cobweb, w: 1 }
        ]
      }
    };
    
    const th = themes[opts.theme] || themes.grassland;
    let grid = Array.from({ length: h }, () => new Array(w).fill(false));
    
    if (opts.style === "cellular") {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
            grid[y][x] = true;
          } else {
            grid[y][x] = Math.random() < 0.45;
          }
        }
      }
      for (let step = 0; step < 4; step++) {
        const nextGrid: any[] = [];
        for (let y = 0; y < h; y++) {
          nextGrid[y] = [];
          for (let x = 0; x < w; x++) {
            if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
              nextGrid[y][x] = true;
              continue;
            }
            let walls = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (grid[y + dy][x + dx]) walls++;
              }
            }
            nextGrid[y][x] = walls >= 5;
          }
        }
        grid = nextGrid;
      }
      
      const visited = Array.from({ length: h }, () => new Array(w).fill(false));
      const components = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!grid[y][x] && !visited[y][x]) {
            const comp = [];
            const queue: any[] = [[x, y]];
            visited[y][x] = true;
            while (queue.length > 0) {
              const [cx, cy] = queue.shift();
              comp.push([cx, cy]);
              const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
              for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                  if (!grid[ny][nx] && !visited[ny][nx]) {
                    visited[ny][nx] = true;
                    queue.push([nx, ny]);
                  }
                }
              }
            }
            components.push(comp);
          }
        }
      }
      
      let largest: any[] = [];
      for (const comp of components) {
        if (comp.length > largest.length) {
          largest = comp;
        }
      }
      
      if (largest.length === 0) {
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            grid[cy + dy][cx + dx] = false;
            largest.push([cx + dx, cy + dy]);
          }
        }
      }
      
      const finalFloorSet = new Set(largest.map(([x, y]) => `${x},${y}`));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!grid[y][x] && !finalFloorSet.has(`${x},${y}`)) {
            grid[y][x] = true;
          }
        }
      }
      
    } else if (opts.style === "islands") {
      const cx = w / 2, cy = h / 2;
      const maxD = Math.sqrt(cx * cx + cy * cy);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
            grid[y][x] = true;
          } else {
            const dx = x - cx, dy = y - cy;
            const d = Math.sqrt(dx * dx + dy * dy);
            const landProb = 0.65 * (1 - d / maxD);
            grid[y][x] = Math.random() > Math.max(0.1, landProb);
          }
        }
      }
      for (let step = 0; step < 3; step++) {
        const nextGrid: any[] = [];
        for (let y = 0; y < h; y++) {
          nextGrid[y] = [];
          for (let x = 0; x < w; x++) {
            if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
              nextGrid[y][x] = true;
              continue;
            }
            let landCount = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (!grid[y + dy][x + dx]) landCount++;
              }
            }
            nextGrid[y][x] = landCount < 5;
          }
        }
        grid = nextGrid;
      }
      
    } else if (opts.style === "maze") {
      grid = Array.from({ length: h }, () => new Array(w).fill(true));
      const stack: any[] = [];
      const startX = 1, startY = 1;
      grid[startY][startX] = false;
      stack.push([startX, startY]);
      
      while (stack.length > 0) {
        const [cx, cy] = stack[stack.length - 1];
        const neighbors = [];
        const dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (nx > 0 && nx < w - 1 && ny > 0 && ny < h - 1) {
            if (grid[ny][nx]) {
              neighbors.push([nx, ny, dx, dy]);
            }
          }
        }
        if (neighbors.length > 0) {
          const [nx, ny, dx, dy] = neighbors[Math.floor(Math.random() * neighbors.length)];
          grid[ny][nx] = false;
          grid[cy + dy / 2][cx + dx / 2] = false;
          stack.push([nx, ny]);
        } else {
          stack.pop();
        }
      }
      
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (grid[y][x] && Math.random() < 0.08) {
            const horiz = !grid[y][x - 1] && !grid[y][x + 1];
            const vert = !grid[y - 1][x] && !grid[y + 1][x];
            if (horiz || vert) {
              grid[y][x] = false;
            }
          }
        }
      }
      
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
            grid[y][x] = true;
          }
        }
      }
      const numFormations = Math.floor(Math.random() * 3) + 1;
      for (let f = 0; f < numFormations; f++) {
        const fx = Math.floor(Math.random() * (w - 6)) + 2;
        const fy = Math.floor(Math.random() * (h - 6)) + 2;
        const fw = Math.floor(Math.random() * 3) + 2;
        const fh = Math.floor(Math.random() * 3) + 2;
        for (let y = fy; y < fy + fh; y++) {
          for (let x = fx; x < fx + fw; x++) {
            grid[y][x] = true;
          }
        }
      }
    }
    
    const ground = m.layers.ground;
    const decor = m.layers.decor;
    
    const isPond = new Array(n).fill(false);
    if (opts.style !== "islands") {
      const numPonds = opts.style === "wilderness" ? Math.floor(Math.random() * 3) + 1 : (Math.random() < 0.4 ? 1 : 0);
      for (let p = 0; p < numPonds; p++) {
        const px = Math.floor(Math.random() * (w - 6)) + 3;
        const py = Math.floor(Math.random() * (h - 6)) + 3;
        const pr = Math.floor(Math.random() * 2) + 2;
        for (let y = py - pr; y <= py + pr; y++) {
          for (let x = px - pr; x <= px + pr; x++) {
            if (x > 0 && x < w - 1 && y > 0 && y < h - 1 && !grid[y][x]) {
              const dx = x - px, dy = y - py;
              if (dx * dx + dy * dy <= pr * pr + 1) {
                isPond[y * w + x] = true;
              }
            }
          }
        }
      }
    }
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (grid[y][x]) {
          if (opts.style === "islands") {
            ground[i] = Math.random() < 0.45 ? th.deepwater : th.water;
          } else {
            ground[i] = th.floor;
            decor[i] = th.wall;
          }
        } else if (isPond[i]) {
          ground[i] = th.water;
        } else {
          ground[i] = th.floor;
          for (const patch of th.patches) {
            if (Math.random() < patch.p) {
              ground[i] = patch.t;
              break;
            }
          }
        }
      }
    }
    
    const walkable: any[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!grid[y][x] && !isPond[i]) {
          walkable.push({ x, y });
        }
      }
    }
    
    if (walkable.length === 0) {
      const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
      grid[cy][cx] = false;
      isPond[cy * w + cx] = false;
      ground[cy * w + cx] = th.floor;
      walkable.push({ x: cx, y: cy });
    }
    
    const startIdx = Math.floor(Math.random() * walkable.length);
    const startCell = walkable[startIdx];
    m.tempStartX = startCell.x;
    m.tempStartY = startCell.y;
    walkable.splice(startIdx, 1);
    
    let exitCell = null;
    let maxD2 = -1;
    let exitIdx = -1;
    for (let i = 0; i < walkable.length; i++) {
      const dx = walkable[i].x - startCell.x;
      const dy = walkable[i].y - startCell.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxD2) {
        maxD2 = d2;
        exitCell = walkable[i];
        exitIdx = i;
      }
    }
    if (exitCell && exitIdx >= 0) {
      walkable.splice(exitIdx, 1);
      const eId = RA.nextId(m.events);
      const e = DataDefaults.newEvent(eId, exitCell.x, exitCell.y, "Exit Portal");
      
      const exitTile = (opts.theme === "cave" || opts.theme === "snow") ? T.stairs : T.path;
      m.layers.ground[exitCell.y * w + exitCell.x] = exitTile;
      
      e.pages[0] = {
        cond: { switchId: 0, varId: 0, varVal: 0, selfSw: "", questId: 0, questStatus: "active", objectiveQuestId: 0, objectiveIndex: 0, objectiveStatus: "completed" },
        charset: "", dir: 0,
        moveType: "fixed", trigger: "touch", priority: "below", through: true,
        commands: [
          { t: "se", name: "door" },
          { t: "transfer", mapId: 1, x: 12, y: 12, dir: 0 },
          { t: "text", name: "", text: "Returned to the village!" }
        ],
      };
      m.events.push(e);
    }
    
    function addRandomChest(cx: any, cy: any) {
      const eId = RA.nextId(m.events);
      const evName = "Chest" + String(eId).padStart(3, "0");
      const e = DataDefaults.newEvent(eId, cx, cy, evName);
      
      const roll = Math.random();
      const cmd = [];
      let lootName = "";
      if (roll < 0.3) {
        const amount = Math.floor(Math.random() * 101) + 50;
        cmd.push({ t: "gold", op: "add", val: amount });
        lootName = `${amount} G`;
      } else if (roll < 0.7) {
        const quantity = Math.random() < 0.5 ? 1 : 2;
        cmd.push({ t: "item", kind: "item", id: 1, op: "add", val: quantity });
        lootName = quantity > 1 ? `${quantity} Potions` : "Potion";
      } else if (roll < 0.85) {
        const itemId = Math.random() < 0.5 ? 2 : 3;
        cmd.push({ t: "item", kind: "item", id: itemId, op: "add", val: 1 });
        lootName = itemId === 2 ? "Hi-Potion" : "Ether";
      } else {
        const isWeapon = Math.random() < 0.5;
        const itemId = Math.floor(Math.random() * 3) + 1;
        cmd.push({ t: "item", kind: isWeapon ? "weapon" : "armor", id: itemId, op: "add", val: 1 });
        if (isWeapon) {
          lootName = itemId === 1 ? "Bronze Sword" : itemId === 2 ? "Iron Sword" : "Oak Staff";
        } else {
          lootName = itemId === 1 ? "Leather Vest" : itemId === 2 ? "Chainmail" : "Cloth Robe";
        }
      }
      
      e.pages[0] = {
        cond: { switchId: 0, varId: 0, varVal: 0, selfSw: "", questId: 0, questStatus: "active", objectiveQuestId: 0, objectiveIndex: 0, objectiveStatus: "completed" },
        charset: "chest", dir: 0,
        moveType: "fixed", trigger: "action", priority: "same", through: false,
        commands: [
          { t: "se", name: "chest" },
          ...cmd,
          { t: "text", name: "", text: `Found ${lootName}!` },
          { t: "selfsw", key: "A", val: true },
        ],
      };
      e.pages.push({
        cond: { switchId: 0, varId: 0, varVal: 0, selfSw: "A", questId: 0, questStatus: "active", objectiveQuestId: 0, objectiveIndex: 0, objectiveStatus: "completed" },
        charset: "chest_open", dir: 0,
        moveType: "fixed", trigger: "action", priority: "same", through: false,
        commands: [
          { t: "text", name: "", text: "The chest is empty." }
        ],
      });
      m.events.push(e);
    }
    
    const numChests = Math.min(walkable.length, Math.floor(Math.random() * 3) + 1);
    for (let i = 0; i < numChests; i++) {
      const cIdx = Math.floor(Math.random() * walkable.length);
      const cCell = walkable[cIdx];
      walkable.splice(cIdx, 1);
      addRandomChest(cCell.x, cCell.y);
    }
    
    let decorProb = 0.12;
    if (opts.density === "sparse") decorProb = 0.05;
    if (opts.density === "dense") decorProb = 0.22;
    
    const dList = th.decor;
    const totalWeight = dList.reduce((sum: any, item: any) => sum + item.w, 0);
    function pickDecor() {
      let roll = Math.random() * totalWeight;
      for (const d of dList) {
        roll -= d.w;
        if (roll <= 0) return d.t;
      }
      return dList[0].t;
    }
    
    for (const cell of walkable) {
      if (Math.random() < decorProb) {
        decor[cell.y * w + cell.x] = pickDecor();
      }
    }
    
    if (opts.theme === "swamp") {
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (ground[i] === th.water && !decor[i] && Math.random() < 0.15) {
            decor[i] = T.waterlily;
          }
        }
      }
    }
    
    return m;
  }

  export function openMapProps() {
    const m = curMap();
    const tilesets = (S.proj.tilesets && S.proj.tilesets.length) ? S.proj.tilesets : [{ id: 1, name: "Default" }];
    const work = { name: m.name, width: m.width, height: m.height, music: m.music || "none", rate: m.encounters.rate, tilesetId: m.tilesetId || tilesets[0].id };
    const troopBox = h("div", { class: "minilist" });
    const encTroops = m.encounters.troops.slice();
    function redrawTroops() {
      troopBox.innerHTML = "";
      encTroops.forEach((tid: any, i: any) => {
        const tr = RA.byId(S.proj.troops, tid);
        troopBox.appendChild(h("div", { class: "minirow" },
          h("span", null, tr ? tr.name : "(missing)"),
          h("button", { class: "mini", onclick() { encTroops.splice(i, 1); redrawTroops(); } }, "✕")));
      });
      const pick = { id: S.proj.troops.length ? S.proj.troops[0].id : 0 };
      const s = sel(pick, "id", dbOpts(S.proj.troops));
      troopBox.appendChild(h("div", { class: "minirow" }, s,
        h("button", { class: "mini", onclick() { if (pick.id) { encTroops.push(pick.id); redrawTroops(); } } }, "+ add")));
    }
    redrawTroops();
    const hd = m.hd2d || {};
    const hdW = {
      enabled: !!hd.enabled,
      tilt: Math.min(89, Math.max(25, Number(hd.tilt) || 50)),
      bloom: !!hd.bloom, dof: !!hd.dof, fog: !!hd.fog,
      fogColor: (hd.fog && hd.fog.color) || "#101018",
      lights: !!hd.lights,
      ambient: hd.ambient == null ? 0.45 : Number(hd.ambient),
      shadows: !!hd.shadows,
      pointShadows: !!hd.pointShadows,
      water: !!hd.water,
      materials: !!hd.materials,
      weather: typeof hd.weather === "string" ? hd.weather : "",
      dropShadows: !!hd.dropShadows,
      aces: !!hd.aces, fxaa: !!hd.fxaa, ssao: !!hd.ssao, vignette: !!hd.vignette,
      lut: typeof hd.lut === "string" ? hd.lut : "",
      dayNight: !!hd.dayNight,
      timeOfDay: hd.timeOfDay == null ? "" : String(hd.timeOfDay),
    };
    const fogColorIn = h("input", { type: "color", value: hdW.fogColor,
      oninput(e: any) { hdW.fogColor = e.target.value; } });
    const content = h("div", null,
      field("Name", tIn(work, "name")),
      row(field("Width", nIn(work, "width", 5, 200)), field("Height", nIn(work, "height", 5, 200))),
      row(field("Tileset", sel(work, "tilesetId", dbOpts(tilesets))), field("Music", sel(work, "music", MUSIC_OPTS()))),
      field("Encounter rate (steps, 0 = off)", nIn(work, "rate", 0, 999)),
      h("div", { class: "fld" }, h("span", null, "Encounter troops"), troopBox),
      h("div", { class: "fld" }, h("span", null, "HD-2D (3D perspective rendering)")),
      row(field("Enabled", chk(hdW, "enabled")), field("Camera tilt (25–89°)", nIn(hdW, "tilt", 25, 89))),
      row(field("Bloom", chk(hdW, "bloom")), field("Depth of field", chk(hdW, "dof"))),
      row(field("Distance fog", chk(hdW, "fog")), field("Fog color", fogColorIn)),
      row(field("Point lights", chk(hdW, "lights")), field("Ambient light (0–2)", nIn(hdW, "ambient", 0, 2, 0.05))),
      row(field("Sun shadows (terrain & characters cast)", chk(hdW, "shadows")),
        field("Point-light shadows (4 nearest lights cast)", chk(hdW, "pointShadows"))),
      row(field("Water surface (waves, reflections, foam)", chk(hdW, "water")),
        field("Auto materials (relief, specular, night glow)", chk(hdW, "materials"))),
      row(field("Weather particles", sel(hdW, "weather", [
        { v: "", l: "None" }, { v: "rain", l: "Rain" },
        { v: "snow", l: "Snow" }, { v: "motes", l: "Ambient motes" },
      ])),
        field("Soft character drop shadows", chk(hdW, "dropShadows"))),
      row(field("ACES filmic tone mapping", chk(hdW, "aces")),
        field("FXAA anti-aliasing", chk(hdW, "fxaa"))),
      row(field("Ambient occlusion (SSAO)", chk(hdW, "ssao")),
        field("Vignette", chk(hdW, "vignette"))),
      row(field("Color grade", sel(hdW, "lut", [
        { v: "", l: "None" }, { v: "warm", l: "Warm" }, { v: "cool", l: "Cool" },
        { v: "night", l: "Night" }, { v: "sepia", l: "Sepia" }, { v: "noir", l: "Noir" },
      ])),
        field("Day/night cycle (sun follows the clock)", chk(hdW, "dayNight"))),
      field("Time of day on entry (hours 0–24, blank = keep current)", tIn(hdW, "timeOfDay")),
      h("div", { class: "dim" }, "Paint elevation in Height mode (H). Point lights: drag gizmos in the HD-2D Viewport (F2), or place events named “light #rrggbb radius”. See changes live in the HD-2D Viewport."),
    );
    modal({
      title: "Map Properties",
      content,
      buttons: [
        { label: "OK", primary: true, onClick(close: any) {
          m.name = work.name;
          m.tilesetId = work.tilesetId;
          m.music = work.music;
          m.encounters = { rate: work.rate, troops: encTroops };
          m.hd2d = {
            enabled: hdW.enabled, tilt: hdW.tilt,
            bloom: hdW.bloom, dof: hdW.dof,
            fog: hdW.fog ? { color: hdW.fogColor } : false,
            lights: hdW.lights, ambient: hdW.ambient,
            shadows: hdW.shadows,
            pointShadows: hdW.pointShadows,
            water: hdW.water,
            materials: hdW.materials,
            weather: hdW.weather || "",
            dropShadows: hdW.dropShadows,
            aces: hdW.aces, fxaa: hdW.fxaa, ssao: hdW.ssao, vignette: hdW.vignette,
            lut: hdW.lut || "",
            dayNight: hdW.dayNight,
            timeOfDay: String(hdW.timeOfDay).trim() === ""
              ? null
              : Math.min(24, Math.max(0, Number(hdW.timeOfDay) || 0)),
          };
          if (work.width !== m.width || work.height !== m.height) resizeMap(m, work.width, work.height);
          close(); rebuildMapList(); renderMap(); touch();
          viewportDirty();
        } },
        { label: "Cancel" },
      ],
    });
  }
  export function resizeMap(m: any, w: any, h2: any) {
    w = Math.max(5, Math.min(200, w)); h2 = Math.max(5, Math.min(200, h2));
    const remap = (old: any, fill: any) => {
      const arr = new Array(w * h2).fill(fill);
      for (let y = 0; y < Math.min(m.height, h2); y++) {
        for (let x = 0; x < Math.min(m.width, w); x++) arr[y * w + x] = old[y * m.width + x];
      }
      return arr;
    };
    for (const ln of LAYER_ORDER) m.layers[ln] = remap(m.layers[ln], ln === "ground" ? Assets.T.grass : 0);
    m.shadows = remap(m.shadows, 0);
    m.passOv = remap(m.passOv, 0);
    m.heights = remap(heightsOf(m), 0);
    m.width = w; m.height = h2;
    m.events = m.events.filter((e: any) => e.x < w && e.y < h2);
  }
