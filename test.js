/* mantis tests - node test.js (requires dev dep: jsdom) */
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const Mantis = require("./mantis.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("  ok " + name);
}

/* ---------- extract(): chrome-heavy page ---------- */
const PAGE = `<!doctype html><html><head>
<title>Essay - SiteName | Section</title>
<meta property="og:title" content="The Essay Itself">
<meta name="author" content="A. Writer">
<meta property="og:image" content="https://site.com/hero.jpg">
</head><body>
<header><p>SiteName navigation with quite a lot of words in it for testing purposes here</p></header>
<nav><ul><li><a href="#">Home</a></li><li><a href="#">Politics</a></li></ul></nav>
<div class="sidebar related">
  <p>You might also like <a href="#">this other very interesting story about things</a> and <a href="#">another one right here too</a></p>
  <p><a href="#">Subscribe now to get our newsletter delivered every single morning</a></p>
</div>
<div id="main"><div class="article-body">
  <p>First paragraph of the actual essay, with enough running prose to score as article content under the extractor's density checks.</p>
  <p>Second paragraph continues the argument at length, sentence after sentence, the way published essays actually read in the wild.</p>
  <h2>A section heading</h2>
  <p>Third paragraph under the heading, still comfortably long enough to pass the twenty-five character floor used by the extractor.</p>
  <blockquote>A pulled quote with sufficient length to be retained in the captured body of the article.</blockquote>
</div></div>
<div class="comments"><p>First comment should not be retained because it is outside the article content.</p></div>
<footer><p>Copyright SiteName. All rights reserved. Terms. Privacy. Do not sell my information please.</p></footer>
</body></html>`;

const doc = new JSDOM(PAGE).window.document;
const a = Mantis.extract(doc);

test("title prefers og:title", () => assert.strictEqual(a.title, "The Essay Itself"));
test("byline from author meta", () => assert.strictEqual(a.byline, "A. Writer"));
test("hero from og:image", () => assert.strictEqual(a.hero, "https://site.com/hero.jpg"));
test("keeps article paragraphs, heading, blockquote", () => {
  const joined = a.paragraphs.join(" ");
  assert.ok(a.paragraphs.length >= 4 && a.paragraphs.length <= 6, "got " + a.paragraphs.length);
  assert.ok(joined.includes("A section heading"));
  assert.ok(joined.includes("A pulled quote"));
});
test("drops nav, sidebar, comments, footer", () => {
  const joined = a.paragraphs.join(" ");
  assert.ok(!/navigation|Subscribe|also like|First!|Copyright/.test(joined));
});

/* ---------- extract(): sparse page falls back to body ---------- */
const SPARSE = new JSDOM(
  "<html><head><title>t</title></head><body><p>" +
  "only one real paragraph lives on this page but it is long enough to count".repeat(2) +
  "</p></body></html>"
).window.document;
test("sparse page still yields its paragraph", () =>
  assert.ok(Mantis.extract(SPARSE).paragraphs.length === 1));

/* ---------- extract(): explicit minTextLength 0 keeps short blocks ---------- */
const SHORTY = new JSDOM(
  "<html><head><title>t</title></head><body><article><p>" +
  "a long opening paragraph that clears the default floor without any trouble at all ".repeat(2) +
  "</p><p>tiny.</p></article></body></html>"
).window.document;
test("minTextLength 0 is honored, not treated as unset", () => {
  assert.ok(!Mantis.extract(SHORTY).text.includes("tiny."));
  assert.ok(Mantis.extract(SHORTY, { minTextLength: 0 }).text.includes("tiny."));
});

