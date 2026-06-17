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

- **The corpus is small (11 pages) and synthetic.** The snapshots are reused
  test fixtures, and they were authored against Mantis's own contract — so the
  current Mantis-vs-baseline gap is **favorable to Mantis and not yet
  representative of the wild web.** Treat today's scorecard as proof the
  *instrument* works, not as a competitive claim.
- **Calibration needs volume.** ECE/Brier over 11 points are directional only.
  The harness is wired correctly; the numbers get meaningful as the corpus grows.
- **Coverage gaps.** No `product`, `spa`, `amp`, or `paywall` pages yet
  (reported as gaps at the bottom of the scorecard).

## Growing the corpus (the real Phase 0 work)

This is the next task and it's deliberately left open:

1. Capture real rendered-DOM snapshots across every page type in `gaps` plus
   more of the existing types — aim for ~50/type, then ~150.
2. For each, save the HTML into `fixtures/` (or a future `eval/snapshots/`) and
   add an entry with hand-authored `truth` + `forbidden`.
3. Re-run `npm run eval`. The per-type F1 and the calibration curve will start
   reflecting the wild web rather than the fixtures.

Until the corpus is real and diverse, "best-in-class" stays a hypothesis the
instrument is built to test — not a result.
