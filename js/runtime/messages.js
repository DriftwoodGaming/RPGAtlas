/* RPGAtlas - runtime/messages.js
   Message text conversion, rich text, typewriter behavior, and message windows.

   Project Compass M2·B brought the message system to RPG Maker MZ/MV escape-code
   parity: substitution codes (\v \n \p \g), a relative-size stack (\{ \}), the
   inline gold badge (\$), the MZ position/size extras (\px \py \fs), and the
   pacing/flow codes (\. \| \! \> \< \^) which the typewriter honours as it types.
   Colour (\c), icons (\i) and the [b]/[i]/[color]/[size] tags still come from the
   Atlas_TextCodes plugin, and \input[..] from the engine input module — this file
   owns everything else plus the window position/background options.
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

  // Typewriter reveal speed (visible chars per 16ms tick), set from the Options menu's
  // Text Speed row. A large value (e.g. 9999) reveals the whole line on the first tick.
  let revealStep = 2;
  function setTextSpeed(step) {
    revealStep = step > 0 ? step : 2;
  }

  // Base message font size the \{ / \} relative-size stack and \fs step from.
  const MSG_BASE_SIZE = 18;
  const SIZE_STEP = 6;

  // --- Text substitution codes (\v \n \p \g) → plain text ------------------
  function partyMemberName(n) {
    const state = getState();
    const member = (state.party || [])[n - 1];
    if (!member) return "";
    if (member.name) return member.name;
    const actor = getProject().actors.find((a) => a.id === member.actorId);
    return actor ? actor.name : "";
  }
  function convertText(s) {
    const project = getProject();
    const state = getState();
    return String(s)
      .replace(/\\v\[(\d+)\]/gi, (_, n) => String(state.vars[+n] || 0))
      .replace(/\\n\[(\d+)\]/gi, (_, n) => {
        const actor = project.actors.find((entry) => entry.id === +n);
        return actor ? actor.name : "";
      })
      .replace(/\\p\[(\d+)\]/gi, (_, n) => partyMemberName(+n))
      .replace(/\\g/gi, () => state.gold + " " + project.system.currency);
  }

  // --- Relative-size stack (\{ bigger / \} smaller) → [size] tags -----------
  // A running level (each \{ +1, \} -1) rendered as [size=n] spans the
  // Atlas_TextCodes bbcode pass turns into real <span>s. Runs on already-esc'd
  // text, where { and } survive untouched.
  function sizeCodes(s) {
    let level = 0, open = false, out = "", last = 0, m;
    const re = /\\([{}])/g;
    while ((m = re.exec(s))) {
      out += s.slice(last, m.index);
      last = re.lastIndex;
      if (open) { out += "[/size]"; open = false; }
      level += m[1] === "{" ? 1 : -1;
      level = Math.max(-2, Math.min(4, level));
      if (level !== 0) {
        const size = Math.max(8, Math.min(40, MSG_BASE_SIZE + level * SIZE_STEP));
        out += "[size=" + size + "]"; open = true;
      }
    }
    out += s.slice(last);
    if (open) out += "[/size]";
    return out;
  }

  // --- The rest of the escape codes (post-esc, pre-plugin) ------------------
  // \fs[n] font size · \px/\py position (not modeled → stripped) · \{ \} size ·
  // \$ inline gold · pacing markers (\. \| \! \> \< \^) the typewriter reads.
  // Note esc() turned \> \< into \&gt; \&lt;, so match those forms.
  function applyMsgControls(html) {
    html = html
      .replace(/\\fs\[(\d+)\]/gi, (_, n) => "[size=" + Math.max(8, Math.min(40, +n)) + "]")
      .replace(/\\p[xy]\[-?\d+\]/gi, "");
    html = sizeCodes(html);
    html = html.replace(/\\\$/g, () => {
      const state = getState(), project = getProject();
      return '<span class="msg-gold">' + esc(state.gold + " " + project.system.currency) + "</span>";
    });
    return html
      .replace(/\\\./g, '<span class="msg-ctl" data-wait="15"></span>')
      .replace(/\\\|/g, '<span class="msg-ctl" data-wait="60"></span>')
      .replace(/\\!/g, '<span class="msg-ctl" data-btn="1"></span>')
      .replace(/\\&gt;/g, '<span class="msg-ctl" data-instant="1"></span>')
      .replace(/\\&lt;/g, '<span class="msg-ctl" data-instant="0"></span>')
      .replace(/\\\^/g, '<span class="msg-ctl" data-nowait="1"></span>');
  }

  // Sentinel standing in for an escaped backslash (a literal "\\" in the source
  // text) while the codes below run, so none of them consume it; restored last.
  // A control char that never appears in real message text.
  const BSLASH = String.fromCharCode(1);
  function richText(s) {
    const protectedStr = String(s).split("\\\\").join(BSLASH);
    let html = esc(convertText(protectedStr));
    html = applyMsgControls(html);
    for (const fn of getPlugins().textProcessors) {
      try {
        html = fn(html);
      } catch (error) {
        console.error("Text processor failed:", error);
      }
    }
    return html.split(BSLASH).join("\\");
  }

  // Build the typewriter over `html`. Text characters and \i / \input icons are
  // revealable units; .msg-ctl spans are zero-width control markers recorded with
  // the unit index they sit at, so showMessage can pause/skip/instant as it types.
  function makeTypewriter(container, html) {
    container.innerHTML = html;
    const nodes = [];
    const controls = [];
    let count = 0;
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          nodes.push({ node: child, full: child.nodeValue });
          count += child.nodeValue.length;
          child.nodeValue = "";
        } else if (child.nodeType === 1 && child.classList.contains("msg-icon")) {
          nodes.push({ node: child, icon: true });
          count += 1;
          child.style.visibility = "hidden";
        } else if (child.nodeType === 1 && child.classList.contains("msg-ctl")) {
          const c = { index: count };
          if (child.dataset.wait) c.wait = +child.dataset.wait;
          if (child.dataset.btn) c.btn = true;
          if (child.dataset.instant != null) c.instant = child.dataset.instant === "1";
          if (child.dataset.nowait) c.nowait = true;
          controls.push(c);
        } else {
          walk(child);
        }
      }
    })(container);

    return {
      total: count,
      controls,
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

  function showMessage(name, text, face, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const win = el("div", "win msgwin");
      // Window backdrop (RM 101 background): 0 window, 1 dim, 2 transparent.
      const bg = Number(opts.background) || 0;
      if (bg === 1) win.classList.add("msg-dim");
      else if (bg === 2) win.classList.add("msg-transparent");
      // Window position (RM 101): 0 top, 1 middle, 2 bottom (default).
      const posv = opts.position == null ? 2 : Number(opts.position);
      if (posv === 0) win.classList.add("msg-top");
      else if (posv === 1) win.classList.add("msg-mid");

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
      const controls = typewriter.controls || [];
      const noWait = controls.some((c) => c.nowait);
      let pos = 0;
      let typing = true;
      let instant = false;
      let tick = 0;
      let waitTick = 0;
      let btnWait = false;
      let fired = 0;

      // Fire every control at or before the current position. A wait or
      // button-wait control pauses the reveal (returns true); instant toggles
      // and the end-of-page no-wait flag just update state and continue.
      function fireControls() {
        while (fired < controls.length && controls[fired].index <= pos) {
          const c = controls[fired++];
          if (c.instant != null) instant = c.instant;
          if (c.wait) { waitTick = tick + c.wait; win.classList.add("msg-hold"); return true; }
          if (c.btn) { btnWait = true; win.classList.add("msg-hold"); return true; }
        }
        return false;
      }

      const timer = setInterval(step, 16);
      function step() {
        tick++;
        if (btnWait) return;
        if (tick < waitTick) return;
        win.classList.remove("msg-hold");
        if (fireControls()) return; // paused on a wait / button control
        const nextIdx = fired < controls.length ? controls[fired].index : typewriter.total;
        const room = nextIdx - pos;
        const stepSize = instant ? room : Math.min(revealStep, room);
        pos = Math.min(typewriter.total, pos + Math.max(0, stepSize));
        typewriter.reveal(pos);
        if (pos >= typewriter.total && fired >= controls.length) {
          typing = false;
          clearInterval(timer);
          win.classList.add("msg-done");
          if (noWait) finish();
        }
      }

      function finish() {
        removeUI(ui);
        resolve();
      }
      function advance() {
        if (btnWait) { btnWait = false; win.classList.remove("msg-hold"); return; } // \! resume
        if (typing) {
          typing = false;
          clearInterval(timer);
          for (; fired < controls.length; fired++) {
            const c = controls[fired];
            if (c.instant != null) instant = c.instant;
          }
          pos = typewriter.total;
          typewriter.reveal(pos);
          win.classList.remove("msg-hold");
          win.classList.add("msg-done");
          if (noWait) finish();
        } else {
          finish();
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

  return { convertText, richText, makeTypewriter, showMessage, setTextSpeed };
}

window.createMessageSystem = createMessageSystem;
