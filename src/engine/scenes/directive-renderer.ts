/* RPGAtlas — src/engine/scenes/directive-renderer.ts
   Project Beacon MP3·A: the client half of the presentation-directive seam.
   One function renders any modal directive with the engine's EXISTING UI —
   the message system (typewriter/control codes), the ui-stack choice window,
   the input scenes, the shop scene — and resolves with the player's reply
   value. boot.ts injects it into the solo ClientSession (injected, not
   imported, so src/engine/net/ stays off the DOM graph).

   Byte-identity: each arm calls the exact function the old command handler
   called, with the exact argument values, and the whole emit→render chain is
   synchronous (loopback delivery contract) — so the modal appears at the same
   point of the same tick as the pre-directive engine, and the reply resumes
   the interpreter in the same microtask chain. The RM-numeric position/
   background options ride the wire as names (protocol MESSAGE_*_NAMES) and
   map back losslessly here. GPL-3.0-or-later (see LICENSE). */

import type { Directive, DirectiveReplyValue, ShopTransaction } from "../../shared/net/protocol.js";
import { MAX_SHOP_TRANSACTIONS, MESSAGE_BG_NAMES, MESSAGE_POS_NAMES } from "../../shared/net/protocol.js";
import { ctx } from "../state/engine-context.js";
import { showList } from "../ui-stack.js";
import { numberInputScene, nameInputScene } from "./input-scenes.js";
import { Shop } from "./shop.js";

/** Render one directive with the client's UI and return the player's answer.
 *  The world side validates the answer again (C3.2) — this function is
 *  presentation, not authority. */
export async function renderDirective(d: Directive): Promise<DirectiveReplyValue> {
  switch (d.kind) {
    case "message":
      // The old `text` handler's showMessage call, args reconstructed
      // losslessly (names → RM numerics; omitted fields stay undefined, so
      // the message system applies its own defaults exactly as before).
      await ctx.showMessage(d.speaker, d.text, d.portrait, {
        background: d.background == null ? undefined : MESSAGE_BG_NAMES.indexOf(d.background),
        position: d.pos == null ? undefined : MESSAGE_POS_NAMES.indexOf(d.pos),
      });
      return { kind: "message", done: true };
    case "choices": {
      // The old `choices` handler's showList call — richText runs client-side
      // now (same module, same tick, same values in loopback).
      const i = await showList(
        d.options.map((o) => ({ html: ctx.richText(o) })),
        { className: "choicewin", cancellable: !!d.cancelable },
      );
      return i < 0 ? { kind: "choices", canceled: true } : { kind: "choices", choice: i };
    }
    case "numberInput":
      return { kind: "numberInput", value: await numberInputScene(d.digits, d.initial ?? 0) };
    case "nameInput":
      return { kind: "nameInput", value: await nameInputScene(d.initial ?? "", d.maxLen) };
    case "shop": {
      // The shop UI runs its whole session against the local view (loopback:
      // the world itself — its live buy/sell lines ARE the solo mutations,
      // byte-identical) and records the transcript for the reply. The world
      // re-applies it only for non-localEcho sessions (MP4/MP5).
      const transactions: ShopTransaction[] = [];
      await Shop.run(
        d.goods.map((g) => ({ kind: g.itemType, id: g.id })),
        d.currencyId,
        (line: ShopTransaction) => {
          if (transactions.length < MAX_SHOP_TRANSACTIONS) transactions.push(line);
        },
      );
      return { kind: "shop", transactions };
    }
  }
}
