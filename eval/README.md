# Mantis eval harness

This is the instrument the roadmap calls **Phase 0**: a reproducible, offline
scorecard you own, built *before* the heuristics so every later change is
measured rather than asserted. It fetches nothing and depends only on `jsdom`.

```
npm run eval            # scorecard
npm run eval -- --json  # machine-readable dump
```

## What it measures

For each page in the corpus, for Mantis and every installed baseline:

- **Word-level precision / recall / F1** — multiset word overlap between the
  extracted text and hand-authored ground truth (`truth`). Broken out **per page
  type**, because an aggregate hides the forum/docs/product cliff that article-
  tuned extractors fall off. This is the headline number.
- **Noise rejection** — the fraction of each page's `forbidden` phrases the
  extractor correctly kept out.
- **Confidence calibration** (Mantis only) — Expected Calibration Error (ECE),
  Brier score, and a reliability table comparing predicted `confidence` against
  observed accuracy (a page counts as "ok" when its F1 ≥ 0.8). A well-calibrated
  0.8 should be right ~80% of the time.
- **Latency** — median wall-clock per page over repeated runs.

## Baselines

Baselines are optional and loaded only if installed:

```
npm i -D @mozilla/readability defuddle
```

When present they are scored alongside Mantis so every change reports a delta.
When absent the harness still runs and says so. **Trafilatura** (the Python bar
to beat) is not wired in yet — it needs a Python toolchain in CI; see the
roadmap. The current numbers are *only* against the JS baselines.

## The corpus

`corpus.json` lists entries of `{ name, file, type, truth, forbidden }`. Each
`file` is a saved rendered-DOM snapshot; `truth` is the full main-content text
that *should* survive extraction; `forbidden` is noise that must not.

## Honest limits (read before trusting the numbers)

- **The corpus is small (15 pages) and synthetic.** The
  article/blog/docs/forum/newsletter/recipe entries are reused test fixtures
  authored against Mantis's own contract; the product/spa/amp/paywall entries
  are adversarial fixtures authored to stress known failure modes. **None are
  real wild-web captures.** So the current Mantis-vs-baseline gap is favorable
  and not yet representative of the wild web — treat today's scorecard as proof
  the *instrument* works, not as a competitive claim.
- **The corpus does not yet discriminate at the top end.** Mantis scores F1 1.0
  on most entries, so the harness can't currently tell "great" from "perfect."
  Real, messy pages are what will create spread.
- **Calibration needs volume.** ECE/Brier over 15 points are directional only.
  That said, the instrument already caught a real defect: the product page
  scores `confidence` ~0.52 at F1 1.0 (badly under-confident on sparse prose),
  which is exactly the kind of failure the planned calibrated `pOk` exists to fix.

## Growing the corpus (the real Phase 0 work, still open)

Type coverage now spans all ten buckets, but every snapshot is synthetic. The
remaining work is real rendered-DOM captures. Two things stand between here and
there:

**1. Network egress.** Outbound fetches obey this environment's egress
allowlist, so by default the capture script can't reach real hosts (you'll see
"Host not in allowlist"). Add the target domains to the environment's egress
settings first — see the network-policy docs:
https://code.claude.com/docs/en/claude-code-on-the-web

**2. A browser.** Captures must be *rendered* HTML (post-JS), so `npm run
eval:capture` drives headless Chromium via Playwright, installed ad hoc (same as
the browser smoke test):

```
npm i --no-save playwright
npx playwright install --with-deps chromium
```

Then list the pages in `eval/urls.json` (copy `eval/urls.example.json`) and run:

```
npm run eval:capture            # reads eval/urls.json
npm run eval:capture -- --url https://site/post --type article --name "a post"
```

It saves rendered HTML into `eval/snapshots/` and prints corpus-entry stubs.
Fill each stub's `truth` (main-content text that should survive) and `forbidden`
(noise that must not), paste into `corpus.json`, and re-run `npm run eval`. The
harness prefers a captured `eval/snapshots/<file>` over a synthetic
`fixtures/<file>` of the same name, so real pages can supersede stand-ins.

Aim for ~50/type, then ~150. Until the corpus is real and diverse,
"best-in-class" stays a hypothesis the instrument is built to test — not a
result.
