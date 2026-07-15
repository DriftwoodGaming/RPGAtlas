/* RPGAtlas — assets.js
   100% procedurally generated graphics. No external images. GPL-3.0-or-later (see LICENSE). */
"use strict";

const Assets = (() => {
  const TILE = 48;
  const PALETTE_COLS = 6;
  const EXTERNAL_PREFIX = "asset:";
  const external = { characters: [], facesets: [], enemies: [], tilesets: [] };
  const externalByKey = new Map();
  const faceByName = new Map();
  const ICON_SIZE = 32;
  const ICON_COLS = 8;
  const BASE_ICON_COUNT = 128;
  let iconCount = BASE_ICON_COUNT;
  let iconSetSrc = "";
  let iconSetImage = null;

  // ---------- helpers ----------
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function hex(c) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb(r, g, b) {
    return "rgb(" + Math.round(Math.max(0, Math.min(255, r))) + "," +
      Math.round(Math.max(0, Math.min(255, g))) + "," +
      Math.round(Math.max(0, Math.min(255, b))) + ")";
  }
  function shade(c, f) { const [r, g, b] = hex(c); return rgb(r * f, g * f, b * f); }
  function mix(a, b, t) {
    const A = hex(a), B = hex(b);
    return rgb(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  function mkCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
  function assetName(path) {
    const file = decodeURIComponent(String(path).split("/").pop().split("?")[0]);
    return file.replace(/\.(png|webp|jpe?g)$/i, "");
  }
  function displayName(name) {
    return name.replace(/\.(pass|terrain)$/i, "").replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  function assetKey(type, name) { return EXTERNAL_PREFIX + type + "/" + name; }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load image: " + src));
      img.src = src;
    });
  }
  async function loadIconSet(customIcons) {
    iconSetSrc = window.RPGATLAS_ICON_SET || ("img/system/icon_set.png?v=" + Date.now());
    const baseImage = await loadImage(iconSetSrc);
    const sources = Array.isArray(customIcons) ? customIcons : [];
    iconCount = BASE_ICON_COUNT + sources.length;
    if (sources.length) {
      const images = await Promise.all(sources.map(async (src, index) => {
        try {
          return await loadImage(src);
        } catch (error) {
          console.warn("Could not load custom icon " + (BASE_ICON_COUNT + index) + ":", error);
          return null;
        }
      }));
      const atlas = mkCanvas(ICON_COLS * ICON_SIZE, Math.ceil(iconCount / ICON_COLS) * ICON_SIZE);
      const g = atlas.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(baseImage, 0, 0);
      images.forEach((image, index) => {
        if (!image) return; // blank cell keeps every saved custom icon index stable
        const id = BASE_ICON_COUNT + index;
        g.drawImage(image, (id % ICON_COLS) * ICON_SIZE, Math.floor(id / ICON_COLS) * ICON_SIZE,
          ICON_SIZE, ICON_SIZE);
      });
      iconSetImage = atlas;
      iconSetSrc = atlas.toDataURL("image/png");
    } else {
      iconSetImage = baseImage;
    }
    const cssSrc = iconSetSrc.startsWith("data:") ? iconSetSrc : new URL(iconSetSrc, location.href).href;
    document.documentElement.style.setProperty("--icon-set-url", 'url("' + cssSrc + '")');
  }
  function iconSpan(index, className) {
    const span = document.createElement("span");
    span.className = "icon-sprite" + (className ? " " + className : "");
    const id = Math.max(0, Math.min(iconCount - 1, Number(index) || 0));
    span.style.setProperty("--icon-x", (-((id % ICON_COLS) * ICON_SIZE)) + "px");
    span.style.setProperty("--icon-y", (-(Math.floor(id / ICON_COLS) * ICON_SIZE)) + "px");
    span.title = "Icon " + id;
    return span;
  }
  function iconHtml(index, className) {
    const id = Math.max(0, Math.min(iconCount - 1, Number(index) || 0));
    return '<span class="icon-sprite' + (className ? " " + className : "") +
      '" style="--icon-x:-' + ((id % ICON_COLS) * ICON_SIZE) +
      'px;--icon-y:-' + (Math.floor(id / ICON_COLS) * ICON_SIZE) + 'px"></span>';
  }
  function iconCanvas(index) {
    const id = Math.max(0, Math.min(iconCount - 1, Number(index) || 0));
    const canvas = mkCanvas(ICON_SIZE, ICON_SIZE);
    if (iconSetImage) {
      const g = canvas.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(iconSetImage,
        (id % ICON_COLS) * ICON_SIZE, Math.floor(id / ICON_COLS) * ICON_SIZE, ICON_SIZE, ICON_SIZE,
        0, 0, ICON_SIZE, ICON_SIZE);
    }
    return canvas;
  }

  // ---------- input prompt glyphs (procedural; no atlas) ----------
  // Small key-cap / gamepad-button icons for the editor rebind grid and the \input[...] message
  // code. Drawn into a canvas so they inline into standalone exports for free (no asset to embed).
  // The short token to draw ("A", "LB", arrows, a key cap) comes from RA.glyphText; RA is read
  // lazily because assets.js loads before data.js in both shells.
  const GLYPH_H = 30;            // canvas height in px; width adapts to the token
  const GLYPH_FONT = '"Segoe UI", system-ui, Arial, sans-serif';
  const glyphCanvasCache = {};
  const glyphUrlCache = {};
  // Per-family face-button accent colors. Xbox = lettered colors; PlayStation = classic symbol
  // colors (✕ blue, ○ red, ▢ pink, △ green); Switch = neutral (white letter, no accent).
  const FAMILY_FACE_COLORS = {
    xbox: { face_south: "#6cc04a", face_east: "#e0584b", face_west: "#3f8ae0", face_north: "#e8b53a" },
    ps: { face_south: "#7a9bd6", face_east: "#e0584b", face_west: "#d65fb0", face_north: "#57c08a" },
    switch: null, // neutral: white letter on a dark circle
  };
  function raLookup() {
    if (typeof RA !== "undefined" && RA) return RA;
    if (typeof window !== "undefined" && window.RA) return window.RA;
    return null;
  }
  function glyphToken(device, code, family) {
    const R = raLookup();
    return R && R.glyphText ? R.glyphText(device, code, family) : code;
  }
  function glyphShapeOf(device, code) {
    if (device !== "gamepad") return "pill";
    const R = raLookup();
    return R && R.glyphShape ? R.glyphShape(code) : "pill";
  }
  function faceColor(family, code) {
    const fam = FAMILY_FACE_COLORS[family] || FAMILY_FACE_COLORS.xbox;
    return (fam && fam[code]) || "#eef1f6";
  }
  function dirOf(code) {
    if (/up$/.test(code)) return "up";
    if (/down$/.test(code)) return "down";
    if (/left$/.test(code)) return "left";
    if (/right$/.test(code)) return "right";
    return null;
  }
  function roundRectPath(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  // A direction arrowhead, shared by the d-pad and analog-stick glyphs.
  function drawArrow(g, cx, cy, dir, s) {
    g.beginPath();
    if (dir === "up") { g.moveTo(cx, cy - s); g.lineTo(cx - s, cy + s * 0.7); g.lineTo(cx + s, cy + s * 0.7); }
    else if (dir === "down") { g.moveTo(cx, cy + s); g.lineTo(cx - s, cy - s * 0.7); g.lineTo(cx + s, cy - s * 0.7); }
    else if (dir === "left") { g.moveTo(cx - s, cy); g.lineTo(cx + s * 0.7, cy - s); g.lineTo(cx + s * 0.7, cy + s); }
    else { g.moveTo(cx + s, cy); g.lineTo(cx - s * 0.7, cy - s); g.lineTo(cx - s * 0.7, cy + s); }
    g.closePath(); g.fill();
  }
  // D-pad: a plus/cross silhouette with a direction arrowhead at the centre.
  function drawDpad(g, W, H, dir) {
    const cx = W / 2, cy = H / 2, t = Math.round(H * 0.32), pad = 3;
    const grad = g.createLinearGradient(0, pad, 0, H - pad);
    grad.addColorStop(0, "#41454f"); grad.addColorStop(1, "#2a2d35");
    g.fillStyle = grad;
    roundRectPath(g, cx - t / 2, pad, t, H - pad * 2, 3); g.fill();
    roundRectPath(g, pad, cy - t / 2, W - pad * 2, t, 3); g.fill();
    g.lineWidth = 1.2; g.strokeStyle = "#11131a";
    roundRectPath(g, cx - t / 2, pad, t, H - pad * 2, 3); g.stroke();
    roundRectPath(g, pad, cy - t / 2, W - pad * 2, t, 3); g.stroke();
    if (dir) { g.fillStyle = "#cdd6e6"; drawArrow(g, cx, cy, dir, H * 0.20); }
  }
  // Analog stick: a round stick-top (ring) with either a push-direction arrow or an L3/R3 label.
  function drawStick(g, W, H, dir, label) {
    const cx = W / 2, cy = H / 2, r = (Math.min(W, H) - 6) / 2;
    const grad = g.createRadialGradient(cx, cy - r * 0.3, r * 0.2, cx, cy, r);
    grad.addColorStop(0, "#4a4f5b"); grad.addColorStop(1, "#23262e");
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.lineWidth = 1.5; g.strokeStyle = "#11131a";
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1; g.strokeStyle = "rgba(180,190,210,0.35)"; // concave inner lip
    g.beginPath(); g.arc(cx, cy, r * 0.55, 0, Math.PI * 2); g.stroke();
    if (dir) { g.fillStyle = "#cdd6e6"; drawArrow(g, cx, cy, dir, r * 0.5); }
    else if (label) { g.fillStyle = "#eef1f6"; g.fillText(label, cx, cy + 0.5); }
  }
  function inputGlyphCanvas(device, code, family) {
    family = device === "gamepad" ? (family || "xbox") : "xbox";
    const key = device + "_" + code + "_" + family;
    if (glyphCanvasCache[key]) return glyphCanvasCache[key];
    const shape = glyphShapeOf(device, code);
    const H = GLYPH_H, inset = 1.5;
    let canvas, g, W;
    if (shape === "dpad" || shape === "stick") {
      W = H; canvas = mkCanvas(W, H); g = canvas.getContext("2d");
      g.textAlign = "center"; g.textBaseline = "middle";
      if (shape === "dpad") drawDpad(g, W, H, dirOf(code));
      else drawStick(g, W, H, dirOf(code), null);
    } else if (shape === "stick_click") {
      W = H; canvas = mkCanvas(W, H); g = canvas.getContext("2d");
      g.font = "600 " + Math.round(H * 0.40) + "px " + GLYPH_FONT;
      g.textAlign = "center"; g.textBaseline = "middle";
      drawStick(g, W, H, null, String(glyphToken(device, code, family) || "L3"));
    } else if (shape === "face") {
      W = H; canvas = mkCanvas(W, H); g = canvas.getContext("2d");
      const txt = String(glyphToken(device, code, family) || code || "?");
      g.font = "600 " + Math.round(H * (txt.length > 1 ? 0.46 : 0.56)) + "px " + GLYPH_FONT;
      g.textAlign = "center"; g.textBaseline = "middle";
      const cx = W / 2, r = (H - inset * 2) / 2;
      const grad = g.createLinearGradient(0, inset, 0, H - inset);
      grad.addColorStop(0, "#3a3f4b"); grad.addColorStop(1, "#23262e");
      g.fillStyle = grad;
      g.beginPath(); g.arc(cx, H / 2, r, 0, Math.PI * 2); g.fill();
      g.lineWidth = 1.5; g.strokeStyle = "#11131a";
      g.beginPath(); g.arc(cx, H / 2, r, 0, Math.PI * 2); g.stroke();
      g.fillStyle = faceColor(family, code);
      g.fillText(txt, cx, H / 2 + 0.5);
    } else {
      // pill / key-cap (bumpers, triggers, start/select, all keyboard codes) — width fits the token.
      const txt = String(glyphToken(device, code, family) || code || "?");
      const fontPx = Math.round(H * (txt.length > 1 ? 0.46 : 0.56));
      const meas = mkCanvas(2, 2).getContext("2d");
      meas.font = "600 " + fontPx + "px " + GLYPH_FONT;
      const tw = Math.ceil(meas.measureText(txt).width);
      W = Math.max(H, tw + Math.round(H * 0.7));
      canvas = mkCanvas(W, H); g = canvas.getContext("2d");
      g.font = "600 " + fontPx + "px " + GLYPH_FONT;
      g.textAlign = "center"; g.textBaseline = "middle";
      const grad = g.createLinearGradient(0, inset, 0, H - inset);
      grad.addColorStop(0, "#41454f"); grad.addColorStop(1, "#2a2d35");
      g.fillStyle = grad;
      roundRectPath(g, inset, inset, W - inset * 2, H - inset * 2, 6); g.fill();
      g.lineWidth = 1.5; g.strokeStyle = "#11131a";
      roundRectPath(g, inset, inset, W - inset * 2, H - inset * 2, 6); g.stroke();
      g.fillStyle = "#eef1f6";
      g.fillText(txt, W / 2, H / 2 + 0.5);
    }
    glyphCanvasCache[key] = canvas;
    return canvas;
  }
  // Cached data: URL — use this for an <img> (a cached canvas node can only live in one place).
  function inputGlyphDataUrl(device, code, family) {
    family = device === "gamepad" ? (family || "xbox") : "xbox";
    const key = device + "_" + code + "_" + family;
    if (!glyphUrlCache[key]) glyphUrlCache[key] = inputGlyphCanvas(device, code, family).toDataURL();
    return glyphUrlCache[key];
  }
  function inputGlyphHtml(device, code, family, className) {
    const R = raLookup();
    const alt = (R && R.codeLabel ? R.codeLabel(device, code, family) : code) || "";
    const cls = "input-glyph" + (className ? " " + className : "");
    return '<img class="' + cls + '" draggable="false" alt="' +
      String(alt).replace(/"/g, "&quot;") + '" src="' + inputGlyphDataUrl(device, code, family) + '">';
  }
  async function discoverFolder(type) {
    try {
      const res = await fetch("img/" + type + "/");
      if (!res.ok) return [];
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const found = [];
      for (const link of doc.querySelectorAll("a[href]")) {
        const url = new URL(link.getAttribute("href"), res.url);
        if (!/\.(png|webp|jpe?g)$/i.test(url.pathname)) continue;
        found.push({ type, name: assetName(url.pathname), src: url.href });
      }
      return found;
    } catch (e) {
      console.warn("Could not scan img/" + type + "/.", e);
      return [];
    }
  }
  // Device-library entries (Phase 6): the asset-library service publishes
  // image-type records here (same {type,name,src} shape as RPGATLAS_ASSETS)
  // before loadExternalAssets runs. Appended AFTER the shipped img/ catalog so
  // a same-key library asset shadows the shipped one at bind time.
  function libraryEntries() {
    const list = window.RPGATLAS_LIBRARY_ASSETS;
    if (!Array.isArray(list)) return [];
    return list.filter((item) => item && external[item.type] !== undefined && item.src);
  }
  async function discoverExternalAssets() {
    if (window.RPGATLAS_ASSETS) return window.RPGATLAS_ASSETS; // standalone export: embedded only
    try {
      const res = await fetch("img/assets.json");
      if (res.ok) {
        const manifest = await res.json();
        const listed = [];
        for (const type of Object.keys(external)) {
          for (const file of manifest[type] || []) {
            listed.push({ type, name: assetName(file), src: new URL("img/" + type + "/" + file, location.href).href });
          }
        }
        return listed.concat(libraryEntries());
      } else if (res.status !== 404) {
          console.warn("Asset manifest fetch failed with status " + res.status);
      }
    } catch (e) {
        // Silenciar erro de rede ou parse
    }
    const groups = await Promise.all(Object.keys(external).map(discoverFolder));
    return groups.flat().sort((a, b) => (a.type + "/" + a.name).localeCompare(b.type + "/" + b.name)).concat(libraryEntries());
  }
  async function prepareExternalAssets(catalog) {
    // Audio entries (Phase 6) ride the same embedded catalog in exports but
    // never bind here — the streamed deck resolves them by key.
    const items = (catalog || []).filter((item) => item.type !== "audio");
    // A device library can hold thousands of images (a sliced tileset sheet is
    // hundreds of tiles), so decode through a small pool instead of one await
    // per image — sequential decodes left the editor bootless for minutes.
    const POOL = 16;
    const ready = new Array(items.length);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        const item = items[i];
        try {
          ready[i] = { ...item, image: await loadImage(item.src) };
        } catch (e) { console.warn(e.message); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, worker));
    return ready.filter(Boolean);
  }

  // speckle texture over the whole tile
  function speckle(g, r, base, n, light, dark) {
    for (let i = 0; i < n; i++) {
      const x = Math.floor(r() * 16) * 3, y = Math.floor(r() * 16) * 3;
      px(g, x, y, 3, 3, r() < 0.5 ? shade(base, dark) : shade(base, light));
    }
  }

  // ---------- tiles ----------
  // Each tile: { key, name, pass, draw(g, r) } — g translated to tile origin, r seeded rng.
  const tiles = [];
  function defTile(key, name, pass, draw) { tiles.push({ key, name, pass, draw }); }

  defTile("empty", "Empty", false, () => {});

  defTile("grass", "Grass", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#4f8f3e");
    speckle(g, r, "#4f8f3e", 26, 1.18, 0.85);
  });
  defTile("flowers", "Flowers", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#4f8f3e");
    speckle(g, r, "#4f8f3e", 18, 1.15, 0.87);
    const cols = ["#e8d44f", "#e06a8a", "#eeeeee", "#8a6ae0"];
    for (let i = 0; i < 4; i++) {
      const x = 6 + Math.floor(r() * 12) * 3, y = 6 + Math.floor(r() * 12) * 3;
      px(g, x, y, 3, 3, cols[Math.floor(r() * cols.length)]);
      px(g, x, y + 3, 3, 3, "#2f6f2a");
    }
  });
  defTile("tallgrass", "Tall Grass", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#46823a");
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(r() * 15) * 3, y = 9 + Math.floor(r() * 12) * 3;
      px(g, x, y, 3, 12, shade("#3f7a30", 0.9 + r() * 0.4));
      px(g, x, y - 3, 3, 3, "#5fa548");
    }
  });
  defTile("dirt", "Dirt", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#8a6a45");
    speckle(g, r, "#8a6a45", 24, 1.15, 0.85);
  });
  defTile("sand", "Sand", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#d8c07a");
    speckle(g, r, "#d8c07a", 22, 1.08, 0.92);
  });
  defTile("path", "Path", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#b09a6e");
    speckle(g, r, "#b09a6e", 16, 1.1, 0.88);
    for (let i = 0; i < 4; i++) {
      const x = 3 + Math.floor(r() * 12) * 3, y = 3 + Math.floor(r() * 12) * 3;
      px(g, x, y, 6, 3, shade("#b09a6e", 0.8));
    }
  });
  defTile("water", "Water", false, (g, r) => {
    px(g, 0, 0, 48, 48, "#2f6fa8");
    speckle(g, r, "#2f6fa8", 10, 1.12, 0.92);
    g.strokeStyle = "#6fa8d8"; g.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const y = 8 + i * 14 + r() * 6, x = r() * 20;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 7, y - 4, x + 14, y); g.stroke();
    }
  });
  defTile("deepwater", "Deep Water", false, (g, r) => {
    px(g, 0, 0, 48, 48, "#1f4f80");
    speckle(g, r, "#1f4f80", 8, 1.12, 0.9);
  });
  defTile("stonefloor", "Stone Floor", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#9a9a9a");
    px(g, 0, 0, 48, 2, "#7a7a7a"); px(g, 0, 24, 48, 2, "#7a7a7a");
    px(g, 0, 0, 2, 48, "#7a7a7a"); px(g, 24, 0, 2, 24, "#7a7a7a"); px(g, 12, 24, 2, 24, "#7a7a7a");
    speckle(g, r, "#9a9a9a", 10, 1.08, 0.92);
  });
  defTile("woodfloor", "Wood Floor", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#a9824f");
    for (let i = 0; i < 4; i++) px(g, 0, i * 12, 48, 1, "#7a5c34");
    for (let i = 0; i < 4; i++) px(g, Math.floor(r() * 14) * 3, i * 12 + 3, 3, 6, shade("#a9824f", 0.85));
  });
  defTile("carpet", "Carpet", true, (g) => {
    px(g, 0, 0, 48, 48, "#9e3a3a");
    px(g, 3, 3, 42, 42, "#b54848");
    px(g, 6, 6, 36, 36, "#9e3a3a");
    px(g, 21, 21, 6, 6, "#d8b04f");
  });
  defTile("cavefloor", "Cave Floor", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#5a5560");
    speckle(g, r, "#5a5560", 22, 1.15, 0.82);
  });
  defTile("bridge", "Bridge", true, (g) => {
    px(g, 0, 0, 48, 48, "#8a6a3f");
    for (let i = 0; i < 4; i++) px(g, 0, i * 12 + 5, 48, 2, "#6a4f2c");
    px(g, 0, 0, 4, 48, "#5c421f"); px(g, 44, 0, 4, 48, "#5c421f");
  });
  defTile("stairs", "Stairs", true, (g) => {
    for (let i = 0; i < 4; i++) {
      px(g, 0, i * 12, 48, 12, shade("#9a9a9a", 1 - i * 0.1));
      px(g, 0, i * 12, 48, 2, "#666");
    }
  });
  defTile("tree", "Tree", false, (g, r) => {
    px(g, 21, 30, 6, 16, "#6a4a28");
    g.fillStyle = "#2f7030";
    g.beginPath(); g.arc(24, 20, 17, 0, 7); g.fill();
    g.fillStyle = "#3f8f3c";
    g.beginPath(); g.arc(18, 15, 10, 0, 7); g.fill();
    g.beginPath(); g.arc(30, 19, 9, 0, 7); g.fill();
    for (let i = 0; i < 5; i++) px(g, 10 + r() * 26, 8 + r() * 20, 3, 3, "#57a850");
  });
  defTile("pine", "Pine Tree", false, (g) => {
    px(g, 21, 36, 6, 10, "#5c421f");
    g.fillStyle = "#26603a";
    g.beginPath(); g.moveTo(24, 2); g.lineTo(40, 22); g.lineTo(8, 22); g.fill();
    g.fillStyle = "#2f7548";
    g.beginPath(); g.moveTo(24, 12); g.lineTo(42, 38); g.lineTo(6, 38); g.fill();
  });
  defTile("bush", "Bush", false, (g, r) => {
    g.fillStyle = "#357a32";
    g.beginPath(); g.arc(15, 32, 11, 0, 7); g.arc(30, 30, 12, 0, 7); g.arc(24, 24, 10, 0, 7); g.fill();
    for (let i = 0; i < 4; i++) px(g, 9 + r() * 28, 20 + r() * 18, 3, 3, "#4f9f48");
  });
  defTile("rock", "Rock", false, (g) => {
    g.fillStyle = "#8a8a8a";
    g.beginPath(); g.moveTo(8, 40); g.lineTo(12, 18); g.lineTo(26, 10); g.lineTo(40, 22); g.lineTo(40, 40); g.fill();
    g.fillStyle = "#a8a8a8";
    g.beginPath(); g.moveTo(12, 18); g.lineTo(26, 10); g.lineTo(30, 20); g.lineTo(16, 26); g.fill();
    px(g, 8, 40, 32, 4, "#6a6a6a");
  });
  defTile("fence", "Fence", false, (g) => {
    px(g, 4, 14, 6, 28, "#8a6a3f"); px(g, 38, 14, 6, 28, "#8a6a3f");
    px(g, 0, 18, 48, 5, "#a9824f"); px(g, 0, 30, 48, 5, "#a9824f");
    px(g, 4, 12, 6, 3, "#6a4f2c"); px(g, 38, 12, 6, 3, "#6a4f2c");
  });
  defTile("cliff", "Cliff", false, (g, r) => {
    px(g, 0, 0, 48, 48, "#7a6045");
    px(g, 0, 0, 48, 6, "#9a805f");
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(r() * 14) * 3, y = 9 + Math.floor(r() * 12) * 3;
      px(g, x, y, 9, 3, "#5f4a32");
    }
    px(g, 0, 44, 48, 4, "#503c26");
  });
  defTile("wall_brick", "Brick Wall", false, (g) => {
    px(g, 0, 0, 48, 48, "#9a5f4a");
    g.fillStyle = "#7a4536";
    for (let y = 0; y < 4; y++) {
      g.fillRect(0, y * 12, 48, 2);
      const off = (y % 2) * 12;
      for (let x = -1; x < 3; x++) g.fillRect(off + x * 24, y * 12, 2, 12);
    }
  });
  defTile("wall_wood", "Wood Wall", false, (g) => {
    px(g, 0, 0, 48, 48, "#9a7445");
    for (let i = 0; i < 4; i++) px(g, i * 12, 0, 2, 48, "#6f5230");
    px(g, 0, 0, 48, 4, "#6f5230");
  });
  defTile("wall_stone", "Stone Wall", false, (g, r) => {
    px(g, 0, 0, 48, 48, "#808088");
    g.fillStyle = "#5f5f66";
    for (let y = 0; y < 3; y++) {
      g.fillRect(0, y * 16, 48, 2);
      const off = (y % 2) * 12;
      for (let x = 0; x < 3; x++) g.fillRect(off + x * 20, y * 16, 2, 16);
    }
    speckle(g, r, "#808088", 8, 1.1, 0.9);
  });
  defTile("roof_red", "Red Roof", false, (g) => {
    px(g, 0, 0, 48, 48, "#a83a3a");
    g.fillStyle = "#8a2c2c";
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.beginPath(); g.arc(x * 12 + 6 + (y % 2) * 6, y * 12 + 10, 6, Math.PI, 0); g.fill();
      }
    }
  });
  defTile("roof_blue", "Blue Roof", false, (g) => {
    px(g, 0, 0, 48, 48, "#3a5a9a");
    g.fillStyle = "#2c4478";
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.beginPath(); g.arc(x * 12 + 6 + (y % 2) * 6, y * 12 + 10, 6, Math.PI, 0); g.fill();
      }
    }
  });
  defTile("door", "Door (passable)", true, (g) => {
    px(g, 6, 2, 36, 46, "#6f4a26");
    px(g, 9, 5, 30, 43, "#8a6236");
    px(g, 12, 8, 11, 18, "#6f4a26"); px(g, 25, 8, 11, 18, "#6f4a26");
    px(g, 31, 30, 4, 4, "#d8b04f");
  });
  defTile("window", "Window", false, (g) => {
    px(g, 0, 0, 48, 48, "#9a7445");
    for (let i = 0; i < 4; i++) px(g, i * 12, 0, 2, 48, "#6f5230");
    px(g, 9, 9, 30, 30, "#5c421f");
    px(g, 12, 12, 24, 24, "#a8d8f0");
    px(g, 23, 12, 2, 24, "#5c421f"); px(g, 12, 23, 24, 2, "#5c421f");
  });
  defTile("table", "Table", false, (g) => {
    px(g, 4, 10, 40, 26, "#8a6236");
    px(g, 6, 12, 36, 22, "#a9824f");
    px(g, 8, 36, 6, 9, "#6f4a26"); px(g, 34, 36, 6, 9, "#6f4a26");
  });
  defTile("chair", "Chair (passable)", true, (g) => {
    px(g, 14, 8, 20, 6, "#8a6236");
    px(g, 14, 14, 4, 16, "#8a6236");
    px(g, 14, 26, 20, 8, "#a9824f");
    px(g, 14, 34, 4, 8, "#6f4a26"); px(g, 30, 34, 4, 8, "#6f4a26");
  });
  defTile("bed", "Bed", false, (g) => {
    px(g, 4, 4, 40, 40, "#8a6236");
    px(g, 6, 6, 36, 36, "#d8d8e0");
    px(g, 6, 6, 36, 12, "#eeeef4");
    px(g, 6, 20, 36, 22, "#a83a4a");
    px(g, 6, 20, 36, 3, "#8a2c3c");
  });
  defTile("shelf", "Shelf", false, (g) => {
    px(g, 2, 2, 44, 44, "#6f4a26");
    px(g, 5, 5, 38, 17, "#503418"); px(g, 5, 26, 38, 17, "#503418");
    const cols = ["#a8443a", "#3a7a4a", "#3a5a9a", "#d8b04f"];
    for (let i = 0; i < 4; i++) px(g, 8 + i * 9, 9, 6, 13, cols[i]);
    for (let i = 0; i < 4; i++) px(g, 8 + i * 9, 30, 6, 13, cols[3 - i]);
  });
  defTile("counter", "Counter", false, (g) => {
    px(g, 0, 8, 48, 34, "#8a6236");
    px(g, 0, 8, 48, 8, "#bf9a5f");
    px(g, 0, 16, 48, 2, "#503418");
  });
  defTile("pot", "Pot", false, (g) => {
    g.fillStyle = "#9a6a45";
    g.beginPath(); g.ellipse(24, 28, 14, 16, 0, 0, 7); g.fill();
    g.fillStyle = "#7a5234";
    g.beginPath(); g.ellipse(24, 14, 9, 4, 0, 0, 7); g.fill();
    px(g, 14, 24, 8, 3, "#bf8f5f");
  });
  defTile("barrel", "Barrel", false, (g) => {
    px(g, 10, 6, 28, 38, "#8a6236");
    g.fillStyle = "#a9824f";
    g.beginPath(); g.ellipse(24, 25, 16, 19, 0, 0, 7); g.fill();
    px(g, 8, 14, 32, 3, "#503418"); px(g, 8, 33, 32, 3, "#503418");
    g.fillStyle = "#7a5c34";
    g.beginPath(); g.ellipse(24, 8, 13, 4, 0, 0, 7); g.fill();
  });
  defTile("cavewall", "Cave Wall", false, (g, r) => {
    px(g, 0, 0, 48, 48, "#3a3540");
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(r() * 14) * 3, y = Math.floor(r() * 14) * 3;
      px(g, x, y, 9, 6, shade("#3a3540", 0.8 + r() * 0.5));
    }
    px(g, 0, 44, 48, 4, "#262230");
  });
  defTile("lava", "Lava", false, (g, r) => {
    px(g, 0, 0, 48, 48, "#c84a1f");
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(r() * 14) * 3, y = Math.floor(r() * 14) * 3;
      px(g, x, y, 6 + Math.floor(r() * 3) * 3, 3, "#f0a030");
    }
    speckle(g, r, "#c84a1f", 6, 0.75, 0.75);
  });
  defTile("mushroom", "Mushrooms (passable)", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#5a5560");
    speckle(g, r, "#5a5560", 14, 1.12, 0.85);
    const spots = [[14, 30], [30, 22], [24, 36]];
    for (const [x, y] of spots) {
      px(g, x + 3, y, 3, 8, "#d8d0c0");
      px(g, x, y - 4, 9, 5, "#b05a9a");
      px(g, x + 3, y - 3, 3, 2, "#e8d8e8");
    }
  });

  // ---------- expanded tiles ----------
  defTile("snow", "Snow", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#eef7f9");
    speckle(g, r, "#eef7f9", 20, 1.04, 0.95);
  });
  defTile("ice", "Ice", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#a3e0eb");
    speckle(g, r, "#a3e0eb", 12, 1.08, 0.92);
    g.strokeStyle = "#ffffff"; g.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const x = 6 + r() * 26, y = 6 + r() * 26;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10, y - 6); g.stroke();
    }
  });
  defTile("swamp", "Swamp Water", false, (g, r) => {
    px(g, 0, 0, 48, 48, "#2d3b26");
    speckle(g, r, "#2d3b26", 14, 1.15, 0.85);
    g.strokeStyle = "#526a45"; g.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const y = 8 + i * 14 + r() * 6, x = r() * 20;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 14, y); g.stroke();
    }
  });
  defTile("crystalfloor", "Crystal Floor", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#2e1f3d");
    speckle(g, r, "#2e1f3d", 15, 1.25, 0.8);
    const cols = ["#b030b0", "#8030a0", "#d85fd8"];
    for (let i = 0; i < 4; i++) {
      const x = 6 + Math.floor(r() * 12) * 3, y = 6 + Math.floor(r() * 12) * 3;
      px(g, x, y, 3, 3, cols[Math.floor(r() * cols.length)]);
    }
  });
  defTile("checkered", "Checkered Floor", true, (g) => {
    px(g, 0, 0, 48, 48, "#d5d5d8");
    px(g, 0, 0, 24, 24, "#404045");
    px(g, 24, 24, 24, 24, "#404045");
    px(g, 0, 0, 48, 1, "#222"); px(g, 0, 24, 48, 1, "#222");
    px(g, 0, 0, 1, 48, "#222"); px(g, 24, 0, 1, 48, "#222");
  });
  defTile("brickfloor", "Brick Floor", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#b05545");
    g.fillStyle = "#8a3a2d";
    for (let y = 0; y < 6; y++) {
      g.fillRect(0, y * 8, 48, 1);
      const off = (y % 2) * 12;
      for (let x = -1; x < 5; x++) g.fillRect(off + x * 24, y * 8, 1, 8);
    }
    speckle(g, r, "#b05545", 8, 1.1, 0.9);
  });
  defTile("snowtree", "Snow Tree", false, (g) => {
    px(g, 21, 30, 6, 16, "#5c421f");
    g.fillStyle = "#2a525c";
    g.beginPath(); g.arc(24, 20, 17, 0, 7); g.fill();
    g.fillStyle = "#edf9fa";
    g.beginPath(); g.arc(24, 15, 12, 0, 7); g.fill();
    g.fillStyle = "#3c6e7a";
    g.beginPath(); g.arc(16, 22, 8, 0, 7); g.arc(32, 22, 8, 0, 7); g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath(); g.arc(16, 19, 5, 0, 7); g.arc(32, 19, 5, 0, 7); g.fill();
  });
  defTile("cactus", "Cactus", false, (g) => {
    px(g, 21, 10, 6, 34, "#3a7d44");
    px(g, 12, 18, 9, 5, "#3a7d44");
    px(g, 12, 12, 5, 10, "#3a7d44");
    px(g, 27, 24, 9, 5, "#3a7d44");
    px(g, 31, 18, 5, 10, "#3a7d44");
    px(g, 24, 8, 1, 2, "#e5ffd8");
    px(g, 10, 12, 2, 1, "#e5ffd8");
    px(g, 36, 18, 2, 1, "#e5ffd8");
  });
  defTile("deadtree", "Dead Tree", false, (g) => {
    px(g, 21, 28, 6, 18, "#4a3c31");
    g.strokeStyle = "#4a3c31"; g.lineWidth = 4;
    g.beginPath(); g.moveTo(24, 28); g.lineTo(12, 18); g.lineTo(8, 14); g.stroke();
    g.beginPath(); g.moveTo(24, 24); g.lineTo(34, 14); g.lineTo(38, 10); g.stroke();
    g.beginPath(); g.moveTo(24, 20); g.lineTo(24, 8); g.stroke();
  });
  defTile("crystals", "Crystals", false, (g) => {
    g.fillStyle = "#8a3ab0";
    g.beginPath(); g.moveTo(12, 40); g.lineTo(18, 12); g.lineTo(26, 20); g.lineTo(20, 40); g.fill();
    g.fillStyle = "#b85ce6";
    g.beginPath(); g.moveTo(18, 12); g.lineTo(26, 20); g.lineTo(23, 25); g.fill();
    g.fillStyle = "#2d8ab0";
    g.beginPath(); g.moveTo(26, 40); g.lineTo(34, 16); g.lineTo(40, 28); g.lineTo(32, 40); g.fill();
    g.fillStyle = "#5cc6e6";
    g.beginPath(); g.moveTo(34, 16); g.lineTo(40, 28); g.lineTo(37, 30); g.fill();
  });
  defTile("pillar", "Stone Pillar", false, (g) => {
    px(g, 10, 8, 28, 36, "#7d7d82");
    px(g, 8, 4, 32, 4, "#505055");
    px(g, 8, 40, 32, 6, "#505055");
    px(g, 15, 8, 2, 32, "#505055");
    px(g, 23, 8, 2, 32, "#505055");
    px(g, 31, 8, 2, 32, "#505055");
    px(g, 11, 8, 3, 32, "#9c9ca3");
  });
  defTile("crate", "Wooden Crate", false, (g) => {
    px(g, 6, 6, 36, 36, "#8a6236");
    px(g, 8, 8, 32, 32, "#a9824f");
    px(g, 6, 6, 36, 4, "#6f4a26");
    px(g, 6, 38, 36, 4, "#6f4a26");
    px(g, 6, 6, 4, 36, "#6f4a26");
    px(g, 38, 6, 4, 36, "#6f4a26");
    g.strokeStyle = "#6f4a26"; g.lineWidth = 4;
    g.beginPath(); g.moveTo(8, 8); g.lineTo(40, 40); g.stroke();
  });
  defTile("chest", "Treasure Chest", false, (g) => {
    px(g, 8, 12, 32, 28, "#8a6236");
    px(g, 8, 12, 32, 12, "#6f4a26");
    px(g, 6, 24, 36, 3, "#3a3a3a");
    px(g, 14, 12, 3, 28, "#ffd86a");
    px(g, 31, 12, 3, 28, "#ffd86a");
    px(g, 22, 22, 4, 6, "#ffd86a");
    px(g, 23, 25, 2, 3, "#3a3a3a");
  });
  defTile("statue", "Stone Statue", false, (g) => {
    px(g, 12, 32, 24, 12, "#6f6f75");
    px(g, 10, 40, 28, 4, "#505055");
    g.fillStyle = "#8d8d94";
    g.beginPath(); g.arc(24, 16, 7, 0, 7); g.fill();
    g.beginPath(); g.moveTo(24, 23); g.lineTo(14, 32); g.lineTo(34, 32); g.closePath(); g.fill();
    g.fillStyle = "#505055";
    g.fillRect(12, 22, 4, 10);
    g.beginPath(); g.arc(32, 25, 5, 0, 7); g.fill();
  });
  defTile("flowerpot", "Flower Pot", false, (g) => {
    px(g, 16, 28, 16, 16, "#c07848");
    px(g, 14, 28, 20, 3, "#d08858");
    px(g, 23, 14, 2, 14, "#448c40");
    g.fillStyle = "#448c40";
    g.beginPath(); g.ellipse(19, 20, 5, 2, -0.4, 0, 7); g.fill();
    g.beginPath(); g.ellipse(29, 17, 5, 2, 0.4, 0, 7); g.fill();
    g.fillStyle = "#e04060";
    g.beginPath(); g.arc(24, 11, 4, 0, 7); g.fill();
    g.fillStyle = "#ffd86a";
    g.beginPath(); g.arc(24, 11, 1.5, 0, 7); g.fill();
  });
  defTile("lava_rock", "Lava Rock", false, (g, r) => {
    px(g, 0, 0, 48, 48, "#c84a1f");
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(r() * 14) * 3, y = Math.floor(r() * 14) * 3;
      px(g, x, y, 6, 3, "#f0a030");
    }
    speckle(g, r, "#c84a1f", 4, 0.75, 0.75);
    g.fillStyle = "#2a2530";
    g.beginPath(); g.moveTo(8, 36); g.lineTo(14, 14); g.lineTo(34, 10); g.lineTo(40, 24); g.lineTo(38, 38); g.closePath(); g.fill();
    g.fillStyle = "#403c4a";
    g.beginPath(); g.moveTo(14, 14); g.lineTo(34, 10); g.lineTo(30, 24); g.lineTo(18, 26); g.fill();
  });
  defTile("bookshelf", "Bookshelf", false, (g) => {
    px(g, 2, 2, 44, 44, "#6f4a26");
    px(g, 5, 5, 38, 8, "#503418"); px(g, 5, 17, 38, 8, "#503418");
    px(g, 5, 29, 38, 8, "#503418");
    px(g, 2, 13, 44, 2, "#6f4a26"); px(g, 2, 25, 44, 2, "#6f4a26"); px(g, 2, 37, 44, 2, "#6f4a26");
    const cols = ["#a8443a", "#3a7a4a", "#3a5a9a", "#d8b04f", "#e8e8e8"];
    for (let i = 0; i < 7; i++) px(g, 6 + i * 5, 6, 4, 7, cols[(i * 3) % cols.length]);
    for (let i = 0; i < 6; i++) px(g, 8 + i * 5, 18, 4, 7, cols[(i * 2) % cols.length]);
    for (let i = 0; i < 7; i++) px(g, 7 + i * 5, 30, 4, 7, cols[(i * 4) % cols.length]);
  });
  defTile("torch", "Wall Torch", false, (g) => {
    px(g, 0, 0, 48, 48, "#808088");
    g.fillStyle = "#5f5f66";
    px(g, 0, 24, 48, 2);
    px(g, 22, 24, 4, 14, "#404040");
    px(g, 20, 20, 8, 5, "#5a5a5a");
    g.fillStyle = "#f0a030";
    g.beginPath(); g.moveTo(24, 4); g.quadraticCurveTo(18, 12, 21, 20); g.lineTo(27, 20); g.quadraticCurveTo(30, 12, 24, 4); g.fill();
    g.fillStyle = "#ffd86a";
    g.beginPath(); g.moveTo(24, 9); g.quadraticCurveTo(20, 14, 22, 20); g.lineTo(26, 20); g.quadraticCurveTo(28, 14, 24, 9); g.fill();
  });
  defTile("waterlily", "Water Lily", true, (g, r) => {
    px(g, 0, 0, 48, 48, "#2f6fa8");
    speckle(g, r, "#2f6fa8", 8, 1.12, 0.92);
    g.fillStyle = "#2d7a3e";
    g.beginPath(); g.arc(24, 24, 14, 0.25, Math.PI * 2 - 0.25);
    g.lineTo(24, 24); g.closePath(); g.fill();
    g.fillStyle = "#e078b0";
    g.beginPath(); g.arc(24, 18, 4, 0, 7); g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath(); g.arc(24, 18, 1.5, 0, 7); g.fill();
  });
  defTile("cobweb", "Cobweb (passable)", true, (g) => {
    g.strokeStyle = "rgba(220, 220, 230, 0.6)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(36, 36); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(48, 20); g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(20, 48); g.stroke();
    for (let r2 = 10; r2 <= 40; r2 += 10) {
      g.beginPath();
      g.arc(0, 0, r2, 0, Math.PI / 2);
      g.stroke();
    }
  });

  const T = {};
  tiles.forEach((t, i) => { T[t.key] = i; });

  // terrain tiles cover the whole cell and belong on the ground layer (used by the
  // editor's Auto-layer mode); everything else is decoration.
  const TERRAIN_KEYS = new Set([
    "grass", "flowers", "tallgrass", "dirt", "sand", "path", "water", "deepwater",
    "stonefloor", "woodfloor", "carpet", "cavefloor", "bridge", "stairs", "lava", "mushroom",
    "snow", "ice", "swamp", "crystalfloor", "checkered", "brickfloor", "waterlily"
  ]);
  tiles.forEach((t) => { t.terrain = TERRAIN_KEYS.has(t.key); });

  // pre-render each tile once (seed fixed per id) for palette + fast map blits
  const tileCache = [];
  function tileCanvas(id) {
    if (!tileCache[id]) {
      const c = mkCanvas(TILE, TILE), g = c.getContext("2d");
      if (id !== T.empty) { tiles[id].draw(g, rng(id * 7919 + 17)); }
      tileCache[id] = c;
    }
    return tileCache[id];
  }
  function drawTile(ctx, id, dx, dy) {
    if (id <= 0 || id >= tiles.length || !tiles[id]) return;
    ctx.drawImage(tileCanvas(id), dx, dy);
  }
  // Browsers cap a canvas edge around 32,767px; past ~600 rows of 48px tiles
  // the palette canvas silently fails to draw. Big imported libraries widen
  // the grid instead — click/highlight math shares this via paletteCols().
  const MAX_PALETTE_ROWS = 600;
  function paletteCols() {
    return Math.max(PALETTE_COLS, Math.ceil(tiles.length / MAX_PALETTE_ROWS));
  }
  function tilesetCanvas() {
    const cols = paletteCols();
    const rows = Math.ceil(tiles.length / cols);
    const c = mkCanvas(cols * TILE, rows * TILE), g = c.getContext("2d");
    g.fillStyle = "#222"; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < tiles.length; i++) {
      drawTile(g, i, (i % cols) * TILE, Math.floor(i / cols) * TILE);
    }
    return c;
  }

  // ---------- character sprites ----------
  // dirs: 0=down 1=left 2=right 3=up ; frames: 0,1,2 (1 = idle)
  const HUMANS = [
    ["hero",       "Hero",        { skin: "#f0c8a0", hair: "#7a4a22", style: "spiky", shirt: "#3a6ea5", pants: "#594631" }],
    ["heroine",    "Heroine",     { skin: "#f0c8a0", hair: "#a83232", style: "long",  shirt: "#b03060", pants: "#4a4a6a" }],
    ["mage",       "Mage",        { skin: "#e8c098", hair: "#5a3a8a", style: "hat",   shirt: "#6a4a9a", pants: "#3a3a5a", hat: "#4a3080" }],
    ["cleric",     "Cleric",      { skin: "#f0d0b0", hair: "#d8c060", style: "short", shirt: "#e8e8e0", pants: "#c0b890" }],
    ["villager_m", "Villager M",  { skin: "#e8b890", hair: "#4a3a28", style: "short", shirt: "#5a8a4a", pants: "#6a5a3a" }],
    ["villager_f", "Villager F",  { skin: "#f0c8a0", hair: "#d89a3a", style: "long",  shirt: "#d8884a", pants: "#8a5a3a" }],
    ["elder",      "Elder",       { skin: "#e0b898", hair: "#c8c8c8", style: "short", shirt: "#7a6a5a", pants: "#5a4a3a" }],
    ["kid",        "Kid",         { skin: "#f0c8a0", hair: "#8a3a2a", style: "spiky", shirt: "#d8443a", pants: "#3a5a8a" }],
    ["guard",      "Guard",       { skin: "#e8b890", hair: "#3a3a3a", style: "hat",   shirt: "#8a8a96", pants: "#4a4a56", hat: "#9a9aa8" }],
    ["merchant",   "Merchant",    { skin: "#e8b890", hair: "#5a4a3a", style: "short", shirt: "#8a4a9a", pants: "#4a3a2a" }],
  ];

  const CHARACTER_ART_STYLES = Object.freeze([
    Object.freeze({
      id: "classic",
      name: "Classic Pixel",
      description: "The clean RPGAtlas look with crisp 3px details.",
    }),
    Object.freeze({
      id: "chibi",
      name: "Chibi",
      description: "A big expressive head, large eyes, and tiny adventurer proportions.",
    }),
    Object.freeze({
      id: "heroic",
      name: "Heroic",
      description: "Longer legs, a smaller head, and a broad action-RPG silhouette.",
    }),
    Object.freeze({
      id: "storybook",
      name: "Storybook",
      description: "A detailed 2px sprite build with shaped edges and expressive features.",
    }),
  ]);
  const CHARACTER_BODY_TYPES = Object.freeze(["balanced", "slim", "broad", "compact"]);
  const CHARACTER_OUTFITS = Object.freeze(["tunic", "robe", "armor", "coat"]);
  const CHARACTER_ACCESSORIES = Object.freeze(["none", "cape", "scarf", "glasses", "headband"]);
  const CHARACTER_ART_STYLE_IDS = new Set(CHARACTER_ART_STYLES.map((style) => style.id));

  function characterArtStyle(params) {
    return params && CHARACTER_ART_STYLE_IDS.has(params.artStyle) ? params.artStyle : "classic";
  }

  function drawClassicHuman(g, p, dir, frame) {
    const u = 3; // pixel unit; 16x16 logical grid in 48x48
    function q(x, y, w, h, c) { px(g, x * u, y * u, w * u, h * u, c); }
    const skinD = shade(p.skin, 0.82), shirtD = shade(p.shirt, 0.8), hairD = shade(p.hair, 0.8);
    const bodyW = p.bodyType === "broad" ? 10 : p.bodyType === "slim" ? 6 : 8;
    const bodyX = Math.floor((16 - bodyW) / 2);
    const legH = p.bodyType === "compact" ? 2 : 3;
    const geo = { head: { x: 4, y: 2, w: 8, h: 6 }, body: { x: bodyX, y: 8, w: bodyW, h: 4 }, legs: { y: 12, h: legH } };
    const step = frame === 1 ? 0 : 1;          // legs apart on frames 0/2
    const swap = frame === 2 ? 1 : 0;          // which leg forward
    drawBackLayer(q, p, dir, geo);
    if (dir === 0 || dir === 3) {
      // front / back
      // legs
      const lLift = step && !swap ? 1 : 0, rLift = step && swap ? 1 : 0;
      const leftLeg = bodyX + 1, rightLeg = bodyX + bodyW - 3;
      q(leftLeg, 12, 2, legH - lLift, p.pants); q(rightLeg, 12, 2, legH - rLift, p.pants);
      q(leftLeg, 12 + legH - lLift, 2, 1, "#3a2c1c"); q(rightLeg, 12 + legH - rLift, 2, 1, "#3a2c1c");
      // body
      q(bodyX, 8, bodyW, 4, p.shirt); q(bodyX, 11, bodyW, 1, shirtD);
      // arms
      q(bodyX - 1, 8, 1, 3, p.shirt); q(bodyX + bodyW, 8, 1, 3, p.shirt);
      q(bodyX - 1, 11, 1, 1, p.skin); q(bodyX + bodyW, 11, 1, 1, p.skin);
      // head
      q(4, 2, 8, 6, p.skin);
      q(4, 7, 8, 1, skinD);
      if (dir === 0) {
        q(6, 5, 1, 1, p.eyes); q(9, 5, 1, 1, p.eyes); // eyes
      }
      // hair
      if (p.style === "bald") {
        q(4, 2, 8, 1, skinD);
      } else if (p.style === "hood") {
        q(3, 1, 10, 3, p.accent); q(3, 4, 2, 4, shade(p.accent, 0.78)); q(11, 4, 2, 4, shade(p.accent, 0.78));
      } else if (p.style === "hat") {
        q(3, 1, 10, 2, p.hat); q(2, 3, 12, 1, shade(p.hat, 0.8));
        if (dir === 3) q(4, 4, 8, 2, p.hat);
      } else {
        q(4, 1, 8, 2, p.hair); q(4, 3, 1, 2, p.hair); q(11, 3, 1, 2, p.hair);
        if (p.style === "spiky") { q(5, 0, 2, 1, p.hair); q(9, 0, 2, 1, p.hair); q(7, 1, 2, 1, hairD); }
        if (p.style === "long") { q(3, 3, 1, 6, p.hair); q(12, 3, 1, 6, p.hair); }
        if (p.style === "bob") { q(3, 3, 1, 4, p.hair); q(12, 3, 1, 4, p.hair); }
        if (p.style === "ponytail") { q(12, 4, 2, 5, p.hair); q(13, 8, 1, 2, hairD); }
        if (p.style === "mohawk") { q(7, 0, 2, 2, p.hair); q(8, 2, 1, 2, hairD); }
        if (dir === 3) q(4, 3, 8, 4, p.hair); // back of head covered
      }
    } else {
      // side view; draw facing left, mirror handled by caller for right
      const fwd = step ? (swap ? 1 : -1) : 0;
      const sideW = p.bodyType === "broad" ? 8 : p.bodyType === "slim" ? 5 : 6;
      const sideX = Math.floor((16 - sideW) / 2);
      // legs
      q(6, 12, 2, legH, p.pants); q(8, 12, 2, legH, shade(p.pants, 0.85));
      if (fwd === 1) { q(5, 12 + legH - 2, 2, 2, p.pants); g.clearRect(8 * u, (11 + legH) * u, 2 * u, u); }
      if (fwd === -1) { q(9, 12 + legH - 2, 2, 2, shade(p.pants, 0.85)); g.clearRect(6 * u, (11 + legH) * u, 2 * u, u); }
      q(6, 12 + legH, 4, 1, "#3a2c1c");
      // body
      q(sideX, 8, sideW, 4, p.shirt); q(sideX, 11, sideW, 1, shirtD);
      // arm
      q(7 + fwd, 9, 2, 3, shirtD); q(7 + fwd, 11, 2, 1, p.skin);
      // head
      q(4, 2, 8, 6, p.skin); q(4, 7, 8, 1, skinD);
      q(5, 5, 1, 1, p.eyes); // one eye
      // hair
      if (p.style === "hood") {
        q(3, 1, 10, 3, p.accent); q(9, 4, 4, 4, shade(p.accent, 0.78));
      } else if (p.style === "hat") {
        q(3, 1, 10, 2, p.hat); q(2, 3, 11, 1, shade(p.hat, 0.8)); q(8, 4, 4, 2, p.hat);
      } else if (p.style !== "bald") {
        q(4, 1, 8, 2, p.hair); q(8, 3, 4, 3, p.hair); q(11, 3, 1, 3, hairD);
        if (p.style === "spiky") { q(5, 0, 2, 1, p.hair); q(9, 0, 2, 1, p.hair); }
        if (p.style === "long") { q(10, 3, 2, 7, p.hair); }
        if (p.style === "bob") { q(10, 3, 2, 5, p.hair); }
        if (p.style === "ponytail") { q(11, 4, 2, 5, p.hair); q(12, 8, 2, 2, hairD); }
        if (p.style === "mohawk") { q(6, 0, 2, 2, p.hair); q(8, 1, 2, 2, hairD); }
      }
    }
    drawOutfitDetails(q, p, dir, geo);
    drawFaceAccessory(q, p, dir, geo);
  }

  function drawBackLayer(q, p, dir, geo) {
    const body = geo.body, head = geo.head, legs = geo.legs;
    if (p.accessory === "cape") {
      const capeD = shade(p.accent, 0.68);
      if (dir === 1) q(body.x + body.w - 1, body.y + 1, Math.max(2, Math.floor(body.w / 3)), body.h + legs.h, capeD);
      else q(body.x - 1, body.y + 1, body.w + 2, body.h + Math.max(1, legs.h - 1), capeD);
    }
    if (p.style === "ponytail") {
      const tailX = dir === 1 ? head.x + head.w - 1 : head.x + Math.floor(head.w / 2);
      q(tailX, head.y + Math.floor(head.h / 2), Math.max(1, Math.floor(head.w / 4)), Math.max(3, Math.floor(head.h * 0.8)), shade(p.hair, 0.78));
    }
  }

  function drawOutfitDetails(q, p, dir, geo) {
    const body = geo.body, legs = geo.legs;
    const shirtD = shade(p.shirt, 0.72), accentD = shade(p.accent, 0.74);
    const center = body.x + Math.floor(body.w / 2);
    if (p.outfit === "robe") {
      q(body.x, body.y + body.h - 1, body.w, Math.max(2, legs.y + legs.h - body.y - body.h + 1), shirtD);
      q(center, body.y + body.h, 1, Math.max(1, legs.h - 1), shade(p.shirt, 0.58));
    } else if (p.outfit === "armor") {
      q(body.x - 1, body.y, 2, 2, p.accent); q(body.x + body.w - 1, body.y, 2, 2, p.accent);
      q(body.x + 1, body.y + 1, Math.max(1, body.w - 2), Math.max(1, body.h - 2), shirtD);
      q(body.x, body.y + body.h - 1, body.w, 1, accentD);
    } else if (p.outfit === "coat") {
      q(body.x, body.y + 1, 2, body.h + Math.max(1, legs.h - 1), shirtD);
      q(body.x + body.w - 2, body.y + 1, 2, body.h + Math.max(1, legs.h - 1), shirtD);
      q(center, body.y, 1, body.h + 1, p.accent);
    } else {
      q(body.x, body.y + body.h - 1, body.w, 1, p.accent);
    }
    if (p.accessory === "scarf") {
      q(body.x, body.y, body.w, 1, p.accent);
      q(dir === 1 ? body.x + body.w - 1 : body.x, body.y + 1, 1, Math.max(2, body.h), accentD);
    }
  }

  function drawFaceAccessory(q, p, dir, geo) {
    const head = geo.head;
    if (p.accessory === "headband") {
      q(head.x, head.y + 1, head.w, 1, p.accent);
    } else if (p.accessory === "glasses" && dir !== 3) {
      const y = head.y + Math.floor(head.h * 0.56);
      if (dir === 0) {
        q(head.x + 1, y, 2, 1, shade(p.accent, 0.46));
        q(head.x + head.w - 3, y, 2, 1, shade(p.accent, 0.46));
        q(head.x + 3, y, Math.max(1, head.w - 6), 1, shade(p.accent, 0.46));
      } else {
        q(head.x, y, Math.max(3, Math.floor(head.w / 2)), 1, shade(p.accent, 0.46));
      }
    }
  }

  function drawHairShape(q, p, dir, head, detailed) {
    const hairD = shade(p.hair, 0.72), x = head.x, y = head.y, w = head.w, h = head.h;
    if (p.style === "bald") {
      q(x + 1, y, Math.max(1, w - 2), 1, shade(p.skin, 0.86));
      return;
    }
    if (p.style === "hat") {
      q(x - 1, y - 1, w + 2, Math.max(2, Math.floor(h / 3)), p.hat);
      q(x - 2, y + 1, w + 4, 1, shade(p.hat, 0.72));
      if (dir === 3) q(x, y + 2, w, Math.max(2, Math.floor(h / 2)), p.hat);
      return;
    }
    if (p.style === "hood") {
      q(x - 1, y - 1, w + 2, Math.max(3, Math.floor(h / 2)), p.accent);
      q(x - 1, y + Math.floor(h / 2) - 1, 2, Math.max(2, Math.floor(h / 2)), hairD);
      q(x + w - 1, y + Math.floor(h / 2) - 1, 2, Math.max(2, Math.floor(h / 2)), hairD);
      return;
    }

    q(x, y - 1, w, 2, p.hair);
    if (p.style === "mohawk") {
      const crestX = x + Math.floor(w / 2) - 1;
      q(crestX, Math.max(0, y - 2), 2, 3, p.hair);
      q(crestX + 1, y + 1, 1, Math.max(1, Math.floor(h / 3)), hairD);
    } else if (p.style === "spiky") {
      q(x + 1, Math.max(0, y - 2), 2, 1, p.hair);
      q(x + w - 3, Math.max(0, y - 2), 2, 1, p.hair);
      if (detailed) q(x + Math.floor(w / 2), Math.max(0, y - 3), 2, 2, hairD);
    }

    if (dir === 3) {
      q(x, y + 1, w, Math.max(2, h - 1), p.hair);
      q(x + Math.floor(w / 2), y + 2, 1, Math.max(2, h - 2), hairD);
    } else if (dir === 1) {
      q(x + Math.floor(w / 2), y + 1, Math.ceil(w / 2), Math.max(2, Math.floor(h / 2)), p.hair);
      q(x + w - 1, y + 2, 1, Math.max(2, Math.floor(h / 2)), hairD);
    } else {
      q(x, y + 1, 1, Math.max(2, Math.floor(h / 2)), p.hair);
      q(x + w - 1, y + 1, 1, Math.max(2, Math.floor(h / 2)), p.hair);
    }

    if (p.style === "long") {
      q(x - 1, y + 2, 2, h + 1, p.hair); q(x + w - 1, y + 2, 2, h + 1, hairD);
    } else if (p.style === "bob") {
      q(x - 1, y + 2, 2, Math.max(3, h - 1), p.hair); q(x + w - 1, y + 2, 2, Math.max(3, h - 1), hairD);
    }
  }

  function drawChibiHuman(g, p, dir, frame) {
    const u = 3;
    function q(x, y, w, h, c) { px(g, x * u, y * u, w * u, h * u, c); }
    const compact = p.bodyType === "compact";
    const bodyW = p.bodyType === "broad" ? 9 : p.bodyType === "slim" ? 6 : compact ? 7 : 8;
    const bodyX = Math.floor((16 - bodyW) / 2);
    const geo = { head: { x: 3, y: 1, w: 10, h: 8 }, body: { x: bodyX, y: 9, w: bodyW, h: compact ? 2 : 3 }, legs: { y: compact ? 11 : 12, h: 3 } };
    const head = geo.head, body = geo.body;
    const step = frame === 1 ? 0 : 1, swap = frame === 2;
    drawBackLayer(q, p, dir, geo);

    const leftLift = step && !swap ? 1 : 0, rightLift = step && swap ? 1 : 0;
    q(5, geo.legs.y, 2, geo.legs.h - leftLift, p.pants); q(9, geo.legs.y, 2, geo.legs.h - rightLift, shade(p.pants, 0.84));
    q(5, geo.legs.y + geo.legs.h - leftLift, 2, 1, "#3a2c1c"); q(9, geo.legs.y + geo.legs.h - rightLift, 2, 1, "#3a2c1c");
    q(body.x, body.y, body.w, body.h, p.shirt);
    q(body.x - 1, body.y, 1, 2, p.shirt); q(body.x + body.w, body.y, 1, 2, p.shirt);
    q(body.x - 1, body.y + 2, 1, 1, p.skin); q(body.x + body.w, body.y + 2, 1, 1, p.skin);

    q(head.x + 1, head.y, head.w - 2, head.h, p.skin);
    q(head.x, head.y + 1, head.w, head.h - 2, p.skin);
    q(head.x + 1, head.y + head.h - 1, head.w - 2, 1, shade(p.skin, 0.82));
    if (dir === 0) {
      const eyeHi = mix(p.eyes, "#ffffff", 0.72);
      q(head.x + 2, head.y + 4, 1, 2, p.eyes); q(head.x + head.w - 3, head.y + 4, 1, 2, p.eyes);
      q(head.x + 2, head.y + 4, 1, 1, eyeHi); q(head.x + head.w - 3, head.y + 4, 1, 1, eyeHi);
      q(head.x + 1, head.y + 6, 1, 1, mix(p.skin, "#d87979", 0.38));
      q(head.x + head.w - 2, head.y + 6, 1, 1, mix(p.skin, "#d87979", 0.38));
    } else if (dir === 1) {
      q(head.x + 1, head.y + 4, 1, 2, p.eyes);
      q(head.x + 1, head.y + 4, 1, 1, mix(p.eyes, "#ffffff", 0.72));
    }
    drawHairShape(q, p, dir, head, false);
    drawOutfitDetails(q, p, dir, geo);
    drawFaceAccessory(q, p, dir, geo);
  }

  function drawHeroicHuman(g, p, dir, frame) {
    const u = 3;
    function q(x, y, w, h, c) { px(g, x * u, y * u, w * u, h * u, c); }
    const compact = p.bodyType === "compact";
    const bodyW = p.bodyType === "broad" ? 12 : p.bodyType === "slim" ? 8 : compact ? 9 : 10;
    const bodyX = Math.floor((16 - bodyW) / 2);
    const geo = { head: compact ? { x: 4, y: 1, w: 8, h: 6 } : { x: 5, y: 1, w: 6, h: 5 },
      body: { x: bodyX, y: compact ? 7 : 6, w: bodyW, h: compact ? 4 : 5 }, legs: { y: 11, h: compact ? 3 : 4 } };
    const head = geo.head, body = geo.body;
    const step = frame === 1 ? 0 : 1, swap = frame === 2;
    drawBackLayer(q, p, dir, geo);

    const leftX = body.x + 2, rightX = body.x + body.w - 4;
    const leftLift = step && !swap ? 1 : 0, rightLift = step && swap ? 1 : 0;
    q(leftX, geo.legs.y, 2, geo.legs.h - leftLift, p.pants); q(rightX, geo.legs.y, 2, geo.legs.h - rightLift, shade(p.pants, 0.82));
    q(leftX - (step && !swap ? 1 : 0), geo.legs.y + geo.legs.h - leftLift, 3, 1, "#30271f");
    q(rightX - (step && swap ? 1 : 0), geo.legs.y + geo.legs.h - rightLift, 3, 1, "#30271f");
    q(body.x, body.y, body.w, body.h, p.shirt); q(body.x, body.y + body.h - 1, body.w, 1, shade(p.shirt, 0.7));
    q(body.x - 1, body.y + 1, 2, 5, p.shirt); q(body.x + body.w - 1, body.y + 1, 2, 5, shade(p.shirt, 0.82));
    q(body.x - 1, body.y + 5, 2, 1, p.skin); q(body.x + body.w - 1, body.y + 5, 2, 1, p.skin);
    q(head.x, head.y, head.w, head.h, p.skin); q(head.x + 1, head.y + head.h, head.w - 2, 1, shade(p.skin, 0.78));
    if (dir === 0) {
      q(head.x + 1, head.y + 2, 1, 1, p.eyes); q(head.x + head.w - 2, head.y + 2, 1, 1, p.eyes);
      q(head.x + 2, head.y + 4, head.w - 4, 1, shade(p.skin, 0.7));
    } else if (dir === 1) q(head.x, head.y + 2, 1, 1, p.eyes);
    drawHairShape(q, p, dir, head, false);
    drawOutfitDetails(q, p, dir, geo);
    drawFaceAccessory(q, p, dir, geo);
  }

  function drawStorybookHuman(g, p, dir, frame) {
    const u = 2;
    function q(x, y, w, h, c) { px(g, x * u, y * u, w * u, h * u, c); }
    const compact = p.bodyType === "compact";
    const bodyW = p.bodyType === "broad" ? 15 : p.bodyType === "slim" ? 10 : compact ? 12 : 13;
    const bodyX = Math.floor((24 - bodyW) / 2);
    const geo = { head: compact ? { x: 6, y: 2, w: 12, h: 10 } : { x: 7, y: 2, w: 10, h: 9 },
      body: { x: bodyX, y: compact ? 12 : 11, w: bodyW, h: compact ? 5 : 6 }, legs: { y: 17, h: compact ? 4 : 5 } };
    const head = geo.head, body = geo.body, outline = shade(p.pants, 0.42);
    const step = frame === 1 ? 0 : 1, swap = frame === 2;
    drawBackLayer(q, p, dir, geo);

    const leftLift = step && !swap ? 1 : 0, rightLift = step && swap ? 1 : 0;
    q(body.x + 2, geo.legs.y, 5, geo.legs.h + 1 - leftLift, outline); q(body.x + body.w - 7, geo.legs.y, 5, geo.legs.h + 1 - rightLift, outline);
    q(body.x + 3, geo.legs.y, 3, geo.legs.h - leftLift, p.pants); q(body.x + body.w - 6, geo.legs.y, 3, geo.legs.h - rightLift, shade(p.pants, 0.82));
    q(body.x + 1, geo.legs.y + geo.legs.h - leftLift, 6, 2, outline); q(body.x + body.w - 7, geo.legs.y + geo.legs.h - rightLift, 6, 2, outline);
    q(body.x + 2, geo.legs.y + geo.legs.h - leftLift, 5, 1, "#352b24"); q(body.x + body.w - 6, geo.legs.y + geo.legs.h - rightLift, 5, 1, "#352b24");
    q(body.x - 1, body.y, body.w + 2, body.h + 1, outline);
    q(body.x, body.y + 1, body.w, body.h - 1, p.shirt);
    q(body.x - 2, body.y + 1, 3, 6, outline); q(body.x + body.w - 1, body.y + 1, 3, 6, outline);
    q(body.x - 1, body.y + 2, 2, 4, p.shirt); q(body.x + body.w - 1, body.y + 2, 2, 4, shade(p.shirt, 0.8));
    q(body.x - 1, body.y + 6, 2, 1, p.skin); q(body.x + body.w - 1, body.y + 6, 2, 1, p.skin);

    q(head.x, head.y - 1, head.w, 1, outline);
    q(head.x - 1, head.y, head.w + 2, head.h - 1, outline);
    q(head.x, head.y + head.h - 1, head.w, 1, outline);
    q(head.x, head.y, head.w, head.h - 1, p.skin);
    q(head.x + 1, head.y + head.h - 2, head.w - 2, 1, shade(p.skin, 0.8));
    if (dir === 0) {
      const eyeHi = mix(p.eyes, "#ffffff", 0.7);
      q(head.x + 2, head.y + 4, 2, 2, p.eyes); q(head.x + head.w - 4, head.y + 4, 2, 2, p.eyes);
      q(head.x + 2, head.y + 4, 1, 1, eyeHi); q(head.x + head.w - 4, head.y + 4, 1, 1, eyeHi);
      q(head.x + 4, head.y + 7, 2, 1, shade(p.skin, 0.66));
    } else if (dir === 1) {
      q(head.x + 1, head.y + 4, 2, 2, p.eyes); q(head.x + 1, head.y + 4, 1, 1, mix(p.eyes, "#ffffff", 0.7));
    }
    drawHairShape(q, p, dir, head, true);
    drawOutfitDetails(q, p, dir, geo);
    drawFaceAccessory(q, p, dir, geo);
  }

  function drawStyledHuman(g, params, dir, frame) {
    const p = normalizeHumanParams(params);
    if (p.artStyle === "chibi") drawChibiHuman(g, p, dir, frame);
    else if (p.artStyle === "heroic") drawHeroicHuman(g, p, dir, frame);
    else if (p.artStyle === "storybook") drawStorybookHuman(g, p, dir, frame);
    else drawClassicHuman(g, p, dir, frame);
  }

  function humanPreviewCanvas(params, dir, frame) {
    const canvas = mkCanvas(TILE, TILE), g = canvas.getContext("2d");
    drawStyledHuman(g, params, dir == null ? 0 : dir, frame == null ? 1 : frame);
    return canvas;
  }

  // object charsets — draw(g, frame) into 48x48, same for all dirs
  const OBJECTS = [
    ["chest", "Chest (closed)", (g) => {
      px(g, 8, 14, 32, 26, "#8a5c2c");
      px(g, 8, 14, 32, 10, "#a9763c");
      px(g, 8, 23, 32, 3, "#503418");
      px(g, 21, 22, 6, 9, "#d8b04f");
      px(g, 23, 25, 2, 4, "#7a5c1f");
      px(g, 8, 14, 3, 26, "#6a4520"); px(g, 37, 14, 3, 26, "#6a4520");
    }],
    ["chest_open", "Chest (open)", (g) => {
      px(g, 8, 6, 32, 10, "#6a4520");
      px(g, 10, 8, 28, 6, "#2c1f10");
      px(g, 8, 18, 32, 22, "#8a5c2c");
      px(g, 10, 20, 28, 6, "#26190c");
      px(g, 21, 26, 6, 7, "#d8b04f");
      px(g, 8, 18, 3, 22, "#6a4520"); px(g, 37, 18, 3, 22, "#6a4520");
    }],
    ["sign", "Sign", (g) => {
      px(g, 21, 26, 6, 16, "#6a4a28");
      px(g, 8, 8, 32, 20, "#a9824f");
      px(g, 10, 10, 28, 16, "#8a6236");
      px(g, 13, 14, 22, 2, "#503418"); px(g, 13, 19, 16, 2, "#503418");
    }],
    ["crystal", "Crystal", (g, f) => {
      const glow = f === 1 ? 1 : 0.85;
      g.fillStyle = shade("#5fc8e8", glow * 0.6);
      g.beginPath(); g.ellipse(24, 42, 14, 4, 0, 0, 7); g.fill();
      g.fillStyle = shade("#5fc8e8", glow);
      g.beginPath(); g.moveTo(24, 4); g.lineTo(36, 24); g.lineTo(24, 44); g.lineTo(12, 24); g.fill();
      g.fillStyle = shade("#a8e8f8", glow);
      g.beginPath(); g.moveTo(24, 4); g.lineTo(30, 24); g.lineTo(24, 44); g.lineTo(18, 24); g.fill();
    }],
    ["flame", "Flame", (g, f) => {
      const w = f === 1 ? 1 : 0.85;
      g.fillStyle = "#c84a1f";
      g.beginPath(); g.moveTo(24, 6); g.quadraticCurveTo(38 * w + 24 * (1 - w), 22, 34, 34);
      g.quadraticCurveTo(30, 44, 24, 44); g.quadraticCurveTo(18, 44, 14, 34);
      g.quadraticCurveTo(10 * w + 24 * (1 - w), 22, 24, 6); g.fill();
      g.fillStyle = "#f0a030";
      g.beginPath(); g.ellipse(24, 33, 7, 10 * w, 0, 0, 7); g.fill();
      g.fillStyle = "#f8e070";
      g.beginPath(); g.ellipse(24, 37, 3, 5, 0, 0, 7); g.fill();
    }],
    ["savepoint", "Save Point", (g, f) => {
      const glow = f === 1 ? 1 : 0.8;
      g.fillStyle = shade("#48b878", glow * 0.5);
      g.beginPath(); g.ellipse(24, 38, 16, 6, 0, 0, 7); g.fill();
      g.strokeStyle = shade("#78e8a8", glow); g.lineWidth = 3;
      g.beginPath(); g.ellipse(24, 38, 11, 4, 0, 0, 7); g.stroke();
      g.fillStyle = shade("#a8f8c8", glow);
      g.beginPath(); g.moveTo(24, 8); g.lineTo(29, 24); g.lineTo(24, 34); g.lineTo(19, 24); g.fill();
    }],
    // vehicles (Phase 5): boat / ship / airship — object charsets any event
    // can also use, but primarily referenced by System ▸ Vehicles
    ["boat", "Boat", (g, f) => {
      const bob = f === 1 ? 1 : 0;
      g.fillStyle = "rgba(16,24,40,0.35)";
      g.beginPath(); g.ellipse(24, 41, 15, 4, 0, 0, 7); g.fill();
      g.fillStyle = "#8a5c2c";
      g.beginPath(); g.moveTo(8, 26 + bob); g.quadraticCurveTo(24, 40 + bob, 40, 26 + bob);
      g.lineTo(36, 22 + bob); g.quadraticCurveTo(24, 30 + bob, 12, 22 + bob); g.fill();
      g.fillStyle = "#a9763c";
      g.beginPath(); g.moveTo(12, 22 + bob); g.quadraticCurveTo(24, 30 + bob, 36, 22 + bob);
      g.lineTo(34, 19 + bob); g.quadraticCurveTo(24, 25 + bob, 14, 19 + bob); g.fill();
      px(g, 22, 10 + bob, 3, 12, "#6a4520"); // oar/mast stub
    }],
    ["ship", "Ship", (g, f) => {
      const bob = f === 1 ? 1 : 0;
      g.fillStyle = "rgba(16,24,40,0.35)";
      g.beginPath(); g.ellipse(24, 42, 17, 4, 0, 0, 7); g.fill();
      g.fillStyle = "#6a4520";
      g.beginPath(); g.moveTo(5, 27 + bob); g.quadraticCurveTo(24, 43 + bob, 43, 27 + bob);
      g.lineTo(39, 21 + bob); g.quadraticCurveTo(24, 31 + bob, 9, 21 + bob); g.fill();
      px(g, 9, 19 + bob, 30, 3, "#8a5c2c");
      px(g, 22, 4 + bob, 3, 16, "#503418"); // mast
      g.fillStyle = "#e8e0cc"; // sail
      g.beginPath(); g.moveTo(25, 5 + bob); g.quadraticCurveTo(38, 10 + bob, 25, 18 + bob); g.fill();
      g.fillStyle = "#c84a1f";
      g.beginPath(); g.moveTo(22, 4 + bob); g.lineTo(22, 8 + bob); g.lineTo(15, 6 + bob); g.fill();
    }],
    ["airship", "Airship", (g, f) => {
      const bob = f === 1 ? 2 : 0;
      g.fillStyle = "rgba(16,24,40,0.3)";
      g.beginPath(); g.ellipse(24, 43, 13, 3, 0, 0, 7); g.fill();
      g.fillStyle = "#c8b06a"; // balloon
      g.beginPath(); g.ellipse(24, 15 + bob, 15, 10, 0, 0, 7); g.fill();
      g.fillStyle = "#a98c46";
      g.beginPath(); g.ellipse(24, 15 + bob, 15, 10, 0, Math.PI * 0.15, Math.PI * 0.85); g.fill();
      px(g, 23, 25 + bob, 2, 6, "#503418"); px(g, 14, 23 + bob, 2, 7, "#503418"); px(g, 32, 23 + bob, 2, 7, "#503418");
      g.fillStyle = "#8a5c2c"; // gondola
      g.beginPath(); g.moveTo(12, 30 + bob); g.quadraticCurveTo(24, 40 + bob, 36, 30 + bob);
      g.lineTo(34, 27 + bob); g.quadraticCurveTo(24, 33 + bob, 14, 27 + bob); g.fill();
    }],
  ];

  const charsets = [];
  HUMANS.forEach(([key, name, p]) => charsets.push({ key, name, kind: "human", params: p }));
  OBJECTS.forEach(([key, name, draw]) => charsets.push({ key, name, kind: "object", draw }));

  let charCache = {};
  function charFrameCanvas(idx, dir, frame) {
    const cs = charsets[idx];
    if (!cs) return mkCanvas(TILE, TILE);
    const k = idx + "_" + dir + "_" + frame;
    if (!charCache[k]) {
      const c = mkCanvas(TILE, TILE), g = c.getContext("2d");
      if (cs.external) {
        const sw = cs.image.width / 3, sh = cs.image.height / 4;
        g.imageSmoothingEnabled = false;
        g.drawImage(cs.image, frame * sw, dir * sh, sw, sh, 0, 0, TILE, TILE);
      } else if (cs.kind === "human") {
        if (dir === 2) { // mirror left
          g.save(); g.translate(TILE, 0); g.scale(-1, 1);
          drawStyledHuman(g, cs.params, 1, frame);
          g.restore();
        } else {
          drawStyledHuman(g, cs.params, dir, frame);
        }
      } else {
        cs.draw(g, frame);
      }
      charCache[k] = c;
    }
    return charCache[k];
  }

  // ---- custom (generated) characters ----
  const HAIR_STYLES = ["spiky", "long", "short", "bob", "ponytail", "mohawk", "hat", "hood", "bald"];
  function humanColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : fallback;
  }
  function normalizeHumanParams(params) {
    const normalized = Object.assign({}, params || {});
    normalized.artStyle = characterArtStyle(normalized);
    normalized.bodyType = CHARACTER_BODY_TYPES.includes(normalized.bodyType) ? normalized.bodyType : "balanced";
    normalized.outfit = CHARACTER_OUTFITS.includes(normalized.outfit) ? normalized.outfit : "tunic";
    normalized.accessory = CHARACTER_ACCESSORIES.includes(normalized.accessory) ? normalized.accessory : "none";
    normalized.style = HAIR_STYLES.includes(normalized.style) ? normalized.style : "short";
    normalized.skin = humanColor(normalized.skin, "#f0c8a0");
    normalized.hair = humanColor(normalized.hair, "#75442b");
    normalized.shirt = humanColor(normalized.shirt, "#3567a5");
    normalized.pants = humanColor(normalized.pants, "#273b5c");
    normalized.hat = humanColor(normalized.hat, "#d1a84b");
    normalized.accent = humanColor(normalized.accent, normalized.hat);
    normalized.eyes = humanColor(normalized.eyes, "#2d3348");
    return normalized;
  }
  function registerHuman(key, name, params) {
    params = normalizeHumanParams(params);
    const i = charsets.findIndex((c) => c.key === key);
    if (i >= 0) {
      charsets[i].name = name;
      charsets[i].params = params;
      for (const k of Object.keys(charCache)) {
        if (k.startsWith(i + "_")) delete charCache[k];
      }
      return i;
    }
    charsets.push({ key, name, kind: "human", params, custom: true });
    return charsets.length - 1;
  }
  function removeCharset(key) {
    const i = charsets.findIndex((c) => c.key === key && c.custom);
    if (i < 0) return false;
    charsets.splice(i, 1);
    charCache = {}; // indices shifted — drop everything
    return true;
  }
  function registerCustomChars(list) {
    (list || []).forEach((c) => registerHuman(c.key, c.name, c.params));
  }
  // full 3-frames × 4-dirs sprite sheet (for the resource manager / export)
  function charSheetCanvas(idx) {
    const c = mkCanvas(TILE * 3, TILE * 4), g = c.getContext("2d");
    for (let dir = 0; dir < 4; dir++) {
      for (let f = 0; f < 3; f++) g.drawImage(charFrameCanvas(idx, dir, f), f * TILE, dir * TILE);
    }
    return c;
  }
  function drawChar(ctx, idx, dir, frame, dx, dy) {
    if (idx < 0) return;
    ctx.drawImage(charFrameCanvas(idx, dir, frame), dx, dy);
  }
  function charsetIndex(key) {
    return charsets.findIndex((c) => c.key === key);
  }
  function faceCanvas(idx) {
    const c = mkCanvas(48, 48), g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    const cs = charsets[idx];
    const face = cs && faceByName.get(cs.assetName || cs.key);
    if (face) {
      g.drawImage(face.image, 0, 0, 48, 48);
      return c;
    }
    g.drawImage(charFrameCanvas(idx, 0, 1), 6, 0, 36, 30, 0, 2, 48, 40);
    return c;
  }

  // ---------- enemy battlers ----------
  const ENEMY_TYPES = [
    "slime", "bat", "orc", "ghost", "golem", "wasp",
    "wolf", "shroom", "skeleton", "imp", "crystal", "serpent",
  ];
  const enemyDrawers = {
    slime(g, s, col) {
      const d = shade(col, 0.75);
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(s * 0.1, s * 0.85);
      g.quadraticCurveTo(s * 0.08, s * 0.35, s * 0.5, s * 0.3);
      g.quadraticCurveTo(s * 0.92, s * 0.35, s * 0.9, s * 0.85);
      g.quadraticCurveTo(s * 0.5, s * 0.95, s * 0.1, s * 0.85);
      g.fill();
      g.fillStyle = mix(col, "#ffffff", 0.45);
      g.beginPath(); g.ellipse(s * 0.35, s * 0.45, s * 0.1, s * 0.06, -0.5, 0, 7); g.fill();
      g.fillStyle = "#1a1a1a";
      g.beginPath(); g.arc(s * 0.38, s * 0.6, s * 0.04, 0, 7); g.arc(s * 0.62, s * 0.6, s * 0.04, 0, 7); g.fill();
      g.strokeStyle = d; g.lineWidth = s * 0.02;
      g.beginPath(); g.arc(s * 0.5, s * 0.72, s * 0.08, 0.3, Math.PI - 0.3); g.stroke();
    },
    bat(g, s, col) {
      const d = shade(col, 0.7);
      g.fillStyle = d;
      // wings
      for (const m of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 0.5, s * 0.45);
        g.quadraticCurveTo(s * (0.5 + 0.42 * m), s * 0.15, s * (0.5 + 0.46 * m), s * 0.5);
        g.quadraticCurveTo(s * (0.5 + 0.34 * m), s * 0.45, s * (0.5 + 0.3 * m), s * 0.62);
        g.quadraticCurveTo(s * (0.5 + 0.18 * m), s * 0.52, s * 0.5, s * 0.62);
        g.fill();
      }
      g.fillStyle = col;
      g.beginPath(); g.ellipse(s * 0.5, s * 0.5, s * 0.16, s * 0.2, 0, 0, 7); g.fill();
      // ears
      g.beginPath(); g.moveTo(s * 0.42, s * 0.36); g.lineTo(s * 0.4, s * 0.22); g.lineTo(s * 0.48, s * 0.32); g.fill();
      g.beginPath(); g.moveTo(s * 0.58, s * 0.36); g.lineTo(s * 0.6, s * 0.22); g.lineTo(s * 0.52, s * 0.32); g.fill();
      g.fillStyle = "#f8e070";
      g.beginPath(); g.arc(s * 0.44, s * 0.46, s * 0.035, 0, 7); g.arc(s * 0.56, s * 0.46, s * 0.035, 0, 7); g.fill();
      g.fillStyle = "#fff";
      g.beginPath(); g.moveTo(s * 0.45, s * 0.58); g.lineTo(s * 0.47, s * 0.64) ; g.lineTo(s * 0.49, s * 0.58); g.fill();
      g.beginPath(); g.moveTo(s * 0.51, s * 0.58); g.lineTo(s * 0.53, s * 0.64); g.lineTo(s * 0.55, s * 0.58); g.fill();
    },
    orc(g, s, col) {
      const d = shade(col, 0.78);
      // legs
      g.fillStyle = "#4a3a2a";
      g.fillRect(s * 0.32, s * 0.72, s * 0.12, s * 0.2);
      g.fillRect(s * 0.56, s * 0.72, s * 0.12, s * 0.2);
      // body
      g.fillStyle = "#6a5236";
      g.beginPath(); g.ellipse(s * 0.5, s * 0.58, s * 0.24, s * 0.2, 0, 0, 7); g.fill();
      // arms
      g.fillStyle = col;
      g.beginPath(); g.ellipse(s * 0.2, s * 0.55, s * 0.08, s * 0.16, 0.3, 0, 7); g.fill();
      g.beginPath(); g.ellipse(s * 0.8, s * 0.55, s * 0.08, s * 0.16, -0.3, 0, 7); g.fill();
      // club
      g.fillStyle = "#7a5c34";
      g.save(); g.translate(s * 0.85, s * 0.5); g.rotate(0.5);
      g.fillRect(-s * 0.03, -s * 0.32, s * 0.06, s * 0.34);
      g.beginPath(); g.ellipse(0, -s * 0.34, s * 0.08, s * 0.1, 0, 0, 7); g.fill();
      g.restore();
      // head
      g.fillStyle = col;
      g.beginPath(); g.ellipse(s * 0.5, s * 0.32, s * 0.17, s * 0.15, 0, 0, 7); g.fill();
      g.fillStyle = d;
      g.beginPath(); g.ellipse(s * 0.5, s * 0.4, s * 0.1, s * 0.05, 0, 0, 7); g.fill();
      // tusks
      g.fillStyle = "#f0ead8";
      g.beginPath(); g.moveTo(s * 0.42, s * 0.42); g.lineTo(s * 0.4, s * 0.34); g.lineTo(s * 0.46, s * 0.4); g.fill();
      g.beginPath(); g.moveTo(s * 0.58, s * 0.42); g.lineTo(s * 0.6, s * 0.34); g.lineTo(s * 0.54, s * 0.4); g.fill();
      // eyes
      g.fillStyle = "#d83a2a";
      g.beginPath(); g.arc(s * 0.43, s * 0.3, s * 0.025, 0, 7); g.arc(s * 0.57, s * 0.3, s * 0.025, 0, 7); g.fill();
    },
    ghost(g, s, col) {
      g.fillStyle = mix(col, "#ffffff", 0.5);
      g.beginPath();
      g.arc(s * 0.5, s * 0.4, s * 0.26, Math.PI, 0);
      g.lineTo(s * 0.76, s * 0.78);
      for (let i = 0; i < 4; i++) {
        g.quadraticCurveTo(s * (0.76 - 0.13 * (i + 0.5) / 2), s * (i % 2 ? 0.78 : 0.9), s * (0.76 - 0.13 * (i + 1)), s * 0.82);
      }
      g.closePath(); g.fill();
      g.fillStyle = "#1a1a2a";
      g.beginPath(); g.ellipse(s * 0.42, s * 0.42, s * 0.045, s * 0.07, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(s * 0.58, s * 0.42, s * 0.045, s * 0.07, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(s * 0.5, s * 0.56, s * 0.04, s * 0.05, 0, 0, 7); g.fill();
    },
    golem(g, s, col) {
      const d = shade(col, 0.75), l = mix(col, "#ffffff", 0.2);
      // legs
      g.fillStyle = d;
      g.fillRect(s * 0.28, s * 0.7, s * 0.16, s * 0.22);
      g.fillRect(s * 0.56, s * 0.7, s * 0.16, s * 0.22);
      // body — chunky boulders
      g.fillStyle = col;
      g.beginPath(); g.moveTo(s * 0.22, s * 0.72); g.lineTo(s * 0.25, s * 0.4); g.lineTo(s * 0.5, s * 0.32);
      g.lineTo(s * 0.75, s * 0.4); g.lineTo(s * 0.78, s * 0.72); g.closePath(); g.fill();
      g.fillStyle = l;
      g.beginPath(); g.moveTo(s * 0.25, s * 0.4); g.lineTo(s * 0.5, s * 0.32); g.lineTo(s * 0.52, s * 0.45); g.lineTo(s * 0.3, s * 0.5); g.fill();
      // arms
      g.fillStyle = d;
      g.beginPath(); g.ellipse(s * 0.16, s * 0.55, s * 0.08, s * 0.17, 0.2, 0, 7); g.fill();
      g.beginPath(); g.ellipse(s * 0.84, s * 0.55, s * 0.08, s * 0.17, -0.2, 0, 7); g.fill();
      // head
      g.fillStyle = col;
      g.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.2);
      g.fillStyle = "#f8e070";
      g.fillRect(s * 0.43, s * 0.21, s * 0.04, s * 0.04);
      g.fillRect(s * 0.53, s * 0.21, s * 0.04, s * 0.04);
    },
    wasp(g, s, col) {
      const d = shade(col, 0.7);
      // wings
      g.fillStyle = "rgba(220,235,255,0.75)";
      g.beginPath(); g.ellipse(s * 0.32, s * 0.3, s * 0.2, s * 0.09, -0.7, 0, 7); g.fill();
      g.beginPath(); g.ellipse(s * 0.68, s * 0.3, s * 0.2, s * 0.09, 0.7, 0, 7); g.fill();
      // abdomen with stripes
      g.fillStyle = col;
      g.beginPath(); g.ellipse(s * 0.5, s * 0.62, s * 0.16, s * 0.22, 0, 0, 7); g.fill();
      g.fillStyle = d;
      g.fillRect(s * 0.36, s * 0.56, s * 0.28, s * 0.045);
      g.fillRect(s * 0.36, s * 0.66, s * 0.28, s * 0.045);
      // stinger
      g.fillStyle = "#3a3a3a";
      g.beginPath(); g.moveTo(s * 0.46, s * 0.82); g.lineTo(s * 0.5, s * 0.94); g.lineTo(s * 0.54, s * 0.82); g.fill();
      // head
      g.fillStyle = d;
      g.beginPath(); g.arc(s * 0.5, s * 0.36, s * 0.11, 0, 7); g.fill();
      g.fillStyle = "#1a1a1a";
      g.beginPath(); g.arc(s * 0.45, s * 0.34, s * 0.035, 0, 7); g.arc(s * 0.55, s * 0.34, s * 0.035, 0, 7); g.fill();
      // antennae
      g.strokeStyle = "#1a1a1a"; g.lineWidth = s * 0.015;
      g.beginPath(); g.moveTo(s * 0.45, s * 0.27); g.lineTo(s * 0.4, s * 0.18); g.stroke();
      g.beginPath(); g.moveTo(s * 0.55, s * 0.27); g.lineTo(s * 0.6, s * 0.18); g.stroke();
    },
    wolf(g, s, col) {
      const d = shade(col, 0.68), l = mix(col, "#ffffff", 0.25);
      g.fillStyle = d;
      g.beginPath(); g.ellipse(s * 0.48, s * 0.58, s * 0.3, s * 0.18, -0.08, 0, 7); g.fill();
      g.fillRect(s * 0.28, s * 0.66, s * 0.09, s * 0.24);
      g.fillRect(s * 0.62, s * 0.66, s * 0.09, s * 0.24);
      g.strokeStyle = d; g.lineWidth = s * 0.07; g.lineCap = "round";
      g.beginPath(); g.moveTo(s * 0.22, s * 0.55); g.quadraticCurveTo(s * 0.05, s * 0.42, s * 0.12, s * 0.28); g.stroke();
      g.fillStyle = col;
      g.beginPath(); g.moveTo(s * 0.62, s * 0.48); g.lineTo(s * 0.76, s * 0.25);
      g.lineTo(s * 0.93, s * 0.48); g.lineTo(s * 0.82, s * 0.65); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(s * 0.68, s * 0.31); g.lineTo(s * 0.67, s * 0.12); g.lineTo(s * 0.77, s * 0.27); g.fill();
      g.beginPath(); g.moveTo(s * 0.8, s * 0.27); g.lineTo(s * 0.87, s * 0.1); g.lineTo(s * 0.88, s * 0.35); g.fill();
      g.fillStyle = l;
      g.beginPath(); g.moveTo(s * 0.7, s * 0.48); g.lineTo(s * 0.92, s * 0.48); g.lineTo(s * 0.82, s * 0.62); g.fill();
      g.fillStyle = "#ffe26a"; g.fillRect(s * 0.76, s * 0.35, s * 0.04, s * 0.035);
      g.fillStyle = "#20202a"; g.beginPath(); g.arc(s * 0.92, s * 0.49, s * 0.035, 0, 7); g.fill();
    },
    shroom(g, s, col) {
      const d = shade(col, 0.66), l = mix(col, "#ffffff", 0.42);
      g.fillStyle = "#ddd0b0";
      g.beginPath(); g.ellipse(s * 0.5, s * 0.68, s * 0.18, s * 0.25, 0, 0, 7); g.fill();
      g.fillStyle = col;
      g.beginPath(); g.ellipse(s * 0.5, s * 0.37, s * 0.38, s * 0.25, 0, Math.PI, 0); g.lineTo(s * 0.12, s * 0.4);
      g.quadraticCurveTo(s * 0.5, s * 0.58, s * 0.88, s * 0.4); g.closePath(); g.fill();
      g.fillStyle = l;
      for (const p of [[0.31, 0.25, 0.07], [0.57, 0.2, 0.055], [0.7, 0.34, 0.045]]) {
        g.beginPath(); g.arc(s * p[0], s * p[1], s * p[2], 0, 7); g.fill();
      }
      g.fillStyle = d;
      g.beginPath(); g.arc(s * 0.43, s * 0.66, s * 0.035, 0, 7); g.arc(s * 0.57, s * 0.66, s * 0.035, 0, 7); g.fill();
      g.strokeStyle = d; g.lineWidth = s * 0.025;
      g.beginPath(); g.arc(s * 0.5, s * 0.75, s * 0.07, 0.15, Math.PI - 0.15); g.stroke();
      g.fillStyle = "#ddd0b0";
      g.beginPath(); g.ellipse(s * 0.3, s * 0.9, s * 0.13, s * 0.045, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(s * 0.7, s * 0.9, s * 0.13, s * 0.045, 0, 0, 7); g.fill();
    },
    skeleton(g, s, col) {
      const bone = mix(col, "#ffffff", 0.5), d = shade(col, 0.62);
      g.strokeStyle = bone; g.lineWidth = s * 0.055; g.lineCap = "round";
      g.beginPath(); g.moveTo(s * 0.5, s * 0.42); g.lineTo(s * 0.5, s * 0.72);
      g.moveTo(s * 0.5, s * 0.5); g.lineTo(s * 0.27, s * 0.64);
      g.moveTo(s * 0.5, s * 0.5); g.lineTo(s * 0.73, s * 0.61);
      g.moveTo(s * 0.48, s * 0.7); g.lineTo(s * 0.34, s * 0.92);
      g.moveTo(s * 0.52, s * 0.7); g.lineTo(s * 0.66, s * 0.92); g.stroke();
      g.strokeStyle = d; g.lineWidth = s * 0.025;
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.moveTo(s * 0.5, s * (0.5 + i * 0.045)); g.lineTo(s * 0.34, s * (0.46 + i * 0.055)); g.stroke();
        g.beginPath(); g.moveTo(s * 0.5, s * (0.5 + i * 0.045)); g.lineTo(s * 0.66, s * (0.46 + i * 0.055)); g.stroke();
      }
      g.fillStyle = bone;
      g.beginPath(); g.arc(s * 0.5, s * 0.28, s * 0.19, 0, 7); g.fill();
      g.fillStyle = d;
      g.beginPath(); g.ellipse(s * 0.43, s * 0.27, s * 0.05, s * 0.065, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(s * 0.57, s * 0.27, s * 0.05, s * 0.065, 0, 0, 7); g.fill();
      g.beginPath(); g.moveTo(s * 0.5, s * 0.31); g.lineTo(s * 0.46, s * 0.38); g.lineTo(s * 0.54, s * 0.38); g.fill();
      g.strokeStyle = "#ece6d0"; g.lineWidth = s * 0.018;
      g.beginPath(); g.moveTo(s * 0.39, s * 0.43); g.lineTo(s * 0.61, s * 0.43); g.stroke();
    },
    imp(g, s, col) {
      const d = shade(col, 0.62), l = mix(col, "#ffffff", 0.3);
      g.fillStyle = d;
      for (const m of [-1, 1]) {
        g.beginPath(); g.moveTo(s * 0.5, s * 0.48);
        g.lineTo(s * (0.5 + m * 0.4), s * 0.25); g.lineTo(s * (0.5 + m * 0.3), s * 0.62); g.closePath(); g.fill();
      }
      g.strokeStyle = d; g.lineWidth = s * 0.04;
      g.beginPath(); g.moveTo(s * 0.54, s * 0.75); g.quadraticCurveTo(s * 0.82, s * 0.88, s * 0.87, s * 0.64); g.stroke();
      g.fillStyle = col;
      g.beginPath(); g.ellipse(s * 0.5, s * 0.58, s * 0.19, s * 0.25, 0, 0, 7); g.fill();
      g.beginPath(); g.arc(s * 0.5, s * 0.34, s * 0.17, 0, 7); g.fill();
      g.beginPath(); g.moveTo(s * 0.39, s * 0.24); g.lineTo(s * 0.31, s * 0.08); g.lineTo(s * 0.48, s * 0.2); g.fill();
      g.beginPath(); g.moveTo(s * 0.61, s * 0.24); g.lineTo(s * 0.69, s * 0.08); g.lineTo(s * 0.52, s * 0.2); g.fill();
      g.fillStyle = l;
      g.beginPath(); g.arc(s * 0.43, s * 0.34, s * 0.035, 0, 7); g.arc(s * 0.57, s * 0.34, s * 0.035, 0, 7); g.fill();
      g.fillStyle = "#27202c";
      g.beginPath(); g.arc(s * 0.43, s * 0.34, s * 0.016, 0, 7); g.arc(s * 0.57, s * 0.34, s * 0.016, 0, 7); g.fill();
    },
    crystal(g, s, col) {
      const d = shade(col, 0.55), l = mix(col, "#ffffff", 0.5);
      const shard = (x, y, w, h, lean) => {
        g.fillStyle = col;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.5 + lean, y - h);
        g.lineTo(x + w, y); g.lineTo(x + w * 0.72, y + h * 0.12); g.lineTo(x + w * 0.2, y + h * 0.12); g.closePath(); g.fill();
        g.fillStyle = l;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.5 + lean, y - h); g.lineTo(x + w * 0.48, y); g.closePath(); g.fill();
        g.strokeStyle = d; g.lineWidth = s * 0.018; g.stroke();
      };
      shard(s * 0.22, s * 0.78, s * 0.25, s * 0.48, -s * 0.05);
      shard(s * 0.38, s * 0.8, s * 0.3, s * 0.68, s * 0.03);
      shard(s * 0.6, s * 0.8, s * 0.22, s * 0.42, s * 0.04);
      g.fillStyle = "rgba(255,255,255,0.82)";
      g.beginPath(); g.arc(s * 0.51, s * 0.44, s * 0.035, 0, 7); g.fill();
    },
    serpent(g, s, col) {
      const d = shade(col, 0.62), l = mix(col, "#ffffff", 0.3);
      g.strokeStyle = d; g.lineWidth = s * 0.18; g.lineCap = "round";
      g.beginPath(); g.moveTo(s * 0.22, s * 0.82);
      g.bezierCurveTo(s * 0.75, s * 0.95, s * 0.25, s * 0.55, s * 0.62, s * 0.5); g.stroke();
      g.strokeStyle = col; g.lineWidth = s * 0.12;
      g.beginPath(); g.moveTo(s * 0.22, s * 0.82);
      g.bezierCurveTo(s * 0.75, s * 0.95, s * 0.25, s * 0.55, s * 0.62, s * 0.5); g.stroke();
      g.fillStyle = col;
      g.beginPath(); g.moveTo(s * 0.55, s * 0.53); g.quadraticCurveTo(s * 0.66, s * 0.2, s * 0.9, s * 0.3);
      g.lineTo(s * 0.82, s * 0.55); g.quadraticCurveTo(s * 0.68, s * 0.65, s * 0.55, s * 0.53); g.fill();
      g.fillStyle = l;
      g.beginPath(); g.moveTo(s * 0.72, s * 0.34); g.lineTo(s * 0.9, s * 0.3); g.lineTo(s * 0.82, s * 0.43); g.fill();
      g.fillStyle = "#ffe26a"; g.fillRect(s * 0.75, s * 0.36, s * 0.04, s * 0.035);
      g.strokeStyle = "#d84a5a"; g.lineWidth = s * 0.014;
      g.beginPath(); g.moveTo(s * 0.87, s * 0.46); g.lineTo(s * 0.98, s * 0.49); g.moveTo(s * 0.98, s * 0.49); g.lineTo(s, s * 0.46); g.stroke();
    },
  };
  const enemyCache = {};
  function enemyCanvas(type, color, size) {
    size = size || 132;
    const k = type + "_" + color + "_" + size;
    if (!enemyCache[k]) {
      const c = mkCanvas(size, size), g = c.getContext("2d");
      const custom = externalByKey.get(type);
      if (custom && custom.type === "enemies") {
        g.imageSmoothingEnabled = false;
        const scale = Math.min(size / custom.image.width, size / custom.image.height);
        const w = custom.image.width * scale, h = custom.image.height * scale;
        g.drawImage(custom.image, (size - w) / 2, (size - h) / 2, w, h);
      } else {
        (enemyDrawers[type] || enemyDrawers.slime)(g, size, color || "#5aa84f");
      }
      enemyCache[k] = c;
    }
    return enemyCache[k];
  }

  let preparedExternal = null;
  function bindExternalAssets(project) {
    project.assets = project.assets || {};
    project.assets.tiles = project.assets.tiles || {};
    let nextTileId = Math.max(
      tiles.length,
      1 + Object.values(project.assets.tiles).reduce((max, id) => Math.max(max, Number(id) || 0), 0),
    );
    for (const item of preparedExternal || []) {
      const key = assetKey(item.type, item.name);
      item.key = key;
      // externalByKey mirrors external[type] membership (every push below is
      // paired with this set), so it doubles as the O(1) duplicate check — a
      // per-item array scan went quadratic on thousand-tile libraries.
      const known = externalByKey.has(key);
      externalByKey.set(key, item);
      if (!known) external[item.type].push(item);

      if (item.type === "characters") {
        // Flipbook sheets (Phase 6 importers) live under "characters" but are
        // NOT walking charsets: keep them out of the sprite pickers while the
        // externalByKey registration above still serves playback + export.
        if (item.meta && item.meta.charset === false) continue;
        const existing = charsets.find((c) => c.key === key);
        if (existing) {
          existing.image = item.image;
        } else {
          charsets.push({
            key, name: displayName(item.name), kind: "human", external: true,
            assetName: item.name, image: item.image,
          });
        }
      } else if (item.type === "facesets") {
        faceByName.set(item.name, item);
      } else if (item.type === "enemies") {
        if (!ENEMY_TYPES.includes(key)) ENEMY_TYPES.push(key);
      } else if (item.type === "tilesets") {
        let id = project.assets.tiles[key];
        // T is the live key → id map (seeded for built-ins, extended below for
        // every bound import) — the old tiles.findIndex scan was O(n²).
        const existingId = T[key] != null ? T[key] : -1;
        if (id == null) {
          id = existingId >= 0 ? existingId : nextTileId++;
          project.assets.tiles[key] = id;
        }
        const terrain = /\.terrain$/i.test(item.name);
        const pass = terrain || /\.pass$/i.test(item.name);
        const def = {
          key,
          name: displayName(item.name),
          pass,
          terrain,
          external: true,
          assetName: item.name,
          image: item.image,
          draw(g) {
            g.imageSmoothingEnabled = false;
            g.drawImage(item.image, 0, 0, TILE, TILE);
          },
        };
        while (tiles.length <= id) tiles.push(null);
        tiles[id] = def;
        T[key] = id;
        delete tileCache[id];
      }
    }
    charCache = {};
    return project;
  }
  // One in-flight discover+prepare, shared by boot and any mid-boot register
  // call (boot no longer blocks the UI on this, so callers can overlap now).
  let preparingExternal = null;
  async function ensurePreparedExternal() {
    if (!preparedExternal) {
      if (!preparingExternal) {
        preparingExternal = (async () => prepareExternalAssets(await discoverExternalAssets()))();
      }
      const prepared = await preparingExternal;
      // registerExternalAssets may have appended while we awaited — never
      // clobber a cache that materialized in the meantime.
      if (!preparedExternal) preparedExternal = prepared;
    }
    return preparedExternal;
  }
  async function loadExternalAssets(project) {
    await ensurePreparedExternal();
    return bindExternalAssets(project);
  }
  // Live registration for assets imported mid-session (Phase 6): prepare the
  // new {type,name,src} entries and bind them into the running registries
  // without a reload. Entries already prepared (same type+name+src) are
  // skipped, so callers may pass the whole library list; a same-key entry
  // with a NEW src re-binds and shadows the old image (bind order wins).
  async function registerExternalAssets(items, project) {
    // Discovery must run before the cache is appended to, or a pre-boot call
    // would mark it warm and the shipped img/ catalog would never load.
    await ensurePreparedExternal();
    const prepared = new Set((preparedExternal || []).map((p) => p.type + "\0" + p.name + "\0" + p.src));
    const fresh = (items || []).filter((item) =>
      item && external[item.type] !== undefined && item.src &&
      !prepared.has(item.type + "\0" + item.name + "\0" + item.src));
    if (fresh.length) preparedExternal = (preparedExternal || []).concat(await prepareExternalAssets(fresh));
    return bindExternalAssets(project);
  }
  function collectUsedExternalKeys(project) {
    const used = new Set();
    const use = (key) => { if (externalByKey.has(key)) used.add(key); };
    const useCharacterWithFace = (key) => {
      use(key);
      const character = externalByKey.get(key);
      if (!character || character.type !== "characters") return;
      const face = external.facesets.find((item) => item.name === character.name);
      if (face) use(face.key);
    };
    const scanCommands = (commands) => {
      for (const command of commands || []) {
        if (command.t === "text" && command.face) useCharacterWithFace(command.face);
        if (command.t === "choices") {
          for (const branch of command.branches || []) scanCommands(branch);
        } else if (command.t === "if") {
          scanCommands(command.then);
          scanCommands(command.else);
        } else if (command.t === "loop") {
          scanCommands(command.body);
        }
      }
    };
    for (const actor of project.actors || []) useCharacterWithFace(actor.charset);
    // Battle-animation flipbook sheets (Phase 6): "asset:" sheet keys resolve
    // through the same external registry, so exports must embed them too.
    for (const anim of project.animations || []) {
      for (const item of anim.items || []) use(item.sheet);
    }
    // Command lists outside map events (pre-Phase-6 gap): common events and
    // troop battle-event pages can show faces too.
    for (const ce of project.commonEvents || []) scanCommands(ce.commands);
    for (const dialogue of project.dialogues || []) {
      for (const speaker of dialogue.speakers || []) useCharacterWithFace(speaker.portrait);
      for (const node of dialogue.nodes || []) {
        useCharacterWithFace(node.portrait);
        scanCommands(node.commands);
      }
    }
    for (const troop of project.troops || []) {
      for (const page of troop.pages || []) scanCommands(page.commands);
    }
    for (const map of project.maps || []) {
      for (const layer of Object.values(map.layers || {})) {
        for (const id of layer || []) {
          const tile = tiles[id];
          if (tile && tile.external) use(tile.key);
        }
      }
      for (const event of map.events || []) {
        for (const page of event.pages || []) {
          use(page.charset);
          scanCommands(page.commands);
        }
      }
    }
    for (const enemy of project.enemies || []) use(enemy.sprite);
    return used;
  }
  function blobDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  async function exportUsedExternalAssets(project) {
    const used = collectUsedExternalKeys(project);
    const result = [];
    for (const key of used) {
      const item = externalByKey.get(key);
      if (!item) continue;
      const src = item.src.startsWith("data:") ? item.src : await blobDataUrl(await (await fetch(item.src)).blob());
      // meta rides along so exported games keep flipbook sheets (meta.charset
      // === false) out of the charset registry too.
      result.push(item.meta ? { type: item.type, name: item.name, src, meta: item.meta } : { type: item.type, name: item.name, src });
    }
    return result;
  }
  function assetLabel(key) {
    const item = externalByKey.get(key);
    return item ? displayName(item.name) : key;
  }

  return {
    TILE, PALETTE_COLS, paletteCols, tiles, T, drawTile, tileCanvas, tilesetCanvas,
    charsets, charsetIndex, drawChar, charFrameCanvas, faceCanvas, charSheetCanvas,
    HAIR_STYLES, CHARACTER_ART_STYLES, CHARACTER_BODY_TYPES, CHARACTER_OUTFITS, CHARACTER_ACCESSORIES,
    humanPreviewCanvas, registerHuman, removeCharset, registerCustomChars,
    ENEMY_TYPES, enemyCanvas, assetLabel, loadExternalAssets, bindExternalAssets, registerExternalAssets, exportUsedExternalAssets,
    ICON_SIZE, BASE_ICON_COUNT, get ICON_COUNT() { return iconCount; }, loadIconSet, iconSpan, iconHtml, iconCanvas,
    inputGlyphCanvas, inputGlyphDataUrl, inputGlyphHtml,
  };
})();

if (typeof window !== "undefined") window.Assets = Assets;