const HIDDEN = new JSDOM(`<!doctype html><html><head>
<title>t</title><meta name="byl" content="B. Reporter"><meta name="twitter:image" content="https://site.com/tw.jpg">
</head><body>
<div style="display:none">
  <p>${"hidden paragraph should not be captured ".repeat(5)}</p>
  <p>${"hidden paragraph should not win scoring ".repeat(5)}</p>
</div>
<article>
  <h1>Visible headline</h1>
  <p>${"visible paragraph should be captured instead ".repeat(5)}</p>
  <p>${"second visible paragraph should be captured too ".repeat(5)}</p>
</article>
</body></html>`).window.document;
const h = Mantis.extract(HIDDEN);
test("ignores hidden DOM and keeps visible article text", () => {
  const joined = h.paragraphs.join(" ");
  assert.ok(joined.includes("visible paragraph"));
  assert.ok(!joined.includes("hidden paragraph"));
});
test("uses common fallback metadata", () => {
  assert.strictEqual(h.byline, "B. Reporter");
  assert.strictEqual(h.hero, "https://site.com/tw.jpg");
});
test("reports extraction diagnostics", () => {
  assert.strictEqual(h.diagnostics.scopeTag, "ARTICLE");
  assert.ok(h.confidence > 0 && h.confidence <= 1);
  assert.strictEqual(h.diagnostics.paragraphCount, h.paragraphs.length);
});

const DUPED = new JSDOM(`<!doctype html><html><head><title>Clean Title - Site Name</title></head><body>
<article>
  <p>${"duplicated responsive paragraph should appear once ".repeat(5)}</p>
  <p>${"second responsive paragraph should appear once ".repeat(5)}</p>
  <div>
    <p>${"duplicated responsive paragraph should appear once ".repeat(5)}</p>
  </div>
</article>
</body></html>`).window.document;
const d = Mantis.extract(DUPED);
test("cleans fallback title suffixes", () =>
  assert.strictEqual(d.title, "Clean Title"));
test("deduplicates repeated responsive body text", () => {
  const matches = d.paragraphs.filter((p) => p.includes("duplicated responsive paragraph"));
  assert.strictEqual(matches.length, 1);
});

const STRUCTURED = new JSDOM(`<!doctype html><html lang="en"><head>
<title>Structured Story - Site</title>
<link rel="canonical" href="/structured">
<meta property="og:site_name" content="Example Site">
<meta property="article:published_time" content="2026-06-10T10:00:00Z">
<meta property="article:modified_time" content="2026-06-10T12:00:00Z">
<meta property="og:image" content="/hero.png">
</head><body>
<article>
  <h1>Structured Story</h1>
  <p>Structured opening paragraph includes a <a href="/source">source link</a> for context and citation.</p>
  <h2>Data</h2>
  <p>Structured data paragraph introduces a compact table for extraction.</p>
  <img src="/chart.png" alt="Chart alt text">
  <table>
    <caption>Quarterly results</caption>
    <tr><th>Quarter</th><th>Value</th></tr>
    <tr><td>Q1</td><td>10</td></tr>
    <tr><td>Q2</td><td>12</td></tr>
  </table>
</article>
</body></html>`, { url: "https://example.com/post" }).window.document;
const s = Mantis.extract(STRUCTURED);
test("returns structured article metadata", () => {
  assert.strictEqual(s.object, "article");
  assert.strictEqual(s.status, "completed");
  assert.strictEqual(s.contentType, "article");
  assert.ok(/^[0-9a-f]{8}$/.test(s.contentHash));
  assert.ok(/^[0-9a-f]{8}$/.test(s.textHash));
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(s.capturedAt));
  assert.deepStrictEqual(s.warnings, []);
  assert.strictEqual(s.url, "https://example.com/post");
  assert.strictEqual(s.canonicalUrl, "https://example.com/structured");
  assert.strictEqual(s.siteName, "Example Site");
  assert.strictEqual(s.language, "en");
  assert.strictEqual(s.publishedAt, "2026-06-10T10:00:00Z");
  assert.strictEqual(s.modifiedAt, "2026-06-10T12:00:00Z");
  assert.strictEqual(s.hero, "/hero.png");
});
test("returns blocks, sections, and source selectors", () => {
  assert.ok(s.text.includes("Structured opening paragraph"));
  assert.ok(s.blocks.some((block) => block.object === "block" && block.type === "heading" && block.text === "Data"));
  assert.ok(s.sections.some((section) => section.heading === "Data"));
  assert.ok(/^body/.test(s.blocks[0].source.selector));
  assert.strictEqual(s.citations[0].object, "citation");
  assert.ok(s.citations[1].hrefs.includes("https://example.com/source"));
  assert.strictEqual(s.citations[0].offset, 0);
});
test("extracts article links and images", () => {
  assert.strictEqual(s.links[0].object, "link");
  assert.strictEqual(s.images[0].object, "image");
  assert.deepStrictEqual(s.links[0].href, "https://example.com/source");
  assert.deepStrictEqual(s.images[0].src, "https://example.com/chart.png");
  assert.strictEqual(s.images[0].alt, "Chart alt text");
});
test("extracts tables as rows and cells", () => {
  assert.strictEqual(s.tables[0].object, "table");
  assert.strictEqual(s.tables[0].caption, "Quarterly results");
  assert.deepStrictEqual(s.tables[0].headers, ["Quarter", "Value"]);
  assert.deepStrictEqual(s.tables[0].rows[1], ["Q2", "12"]);
});

