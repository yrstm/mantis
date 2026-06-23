# mantis

Mantis pulls the readable content out of a rendered page. Give it a DOM, get back a structured
article object, render that as clean Markdown or reader HTML. Built for save-for-later tools,
bookmarklets, browser extensions, and AI agents that want pages as token-cheap Markdown.

One file, zero dependencies, never fetches anything.

## Features

| Feature | Description |
|---|---|
| Content extraction | Scores containers by prose density and semantic signals; removes nav, sidebar, footer, ads, comments, hidden nodes, and repeated responsive markup |
| Metadata | Resolves title, byline, hero image, site name, canonical URL, published/modified dates, and language from meta tags with defined fallback chains |
| Typed blocks | Returns paragraphs, headings, blockquotes, code blocks, and list items — each with inline runs (bold, italic, code, links) and a CSS selector to the source node |
| Sections & citations | Groups blocks under headings; attaches a text offset to every block for precise claim tracing |
| Markdown rendering | Inline links, bold, italic, code, nested lists, fenced code, GFM tables, and optional YAML frontmatter |
| Reader HTML | `<article class="mantis-reader">` with inline formatting and nested lists; no bundled stylesheet |
| Token budget | Cuts at block boundaries; `"outline"` mode keeps headings and section leads before prose when over budget |
| Confidence & warnings | 0–1 confidence score; six warning codes covering low confidence, thin content, ambiguous scope, high link density, and no scope found |
| Content hashing | `contentHash` for cross-session dedup; `textHash` for content-change detection on the same URL |
| Selection capture | Captures the user's active text selection in browser contexts |
| Bookmarklet / `run()` | Extracts and POSTs to your backend; in-page confirmation; CSP-safe popup fallback |
| Node / server-side | `fromHTML(html, { DOMParser })` with jsdom or linkedom; zero network requests |

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
  object: "article",
  title: "Example title",
  byline: "Example author",
  siteName: "Example Site",
  hero: "https://example.com/image.jpg",
  url: "https://example.com/post",
  canonicalUrl: "https://example.com/post",   // from <link rel="canonical">; falls back to url
  language: "en",
  publishedAt: "2026-01-15T00:00:00Z",
  modifiedAt: "",
  status: "completed",                         // "completed" | "partial" | "empty"
  contentType: "article",                      // "article" | "docs" | "recipe" | "forum" |
                                               // "newsletter" | "product" | "video" | "unknown"
  capturedAt: "2026-06-10T12:00:00.000Z",
  contentHash: "f3a2c91b",
  textHash: "91b3f2a0",
  warnings: [],
  text: "First paragraph\n\nSecond paragraph",
  paragraphs: ["First paragraph", "Second paragraph"],
  blocks: [
    {
      object: "block",
      type: "paragraph",            // "paragraph" | "heading" | "blockquote" | "code" | "list_item"
      tag: "P",
      level: 0,                     // heading level 1–6 for headings; 0 otherwise
      text: "First paragraph",
      links: [{ text: "link text", href: "https://example.com" }],
      runs: [
        { type: "text", text: "First " },
        { type: "strong", text: "paragraph" }
      ],                            // run types: "text" | "strong" | "em" | "code" | "link"
                                    // "link" runs also carry href
      source: { selector: "article > p:nth-of-type(1)", index: 0 }
      // list_item blocks also carry: list: { depth, ordered, index }
      // code blocks also carry:      language: "js"
    }
  ],
  sections:  [{ object: "section",  heading: "", level: 0, blocks: [] }],
  citations: [{ object: "citation", text: "First paragraph", selector: "article > p:nth-of-type(1)", hrefs: [], offset: 0 }],
  links:     [{ object: "link",     text: "Source", href: "https://example.com/source", rel: "", source: {} }],
  images:    [{ object: "image",    src: "https://example.com/image.jpg", alt: "", title: "", source: {} }],
  tables:    [{ object: "table",    caption: "", headers: ["Name", "Value"], rows: [["A", "1"]], source: {} }],
  selection: null,                  // { object: "selection", text, note, createdAt, source } when set
  confidence: 0.82,
  diagnostics: { scopeTag: "ARTICLE", linkDensity: 0.04, score: 1200, nextScore: 340, paragraphCount: 2 }
}
```

**Metadata sources** (first match wins):

| Field | Sources |
|---|---|
| `title` | `og:title` → `twitter:title` → first `<h1>` → `document.title` (strips ` \| Site Name` suffixes) |
| `byline` | `author` → `article:author` → `byl` → `parsely-author` |
| `hero` | `og:image` → `twitter:image` → `twitter:image:src` |
| `canonicalUrl` | `<link rel="canonical">`; falls back to `url` |
| `siteName` | `og:site_name` |
| `language` | `<html lang>` → `meta[name=language]` |
| `publishedAt` | `article:published_time` → `date` |
| `modifiedAt` | `article:modified_time` → `lastmod` |

Images fall back to `data-src` when `src` is absent (lazy-load pattern).

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
                              // block of each section before remaining prose;
                              // has no effect if maxChars is not set
});
const html = Mantis.toHTML(article);
```

The Markdown keeps inline links, `code`, **bold**, and *italics*; renders ordered and nested
lists, H1-H6, and fenced code with the page's language hint. It only escapes characters that
would change meaning, so prose doesn't come back full of backslashes.

Tables in `article.tables` render after all prose blocks in both `toMarkdown` and `toHTML`;
their in-document position is not preserved.

`toHTML` also renders inline formatting (bold, italic, code, links) using the same `runs` data
as `toMarkdown`; it wraps output in `<article class="mantis-reader">` with no bundled stylesheet.

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

