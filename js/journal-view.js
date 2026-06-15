/* RPGAtlas - journal-view.js
   Journal runtime UI extracted from engine.js. */
"use strict";

(function () {
  function createJournalView(deps) {
    const el = deps.el;
    const esc = deps.esc;
    const pushUI = deps.pushUI;
    const removeUI = deps.removeUI;
    const sysSe = deps.sysSe;
    const appendUI = deps.appendUI;
    const showMessage = deps.showMessage;
    const getProj = deps.getProj;
    const questState = deps.questState;
    const Quests = deps.Quests;

    function proj() {
      return getProj() || {};
    }

    function groups() {
      return [
        { key: "active", title: "Active Quests" },
        { key: "completed", title: "Completed Quests" },
        { key: "failed", title: "Failed Quests" },
        { key: "abandoned", title: "Abandoned Quests" },
      ];
    }

    function questsForGroup(groupKey) {
      return (proj().quests || []).filter((q) => {
        const st = questState(q.id);
        return st && st.status === groupKey;
      });
    }

    function objectiveHtml(obj) {
      return (
        '<div class="journal-objective' + (obj.done ? ' done' : '') + '">' +
        '<span class="journal-bullet">' + (obj.done ? "&#10003;" : "&#8226;") + "</span>" +
        '<span class="journal-obj-text">' + esc(obj.text) + "</span>" +
        '<span class="journal-obj-count">' + obj.current + " / " + obj.total + "</span>" +
        "</div>"
      );
    }

    function detailHtml(q, groupKey) {
      const failSummary = groupKey === "failed" || groupKey === "abandoned" ? Quests.failSummary(q.id) : "";
      return (
        '<div class="journal-detail-title">' + esc(q.name || "Quest") + "</div>" +
        (q.shortDesc ? '<div class="journal-detail-short">' + esc(q.shortDesc) + "</div>" : "") +
        (q.desc ? '<div class="journal-detail-body">' + esc(q.desc).replace(/\n/g, "<br>") + "</div>" : "") +
        '<div class="journal-detail-objectives">' +
        Quests.objectiveDisplay(q.id).map(objectiveHtml).join("") +
        "</div>" +
        (failSummary
          ? '<div class="journal-detail-fail"><span class="dim">Outcome: ' + esc(failSummary) + "</span></div>"
          : "")
      );
    }

    return {
      async open() {
        return new Promise((resolve) => {
          const groupList = groups();
          let groupIdx = 0;
          let questIdx = 0;
          let focus = "groups";

          const win = el("div", "win journalwin");
          win.style.left = "50%";
          win.style.top = "50%";
          win.style.transform = "translate(-50%, -50%)";
          win.style.width = "760px";
          win.style.height = "560px";
          win.style.minWidth = "760px";
          win.style.minHeight = "560px";
          win.style.maxWidth = "760px";
          win.style.maxHeight = "560px";
          win.appendChild(el("div", "win-title", "Journal"));

          const filterRow = el("div", "journal-filters");
          const body = el("div", "journal-body");
          const left = el("div", "journal-left");
          left.style.flex = "0 0 240px";
          const right = el("div", "journal-right");
          right.style.flex = "1 1 auto";
          const questListWrap = el("div", "journal-list-wrap");
          const questList = el("div", "journal-list");
          const emptyState = el("div", "journal-empty");
          const detail = el("div", "journal-detail-pane");
          const btnRow = el("div", "modal-btns");
          const backBtn = el("button", "primary", "Back");
          const abandonBtn = el("button", "", "Abandon");

          questListWrap.appendChild(questList);
          questListWrap.appendChild(emptyState);
          left.appendChild(questListWrap);

          btnRow.appendChild(backBtn);
          btnRow.appendChild(abandonBtn);

          right.appendChild(detail);
          right.appendChild(btnRow);

          win.appendChild(filterRow);
          body.appendChild(left);
          body.appendChild(right);
          win.appendChild(body);

          const buttons = [backBtn, abandonBtn];
          let buttonIdx = 0;

          function currentGroup() {
            return groupList[groupIdx];
          }

          function currentQuests() {
            return questsForGroup(currentGroup().key);
          }

          function currentQuest() {
            const quests = currentQuests();
            if (!quests.length) return null;
            questIdx = Math.max(0, Math.min(questIdx, quests.length - 1));
            return quests[questIdx];
          }

          function finish(result) {
            removeUI(ui);
            resolve(result);
          }

          function moveGroup(d) {
            groupIdx = (groupIdx + d + groupList.length) % groupList.length;
            questIdx = 0;
            sysSe("cursor");
            refresh();
          }

          function moveQuest(d) {
            const quests = currentQuests();
            if (!quests.length) return;
            questIdx = (questIdx + d + quests.length) % quests.length;
            sysSe("cursor");
            refresh();
          }

          function moveButton(d) {
            const visible = buttons.filter((btn) => btn.style.display !== "none");
            if (!visible.length) return;
            buttonIdx = (buttonIdx + d + visible.length) % visible.length;
            sysSe("cursor");
            refresh();
          }

          function activate() {
            if (focus === "groups") {
              focus = "quests";
              refresh();
              return;
            }
            if (focus === "buttons") {
              const visible = buttons.filter((btn) => btn.style.display !== "none");
              if (visible[buttonIdx]) visible[buttonIdx].click();
              return;
            }
            const q = currentQuest();
            if (!q) return;
            if (currentGroup().key === "active" && q.canAbandon) {
              focus = "buttons";
              buttonIdx = 0;
              sysSe("ok");
              refresh();
            } else {
              sysSe("ok");
            }
          }

          function refreshFilters() {
            filterRow.innerHTML = "";
            groupList.forEach((g, i) => {
              const btn = el(
                "button",
                "journal-filter" +
                  (i === groupIdx ? " sel" : "") +
                  (focus === "groups" && i === groupIdx ? " focus" : ""),
                g.title,
              );
              btn.addEventListener("click", () => {
                groupIdx = i;
                questIdx = 0;
                focus = "quests";
                sysSe("ok");
                refresh();
              });
              filterRow.appendChild(btn);
            });
          }

          function refreshQuestList() {
            const quests = currentQuests();
            questList.innerHTML = "";

            if (!quests.length) {
              emptyState.textContent = "No " + currentGroup().title.toLowerCase() + ".";
              emptyState.style.display = "";
              return;
            }

            emptyState.style.display = "none";

            quests.forEach((q, i) => {
              const row = el(
                "div",
                "journal-entry" +
                  (i === questIdx ? " sel" : "") +
                  (focus === "quests" && i === questIdx ? " focus" : ""),
              );
              row.innerHTML =
                '<div class="journal-entry-title">' + esc(q.name || "Quest") + "</div>" +
                (q.shortDesc
                  ? '<div class="journal-entry-short">' + esc(q.shortDesc) + "</div>"
                  : "");
              row.addEventListener("mouseenter", () => {
                questIdx = i;
                refresh();
              });
              row.addEventListener("click", () => {
                questIdx = i;
                focus = "quests";
                sysSe("ok");
                refresh();
              });
              questList.appendChild(row);
            });

            const selected = questList.children[questIdx];
            if (selected && selected.scrollIntoView) {
              selected.scrollIntoView({ block: "nearest" });
            }
          }

          function refreshDetail() {
            const q = currentQuest();
            if (!q) {
              detail.innerHTML = '<div class="journal-empty-detail dim">No quest selected.</div>';
              abandonBtn.style.display = "none";
              return;
            }

            detail.innerHTML = detailHtml(q, currentGroup().key);
            abandonBtn.style.display =
              currentGroup().key === "active" && q.canAbandon ? "" : "none";
          }

          function refreshButtons() {
            const visible = buttons.filter((btn) => btn.style.display !== "none");
            if (buttonIdx >= visible.length) buttonIdx = 0;
            buttons.forEach((btn) => {
              btn.style.outline = "none";
              btn.style.background = "";
            });
            if (focus === "buttons" && visible[buttonIdx]) {
              visible[buttonIdx].style.outline = "2px solid #9ab8f0";
              visible[buttonIdx].style.background = "rgba(90,130,220,0.45)";
            }
          }

          function refresh() {
            const quests = currentQuests();
            if (!quests.length) questIdx = 0;
            else questIdx = Math.max(0, Math.min(questIdx, quests.length - 1));

            refreshFilters();
            refreshQuestList();
            refreshDetail();
            refreshButtons();
          }

          backBtn.addEventListener("click", () => finish("back"));
          abandonBtn.addEventListener("click", async () => {
            const q = currentQuest();
            if (!q) return;
            if (Quests.abandon(q.id)) {
              await showMessage("", "Quest abandoned.");
              finish("close");
            }
          });

          const ui = {
            el: win,
            onKey(k) {
              if (k === "cancel") {
                if (focus === "buttons") {
                  focus = "quests";
                  sysSe("cancel");
                  refresh();
                  return;
                }
                finish("back");
                return;
              }

              if (k === "left") {
                if (focus === "groups") moveGroup(-1);
                else if (focus === "quests") {
                  focus = "groups";
                  sysSe("cursor");
                  refresh();
                } else if (focus === "buttons") moveButton(-1);
                return;
              }

              if (k === "right") {
                if (focus === "groups") moveGroup(1);
                else if (focus === "quests") {
                  const q = currentQuest();
                  if (currentGroup().key === "active" && q && q.canAbandon) {
                    focus = "buttons";
                    buttonIdx = 0;
                    sysSe("cursor");
                    refresh();
                  }
                } else if (focus === "buttons") moveButton(1);
                return;
              }

              if (k === "up") {
                if (focus === "groups") moveGroup(-1);
                else if (focus === "quests") moveQuest(-1);
                else if (focus === "buttons") {
                  focus = "quests";
                  sysSe("cursor");
                  refresh();
                }
                return;
              }

              if (k === "down") {
                if (focus === "groups") {
                  focus = "quests";
                  sysSe("cursor");
                  refresh();
                } else if (focus === "quests") {
                  moveQuest(1);
                } else if (focus === "buttons") {
                  moveButton(1);
                }
                return;
              }

              if (k === "ok") activate();
            },
          };

          appendUI(win);
          pushUI(ui);
          refresh();
        });
      },
    };
  }

  window.RPGAtlasJournalView = {
    create: createJournalView,
  };
})();
