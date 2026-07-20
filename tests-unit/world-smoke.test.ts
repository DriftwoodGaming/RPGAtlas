/* RPGAtlas — tests-unit/world-smoke.test.ts
   Project Beacon MP8·B item 5: the small-N world load smoke — the CI target for
   the bot harness (the big-N runs live in server/bench/world-smoke.mjs). A real
   BeaconWorld over REAL WebSockets with passported sign-ins:

     1. N passported bots join one zone, random-walk, and measure intent→echo
        (send a move standing still → first authoritative delta reflecting it,
        cadence wait included). Asserts everyone moved and p95 stays inside the
        roadmap's ≤ 250 ms zone budget — the harness's health check.
     2. A player's position survives a FULL server restart over the socket
        (durable persistence, §A5): play → flush → close the world, start a
        brand-new world on the SAME store, reconnect the same passport, and land
        where you left off. The kill-a-zone/restore load-gate criterion at the
        socket level.

   Real sockets + a live 60 Hz tick → this file lives in the isolated serial net
   suite (vitest.net.config.mjs), per the MP5 rule. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startNodeWorldServer, type NodeWorldHandle } from "../server/src/node/ws-server";
import { MemoryWorldStore } from "../server/src/core/store";
import { decodeServerMessage, type ClientMessage } from "../src/shared/net/protocol";
import { generatePassport, passportPublicRaw, signChallenge, type Passport } from "../src/shared/net/passport";

const PROJECT = {
  system: { startMapId: 1, startX: 8, startY: 8, startDir: "down" },
  maps: [{ id: 1, width: 24, height: 24, layers: { ground: new Array(576).fill(1) } }],
  assets: { tiles: {} },
  autotiles: [],
};

let handle: NodeWorldHandle | null = null;
afterEach(async () => { if (handle) { await handle.close(); handle = null; } });

const DIRS = ["down", "left", "right", "up"] as const;
const send = (ws: WebSocket, m: ClientMessage) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); };

/** A passported bot that random-walks `moves` measured cycles, then closes. */
function loadBot(url: string, passport: Passport, index: number): Promise<{ samples: number[]; moved: boolean; ok: boolean }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const samples: number[] = [];
    let pid = -1, attempts = 0, done = 0, pendingSince = 0;
    let phase: "idle" | "await" | "step" = "idle";
    let moved = false, closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const finish = (ok: boolean) => { if (!closed) { closed = true; if (retry) clearTimeout(retry); try { ws.close(); } catch { /* */ } resolve({ samples, moved, ok }); } };
    const move = () => {
      if (done >= 5) return finish(true);
      pendingSince = performance.now();
      phase = "await";
      send(ws, { t: "input", seq: attempts + 1, intent: { k: "move", dir: DIRS[(attempts + index) % 4] } });
      if (retry) clearTimeout(retry);
      retry = setTimeout(() => { if (phase === "await") { attempts++; move(); } }, 200 + Math.floor(Math.random() * 120));
    };
    ws.on("error", () => finish(false));
    ws.on("message", (data) => {
      const r = decodeServerMessage(String(data));
      if (!r.ok) return;
      const m = r.msg as any;
      if (m.t === "challenge") {
        void (async () => {
          send(ws, { t: "hello", proto: 1, name: "Bot " + index, pub: await passportPublicRaw(passport), sig: await signChallenge(passport, m.nonce) });
          send(ws, { t: "join" });
        })();
      } else if (m.t === "welcome") { pid = m.playerId; }
      else if (m.t === "snapshot") { setTimeout(move, 20 + Math.random() * 60); }
      else if (m.t === "delta") {
        const me = (m.changes.players || []).find((p: any) => p.id === pid);
        if (!me) return;
        if (phase === "await" && me.moving) { samples.push(performance.now() - pendingSince); moved = true; done++; attempts++; if (retry) clearTimeout(retry); phase = "step"; }
        if (phase === "step" && !me.moving) { phase = "idle"; setTimeout(move, 8); }
      } else if (m.t === "error" || m.t === "kick") { if (m.fatal || m.t === "kick") finish(false); }
    });
    setTimeout(() => finish(moved), 12000);
  });
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MP8·B world load smoke (harness CI target)", () => {
  it("N passported bots join one zone, move, p95 intent→echo within the zone budget", async () => {
    handle = await startNodeWorldServer({ project: PROJECT, port: 0, seed: 1 });
    const url = `ws://127.0.0.1:${handle.port}`;
    const N = 6;
    const passports = await Promise.all(Array.from({ length: N }, (_, i) => generatePassport("Bot " + i)));
    const runs: Promise<{ samples: number[]; moved: boolean; ok: boolean }>[] = [];
    for (let i = 0; i < N; i++) {
      runs.push(loadBot(url, passports[i], i));
      await sleep(50); // stagger joins so bots disperse off the shared spawn tile
    }
    const results = await Promise.all(runs);
    const all = results.flatMap((r) => r.samples);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.every((r) => r.moved)).toBe(true);
    expect(all.length).toBeGreaterThan(20);
    const p50 = percentile(all, 50), p95 = percentile(all, 95);
    console.log(`[MP8·B] ${N} bots/1 zone, ${all.length} samples — intent→echo p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms (12 Hz cadence included; zone budget 250ms)`);
    expect(p95).toBeLessThanOrEqual(250);
  }, 30000);

  it("a player's position survives a full server restart over the socket (durable §A5)", async () => {
    const store = new MemoryWorldStore();
    const passport = await generatePassport("Riko");

    // Phase 1: sign in, walk 3 tiles right (8,8 → 11,8), let each step finish.
    handle = await startNodeWorldServer({ project: PROJECT, port: 0, seed: 1, store });
    let url = `ws://127.0.0.1:${handle.port}`;
    await walkExact(url, passport, "right", 3);
    await handle.close(); // flushes on graceful close (store present)
    handle = null;

    // Phase 2: a BRAND-NEW world on the SAME store; the same passport rejoins.
    handle = await startNodeWorldServer({ project: PROJECT, port: 0, seed: 1, store });
    url = `ws://127.0.0.1:${handle.port}`;
    const pos = await firstSnapshotPos(url, passport);
    expect(pos.x).toBe(11); // the saved tile, not the project start (8,8)
    expect(pos.y).toBe(8);
  }, 30000);
});

