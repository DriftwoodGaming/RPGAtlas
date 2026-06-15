/* RPGAtlas - quests.js
   Quest runtime extracted from engine.js. */
"use strict";

(function () {
  function createQuestRuntime(deps) {
    const G = deps.G;
    const RA = deps.RA;
    const clamp = deps.clamp;
    const gainExp = deps.gainExp;
    const addInv = deps.addInv;
    const invCount = deps.invCount;
    const dbFor = deps.dbFor;
    const refreshAllPages = deps.refreshAllPages;
    const getProj = deps.getProj;
    const now = deps.now || Date.now;

    function proj() {
      return getProj() || {};
    }
    function questDef(id) { return RA.byId(proj().quests || [], id); }
    function questState(id) { return G.quests[String(id)] || null; }
    function setQuestState(id, state) { G.quests[String(id)] = state; return state; }
    function questObjectives(def) { return Array.isArray(def && def.objectives) ? def.objectives : []; }
    function objectiveCount(obj) { return Math.max(1, Number(obj && obj.count) || 1); }
    function objectiveItemKind(obj) { return obj && obj.itemKind || "item"; }
    function objectiveStateSlot(st, index) {
      if (!st.objectives) st.objectives = [];
      if (!st.objectives[index]) st.objectives[index] = { current: 0 };
      return st.objectives[index];
    }
    function ensureQuestStateShape(def, st) {
      const next = Object.assign({
        status: "inactive",
        unlockedAt: 0,
        startedAt: 0,
        completedAt: 0,
        failedAt: 0,
        rewardsApplied: false,
        failEffectsApplied: false,
        chainUnlocked: false,
        objectives: [],
        failState: [],
        failSummary: "",
      }, st || {});
      const objs = questObjectives(def);
      next.objectives = objs.map((obj, i) => Object.assign({ current: 0 }, (next.objectives && next.objectives[i]) || {}));
      next.failState = ((def && def.failConditions) || []).map((fc, i) => Object.assign({ current: 0 }, (next.failState && next.failState[i]) || {}));
      return next;
    }
    function rewardAmount(entry) { return Number(entry && (entry.amount != null ? entry.amount : entry.count)) || 0; }
    function rewardBool(v) { return v === true || v === "true"; }
    function rewardItemKind(entry) { return entry && entry.itemKind || "item"; }
    function rewardLabel(entry) {
      const amount = Math.max(0, rewardAmount(entry));
      if (!entry || !entry.kind || amount <= 0) return "";
      if (entry.kind === "exp") return amount + " EXP";
      if (entry.kind === "gold") return amount + " " + proj().system.currency;
      if (entry.kind === "item") {
        const item = RA.byId(dbFor(rewardItemKind(entry)), Number(entry.id) || 0);
        return (item ? item.name : "Item") + (amount > 1 ? " ×" + amount : "");
      }
      return "";
    }
    function rewardSummary(list) {
      const parts = (list || []).map(rewardLabel).filter(Boolean);
      if (!parts.length) return "";
      if (parts.length === 1) return parts[0];
      if (parts.length === 2) return parts[0] + " and " + parts[1];
      return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
    }
    function effectLabel(entry) {
      if (!entry || !entry.kind) return "";
      if (entry.kind === "switch") return "Switch " + entry.id + " " + (rewardBool(entry.val) ? "ON" : "OFF");
      if (entry.kind === "var") return "Variable " + entry.id + " " + (entry.op || "set") + " " + rewardAmount(entry);
      if (entry.kind === "questUnlock") {
        const q = questDef(entry.questId);
        return "Unlock quest " + (q ? q.name : ("#" + entry.questId));
      }
      if (entry.kind === "questLock") {
        const q = questDef(entry.questId);
        return "Lock quest " + (q ? q.name : ("#" + entry.questId));
      }
      return rewardLabel(entry);
    }
    function effectSummary(list) {
      const parts = (list || []).map(effectLabel).filter(Boolean);
      if (!parts.length) return "";
      if (parts.length === 1) return parts[0];
      if (parts.length === 2) return parts[0] + " and " + parts[1];
      return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
    }
    function objectiveProgress(def, st, index) {
      const obj = questObjectives(def)[index];
      if (!obj) return 0;
      if (obj.kind === "fetch") {
        const slot = objectiveStateSlot(st, index);
        if ((st.status === "completed" || st.status === "failed" || st.status === "abandoned") && slot.current) return slot.current;
        return invCount(objectiveItemKind(obj), Number(obj.id) || 0);
      }
      return objectiveStateSlot(st, index).current || 0;
    }
    function objectiveMet(def, st, index, ctx) {
      const obj = questObjectives(def)[index];
      if (!obj) return true;
      if (objectiveProgress(def, st, index) < objectiveCount(obj)) return false;
      if (obj.kind === "fetch") {
        if (obj.targetMapId && ctx && Number(obj.targetMapId) !== Number(ctx.mapId)) return false;
        if (obj.targetEventId && ctx && Number(obj.targetEventId) !== Number(ctx.eventId)) return false;
      }
      return true;
    }
    function questObjectivesMet(def, st, ctx) {
      const objs = questObjectives(def);
      return !objs.length || objs.every((_, i) => objectiveMet(def, st, i, ctx));
    }
    function objectiveLabel(obj) {
      if (!obj) return "Objective";
      if (obj.label) return obj.label;
      if (obj.kind === "kill") {
        const enemy = RA.byId(proj().enemies, Number(obj.enemyId) || 0);
        return "Defeat " + (enemy ? enemy.name : "enemy") + (objectiveCount(obj) > 1 ? " ×" + objectiveCount(obj) : "");
      }
      if (obj.kind === "fetch") {
        const item = RA.byId(dbFor(objectiveItemKind(obj)), Number(obj.id) || 0);
        return "Bring " + (item ? item.name : "item") + (objectiveCount(obj) > 1 ? " ×" + objectiveCount(obj) : "");
      }
      return "Complete objective";
    }
    function objectiveDisplay(def, st, index) {
      const obj = questObjectives(def)[index];
      if (!obj) return null;
      const current = Math.min(objectiveProgress(def, st, index), objectiveCount(obj));
      const total = objectiveCount(obj);
      return { text: objectiveLabel(obj), current, total, done: current >= total };
    }
    function objectiveDone(questId, index) {
      const def = questDef(questId), st = questState(questId);
      if (!def || !st || st.status !== "active") return false;
      const obj = objectiveDisplay(def, st, index);
      return !!(obj && obj.done);
    }
    function advanceQuestObjective(questId, index, amount) {
      const def = questDef(questId), st = questState(questId);
      if (!def || !st || st.status !== "active") return false;
      const obj = questObjectives(def)[index];
      if (!obj || obj.kind === "fetch") return false;
      const slot = objectiveStateSlot(st, index);
      slot.current = clamp((slot.current || 0) + (Number(amount) || 0), 0, objectiveCount(obj));
      return true;
    }
    function setQuestObjective(questId, index, value) {
      const def = questDef(questId), st = questState(questId);
      if (!def || !st || st.status !== "active") return false;
      const obj = questObjectives(def)[index];
      if (!obj || obj.kind === "fetch") return false;
      const slot = objectiveStateSlot(st, index);
      slot.current = clamp(Number(value) || 0, 0, objectiveCount(obj));
      return true;
    }
    function onEnemyKilled(enemyId) {
      for (const def of proj().quests || []) {
        const st = questState(def.id);
        if (!st || st.status !== "active") continue;
        questObjectives(def).forEach((obj, i) => {
          if (obj.kind === "kill" && Number(obj.enemyId) === Number(enemyId)) advanceQuestObjective(def.id, i, 1);
        });
      }
    }
    function consumeFetchObjectives(def, st) {
      questObjectives(def).forEach((obj) => {
        if (obj.kind !== "fetch" || !obj.consumeOnComplete) return;
        const id = Number(obj.id) || 0;
        if (!id) return;
        addInv(objectiveItemKind(obj), id, -objectiveCount(obj));
      });
    }
    function snapshotObjectiveProgress(def, st) {
      questObjectives(def).forEach((obj, i) => {
        objectiveStateSlot(st, i).current = Math.min(objectiveProgress(def, st, i), objectiveCount(obj));
      });
    }
    function applyQuestRewards(list) {
      for (const rw of list || []) {
        if (!rw || !rw.kind) continue;
        const amount = Math.max(0, rewardAmount(rw));
        if (rw.kind === "exp") {
          for (const a of G.party) gainExp(a, amount);
        } else if (rw.kind === "gold") {
          G.gold = clamp(G.gold + amount, 0, 9999999);
        } else if (rw.kind === "item") {
          const id = Number(rw.id) || 0;
          if (id) addInv(rewardItemKind(rw), id, amount);
        }
      }
    }
    function applyQuestEffects(list) {
      let changedState = false;
      for (const fx of list || []) {
        if (!fx || !fx.kind) continue;
        const amount = rewardAmount(fx);
        if (fx.kind === "exp" || fx.kind === "gold" || fx.kind === "item") {
          applyQuestRewards([fx]);
        } else if (fx.kind === "switch") {
          G.switches[fx.id] = rewardBool(fx.val);
          refreshAllPages();
          changedState = true;
        } else if (fx.kind === "var") {
          const id = Number(fx.id) || 0;
          const cur = G.vars[id] || 0;
          G.vars[id] = fx.op === "add" ? cur + amount : fx.op === "sub" ? cur - amount : amount;
          refreshAllPages();
          changedState = true;
        } else if (fx.kind === "questUnlock") {
          unlockQuest(fx.questId);
        } else if (fx.kind === "questLock") {
          Quests.lock(fx.questId);
        }
      }
      if (changedState) evaluateQuestFailures();
    }
    function questRequirementMet(req) {
      if (!req || !req.kind) return true;
      if (req.kind === "quest") {
        const st = questState(req.questId);
        return !!st && st.status === (req.status || "completed");
      }
      if (req.kind === "switch") return !!G.switches[req.id] === rewardBool(req.val);
      if (req.kind === "var") {
        const left = G.vars[req.id] || 0;
        const right = Number(req.val) || 0;
        return req.cmp === "==" ? left === right : req.cmp === "<=" ? left <= right : left >= right;
      }
      return true;
    }
    function questCanStart(def) {
      return !!def && (def.startReqs || []).every(questRequirementMet);
    }
    function failSlot(st, index) {
      if (!st.failState) st.failState = [];
      if (!st.failState[index]) st.failState[index] = { current: 0 };
      return st.failState[index];
    }
    function failConditionMet(fc, st) {
      if (!fc || !fc.kind || fc.kind === "manual") return false;
      if (fc.kind === "switch") return !!G.switches[fc.id] === rewardBool(fc.val);
      if (fc.kind === "var") {
        const left = G.vars[fc.id] || 0;
        const right = Number(fc.val) || 0;
        return fc.cmp === "==" ? left === right : fc.cmp === "<=" ? left <= right : left >= right;
      }
      if (fc.kind === "battleLose") return failSlot(st, fc._index).current > 0;
      if (fc.kind === "enemyDefeatCount") return failSlot(st, fc._index).current >= Math.max(1, Number(fc.count) || 1);
      return false;
    }
    function failConditionReason(def, fc) {
      if (def && def.failText) return def.failText;
      if (!fc) return effectSummary((def && def.failEffects) || []);
      if (fc.kind === "battleLose") {
        const troop = RA.byId(proj().troops, Number(fc.troopId) || 0);
        return troop ? ("The party fell against " + troop.name + ".") : "The quest was failed in battle.";
      }
      if (fc.kind === "enemyDefeatCount") {
        const enemy = RA.byId(proj().enemies, Number(fc.enemyId) || 0);
        return enemy ? ("Too many defeats against " + enemy.name + ".") : "The quest was failed after too many defeats.";
      }
      if (fc.kind === "switch") return "A story condition caused the quest to fail.";
      if (fc.kind === "var") return "A tracked value caused the quest to fail.";
      return effectSummary((def && def.failEffects) || "");
    }
    function evaluateQuestFailures() {
      for (const def of proj().quests || []) {
        const st = questState(def.id);
        if (!st || st.status !== "active") continue;
        const list = def.failConditions || [];
        for (let i = 0; i < list.length; i++) {
          const fc = Object.assign({ _index: i }, list[i]);
          if (!failConditionMet(fc, st)) continue;
          Quests.fail(def.id, failConditionReason(def, fc));
          break;
        }
      }
    }
    function noteBattleFailure(troopId, troopEnemies) {
      for (const def of proj().quests || []) {
        const st = questState(def.id);
        if (!st || st.status !== "active") continue;
        (def.failConditions || []).forEach((fc, i) => {
          if (fc.kind === "battleLose" && Number(fc.troopId) === Number(troopId)) failSlot(st, i).current = 1;
          if (fc.kind === "enemyDefeatCount" && troopEnemies.includes(Number(fc.enemyId) || 0)) failSlot(st, i).current++;
        });
      }
      evaluateQuestFailures();
    }
    function unlockQuest(id) {
      const def = questDef(id);
      if (!def) return false;
      const st = questState(id);
      if (st && st.status === "locked") {
        setQuestState(id, ensureQuestStateShape(def, Object.assign({}, st, { status: "inactive" })));
        refreshAllPages();
        return true;
      }
      if (st) return st.status === "inactive";
      setQuestState(id, ensureQuestStateShape(def, {
        status: "inactive",
        unlockedAt: now(),
      }));
      refreshAllPages();
      return true;
    }
    function unlockQuestChain(def, st) {
      if (!def || !st || st.chainUnlocked) return;
      st.chainUnlocked = true;
      for (const nextId of def.nextQuestIds || []) {
        const id = Number(nextId) || 0;
        if (!id || !questDef(id)) continue;
        unlockQuest(id);
        if (def.autoStartNext) Quests.start(id);
      }
    }
    const Quests = {
      status(id) {
        const def = questDef(id);
        if (!def) return "missing";
        const st = questState(id);
        return st ? st.status : "inactive";
      },
      get(id) {
        const def = questDef(id);
        if (!def) return null;
        const st = questState(id);
        return { def, state: st, status: st ? st.status : "inactive" };
      },
      start(id) {
        const def = questDef(id);
        if (!def || !questCanStart(def)) return false;
        const st = questState(id);
        if (st && st.status === "locked") return false;
        if (st && (st.status === "failed" || st.status === "abandoned") && !def.allowRestartOnFail) return false;
        if (st && (st.status === "active" || st.status === "completed")) return false;
        setQuestState(id, ensureQuestStateShape(def, Object.assign({}, st || {}, {
          status: "active",
          startedAt: now(),
          completedAt: 0,
          failedAt: 0,
          rewardsApplied: false,
          failEffectsApplied: false,
          failSummary: "",
        })));
        refreshAllPages();
        evaluateQuestFailures();
        return true;
      },
      complete(id, ctx) {
        const def = questDef(id);
        const st = questState(id);
        if (!def || !st || st.status !== "active" || !questObjectivesMet(def, st, ctx)) return false;
        const rewardText = rewardSummary(def.rewards);
        snapshotObjectiveProgress(def, st);
        st.status = "completed";
        st.completedAt = now();
        st.failedAt = 0;
        if (!st.rewardsApplied) {
          consumeFetchObjectives(def, st);
          applyQuestRewards(def.rewards);
          st.rewardsApplied = true;
        }
        unlockQuestChain(def, st);
        refreshAllPages();
        return { ok: true, rewardText };
      },
      fail(id, reason) {
        const def = questDef(id);
        const st = questState(id);
        if (!def || !st || st.status !== "active") return false;
        snapshotObjectiveProgress(def, st);
        st.status = "failed";
        st.failedAt = now();
        st.completedAt = 0;
        st.failSummary = reason || def.failText || effectSummary(def.failEffects);
        if (!st.failEffectsApplied) {
          applyQuestEffects(def.failEffects);
          st.failEffectsApplied = true;
        }
        refreshAllPages();
        return true;
      },
      lock(id) {
        const def = questDef(id);
        if (!def) return false;
        const st = questState(id);
        setQuestState(id, ensureQuestStateShape(def, Object.assign({}, st || {}, { status: "locked" })));
        refreshAllPages();
        return true;
      },
      abandon(id) {
        const def = questDef(id);
        const st = questState(id);
        if (!def || !def.canAbandon || !st || st.status !== "active") return false;
        snapshotObjectiveProgress(def, st);
        st.status = "abandoned";
        st.failedAt = now();
        st.completedAt = 0;
        st.failSummary = "Abandoned.";
        if (!st.failEffectsApplied) {
          applyQuestEffects(def.failEffects);
          st.failEffectsApplied = true;
        }
        refreshAllPages();
        return true;
      },
      advanceObjective(id, index, amount) { return advanceQuestObjective(id, index, amount == null ? 1 : amount); },
      setObjective(id, index, value) { return setQuestObjective(id, index, value); },
      objectiveDisplay(id) {
        const def = questDef(id), st = questState(id);
        if (!def || !st) return [];
        return questObjectives(def).map((_, i) => objectiveDisplay(def, st, i)).filter(Boolean);
      },
      failSummary(id) {
        const def = questDef(id), st = questState(id);
        if (!def) return "";
        return (st && st.failSummary) || def.failText || effectSummary(def.failEffects);
      },
    };

    return {
      Quests,
      questState,
      objectiveDone,
      evaluateQuestFailures,
      noteBattleFailure,
      onEnemyKilled,
    };
  }

  window.RPGAtlasQuests = {
    create: createQuestRuntime,
  };
})();
