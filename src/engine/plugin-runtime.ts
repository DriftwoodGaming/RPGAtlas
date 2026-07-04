/* RPGAtlas — src/engine/plugin-runtime.ts
   The plugin runtime, extracted verbatim from the js/engine.js monolith
   (Phase 1 Stage B). Plugins register hooks (mapLoad/update/render), message
   text processors, custom event commands, a scene transition, and read the
   frozen `atlas` surface built in runAll(). Failure semantics are unchanged:
   a hook that throws is disabled (spliced out) after logging; a plugin whose
   code throws is marked failed; duplicate ids and missing dependencies skip.
   Plugin commands route onto the SAME registry as built-ins with the frozen
   fn(cmd, interp) signature wrapped in per-call error isolation. Battle is
   reached through fns because the battle scene is extracted in a later step.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, Music, Sfx } from "../shared/deps.js";
import { registerCommand } from "./interpreter/registry.js";
import { ctx, fns } from "./state/engine-context.js";
import { G } from "./state/game-state.js";
import { scriptApi } from "./script-api.js";
import { zonesAtTile } from "../shared/zone-geom.js";

export const Plugins: any = {
  hooks: { mapLoad: [], update: [], render: [] },
  textProcessors: [], // fn(html) -> html, run on every message/choice string
  commands: {}, // custom event-command handlers, by command type
  transition: null, // { out(ms), in(ms) } installed by a transition plugin
  status: [],
  pluginId(pl: any) {
    return String(
      (pl && (pl.pluginId || pl.key || pl.name || "plugin." + pl.id)) || "",
    ).trim();
  },
  fire(name: any, arg?: any) {
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
  fireRender(g: any, info: any) {
    const list = this.hooks.render;
    for (let i = list.length - 1; i >= 0; i--) {
      try {
        list[i](g, info);
      } catch (e) {
        console.error("Plugin render hook failed and was disabled:", e);
        list.splice(i, 1);
      }
    }
  },
  runAll() {
    const atlas = {
      get project() {
        return ctx.proj;
      },
      get map() {
        return ctx.map;
      },
      get player() {
        return G.player;
      },
      get scene() {
        return ctx.scene;
      },
      Assets,
      Sfx,
      Music,
      get SCREEN_W() {
        return ctx.SCREEN_W;
      },
      get SCREEN_H() {
        return ctx.SCREEN_H;
      },
      TILE: Assets.TILE,
      get fader() {
        return ctx.fader;
      },
      get stage() {
        return ctx.stage;
      },
      get uiLayer() {
        return ctx.uiLayer;
      },
      onMapLoad: (fn: any) => Plugins.hooks.mapLoad.push(fn),
      onUpdate: (fn: any) => Plugins.hooks.update.push(fn),
      onRender: (fn: any) => Plugins.hooks.render.push(fn),
      onMessageText: (fn: any) => Plugins.textProcessors.push(fn),
      // Plugin commands route onto the same registry as built-ins. The frozen
      // plugin API is fn(cmd, interp) with per-call error isolation (the old
      // switch `default` behavior), so adapt the (cmd, ctx) registry handler
      // to call fn(cmd, ctx.interp) inside the same try/catch.
      registerCommand: (t: any, fn: any) => {
        Plugins.commands[t] = fn; // kept for introspection / parity
        registerCommand(t, async (cmd: any, ic: any) => {
          try {
            await fn(cmd, ic.interp);
          } catch (e) {
            console.error("Plugin command '" + t + "' failed:", e);
          }
        });
      },
      setTransition: (t: any) => {
        Plugins.transition = t;
      },
      startBattle: (troopId: any, canEscape: any) =>
        fns.Battle.run(troopId, canEscape !== false),
      // Gameplay zones (Phase 8): every zone covering tile (x, y) on the current
      // map, in author draw order. The plugin-facing win of the zone model —
      // "custom" zones are inert to the engine but readable here, so a plugin can
      // give any zone kind its own meaning. Absent map.zones ⇒ [].
      zonesAt: (x: any, y: any) =>
        zonesAtTile(ctx.map && ctx.map.zones, Math.floor(x), Math.floor(y)),
    };
    Plugins.atlas = Plugins.dw = atlas; // .dw kept for pre-rebrand plugins
    Plugins.status = [];
    const seen = new Set(),
      loaded = new Set();
    for (const pl of ctx.proj.plugins || []) {
      const pluginId = Plugins.pluginId(pl);
      const entry: any = {
        id: pl.id,
        pluginId: pluginId,
        name: pl.name || pluginId || "?",
        status: "pending",
        errors: [],
      };
      Plugins.status.push(entry);
      if (!pl.on) {
        entry.status = "disabled";
        continue;
      }
      if (!pluginId) {
        entry.status = "skipped";
        entry.errors.push("Missing plugin ID.");
        console.warn("Plugin '" + (pl.name || "?") + "' skipped: missing plugin ID.");
        continue;
      }
      if (seen.has(pluginId)) {
        entry.status = "skipped";
        entry.errors.push("Duplicate plugin ID: " + pluginId);
        console.warn("Plugin '" + (pl.name || pluginId) + "' skipped: duplicate plugin ID '" + pluginId + "'.");
        continue;
      }
      seen.add(pluginId);
      const missing = (pl.dependencies || []).filter((dep: any) => !loaded.has(dep));
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
      } catch (e: any) {
        // "dw" = pre-rebrand alias
        console.error("Plugin '" + (pl.name || "?") + "' failed:", e);
        entry.status = "failed";
        entry.errors.push(e && e.message ? e.message : String(e));
      }
    }
    if (typeof window !== "undefined") (window as any).AtlasPluginStatus = Plugins.status;
  },
};

// Extracted modules (message system, input glyphs, map runtime) reach the
// plugin runtime through fns; install at module evaluation so it's available
// before any init wiring runs.
fns.Plugins = Plugins;
