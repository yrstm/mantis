# mantis

Mantis extracts readable content from the rendered browser DOM. Use it to power save-for-later and
bookmarking tools, or to convert any page into clean, token-cheap Markdown for LLM agents — same
extraction, two outputs.

It is a small, dependency-free JavaScript library for bookmarklets, browser extensions, headless
browser scripts, and client side capture tools.

## What it does

- Finds the main readable container in a document.
- Returns metadata, text, blocks, sections, links, images, tables, confidence, and diagnostics.
- Renders the same article object as Markdown (inline links, emphasis, nested lists, fenced code)
  or reader HTML.
- Filters navigation, comments, ads, hidden DOM, and repeated responsive content.
- Runs in the page without fetching the URL again.

## API

Browser:

```js
const article = Mantis.extract(document);
const markdown = Mantis.toMarkdown(article);
```

Node (inject a DOM parser; mantis itself stays dependency-free and never fetches URLs):

```js
const { JSDOM } = require("jsdom");
const Mantis = require("mantis");

const article = Mantis.fromHTML(html, {
  url: "https://example.com/post",
  DOMParser: new JSDOM("").window.DOMParser
});
```

Result shape:

```js
{
  title: "Example title",
  byline: "Example author",
  hero: "https://example.com/image.jpg",
  object: "article",
  status: "completed",
  contentType: "article",
  capturedAt: "2026-06-10T12:00:00.000Z",
  contentHash: "f3a2c91b",
  textHash: "91b3f2a0",
  warnings: [],
  text: "First paragraph\n\nSecond paragraph",
  paragraphs: ["First paragraph", "Second paragraph"],
  blocks: [
    {
      type: "paragraph",
      text: "First paragraph",
      runs: [{ type: "text", text: "First " }, { type: "strong", text: "paragraph" }],
      source: { selector: "body > article:nth-of-type(1) > p:nth-of-type(1)", index: 0 }
    }
  ],
  sections: [{ heading: "", level: 0, blocks: [] }],
  citations: [{ text: "First paragraph", selector: "body > article:nth-of-type(1) > p:nth-of-type(1)", hrefs: [], offset: 0 }],
  links: [{ text: "Source", href: "https://example.com/source", rel: "", source: {} }],
  images: [{ src: "https://example.com/image.jpg", alt: "", title: "", source: {} }],
  tables: [{ caption: "", headers: ["Name", "Value"], rows: [["A", "1"]], source: {} }],
  confidence: 0.82,
  diagnostics: {
    scopeTag: "ARTICLE",
    linkDensity: 0.04,
    score: 1200,
    nextScore: 340,
    paragraphCount: 2
  }
}
```

Blocks carry optional fidelity fields: `runs` (inline text, links, code, bold, italics), `list`
(`depth`, `ordered`, `index` for nested and ordered lists), and `language` (code fence hint).

Format helpers:

```js
const markdown = Mantis.toMarkdown(article, {
  frontmatter: true,          // YAML header: title, byline, url, published, captured,
                              // contentType, confidence, contentHash, warnings
  images: "alt",              // "omit" (default) | "alt" (![alt](src)) | "links" ([alt](src))
  tables: true,               // GFM tables (default true)
  maxChars: 8000,             // budget in characters (~4 chars per token); never cuts mid-block
  budget: "outline"           // "cut" (default): keep the leading run of blocks
                              // "outline": spend the budget on headings and the first
                              // block of each section before remaining prose
});
const html = Mantis.toHTML(article);
```

Markdown output keeps inline links, `code`, **bold**, and *italics*; renders ordered and nested
lists, H1-H6, and fenced code with the page's language hint; and escapes only characters that
would change meaning, so prose is not littered with backslashes.

Extract options:

```js
const article = Mantis.extract(document, {
  maxBlocks: 100,
  minTextLength: 25,
  includeLinks: true,
  includeImages: true,
  includeTables: true
});
```

Stable fields: `title`, `byline`, `hero`, `url`, `canonicalUrl`, `text`, `paragraphs`, `blocks`,
`sections`, `citations`, `links`, `images`, `tables`, `status`, `warnings`, `contentType`,
`contentHash`, and `textHash`.

Diagnostic fields: `confidence` and `diagnostics`. These are useful for debugging and ranking
captures, but their exact scoring may change between releases.

`Mantis.run(scriptElement)` is an optional bookmarklet helper. It extracts the page, posts the
result to `{script origin}/api/crates`, shows a small confirmation, and falls back to `/save` if the
post is blocked.

## Use with AI agents

Mantis is the embeddable last mile for agents that already control a browser context: it converts
the DOM the browser actually rendered — after JavaScript, with hidden chrome removed — into
Markdown that is cheap to put in a context window. It does not fetch URLs and is not a scraping
framework; pair it with whatever loads the page.

Playwright or Puppeteer (the page the browser rendered, not the HTML the server sent):

```js
await page.addScriptTag({ path: require.resolve("mantis") });
const markdown = await page.evaluate(() =>
  Mantis.toMarkdown(Mantis.extract(document), { frontmatter: true, maxChars: 12000, budget: "outline" })
);
```

Static HTML you already have (server side, via jsdom or linkedom):

```js
const { JSDOM } = require("jsdom");
const Mantis = require("mantis");
const article = Mantis.fromHTML(html, { url, DOMParser: new JSDOM("").window.DOMParser });
const markdown = Mantis.toMarkdown(article, { frontmatter: true });
```

What the agent gets beyond plain Markdown:

- `frontmatter: true` carries `url`, `confidence`, `contentHash`, and `warnings`, so an agent can
  branch on `low_confidence` or `ambiguous_scope`, dedupe captures by hash, and cite the source.
- The article object keeps `citations` with CSS selectors and text offsets — verifiable grounding
  back to exact DOM locations that markdown-only converters cannot give you.
- `maxChars` enforces a budget at block boundaries instead of mid-sentence (budgets are in
  characters, roughly 4 per token — mantis stays tokenizer-free on purpose). With
  `budget: "outline"` a page that does not fit degrades like an outline — every heading and each
  section's lead block survive before any further prose is added — instead of losing its tail.

## Demo

Run a local bookmarklet receiver:

```
npm run demo
```

Open `http://127.0.0.1:8787`, drag the bookmarklet to your bookmarks bar, visit a page, and click
the bookmarklet. The demo page shows the extracted article and full capture payload.

## Bookmarklet

```js
javascript:(function(){
  var s=document.createElement('script');
  s.src='https://YOUR-HOST/mantis.js?t='+Date.now();
  s.setAttribute('data-mantis-run','1');
  s.onerror=function(){/* your fallback */};
  (document.body||document.documentElement).appendChild(s);
})();
```

## Development

```
npm install
npm test
npm run benchmark
npm run perf
```

The benchmark uses fixed HTML snapshots in `fixtures/` and should stay green when extraction
behavior changes. `perf.js` is the render-path harness: a fixed corpus, a fixed metric
(microseconds per `toMarkdown` pass), and a fidelity gate — renderer changes are kept only when
the gate stays green and the metric does not regress.

## License

MIT
