/* RPGAtlas — renderer.js
  PIXI.js v8 renderer wrapper with HD-2D lighting.
  Lighting polish and PIXI integration by Kiro (Dirgefall Studio).
  Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
"use strict";

const Renderer = (() => {
  const PIXI = window.PIXI;
  const TILE = (window.Assets && window.Assets.TILE) || 48;
  // Screen pixels a tile rises per unit of map.heights. A 1/3-tile lift reads as
  // a believable step in the orthographic faux-3D view (Octopath-style dioramas)
  // without needing a tilted camera. height 9 ≈ 3 tiles tall.
  const ELEV = Math.round(TILE / 3);
  // Auto-shade for exposed block walls (the south face the viewer sees), ~0.6×.
  const WALL_TINT = 0x9a9a9a;

  let app = null,
    ok = false;
  let lowerSpr = null,
    upperSpr = null;
  let sceneContainer = null;
  let mapContainer = null;
  let spriteContainer = null;
  let wallFaceContainer = null; // shaded vertical wall faces, below the sprite layer
  let lightRenderContainer = null;
  let lightMapTexture = null;
  let lightMapSprite = null;
  let ambientGraphics = null;
  let gradientTexture = null;
  let currentMap = null;

  const charSprites = new Map();
  const wallTopSprites = []; // raised tile tops, kept in the depth-sorted sprite layer
  const lightSprPool = [];
  const activeLightSprs = [];
  const shadowGraphicsPool = [];
  const activeShadowGraphics = [];

  function buildGradientTexture() {
    const size = 512;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    // Smooth falloff from bright center to dark edges
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.1, "rgba(255,255,255,0.9)");
    g.addColorStop(0.2, "rgba(255,255,255,0.7)");
    g.addColorStop(0.35, "rgba(255,255,255,0.45)");
    g.addColorStop(0.5, "rgba(255,255,255,0.2)");
    g.addColorStop(0.7, "rgba(255,255,255,0.05)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const texture = PIXI.Texture.from(c);
    texture.baseTexture.scaleMode = "linear";
    return texture;
  }

  function buildWhiteTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 4;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 4, 4);
    return PIXI.Texture.from(c);
  }

  function acquireLightSpr() {
    let spr = lightSprPool.pop();
    if (!spr) {
      spr = new PIXI.Sprite(gradientTexture);
      spr.anchor.set(0.5);
      spr.blendMode = "add";
    }
    spr.visible = true;
    activeLightSprs.push(spr);
    return spr;
  }

  function releaseAllLights() {
    for (let i = 0; i < activeLightSprs.length; i++) {
      activeLightSprs[i].visible = false;
      activeLightSprs[i].parent &&
        activeLightSprs[i].parent.removeChild(activeLightSprs[i]);
      lightSprPool.push(activeLightSprs[i]);
    }
    activeLightSprs.length = 0;
  }

  function acquireShadowGraphics() {
    let g = shadowGraphicsPool.pop();
    if (!g) g = new PIXI.Graphics();
    g.clear();
    g.blendMode = "multiply";
    // Dark gray for shadows, not pure black (allows some light to pass through)
    g.beginFill(0x333333, 1);
    activeShadowGraphics.push(g);
    return g;
  }

  function releaseAllShadows() {
    for (let i = 0; i < activeShadowGraphics.length; i++) {
      const g = activeShadowGraphics[i];
      g.clear();
      g.parent && g.parent.removeChild(g);
      shadowGraphicsPool.push(g);
    }
    activeShadowGraphics.length = 0;
  }

  function ensureLightMap(w, h) {
    if (
      !lightMapTexture ||
      lightMapTexture.width !== w ||
      lightMapTexture.height !== h
    ) {
      if (lightMapTexture) lightMapTexture.destroy(true);
      lightMapTexture = PIXI.RenderTexture.create({
        width: w,
        height: h,
        scaleMode: "linear",
      });
      if (lightMapSprite) lightMapSprite.texture = lightMapTexture;
    }
    if (lightMapSprite) {
      lightMapSprite.width = w;
      lightMapSprite.height = h;
    }
  }

  function projectShadowPoint(px, py, lx, ly, distance, maxDist) {
    const dx = px - lx;
    const dy = py - ly;
    const len = Math.max(0.0001, Math.sqrt(dx * dx + dy * dy));
    const projDist = Math.min(distance, maxDist || distance);
    return { x: px + (dx / len) * projDist, y: py + (dy / len) * projDist };
  }

  function planLightOccluders(map, light, tilePassable) {
    const out = [];
    if (!map || !light || typeof tilePassable !== "function") return out;
    const radius = Math.max(0, Number(light.radius) || 0);
    const lightX = Number(light.rx);
    const lightY = Number(light.ry);
    if (!Number.isFinite(lightX) || !Number.isFinite(lightY) || radius <= 0) return out;
    const minTx = Math.max(0, Math.floor(lightX - radius / TILE - 1));
    const maxTx = Math.min(map.width, Math.ceil(lightX + radius / TILE + 1));
    const minTy = Math.max(0, Math.floor(lightY - radius / TILE - 1));
    const maxTy = Math.min(map.height, Math.ceil(lightY + radius / TILE + 1));
    for (let ty = minTy; ty < maxTy; ty++) {
      for (let tx = minTx; tx < maxTx; tx++) {
        if (tx === Math.floor(lightX) && ty === Math.floor(lightY)) continue;
        const tileHeight = map.heights
          ? Number(map.heights[ty * map.width + tx] || 0)
          : 0;
        if (tilePassable(tx, ty) && tileHeight <= 0) continue;
        const dx = (tx - lightX) * TILE;
        const dy = (ty - lightY) * TILE;
        if (Math.sqrt(dx * dx + dy * dy) > radius + TILE) continue;
        out.push({ tx, ty, tileHeight });
      }
    }
    return out;
  }

  // Pure geometry for the height-extrusion pass: one entry per elevated tile.
  // `faceUnits` is how far the south wall is exposed over its southern neighbour
  // (units of height) — that face is the only one visible in the top-down view;
  // north/east/west faces never show without a tilted camera. Tiles off the south
  // edge expose their full height. Exposed as Renderer.planWalls for unit testing.
  function planWalls(map) {
    const out = [];
    if (!map || !map.heights) return out;
    const w = map.width,
      h = map.height,
      hts = map.heights;
    const at = (x, y) =>
      x < 0 || y < 0 || x >= w || y >= h ? 0 : Number(hts[y * w + x] || 0);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const e = at(tx, ty);
        if (e <= 0) continue;
        const south = at(tx, ty + 1);
        out.push({ tx, ty, h: e, faceUnits: Math.max(0, e - south) });
      }
    }
    return out;
  }

  function buildShadowForTile(
    graphics,
    lightX,
    lightY,
    tx,
    ty,
    tileSize,
    projectionDistance,
    lightRadius,
  ) {
    const centerX = tx + tileSize * 0.5;
    const centerY = ty + tileSize * 0.5;
    const dx = lightX - centerX;
    const dy = lightY - centerY;
    const distToLight = Math.sqrt(dx * dx + dy * dy);

    // Limit projection to not exceed light radius
    const maxProjDist = Math.max(tileSize, lightRadius - distToLight);

    let c1x, c1y, c2x, c2y;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) {
        c1x = tx;
        c1y = ty;
        c2x = tx;
        c2y = ty + tileSize;
      } else {
        c1x = tx + tileSize;
        c1y = ty;
        c2x = tx + tileSize;
        c2y = ty + tileSize;
      }
    } else {
      if (dy > 0) {
        c1x = tx;
        c1y = ty;
        c2x = tx + tileSize;
        c2y = ty;
      } else {
        c1x = tx;
        c1y = ty + tileSize;
        c2x = tx + tileSize;
        c2y = ty + tileSize;
      }
    }
    const f1 = projectShadowPoint(
      c1x,
      c1y,
      lightX,
      lightY,
      projectionDistance,
      maxProjDist,
    );
    const f2 = projectShadowPoint(
      c2x,
      c2y,
      lightX,
      lightY,
      projectionDistance,
      maxProjDist,
    );
    graphics.moveTo(c1x, c1y);
    graphics.lineTo(c2x, c2y);
    graphics.lineTo(f2.x, f2.y);
    graphics.lineTo(f1.x, f1.y);
    graphics.closePath();
    graphics.endFill();
  }

  async function available(options = {}) {
    if (ok) return true;
    try {
      if (!PIXI || !PIXI.Application) return false;
      const targetCanvas = options.canvas || null;
      app = new PIXI.Application();
      await app.init({
        antialias: false,
        premultipliedAlpha: true,
        backgroundAlpha: 0,
        ...(targetCanvas ? { canvas: targetCanvas } : {}),
      });
      const pixiCanvas = app.canvas;
      pixiCanvas.style.imageRendering = "pixelated";
      if (!targetCanvas) {
        const gameCanvas = document.getElementById("gamecanvas");
        if (!gameCanvas || !gameCanvas.parentNode) {
          app.destroy();
          app = null;
          return false;
        }
        pixiCanvas.id = "pixicanvas";
        pixiCanvas.style.cssText =
          "position:absolute;inset:0;z-index:0;image-rendering:pixelated";
        gameCanvas.parentNode.insertBefore(pixiCanvas, gameCanvas);
      }
      ok = true;

      sceneContainer = new PIXI.Container();
      app.stage.addChild(sceneContainer);

      mapContainer = new PIXI.Container();
      sceneContainer.addChild(mapContainer);

      wallFaceContainer = new PIXI.Container();

      spriteContainer = new PIXI.Container();
      spriteContainer.sortableChildren = true;
      sceneContainer.addChild(spriteContainer);

      lightRenderContainer = new PIXI.Container();
      ambientGraphics = new PIXI.Graphics();

      lightMapTexture = PIXI.RenderTexture.create({
        width: 1,
        height: 1,
        scaleMode: "linear",
      });
      lightMapSprite = new PIXI.Sprite(lightMapTexture);
      lightMapSprite.blendMode = "multiply";
      lightMapSprite.width = 1;
      lightMapSprite.height = 1;
      lightMapSprite.visible = false;
      app.stage.addChild(lightMapSprite);

      gradientTexture = buildGradientTexture();
      return true;
    } catch (e) {
      console.error("PIXI init failed", e);
      return false;
    }
  }

  // Build raised tops + shaded south faces for every elevated tile. Tops live in
  // the depth-sorted sprite layer so characters occlude (and are occluded by)
  // elevation correctly; faces sit just under the sprite layer. Both are textured
  // from the tile's own prerendered ground pixels, so a stone cliff stays stone.
  function buildWalls(map) {
    wallFaceContainer.removeChildren();
    for (const t of wallTopSprites) t.destroy();
    wallTopSprites.length = 0;
    if (!map || !map.heights) return;

    const groundSrc = lowerSpr.texture.source;
    const plan = planWalls(map);
    for (const wseg of plan) {
      const gx = wseg.tx * TILE,
        gy = wseg.ty * TILE;
      const rise = wseg.h * ELEV;
      const tileTex = new PIXI.Texture({
        source: groundSrc,
        frame: new PIXI.Rectangle(gx, gy, TILE, TILE),
      });

      // South (front) wall face, exposed over the southern neighbour.
      if (wseg.faceUnits > 0) {
        const faceH = wseg.faceUnits * ELEV;
        const face = new PIXI.Sprite(tileTex);
        face.position.set(gx, gy + TILE - rise);
        face.width = TILE;
        face.height = faceH;
        face.tint = WALL_TINT;
        wallFaceContainer.addChild(face);
      }

      // Raised top. zIndex keys on the block's base (feet) row so it sorts
      // against character sprites — same band*100000 + baseY key renderFrame uses.
      const top = new PIXI.Sprite(tileTex);
      top.position.set(gx, gy - rise);
      top.zIndex = 1 * 100000 + (wseg.ty + 1) * TILE;
      spriteContainer.addChild(top);
      wallTopSprites.push(top);
    }
  }

  function setMap(lowerBuf, upperBuf, map) {
    if (!ok) return;
    mapContainer.removeChildren();
    lowerSpr = new PIXI.Sprite(PIXI.Texture.from(lowerBuf));
    upperSpr = new PIXI.Sprite(PIXI.Texture.from(upperBuf));
    mapContainer.addChild(lowerSpr);
    mapContainer.addChild(wallFaceContainer);
    mapContainer.addChild(upperSpr);
    currentMap = map || null;
    spriteContainer.removeChildren();
    charSprites.clear();
    buildWalls(currentMap);
  }

  function renderFrame(w, h, camX, camY, sprites, extra) {
    if (!ok) return null;
    extra = extra || {};

    if (app.renderer.width !== w || app.renderer.height !== h) {
      app.renderer.resize(w, h);
    }

    const zoom = extra.zoom || 1;
    sceneContainer.position.set(
      -camX + (extra.shakeX || 0),
      -camY + (extra.shakeY || 0),
    );
    sceneContainer.scale.set(zoom);

    for (const [, spr] of charSprites) spr.visible = false;
    for (let i = 0; i < sprites.length; i++) {
      const sData = sprites[i];
      let spr = charSprites.get(sData.id);
      if (!spr) {
        const tex = PIXI.Texture.from(sData.canvas);
        spr = new PIXI.Sprite(tex);
        spr._canvas = sData.canvas;
        charSprites.set(sData.id, spr);
        spriteContainer.addChild(spr);
      } else {
        spr.visible = true;
        if (spr._canvas !== sData.canvas) {
          spr._canvas = sData.canvas;
          spr.texture = PIXI.Texture.from(sData.canvas);
        }
      }
      spr.position.set(sData.rx * TILE, sData.ry * TILE - 8);
      // Sort by priority band, then by feet row, so characters interleave with
      // raised wall tops (buildWalls uses the same band*100000 + baseY key).
      spr.zIndex = sData.pr * 100000 + (sData.ry + 1) * TILE;
    }
    spriteContainer.sortChildren();

    releaseAllLights();
    releaseAllShadows();

    const lights = Array.isArray(extra.lights) ? extra.lights : [];
    const hasLights = lights.length > 0;
    const ambient = extra.ambient != null ? extra.ambient : 0.45;
    const doLighting = hasLights || ambient != null;

    if (doLighting) {
      ensureLightMap(w, h);
      lightMapSprite.visible = true;
      lightMapSprite.width = w;
      lightMapSprite.height = h;
      lightMapSprite.position.set(0, 0);

      lightRenderContainer.removeChildren();

      // Create ambient background based on ambient level
      // Higher ambient = lighter background, lower = darker
      const ambientBg = Math.floor(ambient * 255);
      const ambientColor = (ambientBg << 16) | (ambientBg << 8) | ambientBg;

      // Draw background with ambient color
      ambientGraphics.clear();
      ambientGraphics.beginFill(ambientColor, 1);
      ambientGraphics.drawRect(0, 0, w, h);
      ambientGraphics.endFill();
      lightRenderContainer.addChild(ambientGraphics);

      const gradHalf = gradientTexture.width / 2;
      const sx = extra.shakeX || 0;
      const sy = extra.shakeY || 0;

      const tilePassable = extra.tilePassable;
      // Shadows are safe only when the host provides map passability.
      const useShadows = currentMap && typeof tilePassable === "function";

      for (let i = 0; i < lights.length; i++) {
        const l = lights[i];
        if (
          !l ||
          !l.color ||
          typeof l.rx !== "number" ||
          typeof l.ry !== "number" ||
          typeof l.radius !== "number"
        )
          continue;

        const spr = acquireLightSpr();
        spr.tint = l.color.startsWith("#")
          ? parseInt(l.color.slice(1), 16)
          : 0xffffff;
        const lightX = (l.rx * TILE + TILE / 2 - camX + sx) * zoom;
        const lightY = (l.ry * TILE + TILE / 2 - camY + sy) * zoom;
        spr.position.set(lightX, lightY);
        spr.scale.set((l.radius * zoom) / gradHalf);
        lightRenderContainer.addChild(spr);

        if (useShadows) {
          for (const occluder of planLightOccluders(currentMap, l, tilePassable)) {
            const tileMinX = (occluder.tx * TILE - camX + sx) * zoom;
            const tileMinY = (occluder.ty * TILE - camY + sy) * zoom;
            const shadow = acquireShadowGraphics();
            const projectionDistance =
              l.radius * zoom * (0.3 + occluder.tileHeight * 0.1);
            buildShadowForTile(
              shadow,
              lightX,
              lightY,
              tileMinX,
              tileMinY,
              TILE * zoom,
              projectionDistance,
              l.radius * zoom,
            );
            lightRenderContainer.addChild(shadow);
          }
        }
      }

      app.renderer.render(lightRenderContainer, {
        renderTexture: lightMapTexture,
        clear: true,
      });
    } else {
      lightMapSprite.visible = false;
    }

    app.renderer.render(app.stage);
    return null;
  }

  return { available, setMap, renderFrame, planWalls, planLightOccluders };
})();

window.Renderer = Renderer;
if (!window.GLRender) window.GLRender = Renderer;
