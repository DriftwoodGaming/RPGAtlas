/* RPGAtlas — scripts/build-docs-site.mjs
   Phase 7 Stage F: renders wiki/*.md into the static docs site under
   docs-site/ (committed, GitHub Pages-ready — point Pages at /docs-site on
   main or copy the folder anywhere). Dependency-free: the Markdown renderer
   lives in scripts/md-render.mjs, nav comes from wiki/_Sidebar.md, the
   footer from wiki/_Footer.md, theme matches the editor's dark chrome.
   Rerun after editing wiki pages: node scripts/build-docs-site.mjs
   GPL-3.0-or-later. */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown, resolveHref } from "./md-render.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wikiDir = join(root, "wiki");
const outDir = join(root, "docs-site");

const pages = readdirSync(wikiDir)
  .filter((f) => f.endsWith(".md") && !f.startsWith("_") && f !== "README.md")
  .map((f) => f.replace(/\.md$/, ""));

const sidebarHtml = renderMarkdown(readFileSync(join(wikiDir, "_Sidebar.md"), "utf8"));
const footerHtml = renderMarkdown(readFileSync(join(wikiDir, "_Footer.md"), "utf8"));

const CSS = `
:root {
  --bg: #14161f; --bg2: #1b1e2b; --panel: #20243371; --text: #e8ebf5; --dim: #9aa3bd;
  --accent: #ffd86a; --link: #8ec2ff; --border: #333a52; --code-bg: #262b3d;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.65 "Segoe UI", system-ui, sans-serif;
}
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
.layout { display: flex; min-height: 100vh; max-width: 1200px; margin: 0 auto; }
nav {
  flex: 0 0 250px; padding: 26px 20px; border-right: 1px solid var(--border);
  background: var(--bg2); font-size: 14.5px;
}
nav .brand { display: block; font-size: 21px; font-weight: 800; color: var(--text); margin-bottom: 2px; }
nav .brand span { font-weight: 300; }
nav .tag { color: var(--dim); font-size: 12.5px; font-style: italic; margin-bottom: 18px; }
nav h3 { font-size: 11.5px; text-transform: uppercase; letter-spacing: 1px; color: var(--dim); margin: 18px 0 6px; }
nav p strong { font-size: 11.5px; text-transform: uppercase; letter-spacing: 1px; color: var(--dim); }
nav ul { list-style: none; margin: 4px 0 0; padding: 0; }
nav li { margin: 3px 0; }
nav a { color: var(--text); opacity: .88; }
nav a.active { color: var(--accent); font-weight: 600; }
main { flex: 1; padding: 34px 44px 60px; min-width: 0; }
main h1 { font-size: 30px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
main h2 { font-size: 22px; margin-top: 36px; color: var(--accent); }
main h3 { font-size: 17.5px; margin-top: 26px; }
main hr { border: none; border-top: 1px solid var(--border); margin: 30px 0; }
code {
  background: var(--code-bg); border-radius: 4px; padding: 1.5px 6px;
  font: 13.5px/1.5 Consolas, "Cascadia Mono", monospace; color: #ffe9a8;
}
pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; overflow-x: auto; }
pre code { background: none; padding: 0; color: #dbe4ff; }
table { border-collapse: collapse; margin: 14px 0; width: 100%; }
th, td { border: 1px solid var(--border); padding: 7px 12px; text-align: left; vertical-align: top; }
th { background: var(--bg2); color: var(--accent); font-size: 14px; }
tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
blockquote { border-left: 3px solid var(--accent); margin: 14px 0; padding: 4px 16px; color: var(--dim); background: rgba(255,216,106,0.05); }
li.task { list-style: none; margin-left: -20px; }
footer { border-top: 1px solid var(--border); margin-top: 46px; padding-top: 14px; color: var(--dim); font-size: 13.5px; }
@media (max-width: 800px) {
  .layout { flex-direction: column; }
  nav { flex: none; border-right: none; border-bottom: 1px solid var(--border); }
  main { padding: 24px 20px 40px; }
}
`;

function pageTitle(name, source) {
  const m = source.match(/^#\s+(.*)$/m);
  return m ? m[1].replace(/[*_`]/g, "") : name.replace(/-/g, " ");
}

function layout(name, title, contentHtml) {
  const outName = resolveHref(name); // one mapping for filenames AND links (Home → index.html)
  // Mark the active page in the nav: the sidebar is rendered by the same
  // resolveHref, so the href is exact — plain string replacement, no regex.
  const nav = sidebarHtml.replaceAll(`<a href="${outName}"`, `<a class="active" href="${outName}"`);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — RPGAtlas Docs</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="layout">
<nav>
<a class="brand" href="index.html">RPG<span>Atlas</span></a>
<div class="tag">Chart your world. Tell your story.</div>
${nav}
</nav>
<main>
${contentHtml}
<footer>${footerHtml}
<p>Generated from the <a href="https://github.com/DriftwoodGaming/RPGAtlas/tree/main/wiki">project wiki</a> by <code>scripts/build-docs-site.mjs</code>.</p></footer>
</main>
</div>
</body>
</html>
`;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "style.css"), CSS);
for (const name of pages) {
  const source = readFileSync(join(wikiDir, name + ".md"), "utf8");
  const out = layout(name, pageTitle(name, source), renderMarkdown(source));
  writeFileSync(join(outDir, resolveHref(name)), out);
}
console.log(`[docs-site] wrote ${pages.length} pages + style.css to docs-site/`);
