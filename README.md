# mantis

Mantis extracts readable content from the current browser DOM.

It is a small, dependency-free JavaScript library for bookmarklets, browser extensions, and client
side capture tools.

## What it does

- Finds the main readable container in a document.
- Returns title, byline, hero image, paragraphs, confidence, and diagnostics.
- Filters navigation, comments, ads, hidden DOM, and repeated responsive content.
- Runs in the page without fetching the URL again.

## API

Node:

```js
const Mantis = require("mantis");
const article = Mantis.extract(document);
```

Browser:

```js
const article = Mantis.extract(document);
```

Result shape:

```js
{
  title: "Example title",
  byline: "Example author",
  hero: "https://example.com/image.jpg",
  paragraphs: ["First paragraph", "Second paragraph"],
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

`Mantis.run(scriptElement)` is an optional bookmarklet helper. It extracts the page, posts the
result to `{script origin}/api/crates`, shows a small confirmation, and falls back to `/save` if the
post is blocked.

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
```

The benchmark uses fixed HTML snapshots in `fixtures/` and should stay green when extraction
behavior changes.

## License

MIT
