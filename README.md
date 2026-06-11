# mantis

Mantis pulls the readable content out of a rendered page. Give it a DOM, get back a structured
article object, render that as clean Markdown or reader HTML. Built for save-for-later tools,
bookmarklets, browser extensions, and AI agents that want pages as token-cheap Markdown.

One file, zero dependencies, never fetches anything.

## What it does

- Finds the main content and skips nav, ads, comments, hidden nodes, and repeated responsive markup.
- Returns metadata, text, blocks, sections, links, images, tables, a confidence score, and diagnostics.
- Renders the same article object as Markdown (inline links, emphasis, nested lists, fenced code)
  or reader HTML.
- Works on the page as the browser rendered it — it never refetches the URL.

## API

In the browser:

```js
const article = Mantis.extract(document);
const markdown = Mantis.toMarkdown(article);
```

In Node, bring your own DOM parser (mantis itself stays dependency-free):

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

Blocks can also carry `runs` (inline text, links, code, bold, italics), `list` (`depth`,
`ordered`, `index`), and `language` (code fence hint).

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

The Markdown keeps inline links, `code`, **bold**, and *italics*; renders ordered and nested
lists, H1-H6, and fenced code with the page's language hint. It only escapes characters that
would change meaning, so prose doesn't come back full of backslashes.

Extract options:

```js
const article = Mantis.extract(document, {
  maxBlocks: 100,        // cap on extracted blocks (default 150)
  minTextLength: 25,     // drop blocks shorter than this; 0 keeps everything
  includeLinks: true,
  includeImages: true,
  includeTables: true
});
```

Stable fields: `title`, `byline`, `hero`, `url`, `canonicalUrl`, `text`, `paragraphs`, `blocks`,
`sections`, `citations`, `links`, `images`, `tables`, `status`, `warnings`, `contentType`,
`contentHash`, and `textHash`.

`confidence` and `diagnostics` are for debugging and ranking captures; their exact scoring can
change between releases, so don't build on the numbers themselves.

`Mantis.run(scriptElement)` is an optional bookmarklet helper. It extracts the page, posts the
result to `{script origin}/api/crates`, shows a small confirmation, and falls back to `/save` if
the post is blocked.

## Use with AI agents

If your agent already drives a browser, mantis is the last step: it turns the DOM the browser
actually rendered — after JavaScript, minus the chrome — into Markdown that's cheap to put in a
context window. It doesn't fetch URLs and it isn't a scraping framework; pair it with whatever
loads the page.

Playwright or Puppeteer:

```js
await page.addScriptTag({ path: require.resolve("mantis") });
const markdown = await page.evaluate(() =>
  Mantis.toMarkdown(Mantis.extract(document), { frontmatter: true, maxChars: 12000, budget: "outline" })
);
```

HTML you already have (server side, via jsdom or linkedom):

```js
const { JSDOM } = require("jsdom");
const Mantis = require("mantis");
const article = Mantis.fromHTML(html, { url, DOMParser: new JSDOM("").window.DOMParser });
const markdown = Mantis.toMarkdown(article, { frontmatter: true });
```

Beyond plain Markdown:

- `frontmatter: true` carries `url`, `confidence`, `contentHash`, and `warnings`, so an agent can
  branch on `low_confidence` or `ambiguous_scope`, dedupe captures by hash, and cite the source.
- `citations` keeps CSS selectors and text offsets, so a claim can be traced back to the exact
  DOM node it came from.
- `maxChars` cuts at block boundaries, never mid-sentence. Budgets are in characters (roughly 4
  per token) because mantis stays tokenizer-free. With `budget: "outline"`, a page that doesn't
  fit keeps every heading and each section's lead block instead of losing its tail.

## Demo

```
npm run demo
```

Open `http://127.0.0.1:8787` and drag **Markdown this page** to your bookmarks bar. Click it on
anything you're reading: an overlay shows the Markdown, with a copy button and toggles for
frontmatter and the outline budget. Select some text first if you only want that part. The
**raw** toggle keeps the short blocks extraction normally drops — useful when the confidence
number looks off and you want to see what got filtered.

The server only serves your local `mantis.js`, uncached — edit the file, click again, see the
change. Nothing is uploaded anywhere.

If clicking does nothing, an alert tells you why: the demo server isn't running, or the site's
CSP blocks injected scripts. (Safari also refuses to load from localhost on `https` pages;
Chrome and Firefox allow `127.0.0.1`.) For those pages, use the paste box on the demo page —
a one-line devtools snippet copies the page's URL and HTML, paste it in and convert. Same
engine, just through `fromHTML`.

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

The benchmark runs against fixed HTML snapshots in `fixtures/` and should stay green when
extraction changes. `perf.js` times the render path (microseconds per `toMarkdown` pass) over a
fixed corpus with a fidelity gate; renderer changes only land if the gate stays green and the
number doesn't regress. `npm run test:browser` runs the demo in real Chromium — CI does this on
every push, or install Playwright locally first (see `demo/browser-test.js`).

## License

MIT
