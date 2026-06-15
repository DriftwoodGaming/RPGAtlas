/* RPGAtlas — renderer.js
  PIXI.js v8 renderer wrapper with HD-2D lighting.
  Lighting polish and PIXI integration by Kiro (Dirgefall Studio).
  Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
"use strict";

const Renderer = (() => {
  const PIXI = window.PIXI;
  const TILE = (window.Assets && window.Assets.TILE) || 48;

  let app = null,
    ok = false;
  let lowerSpr = null,
    upperSpr = null;
  let sceneContainer = null;
  let mapContainer = null;
  let spriteContainer = null;
  let lightRenderContainer = null;
  let lightMapTexture = null;
  let lightMapSprite = null;
  let ambientSpr = null;
  let gradientTexture = null;
  let currentMap = null;

  const charSprites = new Map();
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

  function tileHeightAt(x, y) {
    if (!currentMap || !currentMap.heights) return 0;
    if (x < 0 || y < 0 || x >= currentMap.width || y >= currentMap.height)
      return 0;
    return Number(currentMap.heights[y * currentMap.width + x] || 0);
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

  async function available() {
    if (ok) return true;
    try {
      app = new PIXI.Application();
      await app.init({
        antialias: false,
        premultipliedAlpha: true,
        backgroundAlpha: 0,
      });
      const pixiCanvas = app.canvas;
      pixiCanvas.id = "pixicanvas";
      pixiCanvas.style.cssText =
        "position:absolute;inset:0;z-index:0;image-rendering:pixelated";
      const gameCanvas = document.getElementById("gamecanvas");
      gameCanvas.parentNode.insertBefore(pixiCanvas, gameCanvas);
      ok = true;

      sceneContainer = new PIXI.Container();
      app.stage.addChild(sceneContainer);

      mapContainer = new PIXI.Container();
      sceneContainer.addChild(mapContainer);

      spriteContainer = new PIXI.Container();
      spriteContainer.sortableChildren = true;
      sceneContainer.addChild(spriteContainer);

      lightRenderContainer = new PIXI.Container();

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

  function setMap(lowerBuf, upperBuf, map) {
    if (!ok) return;
    mapContainer.removeChildren();
    lowerSpr = new PIXI.Sprite(PIXI.Texture.from(lowerBuf));
    upperSpr = new PIXI.Sprite(PIXI.Texture.from(upperBuf));
    mapContainer.addChild(lowerSpr);
    mapContainer.addChild(upperSpr);
    currentMap = map || null;
    if (map && map.heights) upperSpr.y -= 16;
    spriteContainer.removeChildren();
    charSprites.clear();
  }

  function renderFrame(w, h, camX, camY, sprites, extra) {
    if (!ok) return null;

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
      spr.zIndex = sData.pr;
    }
    spriteContainer.sortChildren();

    releaseAllLights();
    releaseAllShadows();

    const lights = extra.lights;
    const hasLights = lights && Array.isArray(lights) && lights.length > 0;
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
      const bgGraphics = new PIXI.Graphics();
      bgGraphics.beginFill(ambientColor, 1);
      bgGraphics.drawRect(0, 0, w, h);
      bgGraphics.endFill();
      lightRenderContainer.addChild(bgGraphics);

      const gradHalf = gradientTexture.width / 2;
      const sx = extra.shakeX || 0;
      const sy = extra.shakeY || 0;

      const tilePassable = extra.tilePassable;
      // Sombras temporariamente desabilitadas — apenas luzes por enquanto
      const useShadows = false;

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
          const radius = l.radius;
          const minTx = Math.max(0, Math.floor(l.rx - radius / TILE - 1));
          const maxTx = Math.min(
            currentMap.width,
            Math.ceil(l.rx + radius / TILE + 1),
          );
          const minTy = Math.max(0, Math.floor(l.ry - radius / TILE - 1));
          const maxTy = Math.min(
            currentMap.height,
            Math.ceil(l.ry + radius / TILE + 1),
          );
          for (let ty = minTy; ty < maxTy; ty++) {
            for (let tx = minTx; tx < maxTx; tx++) {
              const tileHeight = tileHeightAt(tx, ty);
              const tileBlocked = !tilePassable(tx, ty) || tileHeight > 0;
              if (!tileBlocked) continue;

              // Check if tile is within light radius
              const tileCx = tx * TILE + TILE / 2;
              const tileCy = ty * TILE + TILE / 2;
              const dx = tileCx - l.rx * TILE - TILE / 2;
              const dy = tileCy - l.ry * TILE - TILE / 2;
              const distToLight = Math.sqrt(dx * dx + dy * dy);

              // Skip if tile is too far from light source
              if (distToLight > radius + TILE) continue;

              const tileMinX = (tx * TILE - camX + sx) * zoom;
              const tileMinY = (ty * TILE - camY + sy) * zoom;
              const shadow = acquireShadowGraphics();
              const projectionDistance =
                l.radius * zoom * (0.3 + tileHeight * 0.1);
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

  return { available, setMap, renderFrame };
})();

window.Renderer = Renderer;
if (!window.GLRender) window.GLRender = Renderer;
