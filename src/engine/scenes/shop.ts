/* RPGAtlas — src/engine/scenes/shop.ts
   The shop scene, extracted verbatim from the js/engine.js monolith (Phase 1
   Stage B): buy (stock from the shop command's goods list, 99-cap and gold
   gating), sell (half price, everything owned across item/weapon/armor),
   and the running gold line. Logic unchanged.
   Project Beacon MP3·A: the session optionally records each buy/sell line as
   a protocol ShopTransaction (the directive reply's transcript) — recording
   only, mutations untouched — and applyShopTranscript below is the WORLD-side
   application a real remote session's reply goes through (A6/C3: re-validated
   line-by-line against authoritative stock/wallet; never called in loopback,
   where the session's live lines are already the authoritative writes).
   GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA } from "../../shared/deps.js";
import { sysSe } from "../util.js";
import { showList } from "../ui-stack.js";
import { ctx } from "../state/engine-context.js";
import {
  G, dbFor, invCount, addInv, currencyBalance, addCurrency, currencyName,
} from "../state/game-state.js";
import { iconEntryHtml } from "./menus.js";
import type { ShopGood, ShopTransaction } from "../../shared/net/protocol.js";
import { MAX_SHOP_TRANSACTIONS } from "../../shared/net/protocol.js";

export const Shop: any = {
  async run(goods: any, currencyId?: any, onTransaction?: (line: ShopTransaction) => void) {
    // Wallet-currency shops (currencyId ≥ 2) trade in that Currency Types
    // balance and label amounts with the list entry's name ("50 Gems"). The
    // classic path (absent/0/1) renders byte-identically to the pre-wallet
    // shop: "Gold: <n> <system.currency>".
    const cid = Number(currencyId) || 0;
    const wallet = cid > 1;
    const unit = wallet ? currencyName(cid) : ctx.proj.system.currency;
    const goldLine = () => wallet
      ? unit + ": " + currencyBalance(cid)
      : "Gold: " + G.gold + " " + ctx.proj.system.currency;
    while (true) {
      const i = await showList(
        [{ label: "Buy" }, { label: "Sell" }, { label: "Leave" }],
        { title: "Shop — " + goldLine(), className: "shopwin" },
      );
      if (i < 0 || i === 2) return;
      if (i === 0) {
        while (true) {
          const entries = goods
            .map((gd: any) => ({ gd, e: RA.byId(dbFor(gd.kind), gd.id) }))
            .filter((x: any) => x.e);
          const bi = await showList(
            entries.map(({ gd, e }: any) => ({
              html:
                iconEntryHtml(e) +
                ' <span class="cnt">' +
                e.price +
                " " +
                unit +
                " · own ×" +
                invCount(gd.kind, gd.id) +
                "</span>",
              disabled: currencyBalance(cid) < e.price || invCount(gd.kind, gd.id) >= 99,
              help:
                e.desc ||
                (e.params
                  ? Object.entries(e.params)
                      .map(([k, v]) => k.toUpperCase() + "+" + v)
                      .join(" ")
                  : ""),
            })),
            { title: "Buy — " + goldLine(), className: "shopwin" },
          );
          if (bi < 0) break;
          const { gd, e } = entries[bi];
          addCurrency(cid, -e.price);
          addInv(gd.kind, gd.id, 1);
          if (onTransaction) onTransaction({ op: "buy", itemType: gd.kind, id: gd.id, count: 1 });
          sysSe("equip");
        }
      } else {
        while (true) {
          const owned = [];
          for (const kind of ["item", "weapon", "armor"]) {
            for (const idStr of Object.keys(G.inv[kind])) {
              const e = RA.byId(dbFor(kind), +idStr);
              if (e) owned.push({ kind, e });
            }
          }
          if (!owned.length) {
            await ctx.showMessage("", "Nothing to sell.");
            break;
          }
          const si = await showList(
            owned.map(({ kind, e }: any) => ({
              html:
                iconEntryHtml(e) +
                ' <span class="cnt">×' +
                invCount(kind, e.id) +
                " · " +
                Math.floor(e.price / 2) +
                " " +
                unit +
                "</span>",
            })),
            { title: "Sell — " + goldLine(), className: "shopwin" },
          );
          if (si < 0) break;
          const { kind, e } = owned[si];
          addInv(kind, e.id, -1);
          addCurrency(cid, Math.floor(e.price / 2));
          if (onTransaction) onTransaction({ op: "sell", itemType: kind as any, id: e.id, count: 1 });
          sysSe("equip");
        }
      }
    }
  },
};

/** Map a shop command's goods list to the wire shape (Beacon MP3·A). The
 *  price is the database's — the wire copy is informational (a client's shop
 *  UI reads its own project db; the world validates against the db too), so a
 *  stale/hostile price on the wire can never change what anything charges. */
export function wireShopGoods(goods: any): ShopGood[] {
  return (goods || []).map((gd: any) => ({
    itemType: gd.kind,
    id: gd.id,
    price: Number((RA.byId(dbFor(gd.kind), gd.id) || {}).price) || 0,
  }));
}

/** WORLD-side application of a shop directive reply's transcript (A6/C3.2c):
 *  every line replays against the authoritative goods list, database prices,
 *  wallet and inventory — illegal lines (not stocked, can't afford, over the
 *  99 cap, nothing to sell) are voided unit-by-unit, legal ones apply through
 *  the same helpers the solo shop UI uses. Prices are static, so an honest
 *  client's transcript reproduces its session exactly. Loopback never calls
 *  this (localEcho — the session's lines already applied by reference). */
export function applyShopTranscript(goods: any, currencyId: any, transactions: ShopTransaction[]): void {
  const cid = Number(currencyId) || 0;
  const offered = new Set((goods || []).map((gd: any) => gd.kind + ":" + gd.id));
  for (const line of (transactions || []).slice(0, MAX_SHOP_TRANSACTIONS)) {
    if (!line || (line.op !== "buy" && line.op !== "sell")) continue;
    const e = RA.byId(dbFor(line.itemType), line.id);
    if (!e) continue;
    const count = Math.min(Number(line.count) || 0, 99);
    if (line.op === "buy") {
      if (!offered.has(line.itemType + ":" + line.id)) continue;
      for (let i = 0; i < count; i++) {
        if (currencyBalance(cid) < e.price || invCount(line.itemType, line.id) >= 99) break;
        addCurrency(cid, -e.price);
        addInv(line.itemType, line.id, 1);
      }
    } else {
      for (let i = 0; i < count; i++) {
        if (invCount(line.itemType, line.id) <= 0) break;
        addInv(line.itemType, line.id, -1);
        addCurrency(cid, Math.floor(e.price / 2));
      }
    }
  }
}
