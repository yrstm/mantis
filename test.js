/* mantis tests - node test.js (requires dev dep: jsdom) */
"use strict";

const assert = require("node:assert");
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
  assert.ok(md.includes("| Quarter | Value |"));
  assert.ok(html.includes('<article class="mantis-reader">'));
  assert.ok(html.includes("<table>"));
});

/* ---------- run(): POST happy path, CSP fallback, double-click guard ---------- */
async function runCase(fetchImpl) {
  const dom = new JSDOM(
    '<html><head><title>T</title><meta property="og:title" content="Page Title"></head><body><div>' +
    "<p>" + "long paragraph text here ".repeat(5) + "</p>" +
    "<p>" + "second paragraph words ".repeat(5) + "</p>" +
    "<p>" + "third paragraph words ".repeat(5) + "</p>" +
    "</div></body></html>",
    { url: "https://news.example.com/story", pretendToBeVisual: true }
  );
  const w = dom.window;
  const out = { posted: null, opened: null };
  w.fetch = fetchImpl(out);
  w.open = (u) => { out.opened = u; };
  const s = w.document.createElement("script");
  s.src = "http://localhost:4848/mantis.js?t=1";
  Mantis.run(s);
  Mantis.run(s); // double-click must be a no-op
  await new Promise((r) => setTimeout(r, 40));
  out.window = w;
  return out;
}

(async () => {
  const ok = await runCase((out) => (u, o) => {
    assert.strictEqual(out.posted, null, "double-click guard failed");
    out.posted = { url: u, crate: JSON.parse(o.body) };
    return Promise.resolve({ ok: true });
  });
  test("run() POSTs the artifact to the script's origin", () => {
    assert.strictEqual(ok.posted.url, "http://localhost:4848/api/crates");
    const c = ok.posted.crate;
    assert.strictEqual(c.captured, true);
    assert.strictEqual(c.url, "https://news.example.com/story");
    assert.strictEqual(c.origin, "news.example.com");
    assert.ok(c.body.length === 3);
  });
  test("run() shows the in-page confirmation", () =>
    assert.ok(ok.window.document.querySelector('div[style*="2147483647"]')));

  const blocked = await runCase(() => () => Promise.reject(new Error("csp")));
  test("blocked POST falls back to the /save popup", () =>
    assert.ok(/^http:\/\/localhost:4848\/save\?/.test(blocked.opened)));

  console.log("\n" + passed + " tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