const EMPTY = new JSDOM("<html><head><title>Empty</title></head><body><nav>Only navigation</nav></body></html>").window.document;
const empty = Mantis.extract(EMPTY);
test("reports empty extraction status and warnings", () => {
  assert.strictEqual(empty.status, "empty");
  assert.ok(empty.warnings.includes("empty_content"));
});

const SELECTED_DOM = new JSDOM(`<!doctype html><html><body><article>
<p>Selected paragraph text should be available as a first class selection object.</p>
<p>Second paragraph keeps the article long enough for normal extraction.</p>
</article></body></html>`);
const selectedP = SELECTED_DOM.window.document.querySelector("p");
SELECTED_DOM.window.getSelection = () => ({
  anchorNode: selectedP.firstChild,
  toString: () => "Selected paragraph text"
});
const selected = Mantis.extract(SELECTED_DOM.window.document);
test("captures the current selection as structured data", () => {
  assert.strictEqual(selected.selection.object, "selection");
  assert.strictEqual(selected.selection.text, "Selected paragraph text");
  assert.strictEqual(selected.selection.note, "");
  assert.ok(selected.selection.source.selector.includes("p:nth-of-type(1)"));
});

test("renders Markdown and reader HTML", () => {
  const md = Mantis.toMarkdown(s);
  const html = Mantis.toHTML(s);
  assert.ok(md.includes("# Structured Story"));
  assert.ok(md.includes("[source link](https://example.com/source)"));
  assert.ok(md.includes("| Quarter | Value |"));
  assert.ok(html.includes('<article class="mantis-reader">'));
  assert.ok(html.includes("<table>"));
});
test("extract options can disable optional collections", () => {
  const slim = Mantis.extract(STRUCTURED, { includeLinks: false, includeImages: false, includeTables: false, maxBlocks: 2 });
  assert.deepStrictEqual(slim.links, []);
  assert.deepStrictEqual(slim.images, []);
  assert.deepStrictEqual(slim.tables, []);
  assert.strictEqual(slim.blocks.length, 2);
});

/* ---------- markdown fidelity: inline runs, lists, fences, escaping ---------- */
const RICH = new JSDOM(`<!doctype html><html><head><title>Rich Markdown Page</title></head><body><article>
<h1>Rich Markdown Page</h1>
<p>Inline content keeps <strong>bold words</strong>, some <em>emphasis</em>, inline <code>code()</code>, and a <a href="/rel">relative link</a> intact.</p>
<p>Specials like *stars*, [brackets], and 1.5 numbers survive. Plain sentences stay unescaped.</p>
<h4>Fourth level heading</h4>
<ol start="3">
  <li>third ordered item with enough text to be kept around</li>
  <li>fourth ordered item with enough text to be kept around
    <ul><li>nested unordered child item with enough text to be kept</li></ul>
  </li>
</ol>
<pre class="language-js">function x() {
  return 1;
}</pre>
</article></body></html>`, { url: "https://example.com/rich" }).window.document;
const rich = Mantis.extract(RICH);
const richMd = Mantis.toMarkdown(rich);

