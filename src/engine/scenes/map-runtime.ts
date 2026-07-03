/* RPGAtlas — src/engine/scenes/map-runtime.ts
   The map runtime, extracted verbatim from the js/engine.js monolith (Phase 1
   Stage B): map loading/prerender, tile passability, event runtimes and page
   resolution, HD-2D opt-in + event lights, entity queries/motion/routes, the
   on-map action-combat system (sword hitboxes, chase AI, touch damage, float
   texts, overlay drawing), and player-entity init. Logic unchanged; the
   monolith's closure state (map, buffers, evRTs, blockingRun, camera/shake
   scalars, globalT) is read/written through the shared engine context so the
   remaining engine code observes the same live values. gameOver is reached
   through fns (the gameover scene is extracted in a later step); this module
   self-installs fns.refreshAllPages for the quest runtime.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, Music, RA } from "../../shared/deps.js";
import { Renderer } from "../../renderer/index.js";
import { drawLayerCell } from "../../shared/autotile-draw.js";
import { syncAutotileRegistry } from "../../shared/autotile-load.js";
import { clamp, rnd, compareVariable, sysSe } from "../util.js";
import { ctx, fns } from "../state/engine-context.js";
import { G, Quests, objectiveDone, onEnemyKilled, param } from "../state/game-state.js";
import { Plugins } from "../plugin-runtime.js";

const TILE = Assets.TILE;

// dev override until the editor exposes per-map HD-2D settings:
// ?hd2d=1 forces the HD-2D renderer on, ?hd2d=0 forces it off
const hdOverride = new URLSearchParams(location.search).get("hd2d");
export function hdMapEnabled(candidateMap: any): boolean {
  if (!candidateMap) return false;
  const hd = candidateMap.hd2d;
  if (hd && Object.prototype.hasOwnProperty.call(hd, "enabled")) return hd.enabled === true;
  if (hd && (hd.lights || hd.tilt != null || hd.ambient != null)) return true;
  return !!(candidateMap.lights && candidateMap.lights.length > 0);
}
function hdWanted(): boolean {
  if (hdOverride === "1") return true;
  if (hdOverride === "0") return false;
  return hdMapEnabled(ctx.map);
}

function tileAt(layer: any, x: any, y: any): any {
  return ctx.map.layers[layer][y * ctx.map.width + x];
}
export function tilePassable(x: any, y: any): boolean {
  if (x < 0 || y < 0 || x >= ctx.map.width || y >= ctx.map.height) return false;
  const ov = ctx.map.passOv ? ctx.map.passOv[y * ctx.map.width + x] : 0;
  if (ov === 1) return true;
  if (ov === 2 || ov === 3) return false; // 3 = ledge: blocked for walking, jumped over (Phase 5)
  const d2 = tileAt("decor2", x, y);
  if (d2 !== 0) return Assets.tiles[d2] ? Assets.tiles[d2].pass : false;
  const d = tileAt("decor", x, y);
  if (d !== 0) return Assets.tiles[d] ? Assets.tiles[d].pass : false;
  const g = tileAt("ground", x, y);
  if (g === 0) return false;
  return Assets.tiles[g] ? Assets.tiles[g].pass : false;
}
/** The clock's band: morning 5–10, day 10–17, evening 17–21, night 21–5. */
export function timeBandOf(hour: any): string {
  const h2 = ((Number(hour) || 0) % 24 + 24) % 24;
  if (h2 >= 5 && h2 < 10) return "morning";
  if (h2 >= 10 && h2 < 17) return "day";
  if (h2 >= 17 && h2 < 21) return "evening";
  return "night";
}
function pageActive(evId: any, page: any): boolean {
  const c = page.cond;
  if (c.switchId && !G.switches[c.switchId]) return false;
  if (c.timeBand && timeBandOf(G.timeOfDay) !== c.timeBand) return false;
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
function parseLight(name: any): any {
  if (!/^light\b/i.test(name || "")) return null;
  const light = { color: "#ffcc88", radius: 180 };
  for (const tok of String(name).slice(5).trim().split(/\s+/)) {
    if (/^#[0-9a-fA-F]{6}$/.test(tok)) light.color = tok;
    else if (/^\d+$/.test(tok)) light.radius = Number(tok);
  }
  return light;
}
function makeEvRT(evData: any): any {
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
export function refreshPage(rt: any): void {
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
export function refreshAllPages(): void {
  ctx.evRTs.forEach((rt: any) => {
    if (!rt.erased) refreshPage(rt);
  });
}
// The quest runtime (created before this module's functions can run) reaches
// refreshAllPages through the fns registry.
fns.refreshAllPages = refreshAllPages;

// Decode the project's autotile sheets into the shared registry once per
// project. Awaited before the first prerender so blobs are ready; subsequent
// map transfers reuse the decoded blocks (the registry is process-wide).
let autotilesSyncedFor: any = null;
function ensureAutotilesReady(): Promise<void> {
  if (autotilesSyncedFor === ctx.proj) return Promise.resolve();
  autotilesSyncedFor = ctx.proj;
  return new Promise((resolve) => syncAutotileRegistry(ctx.proj, resolve));
}

async function prerenderMap(): Promise<void> {
  await ensureAutotilesReady();
  ctx.lowerBuf = document.createElement("canvas");
  ctx.lowerBuf.width = ctx.map.width * TILE;
  ctx.lowerBuf.height = ctx.map.height * TILE;
  ctx.upperBuf = document.createElement("canvas");
  ctx.upperBuf.width = ctx.lowerBuf.width;
  ctx.upperBuf.height = ctx.lowerBuf.height;
  const lg = ctx.lowerBuf.getContext("2d"),
    ug = ctx.upperBuf.getContext("2d");
  lg.fillStyle = "#101018";
  lg.fillRect(0, 0, ctx.lowerBuf.width, ctx.lowerBuf.height);
  const m = ctx.map, gr = m.layers.ground, dc = m.layers.decor, d2 = m.layers.decor2, ov = m.layers.over;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      drawLayerCell(lg, gr, m.width, m.height, x, y, x * TILE, y * TILE, TILE, Assets.drawTile);
      drawLayerCell(lg, dc, m.width, m.height, x, y, x * TILE, y * TILE, TILE, Assets.drawTile);
      drawLayerCell(lg, d2, m.width, m.height, x, y, x * TILE, y * TILE, TILE, Assets.drawTile);
      drawLayerCell(ug, ov, m.width, m.height, x, y, x * TILE, y * TILE, TILE, Assets.drawTile);
    }
  }
  // quadrant shadows (drawn into the lower buffer, under characters)
  if (ctx.map.shadows) {
    const H = TILE / 2;
    lg.fillStyle = "rgba(10,10,26,0.35)";
    for (let y = 0; y < ctx.map.height; y++) {
      for (let x = 0; x < ctx.map.width; x++) {
        const m2 = ctx.map.shadows[y * ctx.map.width + x];
        if (!m2) continue;
        if (m2 & 1) lg.fillRect(x * TILE, y * TILE, H, H);
        if (m2 & 2) lg.fillRect(x * TILE + H, y * TILE, H, H);
        if (m2 & 4) lg.fillRect(x * TILE, y * TILE + H, H, H);
        if (m2 & 8) lg.fillRect(x * TILE + H, y * TILE + H, H, H);
      }
    }
  }
  ctx.hdActive =
    hdWanted() &&
    typeof Renderer !== "undefined" &&
    (await Renderer.available());
  if (ctx.hdActive) await Renderer.setMap(ctx.lowerBuf, ctx.upperBuf, ctx.map);
}

export async function loadMap(mapId: any): Promise<void> {
  ctx.map = RA.byId(ctx.proj.maps, mapId);
  if (!ctx.map) {
    ctx.map = ctx.proj.maps[0];
    if (!ctx.map) throw new Error("Map " + mapId + " not found");
    mapId = ctx.map.id;
  }
  // Saved or start positions can point outside this map (deleted/resized
  // maps, or the fallback above landing on a smaller map) — keep the player
  // inside the grid or movement and rendering both misbehave.
  if (G.player) {
    const px = clamp(G.player.x | 0, 0, ctx.map.width - 1);
    const py = clamp(G.player.y | 0, 0, ctx.map.height - 1);
    if (px !== G.player.x || py !== G.player.y) initPlayer(px, py, G.player.dir);
  }
  G.mapId = mapId;
  G.encSteps = 0;
  // Maps can pin the day/night clock on entry (blank = keep the current time).
  if (ctx.map.hd2d && ctx.map.hd2d.timeOfDay != null && ctx.map.hd2d.timeOfDay !== "") {
    G.timeOfDay = clamp(Number(ctx.map.hd2d.timeOfDay) || 0, 0, 24);
  }
  mapFloatTexts.length = 0;
  ctx.evRTs = ctx.map.events.map(makeEvRT);
  ctx.parallels.clear();
  await prerenderMap();
  Music.play(ctx.map.music || "none");
  Plugins.fire("mapLoad", ctx.map);
}

export function entityAt(x: any, y: any, exclude?: any): any[] {
  return ctx.evRTs.filter(
    (rt: any) =>
      rt !== exclude && !rt.erased && rt.page && rt.x === x && rt.y === y,
  );
}
export function blockingEventAt(x: any, y: any): any {
  return entityAt(x, y).find(
    (rt: any) => rt.page.priority === "same" && !rt.page.through,
  );
}
export function canEntityPass(rt: any, nx: any, ny: any): boolean {
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
export function eventBlocksChaseTile(mover: any, other: any, x: any, y: any): boolean {
  if (mover && mover.page && mover.page.through) return false;
  if (!other || other === mover || other.erased || !other.page) return false;
  if (other.page.priority !== "same" || other.page.through) return false;
  if (other.x === x && other.y === y) return true;
  return !!(other.moving && other.tx === x && other.ty === y);
}
function canCombatChasePass(rt: any, nx: any, ny: any): boolean {
  if (!canEntityPass(rt, nx, ny)) return false;
  return !ctx.evRTs.some((other: any) => eventBlocksChaseTile(rt, other, nx, ny));
}
export function startMove(ent: any, dir: any): void {
  // followers trail the tile the player just left (Phase 5 Stage C)
  if (ent === G.player) noteFollowerCrumb(ent.x, ent.y, dir);
  ent.dir = dir;
  const dx = dir === 1 ? -1 : dir === 2 ? 1 : 0;
  const dy = dir === 0 ? 1 : dir === 3 ? -1 : 0;
  ent.tx = ent.x + dx;
  ent.ty = ent.y + dy;
  ent.moving = true;
}
export function dirTo(fx: any, fy: any, tx: any, ty: any): number {
  const dx = tx - fx,
    dy = ty - fy;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 2 : 1;
  return dy > 0 ? 0 : 3;
}
export const DIRD: any = { 0: [0, 1], 1: [-1, 0], 2: [1, 0], 3: [0, -1] };
const mapFloatTexts: any[] = [];

function combatConfig(page: any): any {
  const cfg = page && page.combat;
  return cfg && cfg.enabled ? cfg : null;
}
function combatEnemy(cfg: any): any {
  return RA.byId(ctx.proj.enemies || [], Number(cfg && cfg.enemyId) || 0);
}
function combatMaxHp(cfg: any, enemy: any): number {
  return Math.max(1, Number(cfg && cfg.hp) || Number(enemy && enemy.stats && enemy.stats.mhp) || 1);
}
function combatAi(cfg: any): string {
  return cfg && cfg.ai === "chase" ? "chase" : "none";
}
function refreshEventCombat(rt: any): void {
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
function combatReady(rt: any): boolean {
  return !!(rt && rt.page && rt.combat && !rt.combat.dead && combatConfig(rt.page));
}
export function rectsOverlap(a: any, b: any): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
export function entityHurtbox(ent: any): any {
  return { x: ent.rx + 0.12, y: ent.ry + 0.10, w: 0.76, h: 0.86 };
}
export function swordHitboxAt(x: any, y: any, dir: any): any {
  if (dir === 3) return { x: x + 0.10, y: y - 0.48, w: 0.80, h: 0.62 };
  if (dir === 1) return { x: x - 0.48, y: y + 0.14, w: 0.62, h: 0.78 };
  if (dir === 2) return { x: x + 0.86, y: y + 0.14, w: 0.62, h: 0.78 };
  return { x: x + 0.10, y: y + 0.86, w: 0.80, h: 0.62 };
}
export function swordHitsEntity(attacker: any, target: any, dir: any): boolean {
  if (!attacker || !target) return false;
  const hitbox = swordHitboxAt(attacker.rx, attacker.ry, dir);
  if (rectsOverlap(hitbox, entityHurtbox(target))) return true;
  const [dx, dy] = DIRD[dir] || [0, 0];
  return target.x === attacker.x + dx && target.y === attacker.y + dy;
}
export function tileDistance(a: any, b: any): number {
  if (!a || !b) return Infinity;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
function attackFrame(attack: any): number {
  return attack ? attack.total - attack.framesLeft : 999;
}
function attackIsActive(attack: any): boolean {
  const frame = attackFrame(attack);
  return !!attack && frame >= 3 && frame <= 11;
}
function addMapFloatText(text: any, x: any, y: any, color?: any): void {
  mapFloatTexts.push({
    text,
    x,
    y,
    color: color || "#ffffff",
    life: 46,
    total: 46,
  });
}
export function startPlayerAttack(): boolean {
  const p = G.player;
  if (!p || p.attack || p.moving) return false;
  p.attack = { total: 18, framesLeft: 18, dir: p.dir, hitIds: new Set() };
  p.animT = (p.animT || 0) + 1;
  sysSe("miss");
  return true;
}
function mapAttackDamage(enemy: any): number {
  const a = G.party[0];
  const atk = a ? param(a, "atk") : 10;
  const def = Number(enemy && enemy.stats && enemy.stats.def) || 0;
  return Math.max(1, Math.floor(atk * 1.35 - def * 0.6));
}
function applyEnemyKnockback(rt: any, dir: any, tiles: any): void {
  if (!rt || rt.moving || tiles <= 0) return;
  const [dx, dy] = DIRD[dir] || [0, 0];
  const nx = rt.x + dx;
  const ny = rt.y + dy;
  if (!canEntityPass(rt, nx, ny)) return;
  rt.combat.knockback = true;
  rt.combat.stagger = Math.max(rt.combat.stagger || 0, 14);
  startMove(rt, dir);
}
function defeatMapEnemy(rt: any, cfg: any): void {
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
function damageMapEnemy(rt: any): void {
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
function damagePlayerFromEnemy(rt: any): void {
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
  ctx.shakePower = 3;
  ctx.shakeSpeed = 6;
  ctx.shakeTimer = 12;
  ctx.shakeDuration = 12;
  if (a.hp <= 0) {
    (async () => { await fns.gameOver(); })();
  }
}
export function updateMapCombat(): void {
  const p = G.player;
  if (p && p.hurtInvuln > 0) p.hurtInvuln--;
  if (p && p.attack) {
    if (attackIsActive(p.attack)) {
      for (const rt of ctx.evRTs) {
        if (!combatReady(rt) || p.attack.hitIds.has(rt.ev.id)) continue;
        if (!swordHitsEntity(p, rt, p.attack.dir)) continue;
        p.attack.hitIds.add(rt.ev.id);
        damageMapEnemy(rt);
      }
    }
    p.attack.framesLeft--;
    if (p.attack.framesLeft <= 0) p.attack = null;
  }
  for (const rt of ctx.evRTs) {
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
export function combatStaggered(rt: any): boolean {
  return !!(rt && rt.combat && rt.combat.stagger > 0);
}
export function combatChaseDir(rt: any): number {
  const p = G.player;
  if (!combatReady(rt) || !p || !rt.page) return -1;
  const cfg = combatConfig(rt.page);
  if (combatAi(cfg) !== "chase") return -1;
  if (combatStaggered(rt) || rt.locked || ctx.blockingRun) return -1;
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
function drawSwordSlash(g: any, hitbox: any, dir: any): void {
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
export function drawMapCombatOverlay(g: any, camX: any, camY: any, shakeX: any, shakeY: any, alpha: any, playerX: any, playerY: any): void {
  g.save();
  g.translate(Math.round(shakeX), Math.round(shakeY));
  g.scale(ctx.cameraZoom, ctx.cameraZoom);
  g.translate(-camX, -camY);
  const p = G.player;
  if (p && p.attack && attackIsActive(p.attack)) {
    drawSwordSlash(g, swordHitboxAt(playerX, playerY, p.attack.dir), p.attack.dir);
  }
  for (const rt of ctx.evRTs) {
    if (!combatReady(rt) || rt.combat.hurtFlash <= 0) continue;
    const rx = (rt.prx == null ? rt.rx : rt.prx + (rt.rx - rt.prx) * alpha) * TILE;
    const ry = (rt.pry == null ? rt.ry : rt.pry + (rt.ry - rt.pry) * alpha) * TILE;
    g.fillStyle = "rgba(255,255,255,0.36)";
    g.fillRect(rx + 6, ry - 6, TILE - 12, TILE);
  }
  g.font = "700 14px " + (ctx.proj.system.fontMenu || "sans-serif");
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

export function updateEntityMotion(ent: any, speed: any): boolean {
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
export function walkFrame(ent: any): number {
  if (!ent.moving && ent.kind !== "object") return 1;
  const seq = [0, 1, 2, 1];
  const speed = ent.kind === "object" ? 24 : 8;
  return seq[Math.floor((ent.animT || ctx.globalT) / speed) % 4];
}

// ---- routes ----
export function setRoute(ent: any, steps: any, onDone: any): void {
  ent.route = { steps, idx: 0, wait: 0, onDone };
}
export function updateRoute(ent: any): void {
  const r = ent.route;
  if (!r || ent.moving || ent.jumping) return;
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
  const dirs: any = { up: 3, down: 0, left: 1, right: 2 };
  const stepOk = (x: any, y: any) =>
    ent === G.player
      ? tilePassable(x, y) && !blockingEventAt(x, y)
      : canEntityPass(ent, x, y);
  if (s in dirs) {
    const d = dirs[s];
    ent.dir = d;
    const [dx, dy] = DIRD[d];
    const ok2 = stepOk(ent.x + dx, ent.y + dy);
    if (ok2) startMove(ent, d);
    else if (r.touch) ent.route = null; // touch-to-move: obstruction cancels
  } else if (s === "jump") {
    // hop 2 tiles in the facing direction; blocked → 1; both → in-place hop
    const [dx, dy] = DIRD[ent.dir] || [0, 0];
    if (stepOk(ent.x + dx * 2, ent.y + dy * 2)) startJump(ent, ent.dir, 2);
    else if (stepOk(ent.x + dx, ent.y + dy)) startJump(ent, ent.dir, 1);
    else startJump(ent, ent.dir, 0);
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

// ---- player entity ----
export function initPlayer(x: any, y: any, dir?: any): void {
  G.player = {
    x, y, rx: x, ry: y, prx: x, pry: y, tx: x, ty: y, dir: dir == null ? 0 : dir,
    moving: false, animT: 0, frame: 1, route: null, kind: "human",
    charsetIdx: 0, page: null, attack: null, hurtInvuln: 0,
  };
  refreshPlayerCharset();
}
export function refreshPlayerCharset(): void {
  // riding a vehicle swaps the player sprite for the vehicle's (Phase 5)
  if (G.vehicle) {
    const def = (ctx.proj.system.vehicles || {})[G.vehicle];
    const ci = def && def.charset ? Assets.charsetIndex(def.charset) : -1;
    if (ci >= 0) {
      G.player.charsetIdx = ci;
      G.player.kind = Assets.charsets[ci].kind;
      return;
    }
  }
  G.player.kind = "human";
  const lead = G.party[0];
  if (lead)
    G.player.charsetIdx = Math.max(0, Assets.charsetIndex(lead.charset));
}

// ============================================================================
// Phase 5 Stage C — regions, vehicles, followers, jumps
// ============================================================================

/** The region tag under a tile (0 = none). */
export function regionAt(x: any, y: any): number {
  const m = ctx.map;
  if (!m || !m.regions || x < 0 || y < 0 || x >= m.width || y >= m.height) return 0;
  return m.regions[y * m.width + x] || 0;
}

function groundKeyAt(x: any, y: any): string {
  if (x < 0 || y < 0 || x >= ctx.map.width || y >= ctx.map.height) return "";
  const t = Assets.tiles[tileAt("ground", x, y)];
  return t ? t.key : "";
}

// ---- vehicles ----
// Terrain rules: boat = bare shallow water; ship = bare water or deep water;
// airship = anywhere in bounds. "Bare" = no decor on the cell (bridges and
// lilies block hulls).
function vehicleCanPass(type: any, nx: any, ny: any): boolean {
  if (nx < 0 || ny < 0 || nx >= ctx.map.width || ny >= ctx.map.height) return false;
  if (type === "airship") return true;
  if (tileAt("decor", nx, ny) !== 0 || tileAt("decor2", nx, ny) !== 0) return false;
  const k = groundKeyAt(nx, ny);
  if (type === "boat") return k === "water";
  return k === "water" || k === "deepwater";
}
/** Player step passability, forked on the ridden vehicle (null = on foot). */
export function playerStepPassable(nx: any, ny: any): boolean {
  if (G.vehicle) return vehicleCanPass(G.vehicle, nx, ny);
  return tilePassable(nx, ny) && !blockingEventAt(nx, ny);
}
function vehicleDef(type: any): any {
  const v = (ctx.proj.system.vehicles || {})[type];
  return v && v.charset ? v : null;
}
/** Live position record for a configured vehicle (lazily seeded from the
 *  System-tab definition; persisted in saves via G.vehicles). */
export function vehicleState(type: any): any {
  const def = vehicleDef(type);
  if (!def) return null;
  G.vehicles = G.vehicles || {};
  if (!G.vehicles[type]) {
    G.vehicles[type] = { mapId: Number(def.mapId) || 0, x: Number(def.x) || 0, y: Number(def.y) || 0 };
  }
  return G.vehicles[type];
}
export const VEHICLE_TYPES = ["boat", "ship", "airship"];
function vehicleAtTile(x: any, y: any): any {
  for (const type of VEHICLE_TYPES) {
    if (G.vehicle === type) continue; // being ridden
    const st = vehicleState(type);
    if (st && st.mapId === G.mapId && st.x === x && st.y === y) return type;
  }
  return null;
}
/** Parked vehicles on the current map, as render drawables. */
export function vehicleDrawables(): any[] {
  const out: any[] = [];
  for (const type of VEHICLE_TYPES) {
    if (G.vehicle === type) continue;
    const st = vehicleState(type);
    if (!st || st.mapId !== G.mapId) continue;
    const ci = Assets.charsetIndex(vehicleDef(type).charset);
    if (ci < 0) continue;
    out.push({
      vehicleId: type, x: st.x, y: st.y, rx: st.x, ry: st.y, prx: st.x, pry: st.y,
      dir: 0, moving: false, animT: 0, page: null,
      charsetIdx: ci, kind: Assets.charsets[ci].kind,
    });
  }
  return out;
}
/** Board (facing or standing on a vehicle) / disembark on the action key.
 *  Returns true when the press was consumed by a vehicle. */
export function tryVehicleAction(): boolean {
  const p = G.player;
  if (!p) return false;
  if (G.vehicle) return tryDisembark();
  const [dx, dy] = DIRD[p.dir] || [0, 0];
  const type = vehicleAtTile(p.x + dx, p.y + dy) || vehicleAtTile(p.x, p.y);
  if (!type) return false;
  const st = vehicleState(type);
  G.vehicle = type;
  p.route = null;
  p.x = p.tx = st.x; p.y = p.ty = st.y;
  p.rx = p.prx = st.x; p.ry = p.pry = st.y;
  p.moving = false;
  refreshPlayerCharset();
  const def = vehicleDef(type);
  if (def.music && def.music !== "none") Music.play(def.music);
  sysSe("ok");
  return true;
}
function tryDisembark(): boolean {
  const p = G.player;
  const type = G.vehicle;
  // land on the tile ahead (airship: set down on the spot)
  let lx = p.x, ly = p.y;
  if (type !== "airship") {
    const [dx, dy] = DIRD[p.dir] || [0, 0];
    lx = p.x + dx; ly = p.y + dy;
  }
  if (!tilePassable(lx, ly) || blockingEventAt(lx, ly)) {
    sysSe("buzzer");
    return true;
  }
  const st = vehicleState(type);
  st.mapId = G.mapId; st.x = p.x; st.y = p.y;
  G.vehicle = null;
  p.x = p.tx = lx; p.y = p.ty = ly;
  p.rx = p.prx = lx; p.ry = p.pry = ly;
  p.moving = false;
  refreshPlayerCharset();
  Music.play(ctx.map.music || "none");
  sysSe("ok");
  return true;
}

// ---- party followers ----
/** (Re)build follower records from party[1..]; snap = pile onto the player
 *  (transfers, new game, load). */
export function syncFollowers(snap: any): void {
  const p = G.player;
  if (!ctx.proj.system.followers || !p) {
    G.followers = [];
    G.followerTrail = [];
    return;
  }
  const prevList = G.followers || [];
  G.followers = G.party.slice(1, 4).map((a: any, i: any) => {
    const prev = prevList[i] || {};
    const f: any = {
      followerId: i + 1,
      x: prev.x, y: prev.y, tx: prev.tx, ty: prev.ty,
      rx: prev.rx, ry: prev.ry, prx: prev.prx, pry: prev.pry,
      dir: prev.dir == null ? p.dir : prev.dir,
      moving: snap ? false : !!prev.moving,
      animT: prev.animT || 0, frame: 1, kind: "human", page: null,
      charsetIdx: Math.max(0, Assets.charsetIndex(a.charset)),
    };
    if (snap || f.x == null) {
      f.x = f.tx = p.x; f.y = f.ty = p.y;
      f.rx = f.prx = p.x; f.ry = f.pry = p.y;
      f.moving = false;
      f.dir = p.dir;
    }
    return f;
  });
  if (snap || !G.followerTrail) G.followerTrail = [];
}
/** Record the tile the player just left; follower i heads for crumb i. */
export function noteFollowerCrumb(x: any, y: any, dir: any): void {
  if (!ctx.proj || !ctx.proj.system.followers) return;
  const trail = G.followerTrail || (G.followerTrail = []);
  trail.unshift({ x, y, dir });
  if (trail.length > 8) trail.length = 8;
}
/** Advance followers one tick (ghosts: no collision, pure visuals). */
export function updateFollowers(speed: any): void {
  if (!ctx.proj.system.followers) return;
  const want = Math.max(0, Math.min(3, G.party.length - 1));
  if ((G.followers || []).length !== want) syncFollowers(false);
  const trail = G.followerTrail || [];
  (G.followers || []).forEach((f: any, i: any) => {
    f.prx = f.rx; f.pry = f.ry;
    if (f.moving) {
      updateEntityMotion(f, speed);
      return;
    }
    const crumb = trail[i];
    if (!crumb) return;
    if (f.x === crumb.x && f.y === crumb.y) {
      f.dir = crumb.dir;
      return;
    }
    startMove(f, dirTo(f.x, f.y, crumb.x, crumb.y));
  });
}

// ---- jumps (route step "jump" + ledge tiles passOv === 3) ----
export function startJump(ent: any, dir: any, tiles: any): void {
  const [dx, dy] = DIRD[dir] || [0, 0];
  if (ent === G.player) noteFollowerCrumb(ent.x, ent.y, dir);
  ent.dir = dir;
  ent.jumping = {
    fx: ent.x, fy: ent.y,
    tx: ent.x + dx * tiles, ty: ent.y + dy * tiles,
    t: 0, total: Math.max(10, 8 * tiles + 6),
  };
  sysSe("miss"); // the whoosh
}
/** Advance a jump one tick; true when the hop lands this tick. The arc is
 *  applied through ry so both render paths (and depth sort) see it. */
export function updateJumpMotion(ent: any): boolean {
  const j = ent.jumping;
  if (!j) return false;
  j.t++;
  const k = Math.min(1, j.t / j.total);
  ent.rx = j.fx + (j.tx - j.fx) * k;
  ent.ry = j.fy + (j.ty - j.fy) * k - Math.sin(Math.PI * k) * 0.85;
  ent.animT++;
  if (k >= 1) {
    ent.x = ent.tx = j.tx;
    ent.y = ent.ty = j.ty;
    ent.rx = j.tx;
    ent.ry = j.ty;
    ent.jumping = null;
    return true;
  }
  return false;
}
/** The ledge value under a target tile (passOv 3), bounds-safe. */
export function ledgeAt(x: any, y: any): boolean {
  const m = ctx.map;
  if (!m || !m.passOv || x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
  return m.passOv[y * m.width + x] === 3;
}
