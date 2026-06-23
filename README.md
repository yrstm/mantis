# mantis

Mantis turns the page a browser actually rendered into structured article data and clean Markdown
for agents.

It runs over the live DOM, not a second server-side fetch. That means it can capture pages after
client-side rendering, logged-in state, and content the user can already see. The output is compact
Markdown plus metadata, citations, source selectors, confidence, warnings, and hashes.

One file. Zero runtime dependencies. No network requests.

```js
const article = Mantis.extract(document);
const markdown = Mantis.toMarkdown(article, {
  frontmatter: true,
  maxChars: 12000,
  budget: "outline"
});
```

## Why agents use it

Agents need page context that is cheap, ordered, and citable. Browser copy-paste gives them chrome
and loose text. Raw HTML gives them too much markup. Screenshots make the model OCR and reconstruct
reading order before it can reason.

Mantis keeps the useful parts:

| Method | Approx tokens | What the agent gets |
|---|---:|---|
| Browser copy from a noisy docs page | 221 | Visible text mixed with nav, sidebars, footer, no links |
| Mantis Markdown with frontmatter | 151 | Main content, title, author, canonical URL, links, code, confidence |
| Raw page HTML | 1,000+ | Markup, scripts, chrome, duplicated responsive content |

Example Mantis output:

````md
---
title: "Pricing API Guide"
byline: "Dana Lee"
site: "Acme Docs"
url: "https://docs.example.com/pricing-api"
contentType: "article"
contentHash: "b8546214"
confidence: 0.84
---

# Pricing API Guide

Dana Lee

The Pricing API returns the current plan, metered usage, and renewal date for an account.

Requests must include a bearer token with the `billing:read` scope.

## Example request

```
GET /v1/accounts/acme/pricing
Authorization: Bearer example_token
```

