/* RPGAtlas — plugins.js
   Built-in plugins that ship with the engine.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE).

   Each built-in is authored below as a normal JavaScript function so the code
   reads naturally (real regex literals, no double-escaping). At install time the
   function BODY is extracted with Function.prototype.toString() and stored on the
   project as a plain `code` string — exactly what a hand-written plugin looks like
   in the Plugin Manager. The engine runs it via `new Function("atlas","game", code)`.

   A plugin receives:
     atlas    — engine bridge: atlas.project, atlas.map, atlas.player, atlas.scene, atlas.Assets,
             atlas.Sfx, atlas.Music, atlas.SCREEN_W/H, atlas.TILE, atlas.fader, atlas.stage,
             atlas.onMapLoad(fn) atlas.onUpdate(fn) atlas.onRender(fn(ctx,info))
                 (info.camX/camY and info.playerX/playerY are inter-tick interpolated;
                  info.alpha is the 0..1 blend factor — anchor overlays to these, not atlas.player.rx)
             atlas.onMessageText(fn(html)->html) atlas.setTransition({out,in})
             atlas.registerCommand(type, fn(cmd, interp))
             atlas.startBattle(troopId, canEscape) -> Promise<"win"|"lose"|"escape">
     game  — the Script-command API: setSwitch/getSwitch/setVar/getVar/addGold/party/state
*/
"use strict";

