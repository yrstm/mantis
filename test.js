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