/** Sign in and walk exactly `n` tiles in `dir`, resolving once the last step
 *  has fully completed (so the record captures the final tile). */
function walkExact(url: string, passport: Passport, dir: (typeof DIRS)[number], n: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let pid = -1, done = 0, seq = 0;
    let phase: "idle" | "await" | "step" = "idle";
    let closed = false;
    const finish = () => { if (!closed) { closed = true; try { ws.close(); } catch { /* */ } resolve(); } };
    const step = () => { phase = "await"; send(ws, { t: "input", seq: ++seq, intent: { k: "move", dir } }); };
    ws.on("error", (e) => { if (!closed) { closed = true; reject(e); } });
    ws.on("message", (data) => {
      const r = decodeServerMessage(String(data));
      if (!r.ok) return;
      const m = r.msg as any;
      if (m.t === "challenge") void (async () => { send(ws, { t: "hello", proto: 1, name: passport.name, pub: await passportPublicRaw(passport), sig: await signChallenge(passport, m.nonce) }); send(ws, { t: "join" }); })();
      else if (m.t === "welcome") pid = m.playerId;
      else if (m.t === "snapshot") { if (done < n && phase === "idle") step(); }
      else if (m.t === "delta") {
        const me = (m.changes.players || []).find((p: any) => p.id === pid);
        if (!me) return;
        if (phase === "await" && me.moving) phase = "step";
        if (phase === "step" && !me.moving) { done++; phase = "idle"; if (done < n) step(); else setTimeout(finish, 60); }
      } else if (m.t === "error" || m.t === "kick") { if (!closed) { closed = true; reject(new Error(m.code || m.t)); } }
    });
    setTimeout(finish, 10000);
  });
}

/** Sign in and resolve the local player's position from the first snapshot. */
function firstSnapshotPos(url: string, passport: Passport): Promise<{ x: number; y: number }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let pid = -1, closed = false;
    ws.on("error", (e) => { if (!closed) { closed = true; reject(e); } });
    ws.on("message", (data) => {
      const r = decodeServerMessage(String(data));
      if (!r.ok) return;
      const m = r.msg as any;
      if (m.t === "challenge") void (async () => { send(ws, { t: "hello", proto: 1, name: passport.name, pub: await passportPublicRaw(passport), sig: await signChallenge(passport, m.nonce) }); send(ws, { t: "join" }); })();
      else if (m.t === "welcome") pid = m.playerId;
      else if (m.t === "snapshot") {
        const me = (m.world.players || []).find((p: any) => p.id === pid);
        closed = true; try { ws.close(); } catch { /* */ }
        if (me) resolve({ x: me.x, y: me.y }); else reject(new Error("no local player in snapshot"));
      } else if (m.t === "error" || m.t === "kick") { if (!closed) { closed = true; reject(new Error(m.code || m.t)); } }
    });
    setTimeout(() => { if (!closed) { closed = true; reject(new Error("snapshot timeout")); } }, 10000);
  });
}
