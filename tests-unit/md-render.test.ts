/* RPGAtlas — tests-unit/md-render.test.ts
   Phase 7 Stage F: the docs-site Markdown renderer — exactly the dialect the
   wiki uses, pinned. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import { renderMarkdown, renderInline, resolveHref, slugify } from "../scripts/md-render.mjs";

describe("resolveHref", () => {
  it("maps wiki pages to .html and Home to index.html", () => {
    expect(resolveHref("Events")).toBe("Events.html");
    expect(resolveHref("Home")).toBe("index.html");
    expect(resolveHref("Maps-and-Tiles#random-encounters")).toBe("Maps-and-Tiles.html#random-encounters");
  });
  it("passes external and pure-anchor links through", () => {
    expect(resolveHref("https://example.com/x")).toBe("https://example.com/x");
    expect(resolveHref("#top")).toBe("#top");
  });
});

describe("renderInline", () => {
  it("renders code / bold / italic / links, escaping only code content", () => {
    expect(renderInline("a `<b>` c")).toBe("a <code>&lt;b&gt;</code> c");
    expect(renderInline("**bold** and *it*")).toBe("<strong>bold</strong> and <em>it</em>");
    expect(renderInline("[Events](Events)")).toBe('<a href="Events.html">Events</a>');
  });
  it("never styles inside code spans", () => {
    expect(renderInline("`a ** b`")).toBe("<code>a ** b</code>");
  });
});

describe("renderMarkdown", () => {
  it("headings get GitHub-style ids", () => {
    expect(renderMarkdown("## The `atlas` bridge (API surface)"))
      .toContain('<h2 id="the-atlas-bridge-api-surface">');
    expect(slugify("Random Encounters")).toBe("random-encounters");
  });
  it("tables honor \\| escapes in cells", () => {
    const html = renderMarkdown("| A | B |\n|---|---|\n| `x \\| y` | ok |");
    expect(html).toContain("<table>");
    expect(html).toContain("<code>x | y</code>");
    expect(html).toContain("<td>ok</td>");
  });
  it("fenced code blocks escape and keep their language class", () => {
    const html = renderMarkdown("```js\nif (a < b) {}\n```");
    expect(html).toContain('<pre><code class="lang-js">if (a &lt; b) {}</code></pre>');
  });
  it("task-list checkboxes render disabled", () => {
    const html = renderMarkdown("- [ ] open\n- [x] done");
    expect(html).toContain('<input type="checkbox" disabled> open');
    expect(html).toContain('<input type="checkbox" disabled checked> done');
  });
  it("nested bullets and ordered lists", () => {
    const html = renderMarkdown("1. one\n2. two\n\n- top\n  - sub");
    expect(html).toContain("<ol><li>one</li><li>two</li></ol>");
    expect(html).toContain("<ul><li>top<ul><li>sub</li></ul></li></ul>");
  });
  it("blockquotes, rules, and raw HTML passthrough", () => {
    expect(renderMarkdown("> quoted **bit**")).toContain("<blockquote><p>quoted <strong>bit</strong></p></blockquote>");
    expect(renderMarkdown("---")).toBe("<hr>");
    expect(renderMarkdown('<p align="center"><i>x</i></p>')).toBe('<p align="center"><i>x</i></p>');
  });
});
