/* RPGAtlas — src/engine/net/solo-session.ts
   Project Beacon MP2·A: the single-player composition of the loopback split.
   One in-process channel connects a WorldHost (owning `defaultWorld`, the solo
   session's world) to a ClientSession the presentation layer reads. This is the
   solo analogue of what MP5 stands up per room on the Beacon relay — same
   WorldHost, same ClientSession, a different Transport underneath.

   Nothing here reaches back into the engine's DOM/scene modules: it wires the
   headless transport to the world instance and exposes the two endpoints. The
   engine binds them at MP2·B — the map scene captures player input into intents
   through `soloClient` and drains them through `soloHost`, and the loop drives
   `soloHost.tick()`. Until then this module is inert (imported by nothing on the
   live path), so its mere existence changes no behavior. GPL-3.0-or-later. */

import { defaultWorld } from "../state/default-world.js";
import { createLoopbackPair } from "../../shared/net/transport.js";
import { WorldHost } from "./world-host.js";
import { ClientSession } from "./client-session.js";

const link = createLoopbackPair();

/** The solo session's server: owns `defaultWorld` and its tick. The loop drives
 *  `soloHost.tick()`; the map scene drains `soloHost.drainIntents()`. */
export const soloHost = new WorldHost(defaultWorld, link.server);

/** The solo session's client: the map scene sends player input through
 *  `soloClient.sendInput()`; the renderer reads `soloClient.view` (the world by
 *  reference in loopback — the same object the ctx/G shim already exposes). */
export const soloClient = new ClientSession(link.client, defaultWorld);