See the [error reference](https://docs.example.com/api/errors) for retry behavior.
````

## What it returns

`Mantis.extract(document)` returns a stable article object:

- Metadata: `title`, `byline`, `siteName`, `hero`, `url`, `canonicalUrl`, `language`,
  `publishedAt`, `modifiedAt`
- Content: `text`, `paragraphs`, `blocks`, `sections`, `links`, `images`, `tables`, `selection`
- Agent support: `citations`, `status`, `warnings`, `contentType`, `contentHash`, `textHash`
- Debugging: `confidence`, `diagnostics`

Blocks preserve headings, paragraphs, blockquotes, code blocks, list items, inline links, bold,
italic, inline code, source selectors, and text offsets.

## API

Browser:

```js
const article = Mantis.extract(document, {
  maxBlocks: 150,
  minTextLength: 25,
  includeLinks: true,
  includeImages: true,
  includeTables: true
});

const markdown = Mantis.toMarkdown(article, {
  frontmatter: true,
  images: "alt",
  tables: true,
  maxChars: 8000,
  budget: "outline"
});

const html = Mantis.toHTML(article);

Mantis.run({
  endpoint: "http://127.0.0.1:4111/capture",
  format: "bundle"
});
```

Node, with your own DOM parser:

```js
const { JSDOM } = require("jsdom");
const Mantis = require("mantis");

const article = Mantis.fromHTML(html, {
  url: "https://example.com/post",
  DOMParser: new JSDOM("").window.DOMParser
});
```

`toMarkdown()` options:

| Option | Values |
|---|---|
| `frontmatter` | `true` adds title, byline, URL, content type, confidence, hashes, warnings |
| `images` | `"omit"` default, `"alt"` for `![alt](src)`, `"links"` for `[alt](src)` |
| `tables` | `true` default; renders GFM tables |
| `maxChars` | Cuts at block boundaries, never mid-block |
| `budget` | `"cut"` default, or `"outline"` to keep headings and section leads first |

`extract()` options:

| Option | Default |
|---|---:|
| `maxBlocks` | `150` |
| `minTextLength` | `25`; use `0` to keep short blocks |
| `includeLinks` | `true` |
| `includeImages` | `true` |
| `includeTables` | `true` |

Hard caps: 200 links, 100 images, 50 tables. `selection` is only captured in a live browser
context; it is always `null` in `fromHTML()`.

`run()` options:

| Option | Default |
|---|---|
| `endpoint` | none; Markdown is copied locally or shown in an in-page panel |
| `fallbackUrl` | none; opened if a configured POST fails |
| `format` | `"bundle"`: metadata, Markdown, and the full article object |
| `markdown` | `toMarkdown()` options for the Markdown in the capture |
| `keepalive` | `false` |

## Warnings

`article.status` is `"completed"`, `"partial"`, or `"empty"`. `article.warnings` explains weak
captures:

| Warning | Meaning |
|---|---|
| `low_confidence` | Container score was weak |
| `ambiguous_scope` | Top candidate containers were close |
| `high_link_density` | Scope looks more like navigation than prose |
| `empty_content` | No readable blocks were extracted |
| `short_content` | Fewer than two blocks were extracted |
| `no_content_scope` | No strong content container was found; body fallback was used |

Treat `confidence` and `diagnostics` as debugging signals. They can change between releases.

## Use with browser agents

If an agent already drives Playwright or Puppeteer, Mantis should run after the page has rendered:

```js
await page.addScriptTag({ path: require.resolve("mantis") });

const result = await page.evaluate(() => {
  const article = Mantis.extract(document);
  return {
    markdown: Mantis.toMarkdown(article, {
      frontmatter: true,
      maxChars: 12000,
      budget: "outline"
    }),
    status: article.status,
    warnings: article.warnings,
    confidence: article.confidence,
    citations: article.citations
  };
});
```

See `examples/` for runnable wrappers: a Claude tool, an OpenAI function, and a Playwright
extraction script.

## Demo

```sh
npm run demo
```

Open `http://127.0.0.1:8787`. The page has two capture paths:

- Bookmarklet: drag **Capture agent Markdown** to your bookmarks bar, then click it on a page.
- Paste fallback: run the one-line snippet on a page, paste the rendered HTML blob, and convert it.

The bookmarklet is convenient on permissive pages, but strict Content-Security-Policy can block
script injection. The paste fallback uses the same engine through `Mantis.fromHTML()`.

Nothing is uploaded anywhere. The demo server only serves `demo/index.html`, `demo/overlay.js`, and
your local `mantis.js`.

Port conflict:

```sh
PORT=3000 npm run demo
# or
node demo/server.js 3000
```

## Extension

The repo can be loaded directly as an unpacked Chrome/Chromium MV3 extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this repo.
4. Click the Mantis toolbar action on any `http` or `https` page.

The action injects `mantis.js` and `extension/capture.js` into the active tab, extracts the rendered
DOM, copies Markdown to the clipboard, and shows an in-page panel with the capture. It uses
`activeTab`, so it does not request broad host permissions up front.

This is the preferred live-page capture path for strict CSP sites. Extension content scripts run as
extension code instead of bookmarklet code loaded by the page.

## Bookmarklet

```js
javascript:(function(){
  var s=document.createElement('script');
  s.src='https://YOUR-HOST/mantis.js?t='+Date.now();
  s.setAttribute('data-mantis-run','1');
  s.onerror=function(){/* show your fallback */};
  (document.body||document.documentElement).appendChild(s);
})();
```

The bookmarklet path is a convenience layer. For strict CSP sites, use an extension/content-script
integration or the paste fallback.

By default, `Mantis.run()` does not upload anything; it copies Markdown locally or shows an in-page
copy panel. To send captures to an agent or local service, configure a destination:

```js
javascript:(function(){
  var s=document.createElement('script');
  s.src='https://YOUR-HOST/mantis.js?t='+Date.now();
  s.setAttribute('data-mantis-run','1');
  s.setAttribute('data-mantis-endpoint','http://127.0.0.1:4111/capture');
  s.setAttribute('data-mantis-format','bundle');
  (document.body||document.documentElement).appendChild(s);
})();
```

Relative `data-mantis-endpoint` and `data-mantis-fallback-url` values resolve against the script
URL. The POST body is JSON. `format: "bundle"` sends metadata, Markdown, and the full article;
`"markdown"` sends metadata plus Markdown; `"article"` sends only the article object.

## Screenshot-to-Markdown (planned)

A natural extension is the reverse: for screenshots you already have, Mantis could accept image
data alongside a caller-supplied vision function and return the same article object as the rest of
the API:

```js
// Proposed API - not yet implemented
const article = await Mantis.fromImage(imageData, visionFn, { url });
const markdown = Mantis.toMarkdown(article, { frontmatter: true });
```

The vision function stays in the caller's stack, keeping Mantis dependency-free. Mantis would handle
structure, budget, formatting, hashes, and warnings so agents receive the same shape from live DOM,
stored HTML, or images.

## Development

```sh
npm install
npm test
npm run benchmark
npm run perf
```

`npm run test:browser` runs the demo in real Chromium. Install Playwright locally first; see
`demo/browser-test.js`.

## License

MIT