`links` is capped at 200 entries, `images` at 100, and `tables` at 50, independently of
`maxBlocks`. `selection` is always `null` in Node/`fromHTML` contexts — it only captures a
live browser text selection.

Stable fields: `title`, `byline`, `siteName`, `hero`, `url`, `canonicalUrl`, `language`,
`publishedAt`, `modifiedAt`, `text`, `paragraphs`, `blocks`, `sections`, `citations`, `links`,
`images`, `tables`, `selection`, `status`, `warnings`, `contentType`, `contentHash`, and
`textHash`.

`contentHash` hashes title, byline, canonical URL, body text, and tables — use it to detect
duplicate captures of the same page across sessions. `textHash` hashes body text only — use it
to detect content changes when the URL is stable.

`contentType` is inferred from element class names and `og:type`; it returns `"unknown"` when
those signals are absent, which is common.

`confidence` and `diagnostics` are for debugging and ranking captures; their exact scoring can
change between releases, so don't build on the numbers themselves.

`Mantis.run(scriptElement)` is an optional bookmarklet helper. It extracts the page, posts the
result to `{script origin}/api/crates`, shows a small confirmation, and falls back to `/save` if
the post is blocked. A 3-second guard prevents double-capture if the script is injected twice.

The POST body sent to `/api/crates` is `Content-Type: application/json` with this shape:

```js
{
  type: "web",
  source: "Web",
  origin: "example.com",           // hostname without www
  url: "https://example.com/post", // full window.location.href
  title: "Article title",
  byline: "Author — captured from the browser DOM",
  hero: "https://example.com/image.jpg",
  captured: true,
  body: ["selected text", "paragraph 1", "paragraph 2"],  // selection prepended if any
  article: { /* full MantisArticle object */ }
}
```

The `/save` fallback opens a popup with `url`, `title`, and `text` (the current selection) as
query parameters.

### Warnings and status

`article.warnings` is an array of string codes. `article.status` is derived from them.

| Warning | Triggers when | Suggested action |
|---|---|---|
| `low_confidence` | Confidence score below 0.45 | Treat as provisional; fall back or flag for review |
| `ambiguous_scope` | Top two candidate containers score within 20% of each other | Content container was unclear; inspect `diagnostics.scopeTag` |
| `high_link_density` | Extracted scope is more than 35% anchor text | Page is likely a directory or nav page, not prose |
| `empty_content` | No blocks were extracted | Page has no readable content or is fully JS-gated |
| `short_content` | Fewer than two blocks were extracted | Thin page; treat the output as a stub |
| `no_content_scope` | No container scored above threshold; fell back to `<body>` | No structural target; filter quality will be lower |

`status` derives from warnings:
- `"empty"` — `empty_content` is set
- `"partial"` — `low_confidence` or `short_content` is set
- `"completed"` — neither of the above

`ambiguous_scope`, `high_link_density`, and `no_content_scope` can appear alongside `"completed"`
if confidence cleared the 0.45 threshold and at least two blocks were extracted.

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

See `examples/` for runnable wrappers: a Claude tool, an OpenAI function, and a Playwright
extraction script.

## Token efficiency

Passing raw page content to an agent is expensive. For a typical 2,000-word blog post:

| Input method | Tokens (approx) | Tool calls | Structured metadata | Citable passages |
|---|---|---|---|---|
| Raw HTML source | 30,000–80,000 | 0 | No | No |
| Browser copy-paste (all visible text) | 5,000–15,000 | 0 | No | No |
| Mantis Markdown | 800–2,500 | 1 | Yes (frontmatter) | Yes (citations) |
| Screenshot — one viewport | 1,000–2,000 | 1 | No | No |
| Screenshot — full page (3–4 captures) | 4,000–8,000 | 3–5 | No | No |

Token counts assume ~4 characters per token. Screenshot figures are per-image vision tokens; on
top of that the model must OCR the text, filter UI chrome, and reconstruct reading order before it
can reason about the content. Exact screenshot costs vary by image dimensions and model.

### Screenshots versus Markdown

When an agent processes a screenshot, the model works from pixel data — inferring layout, reading
text optically, filtering navigation chrome, and reconstructing paragraph order — before it can
answer a question or cite a passage. A single 1280 × 800 viewport costs roughly 1,000–2,000 vision
tokens; a full blog post needs three to five captures. The agent cannot cite paragraphs by position,
and metadata (author, published date, canonical URL) is not visible at all.

Mantis's Markdown path replaces that with a single tool call. The rendered DOM becomes clean
structured text, with a CSS selector on every block for source tracing, frontmatter carrying URL and
confidence, and a budget mode that degrades gracefully when the page exceeds the context window.

### Screenshot-to-Markdown (planned)

A natural extension is the reverse: for screenshots you already have — a phone photo of a document,
a PDF export, or a screen-recording frame — Mantis could accept image data alongside a
caller-supplied vision function and return the same article object as the rest of the API:

```js
// Proposed API — not yet implemented
const article = await Mantis.fromImage(imageData, visionFn, { url });
const markdown = Mantis.toMarkdown(article, { frontmatter: true });
```

The vision function stays in the caller's stack (keeping Mantis dependency-free); Mantis handles
structure, budget, and formatting. Whatever form a page arrives in — live DOM, stored HTML, or a
screenshot — agents get the same clean Markdown output.

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

**Port conflict?** 8787 is the default (same as Cloudflare's `wrangler dev`). If something else
is already using it, pass a different port:

```
PORT=3000 npm run demo
# or
node demo/server.js 3000
```

Then open `http://127.0.0.1:3000` instead. The bookmarklet on that page will point to the
correct port automatically.

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
