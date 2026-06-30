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
const _createInputSystem = window.createInputSystem;

(() => {
  const Assets = _Assets;
  const DataDefaults = _DataDefaults;
  const Renderer = _Renderer;
  const Music = _Music;
  const RA = _RA;
  const Sfx = _Sfx;
  const createMessageSystem = _createMessageSystem;
  const createInputSystem = _createInputSystem;

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
  // All physical input flows through the unified Input system (js/runtime/input.js);
  // it is instantiated near the message-system wiring once UIStack/onKey exist.
  let Input = null;

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
  let setMsgSpeed = null; // message-system typewriter speed setter (captured at wiring)

  // generic selectable list. items: [{label|html, disabled, help}]
  function showList(items, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const win = el("div", "win listwin " + (opts.className || ""));
      if (opts.titleHtml != null) win.appendChild(el("div", "win-title", opts.titleHtml));
      else if (opts.title) win.appendChild(el("div", "win-title", esc(opts.title)));
      const ul = el(
        "ul",
        "menu-list" + (opts.cols > 1 ? " cols" + opts.cols : ""),
      );
      win.appendChild(ul);
      const help = el("div", "win-help");
      if (items.some((it) => it.help)) win.appendChild(help);
      let idx = Math.max(0, Math.min(opts.start || 0, items.length - 1));
      let dragging = false; // true while click-dragging a slider — suppresses hover row-changes
      // A "value row" carries an adjust(dir) fn + get() display string; left/right (and
      // gamepad auto-repeat) change its value in place instead of selecting it. Rendered as
      // label-left / value-right so sliders and cyclers line up in one column.
      const isValueRow = (it) => it && typeof it.adjust === "function";
      // Inner HTML of the .opt-cur cell: sliders split into a bar + percent (so a bar click can
      // seek against the bar's own rect); cyclers show the centered word.
      const curHtml = (it) =>
        it.slider
          ? "<span class='opt-bar'>" + esc(it.bar()) + "</span>" +
            "<span class='opt-pct'>" + esc(it.pct()) + "</span>"
          : esc(it.get());
      const valueHtml = (it) =>
        "<span class='opt-label'>" + esc(it.label) + "</span>" +
        "<span class='opt-value'><span class='opt-arrow' data-d='-1'>◄</span>" +
        "<span class='opt-cur'>" + curHtml(it) + "</span>" +
        "<span class='opt-arrow' data-d='1'>►</span></span>";
      const lis = items.map((it, i) => {
        let cls = "";
        if (it.disabled) cls += " disabled";
        if (it.nav) cls += " navrow";   // Controls / Back: centered "go somewhere" rows
        if (it.divider) cls += " sep";  // separator rule above the first nav row
        const li = el(
          "li",
          cls.trim(),
          isValueRow(it) ? valueHtml(it) : it.html != null ? it.html : esc(it.label),
        );
        li.addEventListener("mouseenter", () => {
          if (dragging) return; // mid slider-drag: don't let vertical drift change the selected row
          idx = i;
          refresh(false); // hover never auto-scrolls (that caused the row-boundary bounce)
        });
        li.addEventListener("click", (e) => {
          e.stopPropagation();
          idx = i;
          refresh(false);
          const it2 = items[i];
          if (!isValueRow(it2)) { ok(); return; }
          // Arrows step; cycler word advances. (Slider-bar seek/drag is handled on mousedown below.)
          const arrow = e.target.closest(".opt-arrow");
          if (arrow) { adjust(i, Number(arrow.dataset.d) || 1); return; }
          if (!it2.slider) adjust(i, 1); // click the cycler word to advance; slider label = no-op
        });
        // Slider: press-and-drag along the bar to scrub the volume (a plain click jumps to that
        // block). Move/up live on the document so the drag keeps tracking outside the bar; the bar
        // is re-queried each step because updateValue() re-renders .opt-cur (the old node detaches).
        li.addEventListener("mousedown", (e) => {
          const it2 = items[i];
          if (!it2 || !it2.slider || typeof it2.seek !== "function") return;
          if (e.target.closest(".opt-arrow")) return; // arrows step via click
          if (!e.target.closest(".opt-cur")) return;  // only the value cell scrubs
          e.preventDefault();
          idx = i;
          refresh(false);
          dragging = true;
          let lastV = null;
          const seekTo = (clientX) => {
            const bar = li.querySelector(".opt-bar");
            const r = bar && bar.getBoundingClientRect();
            if (!r || r.width <= 0) return;
            const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
            const v = Math.ceil(frac * 10) / 10;
            if (v === lastV) return; // same block → skip the re-render and SE
            lastV = v;
            it2.seek(frac);
            updateValue(i);
            sysSe("cursor");
          };
          const onMove = (ev) => seekTo(ev.clientX);
          const onUp = () => {
            dragging = false;
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
          seekTo(e.clientX);
        });
        ul.appendChild(li);
        return li;
      });
      win.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        cancel();
      });
      function refresh(scroll) {
        lis.forEach((li, i) => li.classList.toggle("sel", i === idx));
        if (help.parentNode)
          help.textContent = (items[idx] && items[idx].help) || "";
        const li = lis[idx];
        // Only auto-scroll on keyboard/gamepad nav — never on mouse hover, or hovering a row
        // edge would nudge the scroll and bounce the selection between neighboring rows.
        if (scroll && li && li.scrollIntoView) li.scrollIntoView({ block: "nearest" });
      }
      function move(d) {
        if (!items.length) return;
        idx = (idx + d + items.length) % items.length;
        sysSe("cursor");
        refresh(true);
      }
      // Re-read just one value row's display (no full rebuild → no flicker on adjust).
      function updateValue(i) {
        const it = items[i];
        const li = lis[i];
        if (!it || !li) return;
        const cur = li.querySelector(".opt-cur");
        if (cur) cur.innerHTML = curHtml(it);
      }
      function adjust(i, dir) {
        const it = items[i];
        if (!it || it.disabled || typeof it.adjust !== "function") return;
        it.adjust(dir);
        sysSe("cursor");
        updateValue(i);
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
        onKey(k, repeat) {
          const it = items[idx];
          const valueRow = isValueRow(it) && !it.disabled;
          // Cyclers (Text Speed / Dash / Screen Shake) change once per press: ignore auto-repeat so
          // holding a direction can't blow through the options. Sliders still repeat (hold to ramp).
          const blockRepeat = repeat && valueRow && !it.slider;
          if (k === "up") move(-cols);
          else if (k === "down") move(cols);
          else if (k === "left") {
            if (valueRow) { if (!blockRepeat) adjust(idx, -1); }
            else if (cols > 1) move(-1);
          } else if (k === "right") {
            if (valueRow) { if (!blockRepeat) adjust(idx, 1); }
            else if (cols > 1) move(1);
          } else if (k === "ok") {
            if (valueRow) { if (!blockRepeat) adjust(idx, 1); }
            else ok();
          } else if (k === "cancel") cancel();
        },
      };
      uiLayer.appendChild(win);
      pushUI(ui);
      refresh(true);
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
  function hdMapEnabled(candidateMap) {
    if (!candidateMap) return false;
    const hd = candidateMap.hd2d;
    if (hd && Object.prototype.hasOwnProperty.call(hd, "enabled")) return hd.enabled === true;
    if (hd && (hd.lights || hd.tilt != null || hd.ambient != null)) return true;
    return !!(candidateMap.lights && candidateMap.lights.length > 0);
  }
  function hdWanted() {
    if (hdOverride === "1") return true;
    if (hdOverride === "0") return false;
    return hdMapEnabled(map);
  }
  let evRTs = [];
  let blockingRun = false; // an action/touch/autorun interpreter is active
  const parallels = new Map(); // evRT -> running flag
  const commonParallels = new Map(); // common event id -> running flag

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
  function compareVariable(a, b, cmp) {
    switch(cmp) {
      case "==": return a === b;
      case "!=": return a !== b;
      case ">": return a > b;
      case ">=": return a >= b;
      case "<": return a < b;
      case "<=": return a <= b;
      default:
        throw new Error("Invalid comparator: " + cmp);
    }
  }
  function pageActive(evId, page) {
    const c = page.cond;
    if (c.switchId && !G.switches[c.switchId]) return false;
    if (c.varId && !compareVariable(G.vars[c.varId] || 0, c.varVal, c.cmp || ">=")) return false;
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
      combat: null,
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
    refreshEventCombat(rt);
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
    mapFloatTexts.length = 0;
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
  function eventBlocksChaseTile(mover, other, x, y) {
    if (mover && mover.page && mover.page.through) return false;
    if (!other || other === mover || other.erased || !other.page) return false;
    if (other.page.priority !== "same" || other.page.through) return false;
    if (other.x === x && other.y === y) return true;
    return !!(other.moving && other.tx === x && other.ty === y);
  }
  function canCombatChasePass(rt, nx, ny) {
    if (!canEntityPass(rt, nx, ny)) return false;
    return !evRTs.some((other) => eventBlocksChaseTile(rt, other, nx, ny));
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
  const mapFloatTexts = [];

  function combatConfig(page) {
    const cfg = page && page.combat;
    return cfg && cfg.enabled ? cfg : null;
  }
  function combatEnemy(cfg) {
    return RA.byId(proj.enemies || [], Number(cfg && cfg.enemyId) || 0);
  }
  function combatMaxHp(cfg, enemy) {
    return Math.max(1, Number(cfg && cfg.hp) || Number(enemy && enemy.stats && enemy.stats.mhp) || 1);
  }
  function combatAi(cfg) {
    return cfg && cfg.ai === "chase" ? "chase" : "none";
  }
  function refreshEventCombat(rt) {
    const cfg = combatConfig(rt.page);
    const enemy = cfg && combatEnemy(cfg);
    if (!cfg || !enemy) {
      rt.combat = null;
      return;
    }
    if (rt.combat && rt.combat.pageIndex === rt.pageIndex && rt.combat.enemyId === enemy.id) return;
    rt.combat = {
      pageIndex: rt.pageIndex,
      enemyId: enemy.id,
      hp: combatMaxHp(cfg, enemy),
      invuln: 0,
      hurtFlash: 0,
      attackCooldown: 0,
      stagger: 0,
      knockback: false,
      dead: false,
    };
  }
  function combatReady(rt) {
    return !!(rt && rt.page && rt.combat && !rt.combat.dead && combatConfig(rt.page));
  }
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function entityHurtbox(ent) {
    return { x: ent.rx + 0.12, y: ent.ry + 0.10, w: 0.76, h: 0.86 };
  }
  function swordHitboxAt(x, y, dir) {
    if (dir === 3) return { x: x + 0.10, y: y - 0.48, w: 0.80, h: 0.62 };
    if (dir === 1) return { x: x - 0.48, y: y + 0.14, w: 0.62, h: 0.78 };
    if (dir === 2) return { x: x + 0.86, y: y + 0.14, w: 0.62, h: 0.78 };
    return { x: x + 0.10, y: y + 0.86, w: 0.80, h: 0.62 };
  }
  function swordHitsEntity(attacker, target, dir) {
    if (!attacker || !target) return false;
    const hitbox = swordHitboxAt(attacker.rx, attacker.ry, dir);
    if (rectsOverlap(hitbox, entityHurtbox(target))) return true;
    const [dx, dy] = DIRD[dir] || [0, 0];
    return target.x === attacker.x + dx && target.y === attacker.y + dy;
  }
  function tileDistance(a, b) {
    if (!a || !b) return Infinity;
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  function attackFrame(attack) {
    return attack ? attack.total - attack.framesLeft : 999;
  }
  function attackIsActive(attack) {
    const frame = attackFrame(attack);
    return !!attack && frame >= 3 && frame <= 11;
  }
  function addMapFloatText(text, x, y, color) {
    mapFloatTexts.push({
      text,
      x,
      y,
      color: color || "#ffffff",
      life: 46,
      total: 46,
    });
  }
  function startPlayerAttack() {
    const p = G.player;
    if (!p || p.attack || p.moving) return false;
    p.attack = { total: 18, framesLeft: 18, dir: p.dir, hitIds: new Set() };
    p.animT = (p.animT || 0) + 1;
    sysSe("miss");
    return true;
  }
  function mapAttackDamage(enemy) {
    const a = G.party[0];
    const atk = a ? param(a, "atk") : 10;
    const def = Number(enemy && enemy.stats && enemy.stats.def) || 0;
    return Math.max(1, Math.floor(atk * 1.35 - def * 0.6));
  }
  function applyEnemyKnockback(rt, dir, tiles) {
    if (!rt || rt.moving || tiles <= 0) return;
    const [dx, dy] = DIRD[dir] || [0, 0];
    const nx = rt.x + dx;
    const ny = rt.y + dy;
    if (!canEntityPass(rt, nx, ny)) return;
    rt.combat.knockback = true;
    rt.combat.stagger = Math.max(rt.combat.stagger || 0, 14);
    startMove(rt, dir);
  }
  function defeatMapEnemy(rt, cfg) {
    if (!combatReady(rt)) return;
    rt.combat.dead = true;
    rt.combat.hp = 0;
    onEnemyKilled(rt.combat.enemyId);
    addMapFloatText("DEFEATED", rt.rx + 0.5, rt.ry - 0.1, "#f6e27a");
    sysSe("crit");
    const sw = cfg.defeatSelfSwitch;
    if (sw) {
      G.selfSw[G.mapId + ":" + rt.ev.id + ":" + sw] = true;
      refreshAllPages();
    } else {
      rt.erased = true;
    }
  }
  function damageMapEnemy(rt) {
    if (!combatReady(rt) || rt.combat.invuln > 0) return;
    const cfg = combatConfig(rt.page);
    const enemy = combatEnemy(cfg);
    const dmg = mapAttackDamage(enemy);
    rt.combat.hp = Math.max(0, rt.combat.hp - dmg);
    rt.combat.invuln = Math.max(1, Number(cfg.invulnFrames) || 0);
    rt.combat.hurtFlash = 12;
    rt.combat.stagger = Math.max(rt.combat.stagger || 0, 10);
    addMapFloatText("-" + dmg, rt.rx + 0.5, rt.ry - 0.15, "#ffd86a");
    sysSe("hit");
    if (rt.combat.hp <= 0) {
      defeatMapEnemy(rt, cfg);
    } else {
      applyEnemyKnockback(rt, G.player.attack.dir, Number(cfg.knockbackTiles) || 0);
    }
  }
  function damagePlayerFromEnemy(rt) {
    const p = G.player;
    const cfg = combatConfig(rt.page);
    const dmg = Number(cfg && cfg.touchDamage) || 0;
    const a = G.party[0];
    if (!p || !a || dmg <= 0 || (p.hurtInvuln || 0) > 0) return;
    if ((rt.combat.attackCooldown || 0) > 0) return;
    if (!rectsOverlap(entityHurtbox(p), entityHurtbox(rt)) && tileDistance(p, rt) > 1) return;
    rt.combat.attackCooldown = 45;
    rt.dir = dirTo(rt.x, rt.y, p.x, p.y);
    a.hp = Math.max(0, a.hp - dmg);
    p.hurtInvuln = 60;
    addMapFloatText("-" + dmg, p.rx + 0.5, p.ry - 0.2, "#ff8a8a");
    sysSe("hit");
    shakePower = 3;
    shakeSpeed = 6;
    shakeTimer = 12;
    shakeDuration = 12;
    if (a.hp <= 0) {
      (async () => { await gameOver(); })();
    }
  }
  function updateMapCombat() {
    const p = G.player;
    if (p && p.hurtInvuln > 0) p.hurtInvuln--;
    if (p && p.attack) {
      if (attackIsActive(p.attack)) {
        for (const rt of evRTs) {
          if (!combatReady(rt) || p.attack.hitIds.has(rt.ev.id)) continue;
          if (!swordHitsEntity(p, rt, p.attack.dir)) continue;
          p.attack.hitIds.add(rt.ev.id);
          damageMapEnemy(rt);
        }
      }
      p.attack.framesLeft--;
      if (p.attack.framesLeft <= 0) p.attack = null;
    }
    for (const rt of evRTs) {
      if (!combatReady(rt)) continue;
      if (rt.combat.invuln > 0) rt.combat.invuln--;
      if (rt.combat.hurtFlash > 0) rt.combat.hurtFlash--;
      if (rt.combat.attackCooldown > 0) rt.combat.attackCooldown--;
      if (rt.combat.stagger > 0) rt.combat.stagger--;
      damagePlayerFromEnemy(rt);
    }
    for (let i = mapFloatTexts.length - 1; i >= 0; i--) {
      mapFloatTexts[i].life--;
      if (mapFloatTexts[i].life <= 0) mapFloatTexts.splice(i, 1);
    }
  }
  function combatStaggered(rt) {
    return !!(rt && rt.combat && rt.combat.stagger > 0);
  }
  function combatChaseDir(rt) {
    const p = G.player;
    if (!combatReady(rt) || !p || !rt.page) return -1;
    const cfg = combatConfig(rt.page);
    if (combatAi(cfg) !== "chase") return -1;
    if (combatStaggered(rt) || rt.locked || blockingRun) return -1;
    const dx = p.x - rt.x;
    const dy = p.y - rt.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (dist <= 1 || dist > 5) return -1;
    const xDir = dx > 0 ? 2 : dx < 0 ? 1 : -1;
    const yDir = dy > 0 ? 0 : dy < 0 ? 3 : -1;
    const dirs = Math.abs(dx) >= Math.abs(dy) ? [xDir, yDir] : [yDir, xDir];
    for (const dir of dirs) {
      if (dir < 0) continue;
      const [mx, my] = DIRD[dir];
      if (canCombatChasePass(rt, rt.x + mx, rt.y + my)) return dir;
    }
    return -1;
  }
  function drawSwordSlash(g, hitbox, dir) {
    const x = hitbox.x * TILE;
    const y = hitbox.y * TILE;
    const w = hitbox.w * TILE;
    const h = hitbox.h * TILE;
    g.save();
    g.globalAlpha = 0.85;
    g.strokeStyle = "#e8f6ff";
    g.lineWidth = 5;
    g.lineCap = "round";
    g.beginPath();
    if (dir === 3) {
      g.arc(x + w / 2, y + h, w * 0.55, Math.PI * 1.12, Math.PI * 1.88);
    } else if (dir === 0) {
      g.arc(x + w / 2, y, w * 0.55, Math.PI * 0.12, Math.PI * 0.88);
    } else if (dir === 1) {
      g.arc(x + w, y + h / 2, h * 0.55, Math.PI * 0.62, Math.PI * 1.38);
    } else {
      g.arc(x, y + h / 2, h * 0.55, Math.PI * -0.38, Math.PI * 0.38);
    }
    g.stroke();
    g.restore();
  }
  function drawMapCombatOverlay(g, camX, camY, shakeX, shakeY, alpha, playerX, playerY) {
    g.save();
    g.translate(Math.round(shakeX), Math.round(shakeY));
    g.scale(cameraZoom, cameraZoom);
    g.translate(-camX, -camY);
    const p = G.player;
    if (p && p.attack && attackIsActive(p.attack)) {
      drawSwordSlash(g, swordHitboxAt(playerX, playerY, p.attack.dir), p.attack.dir);
    }
    for (const rt of evRTs) {
      if (!combatReady(rt) || rt.combat.hurtFlash <= 0) continue;
      const rx = (rt.prx == null ? rt.rx : rt.prx + (rt.rx - rt.prx) * alpha) * TILE;
      const ry = (rt.pry == null ? rt.ry : rt.pry + (rt.ry - rt.pry) * alpha) * TILE;
      g.fillStyle = "rgba(255,255,255,0.36)";
      g.fillRect(rx + 6, ry - 6, TILE - 12, TILE);
    }
    g.font = "700 14px " + (proj.system.fontMenu || "sans-serif");
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const ft of mapFloatTexts) {
      const t = ft.life / ft.total;
      g.globalAlpha = clamp(t * 1.4, 0, 1);
      g.fillStyle = "rgba(0,0,0,0.75)";
      g.fillText(ft.text, ft.x * TILE + 1, (ft.y - (1 - t) * 0.55) * TILE + 1);
      g.fillStyle = ft.color;
      g.fillText(ft.text, ft.x * TILE, (ft.y - (1 - t) * 0.55) * TILE);
    }
    g.restore();
    g.globalAlpha = 1;
  }

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
    constructor(evRT, commonStack) {
      this.evRT = evRT;
      this.commonStack = commonStack || [];
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

        case "commonEvent":
          await this.callCommonEvent(c.commonEventId);
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
            const api = Object.create(scriptApi);
            api.callCommonEvent = (id) => this.callCommonEvent(id);
            const result = new Function("game", c.code)(api);
            if (result && typeof result.then === "function") await result;
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
    async callCommonEvent(id) {
      const commonEvent = RA.byId(proj.commonEvents || [], Number(id));
      if (!commonEvent || !commonEvent.commands.length) return false;
      if (this.commonStack.includes(commonEvent.id)) {
        console.warn("Skipped recursive common event call:", commonEvent.id);
        return false;
      }
      this.commonStack.push(commonEvent.id);
      try {
        await this.runList(commonEvent.commands);
      } finally {
        this.commonStack.pop();
      }
      return true;
    }
    testCond(cond) {
      if (!cond) return true;
      const cmp = (a, b, op) =>
        compareVariable(a, b, op)
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
    callCommonEvent(id) {
      return new Interp(null).callCommonEvent(id);
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
    status: [],
    pluginId(pl) { return String(pl && (pl.pluginId || pl.key || pl.name || ("plugin." + pl.id)) || "").trim(); },
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
      Plugins.status = [];
      const seen = new Set(), loaded = new Set();
      for (const pl of proj.plugins || []) {
        const pluginId = Plugins.pluginId(pl);
        const entry = { id: pl.id, pluginId: pluginId, name: pl.name || pluginId || "?", status: "pending", errors: [] };
        Plugins.status.push(entry);
        if (!pl.on) { entry.status = "disabled"; continue; }
        if (!pluginId) { entry.status = "skipped"; entry.errors.push("Missing plugin ID."); console.warn("Plugin '" + (pl.name || "?") + "' skipped: missing plugin ID."); continue; }
        if (seen.has(pluginId)) { entry.status = "skipped"; entry.errors.push("Duplicate plugin ID: " + pluginId); console.warn("Plugin '" + (pl.name || pluginId) + "' skipped: duplicate plugin ID '" + pluginId + "'."); continue; }
        seen.add(pluginId);
        const missing = (pl.dependencies || []).filter((dep) => !loaded.has(dep));
        if (missing.length) {
          entry.status = "skipped";
          entry.errors.push("Missing dependencies: " + missing.join(", "));
          console.warn("Plugin '" + (pl.name || pluginId) + "' skipped: missing dependencies " + missing.join(", ") + ".");
          continue;
        }
        try {
          new Function("atlas", "game", "dw", pl.code)(atlas, scriptApi, atlas);
          entry.status = "loaded";
          loaded.add(pluginId);
        } catch (e) {
          // "dw" = pre-rebrand alias
          console.error("Plugin '" + (pl.name || "?") + "' failed:", e);
          entry.status = "failed";
          entry.errors.push(e && e.message ? e.message : String(e));
        }
      }
      if (typeof window !== "undefined") window.AtlasPluginStatus = Plugins.status;
    },
  };

  ({ richText, showMessage, setTextSpeed: setMsgSpeed } = createMessageSystem({
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

  // Unified input (keyboard + gamepad). Engine + menu code reads named actions through
  // this; the in-game Controls menu rebinds them via Input.beginCapture. Menu navigation
  // is gated here: while any UI is open a press is routed to UIStack.top.onKey and never
  // queued as a map edge.
  Input = createInputSystem({
    defaultBindings: RA.defaultInput(),
    isMenuOpen: () => UIStack.length > 0,
    onMenuNav: (action, repeat) => {
      if (UIStack.length) UIStack[UIStack.length - 1].onKey(action, repeat);
    },
  });
  Input.attachDOM(document);

  // Inline input-prompt glyphs in messages: "\input[ok]" renders the glyph for whatever is bound
  // to that action on the device in use *when the message opens* (a snapshot via activeDevice(),
  // not live mid-message). Registered as a text processor so it runs post-esc like \i[n] and may
  // emit the <img> glyph; it lives in the engine because it needs the live Input bindings. Falls
  // back to the other device's primary binding, then to a plain text label.
  function inputPromptGlyph(action) {
    const act = String(action).toLowerCase();
    if (!RA.INPUT_ACTIONS.some((a) => a.key === act)) return "";
    const b = Input.getBindings();
    let device = Input.activeDevice() === "gamepad" ? "gamepad" : "keyboard";
    let arr = (b[device] && b[device][act]) || [];
    if (!arr.length) {
      device = device === "gamepad" ? "keyboard" : "gamepad";
      arr = (b[device] && b[device][act]) || [];
    }
    if (!arr.length) return esc(actionLabel(act));
    const family = device === "gamepad" && Input.padFamily ? Input.padFamily() : "xbox";
    return Assets.inputGlyphHtml(device, arr[0], family, "msg-icon");
  }
  Plugins.textProcessors.push((html) =>
    html.replace(/\\input\[(\w+)\]/gi, (_m, action) => inputPromptGlyph(action)));

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

  async function runCommonEventBlocking(commonEvent) {
    if (blockingRun) return;
    blockingRun = true;
    try {
      await new Interp(null).callCommonEvent(commonEvent.id);
    } finally {
      refreshAllPages();
      blockingRun = false;
    }
  }

  function updateCommonEvents() {
    const commonEvents = proj.commonEvents || [];
    if (!blockingRun) {
      const autorun = commonEvents.find((commonEvent) =>
        commonEvent.trigger === "auto" &&
        commonEvent.commands.length &&
        RA.commonEventEnabled(commonEvent, G.switches));
      if (autorun) runCommonEventBlocking(autorun);
    }
    for (const commonEvent of commonEvents) {
      if (
        commonEvent.trigger !== "parallel" ||
        !commonEvent.commands.length ||
        !RA.commonEventEnabled(commonEvent, G.switches) ||
        commonParallels.get(commonEvent.id)
      ) continue;
      commonParallels.set(commonEvent.id, true);
      new Interp(null).callCommonEvent(commonEvent.id).finally(async () => {
        await sleep(50);
        commonParallels.set(commonEvent.id, false);
      });
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
    // Rebuild this frame's input edge set before any early-return, so title/pause
    // menus see a clean edge set every tick and nothing stays latched across them.
    Input.poll();
    if (scene === "map") Plugins.fire("update");
    if (scene !== "map" || menuOpen) {
      return;
    }

    const p = G.player;
    // Dash "Toggle" mode: flip the latch on each rising edge of the dash button (tracked every
    // tick so a tap while standing still registers). Hold/Always read live in wantsDash().
    if ((playerOptions.dashMode || "hold") === "toggle") {
      const dp = Input.pressed("dash");
      if (dp && !dashPrev) dashLatch = !dashLatch;
      dashPrev = dp;
    }
    // snapshot start-of-tick positions so render() can interpolate between ticks
    p.prx = p.rx; p.pry = p.ry;
    for (const rt of evRTs) { rt.prx = rt.rx; rt.pry = rt.ry; }
    // player motion — advance the current step, then (if it finished this tick) start the
    // next one immediately, so there's no dead frame at each tile. activePlayerControl()
    // stays false during events/battles, so chaining can't spawn a spurious move.
    if (p.moving) {
      const arrived = updateEntityMotion(p, wantsDash() ? 0.13 : 0.085);
      if (arrived) onPlayerStep();
    }
    if (!p.moving && p.route) {
      updateRoute(p);
    } else if (!p.moving && activePlayerControl()) {
      const d = Input.dir();
      if (Input.consume("attack")) {
        startPlayerAttack();
      } else if (d >= 0) {
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
      if (Input.consume("ok")) checkActionTrigger();
      if (Input.consume("cancel")) openMenu();
    }
    if (p.moving) p.animT = (p.animT || 0) + 0; // animT advanced in motion fn
    updateMapCombat();

    // events
    for (const rt of evRTs) {
      if (rt.erased || !rt.page) continue;
      // Same no-dead-frame pattern as the player above: a finished step chains into the next
      // route/random step this same tick instead of pausing a frame at each tile.
      if (rt.moving) {
        const arrived = updateEntityMotion(rt, rt.combat && rt.combat.knockback ? 0.18 : rt.speed);
        if (arrived && rt.combat) rt.combat.knockback = false;
      }
      if (!rt.moving && rt.route) {
        updateRoute(rt);
      } else if (!rt.moving) {
        const chaseDir = combatChaseDir(rt);
        if (chaseDir >= 0) {
          startMove(rt, chaseDir);
          rt.moveT = 20 + rnd(40);
        } else if (rt.page.moveType === "random" && !rt.locked && !blockingRun && !combatStaggered(rt)) {
          if (--rt.moveT <= 0) {
            rt.moveT = 40 + rnd(100);
            const d = rnd(4);
            if (rnd(4) === 0) rt.dir = d;
            else if (canEntityPass(rt, rt.x + DIRD[d][0], rt.y + DIRD[d][1]))
              startMove(rt, d);
          }
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
    updateCommonEvents();
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
      const amp =
        shakePower * 2.5 * decay *
        (playerOptions.shakeScale == null ? 1 : playerOptions.shakeScale);
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
      const lightsEnabled = !map.hd2d || map.hd2d.lights !== false;
      if (lightsEnabled) {
        // Event lights
        for (const rt of evRTs) {
          if (rt.light && !rt.erased && rt.page) {
            lights.push({ rx: ip(rt.prx, rt.rx), ry: ip(rt.pry, rt.ry), color: rt.light.color, radius: rt.light.radius });
          }
        }
        // Map lights
        if (map.lights) {
          for (const l of map.lights) lights.push(l);
        }
      }
      const ambient =
        map.hd2d && map.hd2d.ambient != null ? Number(map.hd2d.ambient) : 0.45;
      const tilt =
        map.hd2d && map.hd2d.tilt != null ? Number(map.hd2d.tilt) : 50;
      await Renderer.renderFrame(SCREEN_W, SCREEN_H, camX, camY, sprites, {
        focus: { rx: pix, ry: piy },
        lights,
        zoom: cameraZoom,
        shakeX,
        shakeY,
        ambient,
        tilt,
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
    drawMapCombatOverlay(ctx, camX, camY, shakeX, shakeY, alpha, pix, piy);
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
  // render() is async (WebGL HD-2D path), so we await it to avoid overlapping frames.

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
            { html: Assets.iconHtml(46, "menu-icon") + "Options" },
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
          await optionsMenu();
        } else if (i === 6) {
          await saveLoadMenu("save");
        } else if (i === 7) {
          if (await saveLoadMenu("load")) break;
        } else if (i === 8) {
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

  // ---- player options (per-player overrides: input rebinds + audio/game settings) ----
  // Stored separately from the project so author defaults stay intact and a player's
  // remaps/preferences persist across sessions. Per-game namespaced like saveKey().
  let playerOptions = {};
  function optionsKey() {
    const gameId = window.RPGATLAS_GAME_ID;
    return gameId ? "rpgatlas_" + gameId + "_options" : "rpgatlas_options";
  }
  function loadOptions() {
    try {
      const raw = localStorage.getItem(optionsKey());
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  function saveOptions() {
    try {
      localStorage.setItem(optionsKey(), JSON.stringify(playerOptions));
    } catch (e) {}
  }
  // ---- player-option setters (mutate playerOptions + persist) ----
  function audioVol(ch) {
    const a = playerOptions.audio || {};
    return a[ch] == null ? 1 : a[ch];
  }
  function setOptAudio(ch, v) {
    v = clamp(v, 0, 1);
    playerOptions.audio = playerOptions.audio || {};
    playerOptions.audio[ch] = v;
    if (ch === "master") Sfx.setMasterVolume(v);
    else if (ch === "bgm") {
      Sfx.setBgmVolume(v);
      if (v > 0 && !Music.enabled) Music.setEnabled(true);
    } else if (ch === "se") Sfx.setSeVolume(v);
    saveOptions();
  }
  function setOpt(key, v) {
    playerOptions[key] = v;
    saveOptions();
  }
  function setOptTextSpeed(v) {
    playerOptions.textSpeed = v;
    saveOptions();
    if (setMsgSpeed) setMsgSpeed(v);
  }
  // Dash mode (Options): Hold = held button; Toggle = tap to latch; Always On = always run.
  let dashLatch = false;
  let dashPrev = false;
  function wantsDash() {
    const m = playerOptions.dashMode || "hold";
    if (m === "always") return true;
    if (m === "toggle") return dashLatch;
    return Input.pressed("dash");
  }

  // In-game Options: rebind keyboard / gamepad per action (editable list — add / replace
  // / remove), audio mixer + game settings, reset. Built on showList/UIStack; capture uses
  // Input.beginCapture (ignore-held-until-release + conflict prompt). Player overrides
  // persist to the options store and apply live via Input.setBindings.
  function actionLabel(key) {
    const a = RA.INPUT_ACTIONS.find((x) => x.key === key);
    return a ? a.label : key;
  }
  // Build a 10-segment volume bar like "▰▰▰▰▰▱▱▱▱▱".
  function volBar(v) {
    const n = Math.max(0, Math.min(10, Math.round(v * 10)));
    return "▰".repeat(n) + "▱".repeat(10 - n);
  }
  const OPT_TEXT_SPEED = [["Slow", 1], ["Normal", 2], ["Fast", 4], ["Instant", 9999]];
  const OPT_DASH = [["Hold", "hold"], ["Toggle", "toggle"], ["Always On", "always"]];
  const OPT_SHAKE = [["Off", 0], ["Reduced", 0.5], ["Full", 1]];
  // Registry-row builders: a slider (continuous 0..1) and a cycler (fixed [label,value] list).
  // sliderRow exposes bar()/pct() for the split display and seek(frac) for click-to-seek.
  function sliderRow(label, getVal, setVal) {
    const set = (v) => setVal(Math.max(0, Math.min(1, v)));
    return {
      label,
      slider: true,
      get() {
        return volBar(getVal()) + " " + Math.round(getVal() * 100) + "%";
      },
      bar() {
        return volBar(getVal());
      },
      pct() {
        return Math.round(getVal() * 100) + "%";
      },
      adjust(dir) {
        set(getVal() + dir * 0.1);
      },
      seek(frac) {
        set(Math.ceil(frac * 10) / 10); // fill up to the segment the cursor is over (click anywhere in it)
      },
    };
  }
  function choiceRow(label, list, getVal, setVal) {
    return {
      label,
      get() {
        const v = getVal();
        const m = list.find((x) => x[1] === v);
        return (m || list[0])[0];
      },
      adjust(dir) {
        let i = list.findIndex((x) => x[1] === getVal());
        if (i < 0) i = 0;
        i = (i + dir + list.length) % list.length;
        setVal(list[i][1]);
      },
    };
  }
  async function optionsMenu() {
    let idx = 0;
    while (true) {
      const rows = [
        sliderRow("Master Volume", () => audioVol("master"), (v) => setOptAudio("master", v)),
        sliderRow("Music Volume", () => audioVol("bgm"), (v) => setOptAudio("bgm", v)),
        sliderRow("SFX Volume", () => audioVol("se"), (v) => setOptAudio("se", v)),
        choiceRow("Text Speed", OPT_TEXT_SPEED, () => playerOptions.textSpeed || 2, (v) => setOptTextSpeed(v)),
        choiceRow("Dash", OPT_DASH, () => playerOptions.dashMode || "hold", (v) => setOpt("dashMode", v)),
        choiceRow("Screen Shake", OPT_SHAKE, () => (playerOptions.shakeScale == null ? 1 : playerOptions.shakeScale), (v) => setOpt("shakeScale", v)),
        { label: "Controls", nav: true },
        { label: "Back", nav: true },
      ];
      const i = await showList(rows, { title: "Options", className: "optionswin optionswin-wide", start: idx });
      if (i < 0 || i === rows.length - 1) return; // Back / cancel
      idx = i;
      if (rows[i] && rows[i].label === "Controls") await controlsMenu();
    }
  }
  // Controls submenu (Options ▸ Controls): per-device rebinders + reset to author defaults.
  async function controlsMenu() {
    let idx = 0;
    while (true) {
      const items = [
        { label: "Keyboard", nav: true },
        { label: "Gamepad", nav: true },
        { label: "Reset to Defaults", nav: true },
        { label: "Back", nav: true },
      ];
      const i = await showList(items, {
        title: "Controls",
        start: idx,
      });
      if (i < 0 || i === items.length - 1) return;
      idx = i;
      if (i === 0) await controlsDevice("keyboard");
      else if (i === 1) await controlsDevice("gamepad");
      else if (i === 2) {
        const c = await showList(
          [{ label: "Yes", nav: true }, { label: "Cancel", nav: true }],
          { title: "Reset controls to defaults?" },
        );
        if (c === 0) {
          delete playerOptions.input;
          Input.setBindings(RA.mergeInputBindings(proj.system.input, null));
          saveOptions();
        }
      }
    }
  }
  // Render a binding array as the same procedural glyphs the editor draws, skinned to the
  // player's live controller family for gamepad. Dim em-dash when an action is unbound.
  function bindGlyphsHtml(device, action) {
    const arr = (Input.getBindings()[device] || {})[action] || [];
    if (!arr.length) return "<span class='bind-none'>—</span>";
    const fam = device === "gamepad" && Input.padFamily ? Input.padFamily() : "xbox";
    return arr.map((code) => Assets.inputGlyphHtml(device, code, fam, "bind-icon")).join("");
  }
  // Per-device action list: each row shows the action and its bindings (as glyphs).
  async function controlsDevice(device) {
    let idx = 0;
    while (true) {
      const rows = RA.INPUT_ACTIONS.map((a) => ({
        html:
          "<span>" + esc(a.label) + "</span>" +
          "<span class='bind'>" + bindGlyphsHtml(device, a.key) + "</span>",
      }));
      rows.push({ label: "Back", nav: true });
      const i = await showList(rows, {
        title: (device === "keyboard" ? "Keyboard" : "Gamepad") + " — pick an action",
        className: "optionswin",
        start: idx,
      });
      if (i < 0 || i === rows.length - 1) return; // cancel or Back
      idx = i;
      await actionBindings(device, RA.INPUT_ACTIONS[i].key);
    }
  }
  // Editable binding list for one action: existing bindings + Add + Back. Selecting a
  // binding offers Replace / Remove; Add captures a new one. First entry = primary.
  async function actionBindings(device, action) {
    let idx = 0;
    while (true) {
      const arr = (Input.getBindings()[device] || {})[action] || [];
      const fam = device === "gamepad" && Input.padFamily ? Input.padFamily() : "xbox";
      const items = arr.map((code) => ({
        html:
          Assets.inputGlyphHtml(device, code, fam, "bind-icon") +
          "<span class='bind-name'>" + esc(Input.codeLabel(device, code)) + "</span>",
      }));
      items.push({ label: "+ Add binding" });
      items.push({ label: "Back", nav: true });
      const i = await showList(items, {
        title: actionLabel(action),
        start: idx,
      });
      if (i < 0 || i === items.length - 1) return; // cancel or Back
      idx = i;
      if (i === arr.length) {
        const code = await rebindCapture(device);
        if (code) await applyCapturedCode(device, action, code, -1);
      } else {
        const c = await showList(
          [
            { label: "Replace", nav: true },
            { label: "Remove", nav: true },
            { label: "Back", nav: true },
          ],
          {
            titleHtml:
              Assets.inputGlyphHtml(device, arr[i], fam, "bind-icon") +
              " " + esc(Input.codeLabel(device, arr[i])),
          },
        );
        if (c === 0) {
          const code = await rebindCapture(device);
          if (code) await applyCapturedCode(device, action, code, i);
        } else if (c === 1) {
          await removeBinding(device, action, i);
        }
      }
    }
  }
  // Show a centered "press any input" prompt and resolve to the captured code, or null
  // if cancelled. The capture itself (ignore-held-until-release) lives in input.js.
  async function rebindCapture(device) {
    const prompt = el(
      "div",
      "win listwin cap-prompt",
      "<div class='win-title'>Press any " + (device === "keyboard" ? "key" : "button") + "</div>" +
        "<div class='win-help'>Esc cancels</div>",
    );
    uiLayer.appendChild(prompt);
    let cap;
    try {
      cap = await new Promise((res) => Input.beginCapture(device, res));
    } finally {
      prompt.remove();
    }
    return cap ? cap.code : null;
  }
  // Apply a captured code to an action (slot -1 = append, otherwise replace that index),
  // resolving a cross-action conflict via a Replace/Cancel prompt, then persist + apply.
  async function applyCapturedCode(device, action, code, slot) {
    const merged = RA.mergeInputBindings(proj.system.input, playerOptions.input || null);
    const clash = RA.inputConflict(merged, device, code, action);
    if (clash) {
      // Refuse a Replace that would orphan a menu-driving action (its last binding on this
      // device) — otherwise unbinding Confirm/Cancel this way could lock the player out.
      if (RA.INPUT_CRITICAL.indexOf(clash) !== -1 && merged[device][clash].length <= 1) {
        sysSe("buzzer");
        await showMessage("", actionLabel(clash) + " needs at least one binding — free it up first.");
        return;
      }
      const c = await showList(
        [{ label: "Replace" }, { label: "Cancel" }],
        { title: Input.codeLabel(device, code) + " is bound to " + actionLabel(clash) },
      );
      if (c !== 0) return;
      merged[device][clash] = merged[device][clash].filter((x) => x !== code);
    }
    const arr = merged[device][action].slice();
    if (slot >= 0) arr[slot] = code;
    else arr.push(code);
    // drop empties and de-duplicate within the action (keep first occurrence)
    merged[device][action] = arr.filter((x, j) => x && arr.indexOf(x) === j);
    commitBindings(merged);
  }
  async function removeBinding(device, action, slot) {
    const merged = RA.mergeInputBindings(proj.system.input, playerOptions.input || null);
    // Don't let the last Confirm/Cancel binding on this device be removed — they drive every
    // menu, so emptying them could lock the player out (recoverable only via mouse/reload).
    if (RA.INPUT_CRITICAL.indexOf(action) !== -1 && merged[device][action].length <= 1) {
      sysSe("buzzer");
      await showMessage("", actionLabel(action) + " needs at least one binding.");
      return;
    }
    const arr = merged[device][action].slice();
    arr.splice(slot, 1);
    merged[device][action] = arr;
    commitBindings(merged);
  }
  function commitBindings(merged) {
    playerOptions.input = merged;
    Input.setBindings(merged);
    saveOptions();
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
    commonParallels.clear();
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
      charsetIdx: 0, page: null, attack: null, hurtInvuln: 0,
    };
    refreshPlayerCharset();
  }
  function refreshPlayerCharset() {
    const lead = G.party[0];
    if (lead)
      G.player.charsetIdx = Math.max(0, Assets.charsetIndex(lead.charset));
  }

  async function newGame() {
    commonParallels.clear();
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
          { label: "Options" },
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
        await optionsMenu();
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
  // base font size, window opacity, and window color (via CSS variables play.css reads).
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
    const windowPalette = RA.windowColorPalette(s.windowColor);
    stage.style.setProperty("--win-top-rgb", windowPalette.top);
    stage.style.setProperty("--win-bottom-rgb", windowPalette.bottom);
    stage.style.setProperty("--win-name-top-rgb", windowPalette.nameTop);
    stage.style.setProperty("--win-name-bottom-rgb", windowPalette.nameBottom);
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
    // Apply author-default bindings, with the player's saved per-device overrides merged
    // on top, and restore the persisted music preference (before any Music.play()).
    playerOptions = loadOptions();
    // One-time migration: the old "Music: On/Off" toggle became the Music Volume slider, so a
    // pre-mixer save with music disabled maps to BGM volume 0 (and we drop the dead `music` key).
    // Runs before `av` is captured below — otherwise this boot would still apply BGM volume 1.
    if (
      playerOptions.music &&
      playerOptions.music.enabled === false &&
      (playerOptions.audio == null || playerOptions.audio.bgm == null)
    ) {
      playerOptions.audio = Object.assign({}, playerOptions.audio, { bgm: 0 });
      delete playerOptions.music;
      saveOptions();
    }
    Input.setBindings(RA.mergeInputBindings(proj.system.input, playerOptions.input || null));
    // Restore saved audio mix + text speed.
    const av = playerOptions.audio || {};
    Sfx.setMasterVolume(av.master == null ? 1 : av.master);
    Sfx.setBgmVolume(av.bgm == null ? 1 : av.bgm);
    Sfx.setSeVolume(av.se == null ? 1 : av.se);
    if (setMsgSpeed && playerOptions.textSpeed) setMsgSpeed(playerOptions.textSpeed);
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