const AtlasBuiltins = (() => {

  // ---- Atlas_Core: shared library every other Atlas_* plugin builds on ----
  function Atlas_Core(atlas, game) {
    /* Atlas_Core — shared library for RPGAtlas plugins. Load me FIRST.
     * Exposes window.Atlas: a plugin registry plus common helpers (colour,
     * easing, tweens, RNG) so other plugins don't each re-implement them. */
    const CONFIG = {
      // Palette for \c[n] text codes (index 0 = default colour).
      palette: ["#ffffff", "#7ac8ff", "#ffd86a", "#ff8a8a", "#8fe0a8", "#c8a0ff", "#ff9a4a", "#9a9db4", "#20222e", "#3a5a9a"],
      defaultTransition: "fade",
    };

    if (window.Atlas && window.Atlas.version) {   // listed twice — just refresh refs
      window.Atlas.atlas = atlas; window.Atlas.game = game;
      return;
    }
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const Atlas = window.Atlas = {
      version: "1.0",
      atlas: atlas, game: game, config: CONFIG,
      plugins: {},
      state: { transition: CONFIG.defaultTransition, weather: "none", weatherPower: 5, map: null },
      register(name, api) { this.plugins[name] = api || {}; return this.plugins[name]; },
      has(name) { return !!this.plugins[name]; },
      get(name) { return this.plugins[name]; },
      util: {
        clamp: clamp,
        lerp(a, b, t) { return a + (b - a) * t; },
        rand(a, b) { return a + Math.random() * (b - a); },
        randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
        easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
        hexToRgb(h) {
          h = String(h).replace("#", "");
          if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
          const n = parseInt(h, 16) || 0;
          return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
        },
        rgba(c, a) { const o = this.hexToRgb(c); return "rgba(" + o.r + "," + o.g + "," + o.b + "," + a + ")"; },
        color(i) { const p = CONFIG.palette; if (typeof i === "string" && i[0] === "#") return i; return p[(+i) | 0] || p[0]; },
        // requestAnimationFrame tween over `ms`; calls step(k) for k in 0..1
        tween(ms, step, done) {
          return new Promise((res) => {
            const t0 = performance.now();
            (function frame(now) {
              const k = ms <= 0 ? 1 : clamp((now - t0) / ms, 0, 1);
              try { step(k); } catch (e) { console.error(e); }
              if (k < 1) requestAnimationFrame(frame);
              else { if (done) done(); res(); }
            })(t0);
          });
        },
      },
    };
    // Lets a Script event command do:  Atlas.transition = 'iris'
    Object.defineProperty(Atlas, "transition", {
      get() { return Atlas.state.transition; },
      set(v) { Atlas.state.transition = v; },
    });
    atlas.onMapLoad((m) => { Atlas.state.map = m; });
    window.Drift = Atlas; // legacy alias — Script commands from pre-rebrand projects
    console.log("[Atlas] Core v" + Atlas.version + " ready");
  }

  // ---- Atlas_TextCodes: colour + BBCode markup in message text ----
  function Atlas_TextCodes(atlas, game) {
    /* Atlas_TextCodes — rich text in Show Text / Show Choices.
     *   \i[n]      inline icon from the system icon sheet (0..63)
     *   \c[n]      colour by palette index (\c[0] resets)
     *   \c[#f80]   colour by hex value
     *   [color=#f80]..[/color]  [b]..[/b]  [i]..[/i]  [size=20]..[/size]
     * Requires Atlas_Core (list it above this one). */
    if (!window.Atlas) { console.warn("Atlas_TextCodes needs Atlas_Core enabled and listed first."); return; }
    const Atlas = window.Atlas;

    // \c[..] changes colour until the next \c[..]; \c[0] / \c[] resets.
    function colorCodes(s) {
      const parts = s.split(/\\c\[([^\]]*)\]/g);
      let out = parts[0], open = false;
      for (let i = 1; i < parts.length; i += 2) {
        const code = parts[i], text = parts[i + 1] || "";
        if (open) { out += "</span>"; open = false; }
        if (code !== "" && code !== "0") { out += '<span style="color:' + Atlas.util.color(code) + '">'; open = true; }
        out += text;
      }
      if (open) out += "</span>";
      return out;
    }
    function iconCodes(s) {
      return s.replace(/\\i\[(\d+)\]/gi, (m, n) => atlas.Assets.iconHtml(n, "msg-icon"));
    }
    function bbcode(s) {
      return s
        .replace(/\[color=([^\]]+)\]/gi, (m, c) => '<span style="color:' + (/^#?[0-9a-f]{3,8}$/i.test(c) ? (c[0] === "#" ? c : "#" + c) : c) + '">')
        .replace(/\[\/color\]/gi, "</span>")
        .replace(/\[b\]/gi, '<span style="font-weight:700">').replace(/\[\/b\]/gi, "</span>")
        .replace(/\[i\]/gi, '<span style="font-style:italic">').replace(/\[\/i\]/gi, "</span>")
        .replace(/\[size=(\d+)\]/gi, (m, n) => '<span style="font-size:' + Math.max(8, Math.min(40, +n)) + 'px">')
        .replace(/\[\/size\]/gi, "</span>");
    }
    // Message text arrives already HTML-escaped, so the markup above is safe.
    atlas.onMessageText((s) => iconCodes(bbcode(colorCodes(s))));
    Atlas.register("Atlas_TextCodes", { iconCodes: iconCodes, colorCodes: colorCodes, bbcode: bbcode });
  }

  // ---- Atlas_Transitions: screen transition effects for Transfer Player ----
  function Atlas_Transitions(atlas, game) {
    /* Atlas_Transitions — transfer effects: 'fade', 'iris', 'curtain', 'slide'.
     * Choose one from a Script event command:  Atlas.transition = 'iris'
     * Requires Atlas_Core. */
    if (!window.Atlas) { console.warn("Atlas_Transitions needs Atlas_Core."); return; }
    const Atlas = window.Atlas, U = Atlas.util;
    const CONFIG = { duration: 300, default: "fade" };
    Atlas.state.transition = CONFIG.default;

    const fader = atlas.fader;
    function reset() { fader.style.transition = "none"; fader.style.clipPath = "none"; fader.style.transform = "none"; }
    function done() { fader.style.transition = ""; fader.style.clipPath = "none"; fader.style.transform = "none"; }

    const EFFECTS = {
      fade: {
        out(ms) { reset(); fader.style.opacity = "0"; return U.tween(ms, (k) => { fader.style.opacity = String(k); }); },
        in(ms) { reset(); fader.style.opacity = "1"; return U.tween(ms, (k) => { fader.style.opacity = String(1 - k); }, done); },
      },
      iris: {
        out(ms) { reset(); fader.style.opacity = "1"; return U.tween(ms, (k) => { fader.style.clipPath = "circle(" + (150 * k) + "% at 50% 50%)"; }); },
        in(ms) { reset(); fader.style.opacity = "1"; fader.style.clipPath = "circle(150% at 50% 50%)"; return U.tween(ms, (k) => { fader.style.clipPath = "circle(" + (150 * (1 - k)) + "% at 50% 50%)"; }, () => { fader.style.opacity = "0"; done(); }); },
      },
      curtain: {
        out(ms) { reset(); fader.style.opacity = "1"; fader.style.transformOrigin = "top"; return U.tween(ms, (k) => { fader.style.transform = "scaleY(" + k + ")"; }); },
        in(ms) { reset(); fader.style.opacity = "1"; fader.style.transformOrigin = "bottom"; return U.tween(ms, (k) => { fader.style.transform = "scaleY(" + (1 - k) + ")"; }, () => { fader.style.opacity = "0"; done(); }); },
      },
      slide: {
        out(ms) { reset(); fader.style.opacity = "1"; return U.tween(ms, (k) => { fader.style.transform = "translateX(" + (-100 + 100 * k) + "%)"; }); },
        in(ms) { reset(); fader.style.opacity = "1"; return U.tween(ms, (k) => { fader.style.transform = "translateX(" + (100 * k) + "%)"; }, () => { fader.style.opacity = "0"; done(); }); },
      },
    };
    atlas.setTransition({
      out(ms) { return (EFFECTS[Atlas.state.transition] || EFFECTS.fade).out(ms || CONFIG.duration); },
      in(ms) { return (EFFECTS[Atlas.state.transition] || EFFECTS.fade).in(ms || CONFIG.duration); },
    });
    Atlas.register("Atlas_Transitions", { effects: EFFECTS, set(n) { Atlas.state.transition = n; } });
  }

  // ---- Atlas_Weather: rain / storm / snow / fog overlays ----
  function Atlas_Weather(atlas, game) {
    /* Atlas_Weather — ambient weather drawn over the map.
     * Change it any time from a Script event command:
     *     Atlas.weather('rain', 6)      // type, power 1..9
     *     Atlas.weather('none')         // clear
     * Types: 'rain', 'storm', 'snow', 'fog'. Or set per-map defaults below.
     * Requires Atlas_Core. */
    if (!window.Atlas) { console.warn("Atlas_Weather needs Atlas_Core."); return; }
    const Atlas = window.Atlas, U = Atlas.util;
    const CONFIG = {
      start: "none",                      // weather when the game begins
      power: 5,                           // default intensity 1..9
      perMap: { 1: "none", 2: "fog", 3: "none" }, // map id -> weather on entering
    };
    const W = atlas.SCREEN_W, H = atlas.SCREEN_H;
    let drops = [], flakes = [], fog = [], flash = 0, seeded = false;

    function seed() {
      drops = []; flakes = []; fog = [];
      for (let i = 0; i < 170; i++) drops.push({ x: U.rand(0, W + 40), y: U.rand(0, H), v: U.rand(7, 11), len: U.rand(10, 18) });
      for (let i = 0; i < 150; i++) flakes.push({ x: U.rand(0, W), y: U.rand(0, H), v: U.rand(0.5, 1.6), r: U.rand(1.2, 2.8), p: U.rand(0, 6.28) });
      for (let i = 0; i < 6; i++) fog.push({ x: U.rand(0, W), y: U.rand(0, H), r: U.rand(120, 210), v: U.rand(0.1, 0.35) });
      seeded = true;
    }

    Atlas.weather = function (type, power) {
      Atlas.state.weather = type || "none";
      if (power != null) Atlas.state.weatherPower = power;
      if (!seeded) seed();
    };
    Atlas.state.weather = CONFIG.start;
    Atlas.state.weatherPower = CONFIG.power;

    atlas.onMapLoad((m) => {
      if (m && CONFIG.perMap[m.id] !== undefined) Atlas.weather(CONFIG.perMap[m.id], CONFIG.power);
    });

    atlas.onRender((ctx, info) => {
      const type = Atlas.state.weather;
      if (!type || type === "none") return;
      if (!seeded) seed();
      const pw = U.clamp(Atlas.state.weatherPower || 5, 1, 9) / 5;
      ctx.save();
      if (type === "rain" || type === "storm") {
        const n = Math.floor(drops.length * (type === "storm" ? 1 : 0.7) * pw);
        ctx.strokeStyle = "rgba(190,214,255,0.45)";
        ctx.lineWidth = type === "storm" ? 2 : 1.4;
        for (let i = 0; i < n; i++) {
          const d = drops[i];
          ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * 0.4, d.y + d.len); ctx.stroke();
          d.y += d.v * pw * (type === "storm" ? 1.4 : 1); d.x -= d.v * 0.3;
          if (d.y > H) { d.y = -10; d.x = U.rand(0, W + 40); }
        }
        if (type === "storm") {
          if (Math.random() < 0.006) flash = 6;
          if (flash > 0) { ctx.fillStyle = "rgba(220,230,255," + (flash / 12) + ")"; ctx.fillRect(0, 0, W, H); flash--; }
        }
      } else if (type === "snow") {
        const n = Math.floor(flakes.length * pw);
        ctx.fillStyle = "rgba(245,250,255,0.85)";
        for (let i = 0; i < n; i++) {
          const f = flakes[i];
          ctx.beginPath(); ctx.arc(f.x + Math.sin(info.t * 0.02 + f.p) * 6, f.y, f.r, 0, 6.2832); ctx.fill();
          f.y += f.v * pw; if (f.y > H) { f.y = -4; f.x = U.rand(0, W); }
        }
      } else if (type === "fog") {
        ctx.globalCompositeOperation = "lighter";
        for (const c of fog) {
          const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
          g.addColorStop(0, "rgba(150,160,180," + (0.10 * pw) + ")");
          g.addColorStop(1, "rgba(150,160,180,0)");
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 6.2832); ctx.fill();
          c.x += c.v; if (c.x - c.r > W) c.x = -c.r;
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(150,160,180," + (0.12 * pw) + ")";
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    });

    Atlas.register("Atlas_Weather", { set: Atlas.weather, config: CONFIG });
  }

  // ---- registry ----
  const LIST = [
    { key: "Atlas_Core", fn: Atlas_Core, on: true,
      desc: "Shared library every other Atlas plugin builds on. Load first." },
    { key: "Atlas_TextCodes", fn: Atlas_TextCodes, on: true,
      desc: "Inline icons (\\i[n]), colour codes (\\c[n]) and BBCode in messages." },
    { key: "Atlas_Transitions", fn: Atlas_Transitions, on: true,
      desc: "Transfer effects: fade, iris, curtain, slide." },
    { key: "Atlas_Weather", fn: Atlas_Weather, on: true,
      desc: "Rain, storm, snow and fog overlays; per-map or scripted." },
  ];

  function bodyOf(fn) {
    const s = fn.toString();
    return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}")).replace(/^\n/, "").replace(/\s+$/, "") + "\n";
  }
  function specByKey(key) { return LIST.find((s) => s.key === key); }
  function make(key, id) {
    const s = specByKey(key);
    if (!s) return null;
    return { id: id, key: s.key, name: s.key, on: s.on !== false, builtin: true, code: bodyOf(s.fn) };
  }
  function seed(startId) {
    return LIST.map((s, i) => make(s.key, (startId || 1) + i));
  }
  function missingFor(plugins) {
    return LIST.filter((s) => !(plugins || []).some((p) => p.key === s.key));
  }

  return { list: LIST, make, seed, missingFor, bodyOf, specByKey };
})();
if (typeof window !== "undefined") window.AtlasBuiltins = AtlasBuiltins;
