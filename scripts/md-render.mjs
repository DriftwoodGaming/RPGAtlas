/* RPGAtlas — scripts/md-render.mjs
   Dependency-free Markdown renderer for the docs site (Phase 7 Stage F).
   Covers exactly the dialect the wiki/ pages use: ATX headings, paragraphs,
   bold/italic/inline code, fenced code blocks, tables (with \| escapes),
   ordered/unordered lists (one nesting level + task checkboxes),
   blockquotes, horizontal rules, wiki-style page links ([Text](Page) →
   Page.html, anchors preserved), and passthrough for the wiki's occasional
   intentional inline HTML. Vitest-covered (tests-unit/md-render.test.ts).
   GPL-3.0-or-later. */

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Wiki link → site href: external and #anchor pass through; page names get
 *  .html (Home → index.html), keeping any #fragment. */
export function resolveHref(href) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [page, anchor] = href.split("#");
  const base = page === "Home" || page === "" ? "index.html" : page + ".html";
  return anchor ? base + "#" + anchor : base;
}

export function renderInline(text) {
  // 1. Shelter code spans (their content is escaped, never styled) behind
  //    private-use-area sentinels no wiki text can contain.
  const shelters = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    shelters.push("<code>" + escapeHtml(code) + "</code>");
    return "" + (shelters.length - 1) + "";
  });
  // 2. Links.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
    `<a href="${resolveHref(href)}">${label}</a>`);
  // 3. Bold, then italic (won't cross the placeholders).
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  // 4. Restore code spans.
  return out.replace(/(\d+)/g, (_, i) => shelters[Number(i)]);
}

function splitTableRow(line) {
  // Split on unescaped pipes; \| stays a literal pipe inside a cell.
  const cells = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") { cur += "|"; i++; }
    else if (ch === "|") { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  // Leading/trailing pipes produce empty edge cells — drop them.
  if (cells.length && cells[0].trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

export function renderMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let i = 0;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push("<p>" + renderInline(paragraph.join(" ")) + "</p>");
      paragraph = [];
    }
  };

  const listItemHtml = (text) => {
    const task = text.match(/^\[( |x)\]\s+(.*)$/);
    if (task) {
      const checked = task[1] === "x" ? " checked" : "";
      return `<li class="task"><input type="checkbox" disabled${checked}> ${renderInline(task[2])}</li>`;
    }
    return "<li>" + renderInline(text) + "</li>";
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushParagraph();
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      const cls = fence[1] ? ` class="lang-${fence[1]}"` : "";
      html.push(`<pre><code${cls}>` + escapeHtml(body.join("\n")) + "</code></pre>");
      continue;
    }
    // heading
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const id = slugify(heading[2]);
      html.push(`<h${level} id="${id}">` + renderInline(heading[2]) + `</h${level}>`);
      i++;
      continue;
    }
    // horizontal rule
    if (/^-{3,}\s*$/.test(line)) {
      flushParagraph();
      html.push("<hr>");
      i++;
      continue;
    }
    // blockquote
    if (/^>\s?/.test(line)) {
      flushParagraph();
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      html.push("<blockquote>" + renderMarkdown(body.join("\n")) + "</blockquote>");
      continue;
    }
    // table
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flushParagraph();
      const head = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i++]));
      }
      html.push("<table><thead><tr>" +
        head.map((c) => "<th>" + renderInline(c) + "</th>").join("") +
        "</tr></thead><tbody>" +
        rows.map((r) => "<tr>" + r.map((c) => "<td>" + renderInline(c) + "</td>").join("") + "</tr>").join("") +
        "</tbody></table>");
      continue;
    }
    // lists (unordered/ordered, one nesting level for "  - sub")
    const ul = line.match(/^- (.*)$/);
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushParagraph();
      const tag = ul ? "ul" : "ol";
      const itemRe = ul ? /^- (.*)$/ : /^\d+\.\s+(.*)$/;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(itemRe);
        if (m) {
          items.push({ text: m[1], subs: [] });
          i++;
        } else if (/^ {2,}- /.test(lines[i]) && items.length) {
          items[items.length - 1].subs.push(lines[i].replace(/^ {2,}- /, ""));
          i++;
        } else if (/^ {2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1].text += " " + lines[i].trim(); // hanging continuation
          i++;
        } else break;
      }
      html.push(`<${tag}>` + items.map((item) => {
        const sub = item.subs.length
          ? "<ul>" + item.subs.map(listItemHtml).join("") + "</ul>"
          : "";
        return listItemHtml(item.text).replace(/<\/li>$/, sub + "</li>");
      }).join("") + `</${tag}>`);
      continue;
    }
    // blank line
    if (line.trim() === "") {
      flushParagraph();
      i++;
      continue;
    }
    // raw block-level HTML passes through untouched
    if (/^\s*<\/?[a-zA-Z]/.test(line)) {
      flushParagraph();
      html.push(line);
      i++;
      continue;
    }
    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  return html.join("\n");
}
