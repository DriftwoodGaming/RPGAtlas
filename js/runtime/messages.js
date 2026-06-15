/* RPGAtlas - runtime/messages.js
   Message text conversion, rich text, typewriter behavior, and message windows.
   GPL-3.0-or-later (see LICENSE). */

function createMessageSystem(deps) {
  const {
    Assets,
    el,
    esc,
    getPlugins,
    getProject,
    getState,
    getUiLayer,
    pushUI,
    removeUI,
  } = deps;

  function convertText(s) {
    const project = getProject();
    const state = getState();
    return String(s)
      .replace(/\\v\[(\d+)\]/gi, (_, n) => String(state.vars[+n] || 0))
      .replace(/\\n\[(\d+)\]/gi, (_, n) => {
        const actor = project.actors.find((entry) => entry.id === +n);
        return actor ? actor.name : "";
      })
      .replace(/\\g/gi, () => state.gold + " " + project.system.currency);
  }

  function richText(s) {
    let html = esc(convertText(s));
    for (const fn of getPlugins().textProcessors) {
      try {
        html = fn(html);
      } catch (error) {
        console.error("Text processor failed:", error);
      }
    }
    return html;
  }

  function makeTypewriter(container, html) {
    container.innerHTML = html;
    const nodes = [];
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          nodes.push({ node: child, full: child.nodeValue });
          child.nodeValue = "";
        } else if (child.nodeType === 1 && child.classList.contains("msg-icon")) {
          nodes.push({ node: child, icon: true });
          child.style.visibility = "hidden";
        } else {
          walk(child);
        }
      }
    })(container);

    const total = nodes.reduce((sum, entry) => sum + (entry.icon ? 1 : entry.full.length), 0);
    return {
      total,
      reveal(pos) {
        let remaining = pos;
        for (const entry of nodes) {
          if (entry.icon) {
            entry.node.style.visibility = remaining > 0 ? "" : "hidden";
            if (remaining > 0) remaining--;
          } else if (remaining <= 0) {
            entry.node.nodeValue = "";
          } else if (remaining >= entry.full.length) {
            entry.node.nodeValue = entry.full;
            remaining -= entry.full.length;
          } else {
            entry.node.nodeValue = entry.full.slice(0, remaining);
            remaining = 0;
          }
        }
      },
    };
  }

  function showMessage(name, text, face) {
    return new Promise((resolve) => {
      const win = el("div", "win msgwin");
      if (name) {
        const nameBox = el("div", "msg-name");
        nameBox.innerHTML = richText(name);
        win.appendChild(nameBox);
      }

      const faceIndex = face ? Assets.charsetIndex(face) : -1;
      if (faceIndex >= 0) {
        const portrait = el("div", "msg-face");
        portrait.appendChild(Assets.faceCanvas(faceIndex));
        win.appendChild(portrait);
        win.classList.add("has-face");
      }

      const body = el("div", "msg-text");
      win.appendChild(body);
      const typewriter = makeTypewriter(body, richText(text));
      let pos = 0;
      let typing = true;
      const timer = setInterval(() => {
        pos = Math.min(typewriter.total, pos + 2);
        typewriter.reveal(pos);
        if (pos >= typewriter.total) {
          typing = false;
          clearInterval(timer);
          win.classList.add("msg-done");
        }
      }, 16);

      function advance() {
        if (typing) {
          typing = false;
          clearInterval(timer);
          typewriter.reveal(typewriter.total);
          win.classList.add("msg-done");
        } else {
          removeUI(ui);
          resolve();
        }
      }

      win.addEventListener("click", advance);
      const ui = {
        el: win,
        onKey(key) {
          if (key === "ok" || key === "cancel") advance();
        },
      };
      getUiLayer().appendChild(win);
      pushUI(ui);
    });
  }

  return { convertText, richText, makeTypewriter, showMessage };
}

window.createMessageSystem = createMessageSystem;
