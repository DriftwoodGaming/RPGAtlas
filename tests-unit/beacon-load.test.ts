/* RPGAtlas — tests-unit/beacon-load.test.ts
   Project Beacon MP5·E: the friend-room latency gate — 16 bots + 2 real clients
   in one room over REAL WebSockets, each random-walking, measuring the
   intent→echo round trip (send a move, time the first authoritative delta that
   reflects it). Asserts every player actually moved and the p95 stays inside the
   roadmap's ≤ 150 ms local budget; logs the measured p95/p50 so the gate records
   a number. A heavier standalone run lives in server/bench/bot-smoke.mjs.
   GPL-3.0. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startNodeServer, type NodeServerHandle } from "../server/src/node/ws-server";
import { decodeServerMessage, encodeMessage, type ClientMessage } from "../src/shared/net/protocol";

const PROJECT = {
  system: { startMapId: 1, startX: 8, startY: 8, startDir: "down" },
  maps: [{ id: 1, width: 20, height: 20, layers: { ground: new Array(400).fill(1) } }],
  assets: { tiles: {} },
  autotiles: [],
};

let handle: NodeServerHandle | null = null;
afterEach(async () => { if (handle) { await handle.close(); handle = null; } });

const DIRS = [
  { dir: "down", dir8: 0 }, { dir: "left", dir8: 1 }, { dir: "right", dir8: 2 }, { dir: "up", dir8: 3 },
] as const;

/** One bot: connect, join (or create), then run `moves` measured move cycles.
 *  Measures true intent→echo: it stands STILL, sends a move, times the first
 *  authoritative delta reflecting it (the server applies it on the next tick),
 *  then waits for the step to COMPLETE before the next move. A blocked step
 *  (anti-stack on the shared spawn tile) retries a different direction, so 18
 *  players disperse rather than deadlock. GPL-3.0. */
function runBot(url: string, opts: { code?: string; moves: number; index: number; onCode?: (c: string) => void }): Promise<{ samples: number[]; moved: boolean; ok: boolean }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const samples: number[] = [];
    let pid = -1;
    let lastRx = 0, lastRy = 0;
    let pendingSince = 0;
    let attempts = 0;
    let done = 0;
    let phase: "idle" | "await" | "step" = "idle";
    let moved = false;
    let closed = false;
    let blockTimer: ReturnType<typeof setTimeout> | null = null;

    const send = (m: ClientMessage) => ws.send(encodeMessage(m));
    const finish = (ok: boolean) => { if (!closed) { closed = true; if (blockTimer) clearTimeout(blockTimer); try { ws.close(); } catch { /* */ } resolve({ samples, moved, ok }); } };

    const sendMove = () => {
      if (done >= opts.moves) { finish(true); return; }
      const d = DIRS[(attempts + opts.index) % 4];
      pendingSince = performance.now();
      phase = "await";
      send({ t: "input", seq: attempts + 1, intent: { k: "move", dir: d.dir, dir8: d.dir8 } });
      if (blockTimer) clearTimeout(blockTimer);
      // blocked → retry a different direction; jitter breaks lock-step contention
      blockTimer = setTimeout(() => { if (phase === "await") { attempts++; sendMove(); } }, 90 + Math.floor(Math.random() * 80));
    };

    ws.on("open", () => { send({ t: "hello", proto: 1, name: opts.code ? "bot" : "host" }); send({ t: "join", code: opts.code }); });
    ws.on("error", () => finish(false));
    ws.on("message", (data) => {
      const r = decodeServerMessage(String(data));
      if (!r.ok) return;
      const m = r.msg as any;
      if (m.t === "error" || m.t === "kick") { finish(false); return; }
      if (m.t === "welcome") { pid = m.playerId; opts.onCode?.(m.roomCode); }
      else if (m.t === "snapshot") {
        const me = (m.world.players || []).find((p: any) => p.id === pid);
        if (me) { lastRx = me.rx; lastRy = me.ry; }
        setTimeout(sendMove, 0);
      } else if (m.t === "delta") {
        const me = (m.changes.players || []).find((p: any) => p.id === pid);
        if (!me) return;
        if (phase === "await" && (me.moving || me.rx !== lastRx || me.ry !== lastRy)) {
          samples.push(performance.now() - pendingSince);
          pendingSince = 0; moved = true; done++; attempts++;
          if (blockTimer) clearTimeout(blockTimer);
          phase = "step";
        }
        if (phase === "step" && !me.moving) { phase = "idle"; setTimeout(sendMove, 6); } // step done → next
        lastRx = me.rx; lastRy = me.ry;
      }
    });
    setTimeout(() => finish(moved), 11000); // safety net
  });
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

describe("MP5·E friend-room latency gate", () => {
  it("16 bots + 2 clients: everyone moves, p95 intent→echo within budget", async () => {
    // Raise the room cap for the 18-player gate (the friend-room default is 16;
    // "16 bots + 2 clients" needs room for 18 — a server config knob).
    handle = await startNodeServer({ project: PROJECT, port: 0, limits: { maxPlayersPerRoom: 24 } });
    const url = `ws://127.0.0.1:${handle.port}`;

    // Host creates the room; capture its code for the rest.
    let code = "";
    let resolveCode: (c: string) => void;
    const codeReady = new Promise<string>((r) => (resolveCode = r));
    const host = runBot(url, { moves: 8, index: 0, onCode: (c) => { code = c; resolveCode(c); } });
    code = await codeReady;

    // 15 bots + 2 "real" clients join by code (18 players total, ≥ the 16+2 gate).
    // Stagger the joins so each disperses off the shared spawn tile (D-B5: all
    // players spawn on the start tile until per-map spawns land in MP7) before
    // the next arrives, rather than a thundering herd on one tile.
    const joiners: Promise<{ samples: number[]; moved: boolean; ok: boolean }>[] = [];
    for (let i = 0; i < 17; i++) {
      joiners.push(runBot(url, { code, moves: 8, index: i + 1 }));
      await new Promise((r) => setTimeout(r, 60));
    }
    const results = await Promise.all([host, ...joiners]);

    const all = results.flatMap((r) => r.samples);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.every((r) => r.moved)).toBe(true); // every player actually moved
    expect(all.length).toBeGreaterThan(100); // plenty of measurements

    const p50 = percentile(all, 50);
    const p95 = percentile(all, 95);
    console.log(`[MP5·E] 18 players, ${all.length} samples — intent→echo p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms (budget 150ms)`);
    expect(p95).toBeLessThanOrEqual(150);
  }, 30000);
});
