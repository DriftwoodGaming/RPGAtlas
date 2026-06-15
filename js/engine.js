/* RPGAtlas — engine.js
   Game runtime: scenes, map, events, interpreter, menus, battle, shop, save/load.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
"use strict";

const _Assets = window.RPGAtlasDeps.Assets;
const _DataDefaults = window.RPGAtlasDeps.DataDefaults;
const _Renderer = window.RPGAtlasDeps.Renderer;
const _Music = window.RPGAtlasDeps.Music;
const _RA = window.RPGAtlasDeps.RA;
const _Sfx = window.RPGAtlasDeps.Sfx;
const _createMessageSystem = window.createMessageSystem;

(() => {
  const Assets = _Assets;
  const DataDefaults = _DataDefaults;
  const Renderer = _Renderer;
  const Music = _Music;
  const RA = _RA;
  const Sfx = _Sfx;
  const createMessageSystem = _createMessageSystem;

  const TILE = Assets.TILE;
  // defaults (overridden at boot from system.screenWidth/Height)
  let SCREEN_W = 17 * TILE,
    SCREEN_H = 13 * TILE;

  let proj = null;
  let stage, canvas, ctx, uiLayer, fader;
  let scene = "boot"; // boot | title | map | battle | gameover
  let menuOpen = false;
  let cameraZoom = 1;

  let shakePower = 0;
  let shakeSpeed = 0;
  let shakeDuration = 0;
  let shakeTimer = 0;

  let flashColor = "#ffffff";
  let flashOpacity = 0.5;
  let flashDuration = 0;
  let flashTimer = 0;

  // ============================ utils ============================
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function rnd(n) {
    return Math.floor(Math.random() * n);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  // system-tab sound/music lookups (logical key -> chosen SE / theme)
  function sysSe(key) {
    const m = (proj && proj.system && proj.system.sounds) || {};
    Sfx.play(m[key] || key);
  }
  function sysBgm(key) {
    const m = (proj && proj.system && proj.system.music) || {};
    return m[key] || key;
  }

  // ============================ input / UI stack ============================
  const UIStack = [];
  let okTriggered = false,
    cancelTriggered = false;
  const held = {};
  function keyName(e) {
    switch (e.code) {
      case "ArrowUp":
      case "KeyW":
        return "up";
      case "ArrowDown":
      case "KeyS":
        return "down";
      case "ArrowLeft":
      case "KeyA":
        return "left";
      case "ArrowRight":
      case "KeyD":
        return "right";
      case "KeyZ":
      case "Enter":
      case "Space":
        return "ok";
      case "KeyX":
      case "Escape":
        return "cancel";
      case "ShiftLeft":
      case "ShiftRight":
        return "dash";
      default:
        return null;
    }
  }
  document.addEventListener("keydown", (e) => {
    const k = keyName(e);
    if (!k) return;
    e.preventDefault();
    held[k] = true;
    if (e.repeat && (k === "ok" || k === "cancel")) return;
    if (UIStack.length) {
      UIStack[UIStack.length - 1].onKey(k);
    } else {
      if (k === "ok") okTriggered = true;
      if (k === "cancel") cancelTriggered = true;
    }
  });
  document.addEventListener("keyup", (e) => {
    const k = keyName(e);
    if (k) held[k] = false;
  });

  function pushUI(ui) {
    UIStack.push(ui);
  }
  function removeUI(ui) {
    const i = UIStack.indexOf(ui);
    if (i >= 0) UIStack.splice(i, 1);
    if (ui.el && ui.el.parentNode) ui.el.parentNode.removeChild(ui.el);
  }
  let richText;
  let showMessage;

  // generic selectable list. items: [{label|html, disabled, help}]
  function showList(items, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const win = el("div", "win listwin " + (opts.className || ""));
      if (opts.title) win.appendChild(el("div", "win-title", esc(opts.title)));
      const ul = el(
        "ul",
        "menu-list" + (opts.cols > 1 ? " cols" + opts.cols : ""),
      );
      win.appendChild(ul);
      const help = el("div", "win-help");
      if (items.some((it) => it.help)) win.appendChild(help);
      let idx = Math.max(0, Math.min(opts.start || 0, items.length - 1));
      const lis = items.map((it, i) => {
        const li = el(
          "li",
          it.disabled ? "disabled" : "",
          it.html != null ? it.html : esc(it.label),
        );
        li.addEventListener("mouseenter", () => {
          idx = i;
          refresh();
        });
        li.addEventListener("click", (e) => {
          e.stopPropagation();
          idx = i;
          refresh();
          ok();
        });
        ul.appendChild(li);
        return li;
      });
      win.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        cancel();
      });
      function refresh() {
        lis.forEach((li, i) => li.classList.toggle("sel", i === idx));
        if (help.parentNode)
          help.textContent = (items[idx] && items[idx].help) || "";
        const li = lis[idx];
        if (li && li.scrollIntoView) li.scrollIntoView({ block: "nearest" });
      }
      function move(d) {
        if (!items.length) return;
        idx = (idx + d + items.length) % items.length;
        sysSe("cursor");
        refresh();
      }
      function ok() {
        if (!items.length) return;
        if (items[idx].disabled) {
          sysSe("buzzer");
          return;
        }
        sysSe("ok");
        finish(idx);
      }
      function cancel() {
        if (opts.cancellable === false) return;
        sysSe("cancel");
        finish(-1);
      }
      function finish(v) {
        removeUI(ui);
        resolve(v);
      }
      const cols = opts.cols || 1;
      const ui = {
        el: win,
        onKey(k) {
          if (k === "up") move(-cols);
          else if (k === "down") move(cols);
          else if (k === "left") move(cols > 1 ? -1 : -1 * 0);
          else if (k === "right") move(cols > 1 ? 1 : 0);
          else if (k === "ok") ok();
          else if (k === "cancel") cancel();
        },
      };
      uiLayer.appendChild(win);
      pushUI(ui);
      refresh();
    });
  }

  // ============================ message window ============================
  // Substitute control codes, HTML-escape, then let text-code plugins add markup.
  // With no plugins this returns the escaped plain text — identical to before.
  // Typewriter that reveals an HTML string one visible character at a time by
  // walking its text nodes — so plugin markup (colour spans, bold) stays intact.

  async function fadeTo(opacity, ms) {
    fader.style.transitionDuration = ms + "ms";
    fader.style.opacity = opacity;
    await sleep(ms + 30);
  }

  // ============================ game state ============================
  const G = {
    switches: {},
    vars: {},
    selfSw: {},
    quests: {},
    party: [],
    inv: { item: {}, weapon: {}, armor: {} },
    gold: 0,
    mapId: 0,
    steps: 0,
    encSteps: 0,
    player: null,
  };

  function expForLevel(lv) {
    let t = 0;
    for (let l = 2; l <= lv; l++)
      t += Math.floor(20 * Math.pow(l - 1, 1.75) + 30);
    return t;
  }
  function actorClass(a) {
    return RA.byId(proj.classes, a.classId) || proj.classes[0];
  }
  function skillElement(skill) {
    return RA.elementOfSkill(skill);
  }
  function skillMpCost(a, skill) {
    return Math.max(
      0,
      Math.ceil(
        (skill.mp || 0) * RA.traitRate(actorClass(a), "special", "mpCost", 1),
      ),
    );
  }
  function skillPowerRate(a, skill) {
    return RA.traitRate(actorClass(a), "skill", skill.type, 1);
  }
  function actorIncomingRate(a, element, guarding) {
    const c = actorClass(a);
    let rate = RA.traitRate(c, "element", element, 1);
    rate *= RA.traitRate(c, "special", "damageTaken", 1);
    if (guarding) rate *= RA.traitRate(c, "special", "guardDamage", 0.55);
    return rate;
  }
  function canActorEquip(a, kind, itemId) {
    return RA.canEquip(actorClass(a), kind, itemId);
  }
  function sanitizeEquipment(a) {
    if (!canActorEquip(a, "weapon", a.weaponId)) a.weaponId = 0;
    if (!canActorEquip(a, "armor", a.armorId)) a.armorId = 0;
  }
  function param(a, stat) {
    const c = actorClass(a);
    let v = Math.floor(
      (c.base[stat] || 0) + (c.growth[stat] || 0) * (a.level - 1),
    );
    const w = RA.byId(proj.weapons, a.weaponId),
      ar = RA.byId(proj.armors, a.armorId);
    if (w && w.params) v += w.params[stat] || 0;
    if (ar && ar.params) v += ar.params[stat] || 0;
    v = Math.floor(v * RA.traitRate(c, "param", stat, 1));
    return Math.max(1, v);
  }
  function learnedSkills(a) {
    const c = actorClass(a);
    return (c.learnings || [])
      .filter((l) => l.level <= a.level)
      .map((l) => RA.byId(proj.skills, l.skillId))
      .filter(Boolean);
  }
  function makeActor(actorId) {
    const d = RA.byId(proj.actors, actorId);
    if (!d) return null;
    const a = {
      actorId,
      name: d.name,
      classId: d.classId,
      charset: d.charset,
      level: d.level || 1,
      exp: expForLevel(d.level || 1),
      weaponId: d.weaponId || 0,
      armorId: d.armorId || 0,
      hp: 1,
      mp: 1,
    };
    sanitizeEquipment(a);
    a.hp = param(a, "mhp");
    a.mp = param(a, "mmp");
    return a;
  }
  function gainExp(a, amount, log) {
    a.exp += amount;
    while (a.exp >= expForLevel(a.level + 1)) {
      const before = learnedSkills(a).map((s) => s.id);
      a.level++;
      a.hp = Math.min(a.hp + 10, param(a, "mhp"));
      if (log) log(a.name + " reached level " + a.level + "!");
      sysSe("levelup");
      for (const s of learnedSkills(a)) {
        if (!before.includes(s.id) && log)
          log(a.name + " learned " + s.name + "!");
      }
    }
  }
  function addInv(kind, id, n) {
    const bag = G.inv[kind];
    bag[id] = clamp((bag[id] || 0) + n, 0, 99);
    if (!bag[id]) delete bag[id];
  }
  function invCount(kind, id) { return G.inv[kind][id] || 0; }
  function dbFor(kind) { return kind === "item" ? proj.items : kind === "weapon" ? proj.weapons : proj.armors; }
  const questRuntime = window.RPGAtlasQuests.create({
    G,
    RA,
    clamp,
    gainExp,
    addInv,
    invCount,
    dbFor,
    refreshAllPages,
    getProj: () => proj,
    now: () => Date.now(),
  });
  const {
    Quests,
    questState,
    objectiveDone,
    evaluateQuestFailures,
    noteBattleFailure,
    onEnemyKilled,
  } = questRuntime;
  function traitDescription(t) {
    const value = Number(t.value) || 0;
    if (t.type === "param")
      return String(t.key).toUpperCase() + " " + value + "%";
    if (t.type === "element") {
      const e = RA.typeList(proj, "elements").find((x) => x.key === t.key);
      return (e ? e.name : t.key) + " damage " + value + "%";
    }
    if (t.type === "state") {
      const state = RA.byId(proj.states || [], Number(t.key));
      return (state ? state.name : "State " + t.key) + " chance " + value + "%";
    }
    if (t.type === "skill")
      return (
        String(t.key).replace(/^\w/, (c) => c.toUpperCase()) +
        " skill power " +
        value +
        "%"
      );
    if (t.type === "equip") {
      const item = RA.byId(
        t.key === "armor" ? proj.armors : proj.weapons,
        value,
      );
      return "Can equip " + (item ? item.name : t.key + " " + value);
    }
    const special = RA.TRAIT_SPECIALS.find((x) => x.v === t.key);
    return (
      (special ? special.l.replace(/ %$/, "") : t.key) + ": " + value + "%"
    );
  }

  // ============================ map runtime ============================
  let map = null;
  let lowerBuf = null,
    upperBuf = null;
  let hdActive = false; // current map renders through the WebGL HD-2D path
  // dev override until the editor exposes per-map HD-2D settings:
  // ?hd2d=1 forces the HD-2D renderer on, ?hd2d=0 forces it off
  const hdOverride = new URLSearchParams(location.search).get("hd2d");
  function hdWanted() {
    if (hdOverride === "1") return true;
    if (hdOverride === "0") return false;
    if (!map) return false;
    if (map.hd2d && map.hd2d.enabled) return true;
    if (
      map.hd2d &&
      (map.hd2d.lights || map.hd2d.tilt != null || map.hd2d.ambient != null)
    )
      return true;
    if (map.lights && map.lights.length > 0) return true;
    return false;
  }
  let evRTs = [];
  let blockingRun = false; // an action/touch/autorun interpreter is active
  const parallels = new Map(); // evRT -> running flag

  function tileAt(layer, x, y) {
    return map.layers[layer][y * map.width + x];
  }
  function tilePassable(x, y) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const ov = map.passOv ? map.passOv[y * map.width + x] : 0;
    if (ov === 1) return true;
    if (ov === 2) return false;
    const d2 = tileAt("decor2", x, y);
    if (d2 !== 0) return Assets.tiles[d2] ? Assets.tiles[d2].pass : false;
    const d = tileAt("decor", x, y);
    if (d !== 0) return Assets.tiles[d] ? Assets.tiles[d].pass : false;
    const g = tileAt("ground", x, y);
    if (g === 0) return false;
    return Assets.tiles[g] ? Assets.tiles[g].pass : false;
  }
  function pageActive(evId, page) {
    const c = page.cond;
    if (c.switchId && !G.switches[c.switchId]) return false;
    if (c.varId && !((G.vars[c.varId] || 0) >= c.varVal)) return false;
    if (c.selfSw && !G.selfSw[G.mapId + ":" + evId + ":" + c.selfSw]) return false;
    if (c.questId && Quests.status(c.questId) !== (c.questStatus || "active")) return false;
    if (c.objectiveQuestId) {
      const done = objectiveDone(c.objectiveQuestId, Number(c.objectiveIndex) || 0);
      if ((c.objectiveStatus || "completed") === "completed" ? !done : done) return false;
    }
    return true;
  }
  // HD-2D point lights are authored as events named "light [#rrggbb] [radius]",
  // e.g. "light #ff9944 260". The light follows the event and obeys its pages.
  function parseLight(name) {
    if (!/^light\b/i.test(name || "")) return null;
    const light = { color: "#ffcc88", radius: 180 };
    for (const tok of String(name).slice(5).trim().split(/\s+/)) {
      if (/^#[0-9a-fA-F]{6}$/.test(tok)) light.color = tok;
      else if (/^\d+$/.test(tok)) light.radius = Number(tok);
    }
    return light;
  }
  function makeEvRT(evData) {
    const rt = {
      ev: evData, x: evData.x, y: evData.y, rx: evData.x, ry: evData.y,
      prx: evData.x, pry: evData.y, // previous-tick render pos (for interpolation)
      dir: 0, frame: 1, animT: 0, moving: false, tx: 0, ty: 0,
      page: null, pageIndex: -1, erased: false, locked: false,
      moveT: 30 + rnd(90), route: null, speed: 0.05, charsetIdx: -1, kind: "",
      light: parseLight(evData.name),
    };
    refreshPage(rt);
    return rt;
  }
  function refreshPage(rt) {
    let pi = -1;
    for (let i = rt.ev.pages.length - 1; i >= 0; i--) {
      if (pageActive(rt.ev.id, rt.ev.pages[i])) {
        pi = i;
        break;
      }
    }
    if (pi === rt.pageIndex) return;
    rt.pageIndex = pi;
    rt.page = pi >= 0 ? rt.ev.pages[pi] : null;
    if (rt.page) {
      rt.dir = rt.page.dir || 0;
      rt.charsetIdx = rt.page.charset
        ? Assets.charsetIndex(rt.page.charset)
        : -1;
      rt.kind = rt.charsetIdx >= 0 ? Assets.charsets[rt.charsetIdx].kind : "";
    } else {
      rt.charsetIdx = -1;
      rt.kind = "";
    }
  }
  function refreshAllPages() {
    evRTs.forEach((rt) => {
      if (!rt.erased) refreshPage(rt);
    });
  }

  async function prerenderMap() {
    lowerBuf = document.createElement("canvas");
    lowerBuf.width = map.width * TILE;
    lowerBuf.height = map.height * TILE;
    upperBuf = document.createElement("canvas");
    upperBuf.width = lowerBuf.width;
    upperBuf.height = lowerBuf.height;
    const lg = lowerBuf.getContext("2d"),
      ug = upperBuf.getContext("2d");
    lg.fillStyle = "#101018";
    lg.fillRect(0, 0, lowerBuf.width, lowerBuf.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        Assets.drawTile(lg, tileAt("ground", x, y), x * TILE, y * TILE);
        Assets.drawTile(lg, tileAt("decor", x, y), x * TILE, y * TILE);
        Assets.drawTile(lg, tileAt("decor2", x, y), x * TILE, y * TILE);
        Assets.drawTile(ug, tileAt("over", x, y), x * TILE, y * TILE);
      }
    }
    // quadrant shadows (drawn into the lower buffer, under characters)
    if (map.shadows) {
      const H = TILE / 2;
      lg.fillStyle = "rgba(10,10,26,0.35)";
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const m2 = map.shadows[y * map.width + x];
          if (!m2) continue;
          if (m2 & 1) lg.fillRect(x * TILE, y * TILE, H, H);
          if (m2 & 2) lg.fillRect(x * TILE + H, y * TILE, H, H);
          if (m2 & 4) lg.fillRect(x * TILE, y * TILE + H, H, H);
          if (m2 & 8) lg.fillRect(x * TILE + H, y * TILE + H, H, H);
        }
      }
    }
    hdActive =
      hdWanted() &&
      typeof Renderer !== "undefined" &&
      (await Renderer.available());
    if (hdActive) await Renderer.setMap(lowerBuf, upperBuf, map);
  }

  async function loadMap(mapId) {
    map = RA.byId(proj.maps, mapId);
    if (!map) throw new Error("Map " + mapId + " not found");
    G.mapId = mapId;
    G.encSteps = 0;
    evRTs = map.events.map(makeEvRT);
    parallels.clear();
    await prerenderMap();
    Music.play(map.music || "none");
    Plugins.fire("mapLoad", map);
  }

  function entityAt(x, y, exclude) {
    return evRTs.filter(
      (rt) =>
        rt !== exclude && !rt.erased && rt.page && rt.x === x && rt.y === y,
    );
  }
  function blockingEventAt(x, y) {
    return entityAt(x, y).find(
      (rt) => rt.page.priority === "same" && !rt.page.through,
    );
  }
  function canEntityPass(rt, nx, ny) {
    if (rt.page && rt.page.through) return true;
    if (!tilePassable(nx, ny)) return false;
    if (blockingEventAt(nx, ny)) return false;
    if (
      G.player &&
      G.player.x === nx &&
      G.player.y === ny &&
      (!rt.page || rt.page.priority === "same")
    )
      return false;
    return true;
  }
  function startMove(ent, dir) {
    ent.dir = dir;
    const dx = dir === 1 ? -1 : dir === 2 ? 1 : 0;
    const dy = dir === 0 ? 1 : dir === 3 ? -1 : 0;
    ent.tx = ent.x + dx;
    ent.ty = ent.y + dy;
    ent.moving = true;
  }
  function dirTo(fx, fy, tx, ty) {
    const dx = tx - fx,
      dy = ty - fy;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 2 : 1;
    return dy > 0 ? 0 : 3;
  }
  const DIRD = { 0: [0, 1], 1: [-1, 0], 2: [1, 0], 3: [0, -1] };

  function updateEntityMotion(ent, speed) {
    if (!ent.moving) return false;
    const sx = Math.sign(ent.tx - ent.rx),
      sy = Math.sign(ent.ty - ent.ry);
    ent.rx += sx * speed;
    ent.ry += sy * speed;
    if (
      (sx !== 0 && Math.sign(ent.tx - ent.rx) !== sx) ||
      (sy !== 0 && Math.sign(ent.ty - ent.ry) !== sy) ||
      (sx === 0 && sy === 0)
    ) {
      ent.rx = ent.tx;
      ent.ry = ent.ty;
      ent.x = ent.tx;
      ent.y = ent.ty;
      ent.moving = false;
      return true; // arrived
    }
    ent.animT++;
    return false;
  }
  function walkFrame(ent) {
    if (!ent.moving && ent.kind !== "object") return 1;
    const seq = [0, 1, 2, 1];
    const speed = ent.kind === "object" ? 24 : 8;
    return seq[Math.floor((ent.animT || globalT) / speed) % 4];
  }

  // ---- routes ----
  function setRoute(ent, steps, onDone) {
    ent.route = { steps, idx: 0, wait: 0, onDone };
  }
  function updateRoute(ent) {
    const r = ent.route;
    if (!r || ent.moving) return;
    if (r.wait > 0) {
      r.wait--;
      return;
    }
    if (r.idx >= r.steps.length) {
      ent.route = null;
      if (r.onDone) r.onDone();
      return;
    }
    const s = r.steps[r.idx++];
    const dirs = { up: 3, down: 0, left: 1, right: 2 };
    if (s in dirs) {
      const d = dirs[s];
      ent.dir = d;
      const [dx, dy] = DIRD[d];
      const ok2 =
        ent === G.player
          ? tilePassable(ent.x + dx, ent.y + dy) &&
            !blockingEventAt(ent.x + dx, ent.y + dy)
          : canEntityPass(ent, ent.x + dx, ent.y + dy);
      if (ok2) startMove(ent, d);
    } else if (s === "forward") {
      r.steps.splice(r.idx, 0, ["down", "left", "right", "up"][ent.dir]);
    } else if (s.startsWith("turn_")) {
      ent.dir = dirs[s.slice(5)];
    } else if (s === "wait15") {
      r.wait = 15;
    } else if (s === "wait60") {
      r.wait = 60;
    }
  }

  // ============================ interpreter ============================
  class Interp {
    constructor(evRT) {
      this.evRT = evRT;
    }
    selfKey(key) {
      return G.mapId + ":" + (this.evRT ? this.evRT.ev.id : 0) + ":" + key;
    }

    async runList(list) {
      for (const cmd of list || []) await this.exec(cmd);
    }
    async exec(c) {
      switch (c.t) {
        case "text":
          await showMessage(c.name, c.text, c.face);
          break;
        case "choices": {
          const i = await showList(
            c.options.map((o) => ({ html: richText(o) })),
            { className: "choicewin", cancellable: false },
          );
          await this.runList(c.branches[i] || []);
          break;
        }
        case "switch": 
          G.switches[c.id] = !!c.val; 
          refreshAllPages(); 
          evaluateQuestFailures(); 
          break;
        case "selfsw": 
          G.selfSw[this.selfKey(c.key)] = !!c.val; 
          refreshAllPages(); 
          break;
        case "var": {
          const cur = G.vars[c.id] || 0;
          let v = c.val;
          if (c.op === "rnd") v = c.val + rnd((c.val2 || c.val) - c.val + 1);
          G.vars[c.id] =
            c.op === "add" ? cur + v : c.op === "sub" ? cur - v : v;
          refreshAllPages();
          evaluateQuestFailures();
          break;
        }
        case "if": {
          const ok2 = this.testCond(c.cond);
          await this.runList(ok2 ? c.then : c.else);
          break;
        }
        case "questStart":
          Quests.start(c.questId);
          break;

        case "questAdvanceObj":
          Quests.advanceObjective(c.questId, c.objIndex, c.amount);
          evaluateQuestFailures();
          break;

        case "questSetObj":
          Quests.setObjective(c.questId, c.objIndex, c.value);
          evaluateQuestFailures();
          break;

        case "questComplete": {
          const res = Quests.complete(c.questId, {
            mapId: G.mapId,
            eventId: this.evRT ? this.evRT.ev.id : 0,
          });
          if (res && res.rewardText) {
            await showMessage(
              "",
              "You received " + res.rewardText + "!",
            );
          }
          break;
        }

        case "questFail":
          Quests.fail(c.questId);
          break;

        case "transfer":
          await transferPlayer(c.mapId, c.x, c.y, c.dir);
          break;

        case "gold":
          G.gold = clamp(
            G.gold + (c.op === "sub" ? -c.val : c.val),
            0,
            9999999,
          );
          break;

        case "item":
          addInv(
            c.kind || "item",
            c.id,
            c.op === "sub" ? -c.val : c.val,
          );
          break;
        case "party": {
          if (c.op === "add") {
            if (
              !G.party.find((a) => a.actorId === c.actorId) &&
              G.party.length < 4
            ) {
              const a = makeActor(c.actorId);
              if (a) G.party.push(a);
            }
          } else {
            G.party = G.party.filter((a) => a.actorId !== c.actorId);
            if (!G.party.length)
              G.party.push(
                makeActor(proj.system.party[0] || proj.actors[0].id),
              );
          }
          break;
        }
        case "heal": {
          for (const a of G.party) {
            if (c.full) {
              a.hp = param(a, "mhp");
              a.mp = param(a, "mmp");
              a.states = [];
            } else {
              a.hp = clamp(a.hp + (c.hp || 0), 1, param(a, "mhp"));
              a.mp = clamp(a.mp + (c.mp || 0), 0, param(a, "mmp"));
            }
          }
          break;
        }
        case "battle": {
          const result = await Battle.run(c.troopId, c.escape !== false);
          if (result === "lose" && !c.lose) await gameOver();
          break;
        }
        case "shop":
          await Shop.run(c.goods || []);
          break;
        case "wait": {
          await waitFrames(c.frames || 30);
          break;
        }
        case "se":
          Sfx.play(c.name);
          break;
        case "music":
          Music.play(c.theme);
          break;
        case "move": {
          const target = c.target === "player" ? G.player : this.evRT;
          if (!target) break;
          if (c.wait) {
            await new Promise((res) => setRoute(target, c.steps.slice(), res));
          } else {
            setRoute(target, c.steps.slice(), null);
          }
          break;
        }
        case "cameraZoom": {
          const start = cameraZoom;
          const target = clamp(Number(c.zoom) || 1, 0.25, 4);
          const frames = Math.max(0, Math.floor(Number(c.frames) || 0));
          if (!frames) {
            cameraZoom = target;
          } else {
            await tickTween(frames, (t) => {
              cameraZoom = start + (target - start) * (t * t * (3 - 2 * t));
            });
          }
          cameraZoom = target;
          break;
        }
        case "shake": {
          shakePower = clamp(c.power || 5, 1, 9);
          shakeSpeed = clamp(c.speed || 5, 1, 9);
          shakeTimer = clamp(c.duration || 30, 1, 600);
          shakeDuration = shakeTimer;
          if (c.wait) {
            while (shakeTimer > 0) await frameWait();
          }
          break;
        }
        case "weather": {
          if (window.Atlas && typeof window.Atlas.weather === "function") {
            window.Atlas.weather(c.kind, c.power);
          }
          break;
        }
        case "flash": {
          flashColor = c.color || "#ffffff";
          flashOpacity = clamp(Number(c.opacity) || 0.5, 0.01, 1.0);
          flashTimer = clamp(c.duration || 15, 1, 300);
          flashDuration = flashTimer;
          if (c.wait) {
            while (flashTimer > 0) await frameWait();
          }
          break;
        }
        case "transparency":
          if (G.player) G.player.transparent = !!c.val;
          break;
        case "erase":
          if (this.evRT) this.evRT.erased = true;
          break;
        case "save":
          await saveLoadMenu("save");
          break;
        case "gameover":
          await gameOver();
          break;
        case "totitle":
          await toTitle();
          break;
        case "script": {
          try {
            new Function("game", c.code)(scriptApi);
          } catch (e) {
            console.error("Script command error:", e);
          }
          refreshAllPages();
          break;
        }
        default:
          if (Plugins.commands[c.t]) {
            try {
              await Plugins.commands[c.t](c, this);
            } catch (e) {
              console.error("Plugin command '" + c.t + "' failed:", e);
            }
          }
          break;
      }
    }
    testCond(cond) {
      if (!cond) return true;
      const cmp = (a, b, op) =>
        op === "==" ? a === b : op === "<=" ? a <= b : a >= b;
      switch (cond.kind) {
        case "switch":
          return !!G.switches[cond.id] === (cond.val !== false);
        case "var":
          return cmp(G.vars[cond.id] || 0, cond.val, cond.cmp || ">=");
        case "selfsw":
          return !!G.selfSw[this.selfKey(cond.key)];
        case "quest":
          return Quests.status(cond.questId) === (cond.status || "active");
        case "item":
          return invCount(cond.itemKind || "item", cond.id) > 0;
        case "gold":
          return cmp(G.gold, cond.val, cond.cmp || ">=");
        case "actor": {
          const actor = G.party.find((a) => a.actorId === cond.actorId);
          if (!actor) return false;
          if (cond.check === "inParty") return true;
          if (cond.check === "weapon") return actor.weaponId === cond.itemId;
          if (cond.check === "armor") return actor.armorId === cond.itemId;
          return true;
        }
        default:
          return true;      }
    }
  }
  const scriptApi = {
    setSwitch(id, v) {
      G.switches[id] = !!v;
      evaluateQuestFailures();
    },
    getSwitch(id) {
      return !!G.switches[id];
    },
    setVar(id, v) {
      G.vars[id] = v;
      evaluateQuestFailures();
    },
    getVar(id) {
      return G.vars[id] || 0;
    },
    addGold(n) {
      G.gold = clamp(G.gold + n, 0, 9999999);
    },
    party() {
      return G.party;
    },
    quest(id) {
      return Quests.get(id);
    },
    questStatus(id) {
      return Quests.status(id);
    },
    startQuest(id) {
      return Quests.start(id);
    },
    advanceQuestObjective(id, index, amount) {
      return Quests.advanceObjective(id, index, amount);
    },
    setQuestObjective(id, index, value) {
      return Quests.setObjective(id, index, value);
    },
    completeQuest(id) {
      return Quests.complete(id);
    },
    failQuest(id) {
      return Quests.fail(id);
    },
    abandonQuest(id) {
      return Quests.abandon(id);
    },
    state() {
      return G;
    },
    setCameraZoom(zoom) {
      cameraZoom = clamp(Number(zoom) || 1, 0.25, 4);
    },
    getCameraZoom() {
      return cameraZoom;
    },
  };

  // ============================ plugins ============================
  const Plugins = {
    hooks: { mapLoad: [], update: [], render: [] },
    textProcessors: [], // fn(html) -> html, run on every message/choice string
    commands: {}, // custom event-command handlers, by command type
    transition: null, // { out(ms), in(ms) } installed by a transition plugin
    fire(name, arg) {
      const list = this.hooks[name];
      for (let i = list.length - 1; i >= 0; i--) {
        try {
          list[i](arg);
        } catch (e) {
          console.error(
            "Plugin hook '" + name + "' failed and was disabled:",
            e,
          );
          list.splice(i, 1); // don't spam every frame
        }
      }
    },
    fireRender(ctx, info) {
      const list = this.hooks.render;
      for (let i = list.length - 1; i >= 0; i--) {
        try {
          list[i](ctx, info);
        } catch (e) {
          console.error("Plugin render hook failed and was disabled:", e);
          list.splice(i, 1);
        }
      }
    },
    runAll() {
      const atlas = {
        get project() {
          return proj;
        },
        get map() {
          return map;
        },
        get player() {
          return G.player;
        },
        get scene() {
          return scene;
        },
        Assets,
        Sfx,
        Music,
        get SCREEN_W() {
          return SCREEN_W;
        },
        get SCREEN_H() {
          return SCREEN_H;
        },
        TILE,
        get fader() {
          return fader;
        },
        get stage() {
          return stage;
        },
        get uiLayer() {
          return uiLayer;
        },
        onMapLoad: (fn) => Plugins.hooks.mapLoad.push(fn),
        onUpdate: (fn) => Plugins.hooks.update.push(fn),
        onRender: (fn) => Plugins.hooks.render.push(fn),
        onMessageText: (fn) => Plugins.textProcessors.push(fn),
        registerCommand: (t, fn) => {
          Plugins.commands[t] = fn;
        },
        setTransition: (t) => {
          Plugins.transition = t;
        },
        startBattle: (troopId, canEscape) =>
          Battle.run(troopId, canEscape !== false),
      };
      Plugins.atlas = Plugins.dw = atlas; // .dw kept for pre-rebrand plugins
      for (const pl of proj.plugins || []) {
        if (!pl.on) continue;
        try {
          new Function("atlas", "game", "dw", pl.code)(atlas, scriptApi, atlas);
        } catch (e) {
          // "dw" = pre-rebrand alias
          console.error("Plugin '" + (pl.name || "?") + "' failed:", e);
        }
      }
    },
  };

  ({ richText, showMessage } = createMessageSystem({
    Assets,
    el,
    esc,
    getPlugins: () => Plugins,
    getProject: () => proj,
    getState: () => G,
    getUiLayer: () => uiLayer,
    pushUI,
    removeUI,
  }));

  let frameWaiters = [];
  function frameWait() { return new Promise((r) => frameWaiters.push(r)); }
  // Tick-accurate timers: counted in update(), so event waits/tweens advance by ticks even
  // when several ticks run in one rendered frame. (frameWait above is per-rendered-frame.)
  let tickTimers = [];
  function waitFrames(n) {
    return new Promise((resolve) => tickTimers.push({ left: Math.max(1, n | 0), resolve }));
  }
  function tickTween(n, step) {
    const total = Math.max(1, n | 0);
    return new Promise((resolve) => tickTimers.push({ left: total, total, step, resolve }));
  }
  function pumpTickTimers() {
    if (!tickTimers.length) return;
    const timers = tickTimers; tickTimers = [];
    const done = [];
    for (const tm of timers) {
      tm.left--;
      if (tm.step) tm.step((tm.total - tm.left) / tm.total);
      if (tm.left <= 0) done.push(tm); else tickTimers.push(tm);
    }
    done.forEach((tm) => tm.resolve());
  }

  async function runEventBlocking(rt) {
    if (blockingRun) return;
    blockingRun = true;
    rt.locked = true;
    const prevDir = rt.dir;
    if (rt.kind === "human" && rt.page.trigger === "action") {
      rt.dir = dirTo(rt.x, rt.y, G.player.x, G.player.y);
    }
    try {
      await new Interp(rt).runList(rt.page.commands);
    } finally {
      rt.locked = false;
      if (rt.kind === "human")
        rt.dir = prevDir === rt.dir ? rt.page.dir || 0 : rt.page.dir || 0;
      refreshAllPages();
      blockingRun = false;
    }
  }

  async function transferPlayer(mapId, x, y, dir) {
    const tr = Plugins.transition;
    if (tr && tr.out) await tr.out();
    else await fadeTo(1, 250);
    await loadMap(mapId);
    const p = G.player;
    p.x = p.tx = x; p.y = p.ty = y; p.rx = x; p.ry = y; p.prx = x; p.pry = y; p.moving = false;
    if (dir != null) p.dir = dir;
    await render();
    if (tr && tr.in) await tr.in();
    else await fadeTo(0, 250);
  }

  // ============================ map scene update ============================
  let globalT = 0;

  function activePlayerControl() {
    return scene === "map" && !UIStack.length && !blockingRun && !menuOpen;
  }

  function update() {
    globalT++;
    if (shakeTimer > 0) shakeTimer--;
    if (flashTimer > 0) flashTimer--;
    const waiters = frameWaiters;
    frameWaiters = [];
    waiters.forEach((r) => r());
    pumpTickTimers(); // advance tick-accurate event timers (wait / camera-zoom)
    if (scene === "map") Plugins.fire("update");
    if (scene !== "map" || menuOpen) return;

    const p = G.player;
    // snapshot start-of-tick positions so render() can interpolate between ticks
    p.prx = p.rx; p.pry = p.ry;
    for (const rt of evRTs) { rt.prx = rt.rx; rt.pry = rt.ry; }
    // player motion — advance the current step, then (if it finished this tick) start the
    // next one immediately, so there's no dead frame at each tile. activePlayerControl()
    // stays false during events/battles, so chaining can't spawn a spurious move.
    if (p.moving) {
      const arrived = updateEntityMotion(p, held.dash ? 0.13 : 0.085);
      if (arrived) onPlayerStep();
    }
    if (!p.moving && p.route) {
      updateRoute(p);
    } else if (!p.moving && activePlayerControl()) {
      const d = held.down ? 0 : held.left ? 1 : held.right ? 2 : held.up ? 3 : -1;
      if (d >= 0) {
        p.dir = d;
        const [dx, dy] = DIRD[d];
        const nx = p.x + dx,
          ny = p.y + dy;
        const blocker = blockingEventAt(nx, ny);
        if (
          blocker &&
          blocker.page.trigger === "touch" &&
          blocker.page.commands.length
        ) {
          runEventBlocking(blocker);
        } else if (tilePassable(nx, ny) && !blocker) {
          startMove(p, d);
          p.animT = p.animT || 0;
        }
      }
      if (okTriggered) checkActionTrigger();
      if (cancelTriggered) {
        cancelTriggered = false;
        okTriggered = false;
        openMenu();
      }
    }
    okTriggered = false;
    cancelTriggered = false;
    if (p.moving) p.animT = (p.animT || 0) + 0; // animT advanced in motion fn

    // events
    for (const rt of evRTs) {
      if (rt.erased || !rt.page) continue;
      // Same no-dead-frame pattern as the player above: a finished step chains into the next
      // route/random step this same tick instead of pausing a frame at each tile.
      if (rt.moving) {
        updateEntityMotion(rt, rt.speed);
      }
      if (!rt.moving && rt.route) {
        updateRoute(rt);
      } else if (!rt.moving && rt.page.moveType === "random" && !rt.locked && !blockingRun) {
        if (--rt.moveT <= 0) {
          rt.moveT = 40 + rnd(100);
          const d = rnd(4);
          if (rnd(4) === 0) rt.dir = d;
          else if (canEntityPass(rt, rt.x + DIRD[d][0], rt.y + DIRD[d][1]))
            startMove(rt, d);
        }
      }
      // autorun / parallel
      if (
        !blockingRun &&
        rt.page.trigger === "auto" &&
        rt.page.commands.length
      ) {
        runEventBlocking(rt);
      }
      if (
        rt.page.trigger === "parallel" &&
        rt.page.commands.length &&
        !parallels.get(rt)
      ) {
        parallels.set(rt, true);
        new Interp(rt).runList(rt.page.commands).finally(async () => {
          await sleep(50);
          parallels.set(rt, false);
        });
      }
    }
  }

  function onPlayerStep() {
    G.steps++;
    const p = G.player;
    // touch events on the tile we stepped onto
    if (!blockingRun) {
      const here = entityAt(p.x, p.y).find(
        (rt) =>
          rt.page.trigger === "touch" &&
          rt.page.commands.length &&
          (rt.page.priority !== "same" || rt.page.through),
      );
      if (here) {
        runEventBlocking(here);
        return;
      }
    }
    // random encounters
    const enc = map.encounters;
    if (enc && enc.rate > 0 && enc.troops.length && !blockingRun) {
      G.encSteps++;
      if (G.encSteps >= enc.rate * (0.7 + Math.random() * 0.6)) {
        G.encSteps = 0;
        const troopId = enc.troops[rnd(enc.troops.length)];
        sysSe("encounter");
        (async () => {
          const result = await Battle.run(troopId, true);
          if (result === "lose") await gameOver();
        })();
      }
    }
  }

  function checkActionTrigger() {
    const p = G.player;
    const [dx, dy] = DIRD[p.dir];
    const spots = [
      [p.x + dx, p.y + dy],
      [p.x, p.y],
    ];
    for (const [x, y] of spots) {
      const rt = entityAt(x, y).find(
        (r) => r.page.trigger === "action" && r.page.commands.length,
      );
      if (rt) {
        runEventBlocking(rt);
        return;
      }
    }
  }

  // ============================ rendering ============================
  async function render() {
    if (!ctx) return;
    if (scene === "title" || scene === "gameover") return; // backdrop persists
    ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
    if (!hdActive || scene !== "map") {
      ctx.fillStyle = "#101018";
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    }
    if (scene !== "map" && scene !== "battle") return;
    if (!map || !G.player) return;
    const p = G.player;
    let shakeX = 0,
      shakeY = 0;
    if (shakeTimer > 0) {
      const freq = shakeSpeed * 0.5;
      const decay = shakeTimer / (shakeDuration || 30);
      const amp = shakePower * 2.5 * decay;
      shakeX = Math.sin(globalT * freq) * amp;
      shakeY = Math.cos(globalT * freq * 0.85) * amp;
    }
    // blend between the previous and current tick by the loop's leftover time, so motion is
    // smooth on any refresh rate. Identity when an entity didn't move (prx == rx).
    const alpha = clamp(loopAcc / TICK_MS, 0, 1);
    const ip = (pv, cv) => (pv == null ? cv : pv + (cv - pv) * alpha);
    const pix = ip(p.prx, p.rx), piy = ip(p.pry, p.ry);
    const viewW = SCREEN_W / cameraZoom, viewH = SCREEN_H / cameraZoom;
    const camX = clamp(pix * TILE + TILE / 2 - viewW / 2, 0, Math.max(0, map.width * TILE - viewW));
    const camY = clamp(piy * TILE + TILE / 2 - viewH / 2, 0, Math.max(0, map.height * TILE - viewH));
    const drawables = [];
    for (const rt of evRTs) {
      if (rt.erased || !rt.page || rt.charsetIdx < 0) continue;
      drawables.push(rt);
    }
    if (!p.transparent) drawables.push(p);
    drawables.sort((a, b) => {
      const pa = a.page ? a.page.priority : "same",
        pb = b.page ? b.page.priority : "same";
      const oa = pa === "below" ? 0 : pa === "above" ? 2 : 1;
      const ob = pb === "below" ? 0 : pb === "above" ? 2 : 1;
      if (oa !== ob) return oa - ob;
      return a.ry - b.ry;
    });
    if (hdActive) {
      const sprites = [];
      for (const d of drawables) {
        const idx = d === p ? p.charsetIdx : d.charsetIdx;
        if (idx < 0) continue;
        const pri = d.page ? d.page.priority : "same";
        sprites.push({
          id: d === p ? "player" : "ev_" + d.ev.id,
          canvas: Assets.charFrameCanvas(idx, d.dir, walkFrame(d)),
          rx: ip(d.prx, d.rx), ry: ip(d.pry, d.ry),
          pr: pri === "below" ? 0 : pri === "above" ? 2 : 1,
        });
      }
      const lights = [];
      // Luzes de eventos
      for (const rt of evRTs) {
        if (rt.light && !rt.erased && rt.page) {
          lights.push({ rx: ip(rt.prx, rt.rx), ry: ip(rt.pry, rt.ry), color: rt.light.color, radius: rt.light.radius });
        }
      }
      // Luzes do mapa
      if (map.lights) {
        for (const l of map.lights) lights.push(l);
      }
      const ambient =
        map.hd2d && map.hd2d.ambient != null ? Number(map.hd2d.ambient) : 0.45;
      await Renderer.renderFrame(SCREEN_W, SCREEN_H, camX, camY, sprites, {
        focus: { rx: pix, ry: piy },
        lights,
        zoom: cameraZoom,
        shakeX,
        shakeY,
        ambient,
        tilePassable,
      });
    }

    if (!hdActive) {
      ctx.save();
      ctx.translate(Math.round(shakeX), Math.round(shakeY));
      ctx.scale(cameraZoom, cameraZoom);
      ctx.drawImage(lowerBuf, -camX, -camY);
      for (const d of drawables) {
        const idx = d === p ? p.charsetIdx : d.charsetIdx;
        Assets.drawChar(ctx, idx, d.dir, walkFrame(d), Math.round(ip(d.prx, d.rx) * TILE - camX), Math.round(ip(d.pry, d.ry) * TILE - 8 - camY));
      }
      ctx.drawImage(upperBuf, -camX, -camY);
      ctx.restore();
    }
    if (flashTimer > 0) {
      const decay = flashTimer / (flashDuration || 15);
      ctx.save();
      ctx.fillStyle = flashColor;
      ctx.globalAlpha = flashOpacity * decay;
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      ctx.restore();
    }
    if (scene === "map") Plugins.fireRender(ctx, {
      w: SCREEN_W, h: SCREEN_H, t: globalT, map: map,
      camX: camX, camY: camY, cameraZoom: cameraZoom,
      playerX: pix, playerY: piy, alpha: alpha, // interpolated player pos + blend factor
    });
  }

  // Fixed-timestep loop: update() runs at a steady 60 ticks/sec regardless of refresh rate,
  // render() once per frame (every frame, at full refresh). Keeps the tick-based engine in
  // sync without per-system delta time, and stops fast displays from running in fast-forward.
  // render() is async (PIXI HD-2D path), so we await it to avoid overlapping frames.

  let loopLast = 0, loopAcc = 0;
  const TICK_MS = 1000 / 60;
  async function loop(now) {
    if (loopLast === 0) loopLast = now;   // first frame: establish baseline, no delta
    loopAcc += now - loopLast;
    loopLast = now;
    if (loopAcc > 250) loopAcc = 250;     // clamp after a stall / tab switch (avoid spiral)
    while (loopAcc >= TICK_MS) { update(); loopAcc -= TICK_MS; }
    await render();
    requestAnimationFrame(loop);
  }

  // ============================ menus ============================
  function bar(cur, max, color) {
    const pct = max > 0 ? clamp((cur / max) * 100, 0, 100) : 0;
    return (
      '<span class="bar"><span class="bar-fill" style="width:' +
      pct +
      "%;background:" +
      color +
      '"></span></span>'
    );
  }
  function iconEntryHtml(entry, text) {
    return (
      Assets.iconHtml(entry && entry.icon, "menu-icon") +
      (text == null ? esc(entry.name) : text)
    );
  }
  function actorRowHTML(a) {
    const cls = actorClass(a);
    return (
      '<div class="arow"><span class="aface"></span><div class="ainfo">' +
      Assets.iconHtml(cls && cls.icon, "menu-icon") +
      "<b>" +
      esc(a.name) +
      '</b> <span class="lv">' +
      esc(cls ? cls.name : "") +
      " · Lv " +
      a.level +
      "</span><br>" +
      "HP " +
      a.hp +
      "/" +
      param(a, "mhp") +
      " " +
      bar(a.hp, param(a, "mhp"), "#58c46a") +
      "<br>" +
      "MP " +
      a.mp +
      "/" +
      param(a, "mmp") +
      " " +
      bar(a.mp, param(a, "mmp"), "#5a8ad8") +
      "</div></div>"
    );
  }
  function attachFaces(container, actors) {
    const slots = container.querySelectorAll(".aface");
    actors.forEach((a, i) => {
      if (!slots[i]) return;
      const ci = Assets.charsetIndex(a.charset);
      if (ci >= 0) slots[i].appendChild(Assets.faceCanvas(ci));
    });
  }

  async function pickPartyMember(title) {
    const i = await showList(
      G.party.map((a) => ({ html: actorRowHTML(a) })),
      { title, className: "partywin" },
    );
    return i < 0 ? null : G.party[i];
  }
  const journalView = window.RPGAtlasJournalView.create({
    el,
    esc,
    pushUI,
    removeUI,
    sysSe,
    appendUI: (node) => uiLayer.appendChild(node),
    showMessage: (...args) => showMessage(...args),
    getProj: () => proj,
    questState,
    Quests,
  });
  async function menuJournal() {
    return journalView.open();
  }

  async function openMenu() {
    if (menuOpen || blockingRun) return;
    menuOpen = true;
    sysSe("ok");
    const panel = el("div", "win menupanel");
    const partyBox = el("div", "menu-party");
    panel.appendChild(partyBox);
    const goldBox = el("div", "menu-gold");
    panel.appendChild(goldBox);
    uiLayer.appendChild(panel);
    function refreshPanel() {
      partyBox.innerHTML = G.party.map(actorRowHTML).join("");
      attachFaces(partyBox, G.party);
      goldBox.textContent = G.gold + " " + proj.system.currency;
    }
    try {
      let idx = 0;
      while (true) {
        refreshPanel();
        const i = await showList(
          [            
            { html: Assets.iconHtml(24, "menu-icon") + "Items" },
            { html: Assets.iconHtml(8, "menu-icon") + "Skills" },
            { html: Assets.iconHtml(48, "menu-icon") + "Equip" },
            {
              html:
                Assets.iconHtml(
                  (actorClass(G.party[0]) || {}).icon,
                  "menu-icon",
                ) + "Status",
            },
            { html: Assets.iconHtml(16, "menu-icon") + "Journal" },
            { html: Assets.iconHtml(44, "menu-icon") + "Save" },
            { html: Assets.iconHtml(45, "menu-icon") + "Load" },
            { html: Assets.iconHtml(47, "menu-icon") + "To Title" },
          ],
          { className: "mainmenu", start: idx },
        );
        if (i < 0) break;
        idx = i;
        
        if (i === 0) {
          await menuItems();
        } else if (i === 1) {
          await menuSkills();
        } else if (i === 2) {
          await menuEquip();
        } else if (i === 3) {
          await menuStatus();
        } else if (i === 4) {
          panel.style.display = "none";
          try {
            if (await menuJournal() === "close") return;
          } finally {
            panel.style.display = "";
          }
        } else if (i === 5) {
          await saveLoadMenu("save");
        } else if (i === 6) {
          if (await saveLoadMenu("load")) break;
        } else if (i === 7) {
          const c = await showList(
            [{ label: "Return to title" }, { label: "Cancel" }],
            { className: "choicewin" },
          );
          if (c === 0) {
            panel.remove();
            menuOpen = false;
            await toTitle();
            return;
          }
        }
      }
    } finally {
      panel.remove();
      menuOpen = false;
    }
  }

  async function menuItems() {
    while (true) {
      const list = proj.items.filter((it) => invCount("item", it.id) > 0);
      if (!list.length) {
        await showMessage("", "You have no items.");
        return;
      }
      const i = await showList(
        list.map((it) => ({
          html:
            iconEntryHtml(it) +
            ' <span class="cnt">×' +
            invCount("item", it.id) +
            "</span>",
          help: it.desc || "",
        })),
        { title: "Items", className: "itemwin" },
      );
      if (i < 0) return;
      const it = list[i];
      const target = await pickPartyMember("Use on…");
      if (!target) continue;
      useItemOn(it, target);
    }
  }
  function useItemOn(it, target) {
    if (it.hp) target.hp = clamp(target.hp + it.hp, 0, param(target, "mhp"));
    if (it.mp) target.mp = clamp(target.mp + it.mp, 0, param(target, "mmp"));
    sysSe("heal");
    addInv("item", it.id, -1);
  }

  async function menuSkills() {
    const a = await pickPartyMember("Whose skills?");
    if (!a) return;
    while (true) {
      const skills = learnedSkills(a);
      if (!skills.length) {
        await showMessage("", a.name + " knows no skills.");
        return;
      }
      const i = await showList(
        skills.map((s) => ({
          html:
            iconEntryHtml(s) +
            ' <span class="cnt">' +
            skillMpCost(a, s) +
            " MP</span>",
          disabled: s.type !== "heal" || a.mp < skillMpCost(a, s),
          help: s.type === "heal" ? "Restores HP." : "Usable in battle only.",
        })),
        { title: a.name + "'s Skills", className: "itemwin" },
      );
      if (i < 0) return;
      const s = skills[i];
      const target = await pickPartyMember("Heal whom?");
      if (!target) continue;
      a.mp -= skillMpCost(a, s);
      const amount = Math.max(
        1,
        Math.floor((s.power + param(a, "mat") * 1.2) * skillPowerRate(a, s)),
      );
      target.hp = clamp(target.hp + amount, 0, param(target, "mhp"));
      sysSe("heal");
    }
  }

  async function menuEquip() {
    const a = await pickPartyMember("Equip whom?");
    if (!a) return;
    while (true) {
      const w = RA.byId(proj.weapons, a.weaponId),
        ar = RA.byId(proj.armors, a.armorId);
      const slot = await showList(
        [
          {
            html: iconEntryHtml(
              w || { icon: 48 },
              "Weapon: <b>" + esc(w ? w.name : "—") + "</b>",
            ),
          },
          {
            html: iconEntryHtml(
              ar || { icon: 56 },
              "Armor: <b>" + esc(ar ? ar.name : "—") + "</b>",
            ),
          },
        ],
        {
          title:
            a.name +
            " — ATK " +
            param(a, "atk") +
            " / DEF " +
            param(a, "def") +
            " / MAT " +
            param(a, "mat"),
          className: "itemwin",
        },
      );
      if (slot < 0) return;
      const kind = slot === 0 ? "weapon" : "armor";
      const db = dbFor(kind);
      const candidates = db.filter((e) => invCount(kind, e.id) > 0);
      const opts = candidates.map((e) => ({
        html:
          iconEntryHtml(e) +
          ' <span class="cnt">' +
          Object.entries(e.params || {})
            .map(([k, v]) => k.toUpperCase() + "+" + v)
            .join(" ") +
          "</span>",
        disabled: !canActorEquip(a, kind, e.id),
        help: canActorEquip(a, kind, e.id)
          ? ""
          : actorClass(a).name + " cannot equip this item.",
      }));
      opts.push({ label: "(Remove)" });
      const ci = await showList(opts, {
        title: "Equip " + kind,
        className: "itemwin",
      });
      if (ci < 0) continue;
      const cur = kind === "weapon" ? a.weaponId : a.armorId;
      if (cur) addInv(kind, cur, 1);
      const next = ci < candidates.length ? candidates[ci].id : 0;
      if (next) addInv(kind, next, -1);
      if (kind === "weapon") a.weaponId = next;
      else a.armorId = next;
      sysSe("equip");
      a.hp = Math.min(a.hp, param(a, "mhp"));
      a.mp = Math.min(a.mp, param(a, "mmp"));
    }
  }

  async function menuStatus() {
    const a = await pickPartyMember("Status of…");
    if (!a) return;
    const c = actorClass(a);
    const next = expForLevel(a.level + 1) - a.exp;
    const stats = ["mhp", "mmp", "atk", "def", "mat", "mdf", "agi"]
      .map(
        (s) =>
          "<tr><td>" +
          s.toUpperCase() +
          "</td><td>" +
          param(a, s) +
          "</td></tr>",
      )
      .join("");
    const traits = (c.traits || []).map(traitDescription);
    await showList(
      [
        {
          html:
            Assets.iconHtml(c.icon, "menu-icon") +
            "<b>" +
            esc(a.name) +
            "</b> — " +
            esc(c.name) +
            " Lv " +
            a.level +
            "<br>EXP " +
            a.exp +
            " (next in " +
            next +
            ")" +
            '<table class="stats">' +
            stats +
            "</table>" +
            "Skills: " +
            (learnedSkills(a)
              .map((s) => esc(s.name))
              .join(", ") || "none") +
            "<br>Traits: " +
            (traits.map(esc).join(" · ") || "none"),
        },
      ],
      { title: "Status", className: "statuswin" },
    );
  }

  // ---- save / load ----
  function saveKey(slot) {
    const gameId = window.RPGATLAS_GAME_ID;
    return gameId
      ? "rpgatlas_" + gameId + "_save_" + slot
      : "rpgatlas_save_" + slot;
  }
  function slotInfo(slot) {
    try {
      const raw =
        localStorage.getItem(saveKey(slot)) ||
        localStorage.getItem(saveKey(slot).replace(/^rpgatlas/, "driftwood")); // pre-rebrand saves
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  async function saveLoadMenu(mode) {
    const slots = [1, 2, 3];
    const i = await showList(
      slots.map((s) => {
        const info = slotInfo(s);
        return {
          html:
            "<b>Slot " +
            s +
            "</b> — " +
            (info
              ? esc(info.mapName) +
                " · Lv " +
                info.level +
                " · " +
                new Date(info.ts).toLocaleString()
              : "(empty)"),
          disabled: mode === "load" && !info,
        };
      }),
      {
        title: mode === "save" ? "Save Game" : "Load Game",
        className: "savewin",
      },
    );
    if (i < 0) return false;
    const slot = slots[i];
    if (mode === "save") {
      const payload = {
        ts: Date.now(),
        mapName: map ? map.name : "",
        level: G.party[0] ? G.party[0].level : 1,
        data: {
          switches: G.switches,
          vars: G.vars,
          selfSw: G.selfSw,
          quests: G.quests,
          party: G.party,
          inv: G.inv,
          gold: G.gold,
          steps: G.steps,
          cameraZoom: cameraZoom,
          mapId: G.mapId,
          player: {
            x: G.player.x,
            y: G.player.y,
            dir: G.player.dir,
            transparent: !!G.player.transparent,
          },
        },
      };
      localStorage.setItem(saveKey(slot), JSON.stringify(payload));
      sysSe("save");
      await showMessage("", "Game saved to slot " + slot + ".");
      return false;
    } else {
      const info = slotInfo(slot);
      if (!info) return false;
      await applySave(info.data);
      sysSe("save");
      return true;
    }
  }
  async function applySave(d) {
    G.switches = d.switches || {};
    G.vars = d.vars || {};
    G.selfSw = d.selfSw || {};
    G.quests = d.quests || {};
    G.party = d.party || [];
    G.inv = d.inv || { item: {}, weapon: {}, armor: {} };
    G.party.forEach((a) => {
      sanitizeEquipment(a);
      a.hp = Math.min(a.hp, param(a, "mhp"));
      a.mp = Math.min(a.mp, param(a, "mmp"));
    });
    G.gold = d.gold || 0;
    G.steps = d.steps || 0;
    cameraZoom = clamp(Number(d.cameraZoom) || 1, 0.25, 4);
    initPlayer(d.player.x, d.player.y, d.player.dir);
    G.player.transparent = !!d.player.transparent;
    await loadMap(d.mapId);
    scene = "map";
  }

  // ============================ shop ============================
  const Shop = {
    async run(goods) {
      const goldLine = () => "Gold: " + G.gold + " " + proj.system.currency;
      while (true) {
        const i = await showList(
          [{ label: "Buy" }, { label: "Sell" }, { label: "Leave" }],
          { title: "Shop — " + goldLine(), className: "shopwin" },
        );
        if (i < 0 || i === 2) return;
        if (i === 0) {
          while (true) {
            const entries = goods
              .map((gd) => ({ gd, e: RA.byId(dbFor(gd.kind), gd.id) }))
              .filter((x) => x.e);
            const bi = await showList(
              entries.map(({ gd, e }) => ({
                html:
                  iconEntryHtml(e) +
                  ' <span class="cnt">' +
                  e.price +
                  " " +
                  proj.system.currency +
                  " · own ×" +
                  invCount(gd.kind, gd.id) +
                  "</span>",
                disabled: G.gold < e.price || invCount(gd.kind, gd.id) >= 99,
                help:
                  e.desc ||
                  (e.params
                    ? Object.entries(e.params)
                        .map(([k, v]) => k.toUpperCase() + "+" + v)
                        .join(" ")
                    : ""),
              })),
              { title: "Buy — " + goldLine(), className: "shopwin" },
            );
            if (bi < 0) break;
            const { gd, e } = entries[bi];
            G.gold -= e.price;
            addInv(gd.kind, gd.id, 1);
            sysSe("equip");
          }
        } else {
          while (true) {
            const owned = [];
            for (const kind of ["item", "weapon", "armor"]) {
              for (const idStr of Object.keys(G.inv[kind])) {
                const e = RA.byId(dbFor(kind), +idStr);
                if (e) owned.push({ kind, e });
              }
            }
            if (!owned.length) {
              await showMessage("", "Nothing to sell.");
              break;
            }
            const si = await showList(
              owned.map(({ kind, e }) => ({
                html:
                  iconEntryHtml(e) +
                  ' <span class="cnt">×' +
                  invCount(kind, e.id) +
                  " · " +
                  Math.floor(e.price / 2) +
                  " " +
                  proj.system.currency +
                  "</span>",
              })),
              { title: "Sell — " + goldLine(), className: "shopwin" },
            );
            if (si < 0) break;
            const { kind, e } = owned[si];
            addInv(kind, e.id, -1);
            G.gold = clamp(G.gold + Math.floor(e.price / 2), 0, 9999999);
            sysSe("equip");
          }
        }
      }
    },
  };

  // ============================ battle ============================
  const Battle = {
    async run(troopId, canEscape) {
      const troop = RA.byId(proj.troops, troopId);
      if (!troop) return "win";
      const prevScene = scene,
        prevMusic = Music.current;
      scene = "battle";
      Music.play(sysBgm("battle"));

      const enemies = troop.enemies
        .map((eid, i) => {
          const d = RA.byId(proj.enemies, eid);
          return d ? { d, hp: d.stats.mhp, i, alive: true } : null;
        })
        .filter(Boolean);

      const sideView = proj.system.battleView === "side";
      const win = el("div", "battlewin" + (sideView ? " side" : ""));
      const fxLayer = el("div", "battle-fx");
      const enemyArea = el("div", "battle-enemies");
      const log = el("div", "battle-log");
      const partyArea = el("div", "battle-party");
      win.appendChild(fxLayer);
      if (sideView) {
        const fieldRow = el("div", "battle-field");
        fieldRow.appendChild(enemyArea);
        win.appendChild(fieldRow);
      } else {
        win.appendChild(enemyArea);
      }
      win.appendChild(log);
      win.appendChild(partyArea);
      uiLayer.appendChild(win);

      const sprs = enemies.map((en) => {
        const spriteClass = String(en.d.sprite || "slime").replace(
          /[^a-z0-9_-]/gi,
          "-",
        );
        const wrap = el("div", "enemy-spr enemy-" + spriteClass);
        const source = Assets.enemyCanvas(
          en.d.sprite,
          en.d.color,
          sideView ? 108 : 132,
        );
        const battlerCanvas = document.createElement("canvas");
        battlerCanvas.width = source.width;
        battlerCanvas.height = source.height;
        battlerCanvas.getContext("2d").drawImage(source, 0, 0);
        wrap.appendChild(battlerCanvas);
        wrap.appendChild(el("div", "enemy-name", esc(en.d.name)));
        wrap.appendChild(el("div", "battler-states"));
        enemyArea.appendChild(wrap);
        return wrap;
      });
      // side view: the party stands on the right, facing the enemies
      let actorSprs = [];
      if (sideView) {
        const actorArea = el("div", "battle-actors");
        win.querySelector(".battle-field").appendChild(actorArea);
        actorSprs = G.party.map((a) => {
          const wrap = el("div", "actor-spr");
          const ci = Assets.charsetIndex(a.charset);
          if (ci >= 0) {
            // copy the cached frame — the cache canvas itself must stay off-DOM
            const c = document.createElement("canvas");
            c.width = c.height = TILE;
            c.getContext("2d").drawImage(
              Assets.charFrameCanvas(ci, 1, 1),
              0,
              0,
            ); // facing left
            wrap.appendChild(c);
          }
          wrap.appendChild(el("div", "actor-name", esc(a.name)));
          wrap.appendChild(el("div", "battler-states"));
          actorArea.appendChild(wrap);
          return wrap;
        });
      }
      // Battle effects use a fixed pool so repeated multi-target skills do not
      // continually allocate and discard DOM nodes.
      const particlePool = Array.from({ length: 84 }, () => {
        const p = el("i", "fx-particle");
        p._busy = false;
        fxLayer.appendChild(p);
        return p;
      });
      function takeParticle(cls) {
        const p = particlePool.find((node) => !node._busy) || particlePool[0];
        p.getAnimations().forEach((a) => a.cancel());
        p._busy = true;
        p.className = "fx-particle " + (cls || "");
        p.style.cssText = "";
        return p;
      }
      function releaseParticle(p) {
        p._busy = false;
        p.className = "fx-particle";
        p.style.cssText = "";
        p.textContent = "";
      }
      function fxPoint(target) {
        const wr = win.getBoundingClientRect();
        if (!target) return { x: wr.width * 0.5, y: wr.height * 0.42 };
        const r = target.getBoundingClientRect();
        return {
          x: r.left - wr.left + r.width * 0.5,
          y: r.top - wr.top + r.height * 0.43,
        };
      }
      function actorElement(a) {
        const i = G.party.indexOf(a);
        return actorSprs[i] || partyArea.children[i] || partyArea;
      }
      function battlerElement(b) {
        return b && b.d ? sprs[b.i] : actorElement(b);
      }
      function burst(target, kind, opts) {
        opts = opts || {};
        const pt = fxPoint(target);
        const colors = {
          hit: ["#fff4cf", "#ffc85a", "#ef694f"],
          crit: ["#ffffff", "#ffe45c", "#ff6b45"],
          fire: ["#fff08a", "#ff9d36", "#e84931"],
          ice: ["#eaffff", "#8edcff", "#5b8cff"],
          thunder: ["#ffffff", "#fff36b", "#77dfff"],
          heal: ["#efffcf", "#79e8a2", "#42cfd0"],
          poison: ["#e5a2ff", "#9c54cf", "#5d338d"],
          status: ["#ffffff", "#d6a3ff", "#8f72e6"],
          death: ["#ffffff", "#9ea8c4", "#4c526b"],
          item: ["#ffffff", "#8edfff", "#ffd76d"],
          dust: ["#d8c39d", "#a88d67", "#73624f"],
        };
        const palette = colors[kind] || [opts.color || "#ffffff"];
        const count =
          opts.count || (kind === "crit" || kind === "death" ? 18 : 11);
        for (let i = 0; i < count; i++) {
          const p = takeParticle("fx-" + kind);
          const angle = Math.random() * Math.PI * 2;
          const distance = (opts.radius || 42) * (0.45 + Math.random() * 0.7);
          const dx = Math.cos(angle) * distance;
          const dy = Math.sin(angle) * distance - (kind === "heal" ? 20 : 0);
          const size = (opts.size || 7) * (0.65 + Math.random() * 0.7);
          p.style.left = pt.x + "px";
          p.style.top = pt.y + "px";
          p.style.width = size + "px";
          p.style.height = size + "px";
          p.style.background = opts.color || palette[i % palette.length];
          p.style.boxShadow =
            "0 0 " + Math.ceil(size * 1.8) + "px currentColor";
          const anim = p.animate(
            [
              {
                opacity: 0,
                transform: "translate(-50%,-50%) scale(0.2) rotate(0deg)",
              },
              { opacity: 1, offset: 0.18 },
              {
                opacity: 0,
                transform:
                  "translate(calc(-50% + " +
                  dx +
                  "px),calc(-50% + " +
                  dy +
                  "px)) scale(0.05) rotate(" +
                  (180 + rnd(220)) +
                  "deg)",
              },
            ],
            {
              duration: opts.duration || 470,
              easing: "cubic-bezier(.18,.75,.25,1)",
            },
          );
          anim.finished
            .then(() => releaseParticle(p))
            .catch(() => releaseParticle(p));
        }
      }
      function floatText(target, text, kind) {
        const p = takeParticle(
          "fx-number " + (kind ? "fx-number-" + kind : ""),
        );
        const pt = fxPoint(target);
        p.textContent = text;
        p.style.left = pt.x + "px";
        p.style.top = pt.y - 12 + "px";
        const anim = p.animate(
          [
            { opacity: 0, transform: "translate(-50%,0) scale(.65)" },
            {
              opacity: 1,
              transform: "translate(-50%,-12px) scale(1.12)",
              offset: 0.2,
            },
            {
              opacity: 1,
              transform: "translate(-50%,-28px) scale(1)",
              offset: 0.72,
            },
            { opacity: 0, transform: "translate(-50%,-48px) scale(.9)" },
          ],
          { duration: 720, easing: "ease-out" },
        );
        anim.finished
          .then(() => releaseParticle(p))
          .catch(() => releaseParticle(p));
      }
      function pulse(kind, color) {
        const p = takeParticle("fx-pulse fx-" + kind);
        p.style.left = "50%";
        p.style.top = "43%";
        p.style.borderColor = color || "#ffffff";
        const anim = p.animate(
          [
            { opacity: 0.8, transform: "translate(-50%,-50%) scale(.1)" },
            { opacity: 0, transform: "translate(-50%,-50%) scale(8)" },
          ],
          { duration: 440, easing: "ease-out" },
        );
        anim.finished
          .then(() => releaseParticle(p))
          .catch(() => releaseParticle(p));
      }
      function skillKind(skill) {
        if (!skill) return "hit";
        const name = String(skill.name || "").toLowerCase();
        if (skill.type === "heal") return "heal";
        if (skill.type === "phys") return "crit";
        if (name.includes("fire") || name.includes("ember")) return "fire";
        if (name.includes("ice")) return "ice";
        if (name.includes("thunder") || name.includes("static"))
          return "thunder";
        if (
          name.includes("venom") ||
          name.includes("spore") ||
          skill.stateId === 1
        )
          return "poison";
        return "status";
      }
      async function travel(source, target, skill) {
        if (!skill || skill.type === "phys" || skill.type === "heal") return;
        const from = fxPoint(source),
          to = fxPoint(target);
        const p = takeParticle("fx-projectile fx-" + skillKind(skill));
        p.style.left = from.x + "px";
        p.style.top = from.y + "px";
        p.style.background = skill.color || "#ffffff";
        const anim = p.animate(
          [
            { opacity: 0, transform: "translate(-50%,-50%) scale(.4)" },
            { opacity: 1, offset: 0.12 },
            {
              opacity: 1,
              transform:
                "translate(calc(-50% + " +
                (to.x - from.x) +
                "px),calc(-50% + " +
                (to.y - from.y) +
                "px)) scale(1.3)",
              offset: 0.88,
            },
            {
              opacity: 0,
              transform:
                "translate(calc(-50% + " +
                (to.x - from.x) +
                "px),calc(-50% + " +
                (to.y - from.y) +
                "px)) scale(2)",
            },
          ],
          { duration: 330, easing: "cubic-bezier(.2,.7,.3,1)" },
        );
        await anim.finished.catch(() => {});
        releaseParticle(p);
      }
      function castFx(source, skill, targetCount) {
        const kind = skillKind(skill);
        burst(source, kind, {
          count: 8,
          radius: 30,
          color: skill && skill.color,
        });
        if (targetCount > 1) pulse(kind, skill && skill.color);
      }
      function refreshParty() {
        partyArea.innerHTML = G.party
          .map(
            (a) =>
              '<div class="brow' +
              (a.hp <= 0 ? " dead" : "") +
              '"><b>' +
              esc(a.name) +
              "</b> " +
              "HP " +
              a.hp +
              "/" +
              param(a, "mhp") +
              " " +
              bar(a.hp, param(a, "mhp"), "#58c46a") +
              " MP " +
              a.mp +
              "/" +
              param(a, "mmp") +
              " " +
              bar(a.mp, param(a, "mmp"), "#5a8ad8") +
              stateTagsHtml(a) +
              "</div>",
          )
          .join("");
        actorSprs.forEach((w, i) => {
          const a = G.party[i];
          if (a) w.classList.toggle("dead", a.hp <= 0);
        });
      }
      function refreshEnemies() {
        enemies.forEach((en, i) => {
          sprs[i].classList.toggle("dead", !en.alive);
        });
      }
      async function say(text, ms) {
        log.textContent = text;
        await sleep(ms == null ? 650 : ms);
      }
      function flash(i) {
        sprs[i].classList.remove("flash");
        void sprs[i].offsetWidth;
        sprs[i].classList.add("flash");
      }
      const livingE = () => enemies.filter((e) => e.alive);
      const livingP = () => G.party.filter((a) => a.hp > 0);
      function variance(v) {
        return Math.max(1, Math.floor(v * (0.85 + Math.random() * 0.3)));
      }

      async function pickTarget() {
        const live = livingE();
        if (live.length === 1) return live[0];
        const i = await showList(
          live.map((en) => ({ label: en.d.name + "  (HP " + en.hp + ")" })),
          { className: "targetwin" },
        );
        return i < 0 ? null : live[i];
      }
      async function pickAlly(deadOk) {
        const pool = deadOk ? G.party : livingP();
        const i = await showList(
          pool.map((a) => ({ label: a.name + "  (HP " + a.hp + ")" })),
          { className: "targetwin" },
        );
        return i < 0 ? null : pool[i];
      }

      async function actorCommand(a) {
        while (true) {
          const items = [
            { html: Assets.iconHtml(48, "menu-icon") + "Attack" },
            {
              html: Assets.iconHtml(8, "menu-icon") + "Skills",
              disabled: !learnedSkills(a).length,
            },
            {
              html: Assets.iconHtml(24, "menu-icon") + "Items",
              disabled: !proj.items.some((it) => invCount("item", it.id) > 0),
            },
            { html: Assets.iconHtml(22, "menu-icon") + "Guard" },
            {
              html: Assets.iconHtml(7, "menu-icon") + "Escape",
              disabled: !canEscape,
            },
          ];
          const i = await showList(items, {
            title: a.name,
            className: "cmdwin",
            cancellable: false,
          });
          if (i === 0) {
            const t = await pickTarget();
            if (t) return { type: "attack", target: t };
          } else if (i === 1) {
            const skills = learnedSkills(a);
            const si = await showList(
              skills.map((s) => ({
                html:
                  iconEntryHtml(s) +
                  ' <span class="cnt">' +
                  skillMpCost(a, s) +
                  " MP</span>",
                disabled: a.mp < skillMpCost(a, s),
              })),
              { title: "Skill", className: "cmdwin" },
            );
            if (si < 0) continue;
            const s = skills[si];
            if (s.scope === "enemy") {
              const t = await pickTarget();
              if (t) return { type: "skill", skill: s, target: t };
            } else if (s.scope === "ally") {
              const t = await pickAlly(false);
              if (t) return { type: "skill", skill: s, target: t };
            } else {
              return { type: "skill", skill: s };
            }
          } else if (i === 2) {
            const list = proj.items.filter((it) => invCount("item", it.id) > 0);
            const ii = await showList(
              list.map((it) => ({
                html:
                  iconEntryHtml(it) +
                  ' <span class="cnt">×' +
                  invCount("item", it.id) +
                  "</span>",
              })),
              { title: "Item", className: "cmdwin" },
            );
            if (ii < 0) continue;
            const t = await pickAlly(false);
            if (t) return { type: "item", item: list[ii], target: t };
          } else if (i === 3) {
            return { type: "guard" };
          } else if (i === 4) {
            return { type: "escape" };
          }
        }
      }

      function enemyAction(en) {
        const acts =
          en.d.actions && en.d.actions.length
            ? en.d.actions
            : [{ skillId: 0, weight: 1 }];
        let total = acts.reduce((s, a2) => s + (a2.weight || 1), 0);
        let roll = Math.random() * total;
        let chosen = acts[0];
        for (const a2 of acts) {
          roll -= a2.weight || 1;
          if (roll <= 0) {
            chosen = a2;
            break;
          }
        }
        const skill = chosen.skillId
          ? RA.byId(proj.skills, chosen.skillId)
          : null;
        return { type: skill ? "skill" : "attack", skill, enemy: en };
      }

      async function dealToEnemy(en, dmg, idx, kind) {
        const target = sprs[idx];
        const wasAlive = en.alive;
        en.hp -= dmg;
        flash(idx);
        burst(target, kind || "hit", {
          color: kind === "poison" ? "#a050d8" : null,
        });
        floatText(target, "-" + dmg, kind === "crit" ? "crit" : "damage");
        if (en.hp <= 0) {
          en.hp = 0;
          en.alive = false;
        }
        refreshEnemies();
        if (wasAlive && !en.alive) {
          onEnemyKilled(en.d.id);
          burst(target, "death", { count: 22, radius: 62, duration: 650 });
          floatText(target, "DEFEATED", "death");
        }
      }
      function actorDef(a) {
        return param(a, "def");
      }

      // ---- states (poison / stun / regen…) ----
      const stateDef = (id) => RA.byId(proj.states || [], id);
      const statesOf = (b) => b.states || (b.states = []);
      const isEnemy = (b) => !!b.d;
      const nameOf = (b) => (isEnemy(b) ? b.d.name : b.name);
      const maxHpOf = (b) => (isEnemy(b) ? b.d.stats.mhp : param(b, "mhp"));
      const aliveB = (b) => (isEnemy(b) ? b.alive : b.hp > 0);
      function cannotAct(b) {
        return statesOf(b).some((st) => {
          const d = stateDef(st.id);
          return d && d.restrict === "act";
        });
      }
      function stateTagsHtml(b) {
        return statesOf(b)
          .map((st) => {
            const d = stateDef(st.id);
            return d
              ? ' <span class="state-tag" style="color:' +
                  esc(d.color || "#e8e8f4") +
                  '">' +
                  esc(d.name) +
                  "</span>"
              : "";
          })
          .join("");
      }
      function refreshStates() {
        enemies.forEach((en, i) => {
          const slot = sprs[i].querySelector(".battler-states");
          if (slot) slot.innerHTML = stateTagsHtml(en);
        });
        actorSprs.forEach((w, i) => {
          const a = G.party[i],
            slot = w.querySelector(".battler-states");
          if (a && slot) slot.innerHTML = stateTagsHtml(a);
        });
        refreshParty();
      }
      async function addStateTo(b, stateId) {
        const d = stateDef(stateId);
        if (!d || !aliveB(b)) return;
        const min = Math.max(1, d.minTurns || 1);
        const max = Math.max(min, d.maxTurns || min);
        const turns = min + rnd(max - min + 1);
        const list = statesOf(b);
        const ex = list.find((st) => st.id === stateId);
        if (ex) ex.turns = Math.max(ex.turns, turns);
        else list.push({ id: stateId, turns });
        burst(battlerElement(b), stateId === 1 ? "poison" : "status", {
          color: d.color,
        });
        floatText(battlerElement(b), d.name.toUpperCase(), "state");
        refreshStates();
        await say(nameOf(b) + " is afflicted by " + d.name + "!", 600);
      }
      async function removeStateFrom(b, stateId) {
        const d = stateDef(stateId);
        const list = statesOf(b);
        const i = list.findIndex((st) => st.id === stateId);
        if (i < 0) return;
        list.splice(i, 1);
        burst(battlerElement(b), "heal", { color: d && d.color, count: 8 });
        refreshStates();
        if (d) await say(nameOf(b) + " is cured of " + d.name + ".", 600);
      }
      // roll a skill's state effect against a target
      async function applySkillState(skill, target) {
        if (!skill || !skill.stateId || !aliveB(target)) return;
        if (skill.stateOp === "remove") {
          await removeStateFrom(target, skill.stateId);
          return;
        }
        let chance = skill.stateChance == null ? 100 : skill.stateChance;
        if (!isEnemy(target))
          chance *= RA.traitRate(
            actorClass(target),
            "state",
            String(skill.stateId),
            1,
          );
        if (rnd(100) < chance) await addStateTo(target, skill.stateId);
      }
      // end-of-round damage/regen ticks and turn-count expiry
      async function tickStates() {
        for (const b of [...livingP(), ...livingE()]) {
          for (const st of statesOf(b).slice()) {
            const d = stateDef(st.id);
            const list = statesOf(b);
            if (!d) {
              list.splice(list.indexOf(st), 1);
              continue;
            }
            if (d.hpTurn && aliveB(b)) {
              let amt = Math.max(
                1,
                Math.floor((maxHpOf(b) * Math.abs(d.hpTurn)) / 100),
              );
              if (d.hpTurn < 0) {
                if (isEnemy(b))
                  await dealToEnemy(b, amt, b.i, d.id === 1 ? "poison" : "hit");
                else {
                  const tickElement = d.id === 1 ? "poison" : "magic";
                  amt = Math.max(
                    1,
                    Math.floor(amt * actorIncomingRate(b, tickElement, false)),
                  );
                  b.hp = Math.max(0, b.hp - amt);
                  actorFlash(b);
                  burst(battlerElement(b), d.id === 1 ? "poison" : "hit", {
                    color: d.color,
                  });
                  floatText(battlerElement(b), "-" + amt, "damage");
                }
                await say(
                  nameOf(b) + " takes " + amt + " damage from " + d.name + "!",
                  550,
                );
                if (isEnemy(b) && !b.alive)
                  await say(b.d.name + " is defeated!", 450);
                if (!isEnemy(b) && b.hp <= 0)
                  await say(b.name + " falls!", 500);
              } else {
                b.hp = Math.min(maxHpOf(b), b.hp + amt);
                burst(battlerElement(b), "heal", { color: d.color });
                floatText(battlerElement(b), "+" + amt, "heal");
                await say(
                  nameOf(b) + " recovers " + amt + " HP from " + d.name + "!",
                  550,
                );
              }
              refreshParty();
              refreshEnemies();
            }
            st.turns--;
            if (st.turns <= 0) {
              list.splice(list.indexOf(st), 1);
              await say(nameOf(b) + "'s " + d.name + " wore off.", 500);
            }
          }
        }
        refreshStates();
      }
      // ---- side-view battler animations ----
      function actorFlash(a) {
        const w = actorSprs[G.party.indexOf(a)];
        if (!w) return;
        w.classList.remove("hurt");
        void w.offsetWidth;
        w.classList.add("hurt");
      }
      function actorStep(a) {
        const w = actorSprs[G.party.indexOf(a)];
        if (!w) return;
        w.classList.add("acting");
        burst(w, "dust", { count: 5, radius: 20, size: 5, duration: 330 });
        setTimeout(() => w.classList.remove("acting"), 380);
      }
      function enemyStep(en) {
        if (!sideView || !sprs[en.i]) return;
        sprs[en.i].classList.add("acting");
        burst(sprs[en.i], "dust", {
          count: 5,
          radius: 20,
          size: 5,
          duration: 330,
        });
        setTimeout(() => sprs[en.i].classList.remove("acting"), 380);
      }

      let result = null;
      try {
        await say("Enemies appear!", 700);
        battleLoop: while (true) {
          refreshParty();
          refreshEnemies();
          // ---- collect party commands ----
          const cmds = [];
          for (const a of livingP()) {
            refreshParty();
            if (cannotAct(a)) {
              cmds.push({ type: "stunned", actor: a });
              continue;
            }
            const c = await actorCommand(a);
            c.actor = a;
            if (c.type === "escape") {
              const pa =
                livingP().reduce((s, x) => s + param(x, "agi"), 0) /
                livingP().length;
              const ea =
                livingE().reduce((s, x) => s + x.d.stats.agi, 0) /
                livingE().length;
              const chance = clamp(0.55 + (pa - ea) * 0.03, 0.2, 0.95);
              if (Math.random() < chance) {
                sysSe("escape");
                await say("Got away safely!", 800);
                result = "escape";
                break battleLoop;
              } else {
                await say("Couldn't escape!", 700);
                cmds.length = 0;
                break; // enemies still act
              }
            }
            cmds.push(c);
          }
          const guards = new Set(
            cmds.filter((c) => c.type === "guard").map((c) => c.actor),
          );
          // ---- enemy commands ----
          for (const en of livingE()) cmds.push(enemyAction(en));
          // ---- sort by agility ----
          cmds.sort((x, y) => {
            const ax = x.actor ? param(x.actor, "agi") : x.enemy.d.stats.agi;
            const ay = y.actor ? param(y.actor, "agi") : y.enemy.d.stats.agi;
            return (
              ay * (0.8 + Math.random() * 0.4) -
              ax * (0.8 + Math.random() * 0.4)
            );
          });

          for (const c of cmds) {
            if (c.actor && c.actor.hp <= 0) continue;
            if (c.enemy && !c.enemy.alive) continue;
            if (c.actor) {
              // ---------- party side ----------
              const a = c.actor;
              if (c.type === "stunned") {
                await say(a.name + " can't move!", 500);
                continue;
              }
              if (c.type === "guard") {
                burst(actorElement(a), "status", {
                  color: "#9ab8f0",
                  count: 10,
                  radius: 30,
                });
                floatText(actorElement(a), "GUARD", "state");
                await say(a.name + " guards.", 450);
                continue;
              }
              if (c.type === "item") {
                if (invCount("item", c.item.id) <= 0) continue;
                actorStep(a);
                useItemOn(c.item, c.target);
                burst(actorElement(c.target), "item", { count: 13 });
                floatText(
                  actorElement(c.target),
                  c.item.hp ? "+" + c.item.hp : "+" + c.item.mp + " MP",
                  "heal",
                );
                refreshParty();
                await say(
                  a.name +
                    " uses " +
                    c.item.name +
                    " on " +
                    c.target.name +
                    "!",
                );
                continue;
              }
              if (
                c.type === "attack" ||
                (c.type === "skill" && c.skill.scope === "enemy") ||
                (c.type === "skill" && c.skill.scope === "enemies")
              ) {
                const skill = c.type === "skill" ? c.skill : null;
                if (skill) {
                  const cost = skillMpCost(a, skill);
                  if (a.mp < cost) continue;
                  a.mp -= cost;
                }
                const targets =
                  skill && skill.scope === "enemies"
                    ? livingE().slice()
                    : [
                        c.target && c.target.alive ? c.target : livingE()[0],
                      ].filter(Boolean);
                actorStep(a);
                if (skill) castFx(actorElement(a), skill, targets.length);
                for (const t of targets) {
                  let dmg;
                  const critical =
                    (!skill || skill.type === "phys") &&
                    rnd(100) <
                      RA.traitSum(actorClass(a), "special", "critChance", 0);
                  if (!skill) {
                    dmg = variance(param(a, "atk") * 2 - t.d.stats.def * 1.2);
                    Sfx.play(critical ? "crit" : "hit");
                  } else if (skill.type === "phys") {
                    dmg = variance(
                      (skill.power +
                        param(a, "atk") * 2 -
                        t.d.stats.def * 1.2) *
                        skillPowerRate(a, skill),
                    );
                    Sfx.play("crit");
                  } else {
                    dmg = variance(
                      (skill.power +
                        param(a, "mat") * 2 -
                        t.d.stats.mdf * 1.5) *
                        skillPowerRate(a, skill),
                    );
                    Sfx.play("magic");
                  }
                  if (critical) dmg = Math.max(1, Math.floor(dmg * 1.5));
                  await travel(actorElement(a), sprs[t.i], skill);
                  await dealToEnemy(
                    t,
                    dmg,
                    t.i,
                    critical ? "crit" : skillKind(skill),
                  );
                  await say(
                    a.name +
                      (skill ? " casts " + skill.name : " attacks") +
                      " — " +
                      t.d.name +
                      " takes " +
                      dmg +
                      "!",
                    550,
                  );
                  if (!t.alive) await say(t.d.name + " is defeated!", 450);
                  await applySkillState(skill, t);
                }
              } else if (
                c.type === "skill" &&
                (c.skill.scope === "ally" || c.skill.scope === "allies")
              ) {
                const cost = skillMpCost(a, c.skill);
                if (a.mp < cost) continue;
                a.mp -= cost;
                const targets =
                  c.skill.scope === "allies" ? livingP() : [c.target];
                Sfx.play("heal");
                actorStep(a);
                castFx(actorElement(a), c.skill, targets.length);
                for (const t of targets) {
                  const amount = variance(
                    (c.skill.power + param(a, "mat") * 1.2) *
                      skillPowerRate(a, c.skill),
                  );
                  t.hp = clamp(t.hp + amount, 0, param(t, "mhp"));
                  burst(actorElement(t), "heal", {
                    color: c.skill.color,
                    count: 14,
                  });
                  floatText(actorElement(t), "+" + amount, "heal");
                  await say(
                    a.name +
                      " casts " +
                      c.skill.name +
                      " — " +
                      t.name +
                      " recovers " +
                      amount +
                      " HP!",
                    550,
                  );
                  await applySkillState(c.skill, t);
                }
                refreshParty();
              }
            } else {
              // ---------- enemy side ----------
              const en = c.enemy;
              if (cannotAct(en)) {
                await say(en.d.name + " can't move!", 500);
                continue;
              }
              const pool = livingP();
              if (!pool.length) break;
              const t = pool[rnd(pool.length)];
              enemyStep(en);
              let dmg;
              if (c.skill && c.skill.type !== "heal") {
                const atkStat =
                  c.skill.type === "phys" ? en.d.stats.atk : en.d.stats.mat;
                const defStat =
                  c.skill.type === "phys" ? actorDef(t) : param(t, "mdf") * 1.5;
                dmg = variance(c.skill.power + atkStat * 2 - defStat);
                dmg = Math.max(
                  1,
                  Math.floor(
                    dmg *
                      actorIncomingRate(
                        t,
                        skillElement(c.skill),
                        guards.has(t),
                      ),
                  ),
                );
                Sfx.play(c.skill.type === "phys" ? "hit" : "magic");
                castFx(sprs[en.i], c.skill, 1);
                await travel(sprs[en.i], actorElement(t), c.skill);
                await say(
                  en.d.name +
                    " uses " +
                    c.skill.name +
                    " — " +
                    t.name +
                    " takes " +
                    dmg +
                    "!",
                  550,
                );
              } else {
                dmg = variance(en.d.stats.atk * 2 - actorDef(t) * 1.2);
                dmg = Math.max(
                  1,
                  Math.floor(
                    dmg * actorIncomingRate(t, "physical", guards.has(t)),
                  ),
                );
                Sfx.play("hit");
                await say(
                  en.d.name + " attacks — " + t.name + " takes " + dmg + "!",
                  550,
                );
              }
              t.hp = Math.max(0, t.hp - dmg);
              actorFlash(t);
              burst(actorElement(t), skillKind(c.skill), {
                color: c.skill && c.skill.color,
              });
              floatText(
                actorElement(t),
                "-" + dmg,
                c.skill && c.skill.type === "phys" ? "crit" : "damage",
              );
              if (t.hp <= 0) {
                burst(actorElement(t), "death", { count: 20, radius: 55 });
                floatText(actorElement(t), "FALLEN", "death");
              }
              win.classList.remove("shake");
              void win.offsetWidth;
              win.classList.add("shake");
              refreshParty();
              if (t.hp <= 0) await say(t.name + " falls!", 500);
              if (c.skill) await applySkillState(c.skill, t);
            }
            if (!livingE().length || !livingP().length) break;
          }
          if (livingE().length && livingP().length) await tickStates();
          if (!livingP().length) {
            result = "lose";
            break;
          }
          if (!livingE().length) {
            result = "win";
            break;
          }
        }

        if (result === "win") {
          const exp = enemies.reduce((s, e) => s + (e.d.exp || 0), 0);
          const gold = enemies.reduce((s, e) => s + (e.d.gold || 0), 0);
          Music.stop();
          sysSe("levelup");
          const lines = [];
          await say(
            "Victory!  +" + exp + " EXP, +" + gold + " " + proj.system.currency,
            900,
          );
          G.gold = clamp(G.gold + gold, 0, 9999999);
          for (const a of livingP()) gainExp(a, exp, (m) => lines.push(m));
          refreshParty();
          for (const m of lines) await say(m, 800);
        } else if (result === "lose") {
          noteBattleFailure(troopId, troop.enemies.map((id) => Number(id) || 0));
          await say("The party has fallen...", 1100);
        }
      } finally {
        // shed battle-only states (poison etc. configured to clear after battle)
        for (const a of G.party) {
          if (a.states)
            a.states = a.states.filter((st) => {
              const d = stateDef(st.id);
              return d && !d.removeAtEnd;
            });
        }
        win.remove();
        scene = prevScene;
        if (result !== "lose")
          Music.play(prevMusic || (map && map.music) || "none");
      }
      return result || "win";
    },
  };

  // ============================ title / gameover ============================
  function initPlayer(x, y, dir) {
    G.player = {
      x, y, rx: x, ry: y, prx: x, pry: y, tx: x, ty: y, dir: dir == null ? 0 : dir,
      moving: false, animT: 0, frame: 1, route: null, kind: "human",
      charsetIdx: 0, page: null,
    };
    refreshPlayerCharset();
  }
  function refreshPlayerCharset() {
    const lead = G.party[0];
    if (lead)
      G.player.charsetIdx = Math.max(0, Assets.charsetIndex(lead.charset));
  }

  async function newGame() {
    G.switches = {};
    G.vars = {};
    G.selfSw = {};
    G.quests = {};
    G.gold = proj.system.startGold || 0;
    G.inv = { item: {}, weapon: {}, armor: {} };
    G.party = (proj.system.party || [])
      .slice(0, 4)
      .map(makeActor)
      .filter(Boolean);
    if (!G.party.length && proj.actors.length)
      G.party = [makeActor(proj.actors[0].id)];
    G.steps = 0;
    cameraZoom = 1;
    initPlayer(proj.system.startX, proj.system.startY, proj.system.startDir);
    G.player.transparent = !!proj.system.startTransparent;
    await loadMap(proj.system.startMapId);
    scene = "map";
  }

  async function toTitle() {
    await fadeTo(1, 350);
    scene = "title";
    // clear leftover UI
    while (UIStack.length) removeUI(UIStack[UIStack.length - 1]);
    uiLayer
      .querySelectorAll(".battlewin, .menupanel")
      .forEach((n) => n.remove());
    showTitle();
    await fadeTo(0, 350);
  }

  async function showTitle() {
    Music.play(sysBgm("title"));
    const tw = el("div", "titlewin");
    tw.appendChild(
      el("div", "title-name", esc(proj.system.title || "Untitled")),
    );
    tw.appendChild(el("div", "title-sub", "made with RPGAtlas"));
    uiLayer.appendChild(tw);
    // decorative title backdrop on the canvas
    drawTitleBackdrop();
    while (true) {
      const hasSave = [1, 2, 3].some((s) => slotInfo(s));
      const i = await showList(
        [
          { label: "New Game" },
          { label: "Continue", disabled: !hasSave },
          { label: "Music: " + (Music.enabled ? "On" : "Off") },
        ],
        { className: "titlemenu", cancellable: false },
      );
      if (i === 0) {
        tw.remove();
        await fadeTo(1, 300);
        await newGame();
        await render();
        await fadeTo(0, 300);
        return;
      } else if (i === 1) {
        const ok2 = await saveLoadMenu("load");
        if (ok2) {
          tw.remove();
          await render();
          await fadeTo(0, 300);
          return;
        }
      } else if (i === 2) {
        Music.setEnabled(!Music.enabled);
        if (Music.enabled) Music.play(sysBgm("title"));
      }
    }
  }
  function drawTitleBackdrop() {
    const g = ctx;
    const grad = g.createLinearGradient(0, 0, 0, SCREEN_H);
    grad.addColorStop(0, "#1a2340");
    grad.addColorStop(1, "#2c4a3a");
    g.fillStyle = grad;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // procedural hills + trees
    g.fillStyle = "#22382c";
    g.beginPath();
    g.moveTo(0, SCREEN_H);
    for (let x = 0; x <= SCREEN_W; x += 40) {
      g.lineTo(x, SCREEN_H - 90 - 40 * Math.sin(x / 130));
    }
    g.lineTo(SCREEN_W, SCREEN_H);
    g.fill();
    for (let i = 0; i < 9; i++) {
      const x = 40 + i * 88,
        y = SCREEN_H - 60 - 30 * Math.sin(x / 130);
      Assets.drawTile(g, Assets.T.pine, x, y - 30);
    }
    g.fillStyle = "rgba(255,255,230,0.85)";
    for (let i = 0; i < 40; i++) {
      g.fillRect((i * 211) % SCREEN_W, (i * 137) % (SCREEN_H - 200), 2, 2);
    }
    // faint compass-rose watermark (the RPGAtlas motif)
    g.save();
    g.translate(SCREEN_W - 120, 130);
    g.globalAlpha = 0.16;
    g.strokeStyle = g.fillStyle = "#ffe2a0";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, 70, 0, 6.2832);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 56, 0, 6.2832);
    g.stroke();
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(0, -64);
      g.lineTo(9, 0);
      g.lineTo(0, 64);
      g.lineTo(-9, 0);
      g.closePath();
      g.fill();
      g.rotate(Math.PI / 4);
      g.globalAlpha = i % 2 === 0 ? 0.09 : 0.16; // diagonals fainter than cardinals
    }
    g.restore();
  }

  async function gameOver() {
    scene = "gameover";
    Music.stop();
    sysSe("gameover");
    const gw = el(
      "div",
      "gameoverwin",
      "<div>GAME OVER</div><div class='go-sub'>press confirm</div>",
    );
    uiLayer.appendChild(gw);
    await new Promise((resolve) => {
      const ui = {
        el: gw,
        onKey(k) {
          if (k === "ok") {
            removeUI(ui);
            resolve();
          }
        },
      };
      gw.addEventListener("click", () => {
        removeUI(ui);
        resolve();
      });
      pushUI(ui);
    });
    await toTitle();
  }

  // ============================ boot ============================
  function loadProject() {
    if (window.RPGATLAS_PROJECT)
      return RA.migrateProject(RA.clone(window.RPGATLAS_PROJECT));
    try {
      const raw =
        localStorage.getItem("rpgatlas_project") ||
        localStorage.getItem("driftwood_project");
      if (raw) {
        const p = JSON.parse(raw);
        if (
          p &&
          p.meta &&
          (p.meta.engine === "rpgatlas" || p.meta.engine === "driftwood")
        )
          return RA.migrateProject(p);
      }
    } catch (e) {
      console.warn("Stored project unreadable, using sample.", e);
    }
    return DataDefaults.newProject();
  }

  function fitStage() {
    const sw = window.innerWidth / SCREEN_W,
      sh = window.innerHeight / SCREEN_H;
    const maxScale = (proj && Number(proj.system.screenScale)) || 1.6;
    const sc = Math.min(sw, sh, maxScale);
    stage.style.transform = "translate(-50%,-50%) scale(" + sc + ")";
  }

  // Apply System-tab presentation settings: screen size, UI area, fonts,
  // base font size, and window opacity (via CSS variables play.css reads).
  function applyScreenSettings() {
    const s = proj.system;
    SCREEN_W = clamp(Math.floor(Number(s.screenWidth) || 816), 384, 3840);
    SCREEN_H = clamp(Math.floor(Number(s.screenHeight) || 624), 288, 2160);
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    ctx.imageSmoothingEnabled = false;
    stage.style.width = SCREEN_W + "px";
    stage.style.height = SCREEN_H + "px";
    const uw = clamp(Math.floor(Number(s.uiWidth) || 0), 0, SCREEN_W);
    const uh = clamp(Math.floor(Number(s.uiHeight) || 0), 0, SCREEN_H);
    if (uw > 0 || uh > 0) {
      const w = uw || SCREEN_W,
        h2 = uh || SCREEN_H;
      uiLayer.style.inset = "auto";
      uiLayer.style.left = Math.floor((SCREEN_W - w) / 2) + "px";
      uiLayer.style.top = Math.floor((SCREEN_H - h2) / 2) + "px";
      uiLayer.style.width = w + "px";
      uiLayer.style.height = h2 + "px";
    }
    stage.style.setProperty(
      "--font-text",
      s.fontText || '"Segoe UI", system-ui, sans-serif',
    );
    stage.style.setProperty(
      "--font-menu",
      s.fontMenu || s.fontText || '"Segoe UI", system-ui, sans-serif',
    );
    stage.style.setProperty(
      "--font-size",
      clamp(Number(s.fontSize) || 15, 8, 48) + "px",
    );
    stage.style.setProperty(
      "--win-op",
      clamp(s.windowOpacity == null ? 93 : Number(s.windowOpacity), 0, 100) /
        100,
    );
  }

  async function boot() {
    stage = document.getElementById("stage");
    canvas = document.getElementById("gamecanvas");
    ctx = canvas.getContext("2d");
    uiLayer = el("div", "uilayer");
    stage.appendChild(uiLayer);
    fader = el("div", "fader");
    stage.appendChild(fader);
    fader.style.opacity = 0;
    document.title = "RPGAtlas Player";

    window.addEventListener("error", (e) => {
      const box = el(
        "div",
        "errbox",
        "<b>Error:</b> " +
          esc(e.message) +
          "<br><small>" +
          esc((e.filename || "") + ":" + e.lineno) +
          "</small>",
      );
      stage.appendChild(box);
      setTimeout(() => box.remove(), 8000);
    });

    proj = loadProject();
    applyScreenSettings();
    window.addEventListener("resize", fitStage);
    fitStage();
    Assets.registerCustomChars(proj.customChars);
    await Promise.all([Assets.loadIconSet(), Assets.loadExternalAssets(proj)]);
    Plugins.runAll();
    document.title = (proj.system.title || "RPGAtlas") + " — RPGAtlas Player";
    scene = "title";
    showTitle();
    requestAnimationFrame(loop);   // kick off via rAF so loop() receives a real timestamp

    // unlock audio on first interaction
    const unlock = () => {
      Sfx.play("cursor");
      document.removeEventListener("pointerdown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
  }
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