test("captures inline runs whose text matches the block", () => {
  const p = rich.blocks.find((b) => b.runs);
  assert.ok(p.runs.some((r) => r.type === "strong" && r.text === "bold words"));
  assert.ok(p.runs.some((r) => r.type === "link" && r.href === "https://example.com/rel"));
  assert.strictEqual(p.runs.map((r) => r.text).join(""), p.text);
});
test("renders inline markdown with minimal escaping", () => {
  assert.ok(richMd.includes("**bold words**"));
  assert.ok(richMd.includes("*emphasis*"));
  assert.ok(richMd.includes("`code()`"));
  assert.ok(richMd.includes("[relative link](https://example.com/rel)"));
  assert.ok(richMd.includes("\\*stars\\*"));
  assert.ok(richMd.includes("\\[brackets\\]"));
  assert.ok(richMd.includes("1.5 numbers survive. Plain sentences stay unescaped."));
});
test("keeps heading levels four through six", () => {
  assert.ok(rich.blocks.some((b) => b.type === "heading" && b.level === 4));
  assert.ok(richMd.includes("#### Fourth level heading"));
});
test("renders ordered and nested lists", () => {
  assert.ok(richMd.includes("3. third ordered item"));
  assert.ok(richMd.includes("4. fourth ordered item"));
  assert.ok(richMd.includes("\n    - nested unordered child item"));
});
test("emits the page title once", () =>
  assert.strictEqual(richMd.match(/# Rich Markdown Page/g).length, 1));
test("renders fenced code with language and line breaks", () => {
  const code = rich.blocks.find((b) => b.type === "code");
  assert.strictEqual(code.language, "js");
  assert.ok(richMd.includes("```js\nfunction x() {\n  return 1;\n}\n```"));
});
test("toHTML nests lists instead of wrapping each item", () => {
  const html = Mantis.toHTML(rich);
  assert.ok(html.includes("<ol><li>"));
  assert.ok(html.includes("<ul><li>nested"));
  assert.ok(!html.includes("</ul><ul>"));
});

/* ---------- toMarkdown options: frontmatter, budget, images, tables ---------- */
test("toMarkdown can emit yaml frontmatter for agents", () => {
  const fm = Mantis.toMarkdown(s, { frontmatter: true });
  assert.ok(fm.startsWith("---\n"));
  assert.ok(fm.includes('title: "Structured Story"'));
  assert.ok(fm.includes('url: "https://example.com/structured"'));
  assert.ok(fm.includes("confidence: " + s.confidence));
  assert.ok(fm.includes('contentHash: "' + s.contentHash + '"'));
});
test("toMarkdown maxChars cuts at block boundaries", () => {
  const small = Mantis.toMarkdown(s, { maxChars: 80 });
  assert.ok(small.length <= 80);
  assert.ok(small.includes("# Structured Story"));
});
test("toMarkdown outline budget keeps headings and section leads", () => {
  const filler = "Filler sentence that runs long enough to spend the whole budget on low priority prose. ".repeat(3).trim();
  const docArticle = {
    title: "Budget Doc",
    blocks: [
      { type: "heading", level: 2, text: "Alpha section" },
      { type: "paragraph", text: "Alpha lead paragraph stays." },
      { type: "paragraph", text: filler },
      { type: "heading", level: 2, text: "Beta section" },
      { type: "paragraph", text: "Beta lead paragraph stays." }
    ]
  };
  const cut = Mantis.toMarkdown(docArticle, { maxChars: 150 });
  const outline = Mantis.toMarkdown(docArticle, { maxChars: 150, budget: "outline" });
  assert.ok(!cut.includes("## Beta section"), "cut mode loses the tail");
  assert.ok(outline.includes("## Beta section"));
  assert.ok(outline.includes("Beta lead paragraph stays."));
  assert.ok(!outline.includes("Filler sentence"));
  assert.ok(outline.length <= 150);
  assert.ok(outline.indexOf("Alpha lead") < outline.indexOf("## Beta section"), "document order preserved");
});
test("toMarkdown can include images and drop tables", () => {
  const md = Mantis.toMarkdown(s, { images: "alt", tables: false });
  assert.ok(md.includes("![Chart alt text](https://example.com/chart.png)"));
  assert.ok(!md.includes("| Quarter |"));
});
test("toMarkdown still renders stored articles without runs", () => {
  const md = Mantis.toMarkdown({
    title: "Old",
    blocks: [{ type: "paragraph", text: "Read the spec today", links: [{ text: "spec", href: "https://example.com/spec(v2)" }] }]
  });
  assert.ok(md.includes("[spec](https://example.com/spec%28v2%29)"));
});

/* ---------- fromHTML(): server-side entry with injected DOMParser ---------- */
test("fromHTML extracts from an HTML string with an injected DOMParser", () => {
  const { DOMParser } = new JSDOM("").window;
  const article = Mantis.fromHTML(`<html><head><title>Server Page</title></head><body><article>
    <h1>Server Page</h1>
    <p>Server side paragraph one is long enough to be captured by the extractor.</p>
    <p>Second server paragraph has a <a href="/docs">relative docs link</a> in the body text.</p>
  </article></body></html>`, { url: "https://example.com/server/page", DOMParser });
  assert.strictEqual(article.url, "https://example.com/server/page");
  assert.ok(article.paragraphs.length >= 2);
  assert.ok(Mantis.toMarkdown(article).includes("[relative docs link](https://example.com/docs)"));
});

/* ---------- extension manifest ---------- */
test("MV3 extension manifest points at existing capture files", () => {
  const manifest = require("./manifest.json");
  assert.strictEqual(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.strictEqual(manifest.background.service_worker, "extension/background.js");
  assert.ok(fs.existsSync(path.join(__dirname, manifest.background.service_worker)));
  assert.ok(fs.existsSync(path.join(__dirname, "extension/capture.js")));
  assert.ok(fs.existsSync(path.join(__dirname, "mantis.js")));
});

/* ---------- run(): local copy, configured POST, configured fallback ---------- */
async function runCase(fetchImpl, configureScript) {
  const dom = new JSDOM(
    '<html><head><title>T</title><meta property="og:title" content="Page Title"></head><body><div>' +
    "<p>" + "long paragraph text here ".repeat(5) + "</p>" +
    "<p>" + "second paragraph words ".repeat(5) + "</p>" +
    "<p>" + "third paragraph words ".repeat(5) + "</p>" +
    "</div></body></html>",
    { url: "https://news.example.com/story", pretendToBeVisual: true }
  );
  const w = dom.window;
  const out = { posted: null, opened: null, copied: null };
  if (fetchImpl) w.fetch = fetchImpl(out);
  w.open = (u) => { out.opened = u; };
  w.navigator.clipboard = { writeText: (text) => { out.copied = text; return Promise.resolve(); } };
  const s = w.document.createElement("script");
  s.src = "http://localhost:4848/mantis.js?t=1";
  if (configureScript) configureScript(s);
  Mantis.run(s);
  Mantis.run(s); // double-click must be a no-op
  await new Promise((r) => setTimeout(r, 40));
  out.window = w;
  return out;
}

(async () => {
  const ok = await runCase((out) => (u, o) => {
    assert.strictEqual(out.posted, null, "double-click guard failed");
    out.posted = { url: u, payload: JSON.parse(o.body) };
    return Promise.resolve({ ok: true });
  }, (s) => {
    s.setAttribute("data-mantis-endpoint", "https://agent.local/capture");
    s.setAttribute("data-mantis-format", "bundle");
  });
  test("run() POSTs the artifact to a configured endpoint", () => {
    assert.strictEqual(ok.posted.url, "https://agent.local/capture");
    const c = ok.posted.payload;
    assert.strictEqual(c.object, "mantis_capture");
    assert.strictEqual(c.format, "bundle");
    assert.strictEqual(c.url, "https://news.example.com/story");
    assert.strictEqual(c.origin, "news.example.com");
    assert.ok(c.markdown.includes("# Page Title"));
    assert.strictEqual(c.article.object, "article");
  });
  test("run() shows the in-page confirmation", () =>
    assert.ok(ok.window.document.querySelector('div[style*="2147483647"]')));

  const local = await runCase(null);
  test("run() copies Markdown locally when no endpoint is configured", () => {
    assert.strictEqual(local.posted, null);
    assert.ok(local.copied.includes("# Page Title"));
    assert.strictEqual(local.opened, null);
  });

  const blocked = await runCase(() => () => Promise.reject(new Error("network")), (s) => {
    s.setAttribute("data-mantis-endpoint", "/capture");
    s.setAttribute("data-mantis-fallback-url", "/capture-fallback");
  });
  test("blocked POST opens the configured fallback", () =>
    assert.ok(/^http:\/\/localhost:4848\/capture-fallback\?/.test(blocked.opened)));

  console.log("\n" + passed + " tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
