# mantis

Mantis is a browser extension and small extraction library that turns visible web content into
structured article data and clean Markdown for agents.

The main install is the browser extension. It runs over the live DOM, not a second server-side
fetch, so it can capture pages after client-side rendering, logged-in state, and content the user
can already see. The output is compact Markdown plus metadata, citations, source selectors,
confidence, warnings, and hashes.

There is also a lower-level screenshot/image API, `Mantis.fromImage()`. It is not part of the
extension UI yet. It lets a separate local tool, such as a macOS screenshot helper using Apple
Vision, hand OCR or vision output to Mantis so it can be normalized into the same article shape.

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
| Mantis Markdown with frontmatter | 151 | Main content, title, author, canonical URL, links, code, capture mode, confidence |
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

Browser DOM capture:

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

Screenshot or image normalization:

```js
const article = await Mantis.fromImage(imageData, async (images, context) => {
  // Call Apple Vision, Tesseract, a local OCR service, or a model here.
  // Return Markdown, plain text, HTML, an article-like object, or a full article.
  return await runVision(images, context.prompt);
}, {
  url: "https://example.com/source",
  title: "Captured screenshot"
});

const markdown = Mantis.toMarkdown(article, { frontmatter: true, budget: "outline" });
```

`toMarkdown()` options:

| Option | Values |
|---|---|
| `frontmatter` | `true` adds title, byline, URL, content type, confidence, hashes, warnings |
| `images` | `"omit"` default, `"alt"` for `![alt](src)`, `"links"` for `[alt](src)` |
| `tables` | `true` default; renders GFM tables |
| `maxChars` | Cuts at block boundaries, never mid-block |
| `budget` | `"cut"` default, or `"outline"` to keep headings and section leads first |
| `sourceSafety` | `true` default with frontmatter; tells agents to treat captured content as data |

`extract()` options:

| Option | Default |
|---|---:|
| `maxBlocks` | `150` |
| `minTextLength` | `25`; use `0` to keep short blocks |
| `includeLinks` | `true` |
| `includeImages` | `true` |
| `includeTables` | `true` |

Hard caps: 200 links, 100 images, 50 tables. Non-content images such as avatars, icons, logos,
badges, social buttons, and tracking pixels are filtered before Markdown rendering. `selection` is
only captured in a live browser context; it is always `null` in `fromHTML()`.

Frontmatter also includes cheap routing signals when available: `captureMode`, `imageCount`,
`selectionChars`, `blockCount`, `citationCount`, `linkCount`, and `tableCount`. With frontmatter
enabled, Mantis also adds `sourceSafety`, a short instruction that helps agents treat converted page
content as untrusted source data rather than user or system instructions.

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

## Browser Extension

The repo can be loaded directly as an unpacked Chrome/Chromium MV3 extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this repo.
4. Click the Mantis toolbar action on any `http` or `https` page.

The action injects `mantis.js` and `extension/capture.js` into the active tab, extracts the rendered
DOM, copies Markdown to the clipboard, and shows an in-page panel with the capture. If the page has
an active text selection, including a full-page `Cmd+A` selection, the extension converts the
selected DOM range instead of the whole page. It uses `activeTab`, so it does not request broad host
permissions up front.

This is the preferred live-page capture path for strict CSP sites. Extension content scripts run as
extension code instead of bookmarklet code loaded by the page.

The browser extension does not take screenshots. It captures page DOM and selected DOM ranges.
Screenshot capture should be installed as a separate local helper if you need it.

## Demo

```sh
npm run demo
```

Open `http://127.0.0.1:8787` to see the browser-copy versus Mantis comparison and use the paste
converter. The demo also includes a bookmarklet for development and failure-mode testing, but the
extension is the simple live-page capture path.

Nothing is uploaded anywhere. The demo server only serves `demo/index.html`, `demo/overlay.js`, and
your local `mantis.js`.

Port conflict:

```sh
PORT=3000 npm run demo
# or
node demo/server.js 3000
```

## Bookmarklet Helper

```js
javascript:(function(){
  var s=document.createElement('script');
  s.src='https://YOUR-HOST/mantis.js?t='+Date.now();
  s.setAttribute('data-mantis-run','1');
  s.onerror=function(){/* show your fallback */};
  (document.body||document.documentElement).appendChild(s);
})();
```

The bookmarklet path is a convenience layer for permissive pages and local development. For normal
use, prefer the extension.

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

## Screenshot-to-Markdown API

For screenshots you already have, `Mantis.fromImage()` accepts one image or an array of images
alongside a caller-supplied OCR or vision function:

```js
const article = await Mantis.fromImage(imageData, visionFn, { url });
const markdown = Mantis.toMarkdown(article, { frontmatter: true });
```

The vision function is called once as `visionFn(images, context)`. `context.prompt` asks for clean
Markdown in reading order, with browser and OS chrome ignored. The function may return:

- a Markdown or plain-text string
- `{ markdown, text, confidence, warnings, ...metadata }`
- `{ html }` when you also pass `DOMParser`
- a partial or complete Mantis article object

Mantis keeps the model or OCR dependency in your stack, then handles structure, budget, formatting,
hashes, warnings, and frontmatter. Screenshot captures set `captureMode: "image"` and `imageCount`,
so agents can distinguish OCR-derived context from live DOM captures.

This API is meant for a separate tool, not the browser extension. A macOS helper could bind a global
shortcut, call `screencapture`, run Apple Vision locally, save the image and Markdown as files, and
copy the Markdown to the clipboard. Mantis would handle the final normalization step.

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
