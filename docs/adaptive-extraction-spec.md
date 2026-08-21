# Adaptive Extraction — Spec

*Status: phases 1–3 implemented. Core (`mantis.js`): profiler, coverage metric, composite + linklist strategies, quality gate, sparse detection, word-boundary chrome lexicon with dominance override (fixes HN comment trees, GitHub SharedPageLayout, utility-CSS false positives), script-text exclusion, §8 canonical fix. Extension (`capture.js`): DOM-quiet wait + auto-scroll re-capture on lazy-mount suspicion. Feed strategy remains explicit-only by design (thread pages usually want the focused post). Not done: per-site strategy memory. Guiding constraint: **this change must not reduce existing functionality.***

---

## 1. Problem

Mantis today assumes every page fits one model: a single dominant content container (the Readability/arc90 lineage). `findContent()` picks exactly one scope; `blocksFrom()` extracts only inside it; the `<main>`/`body` fallback triggers only when fewer than 2 blocks result.

Observed failure (palantir.com/platforms/ontology, captured via the extension): a marketing landing page composed of many sibling sections of short copy. Result: 8 blocks covering ~4 of many sections, `contentType: "unknown"`, `confidence: 0.68`, `status: "completed"`, **no warnings** — a partial capture that reported itself as successful. Contributing causes:

1. **Single-scope model.** No container dominates on a landing page, so the winning scope is an arbitrary mid-level wrapper; sibling sections outside it are discarded.
2. **Silent partiality.** The quality signals (`confidence`, `warnings`) measure scope *dominance*, not page *coverage*. Nothing measures "how much of the visible page did we capture."
3. **Lazy-mounted content.** The page mounts sections via IntersectionObserver on scroll. The extension captures instantly, so unmounted content never existed in the DOM. (Core library cannot fix this; it is an extension-side readiness problem — see §6.)
4. **Wrong provenance.** Frontmatter `url` prefers the canonical link, which on this page points to a staging URL (`/pt-test/ontology/`). See §8.

Goal: when the default model doesn't fit, Mantis should **profile the page's structure, select an extraction strategy that fits that structure, and use it** — while guaranteeing that pages well-served today produce identical output.

## 2. Non-goals

- Not a verbatim full-page capture mode. Mantis remains a main-content extractor that drops boilerplate; adaptive strategies widen what counts as content, they don't disable chrome filtering.
- No new runtime dependencies; `mantis.js` stays a single zero-dependency ES5-compatible file.
- No LLM-in-the-loop inside the core library. "Understanding the structure" means deterministic DOM profiling. (An agent caller may route on the new diagnostics; that's outside the library.)
- No removal or renaming of any existing API field, option, warning string, or diagnostic.

## 3. Non-regression invariants (acceptance gates)

These are testable, and CI must enforce them:

1. **Fixture gate:** every assertion in `fixtures/expectations.json` passes unchanged. No existing fixture's expected strings change.
2. **Default-path identity:** for every existing fixture, when the profiler classifies the page as article-like (the current model fits), the emitted `article.blocks`, `article.text`, and Markdown body are **byte-identical** to today's output. New diagnostics/frontmatter fields are additive only.
3. **Escalation monotonicity:** an adaptive strategy result is only returned when it beats the default result by a defined quality margin (§5.4). Ties go to the default strategy.
4. **API additivity:** `MantisExtractOptions`, `MantisDiagnostics`, `MantisArticle`, and frontmatter gain fields only. Existing consumers parse unchanged output.
5. **Performance:** `perf.js` median per-pass time regresses by no more than an agreed budget (proposal: ≤ 15%) with the gate green. Profiling must be a single O(nodes) pass, and escalation must short-circuit (default path only) on article-like pages.

## 4. Design overview

Three new components in `mantis.js`, plus extension-side changes:

```
extract(doc, opts)
  │
  ├─ 1. PROFILE      analyzeDocument(doc) → pageProfile        (new, §5.1)
  ├─ 2. DEFAULT RUN  current pipeline, unchanged               (strategy: "article")
  ├─ 3. QUALITY GATE score(result, profile)                    (new, §5.4)
  │      ├─ pass → return default result (+ new diagnostics)
  │      └─ fail →
  ├─ 4. ESCALATE     run next-best strategy from registry      (new, §5.2)
  │      └─ compare by quality margin; keep winner
  └─ 5. ANNOTATE     diagnostics.strategy / .profile / .coverage, warnings
```

The profiler is pure and side-effect-free. Strategies are pure functions `doc → blocks`. The gate is conservative: it only ever *adds* content when the default result is demonstrably poor for the page's shape.

## 5. Core library changes

### 5.1 Page profiler — `analyzeDocument(doc)`

New internal function (optionally exported as `Mantis.analyze` for tooling/debug). One DOM walk collecting:

| Signal | Definition | What it detects |
|---|---|---|
| `visibleTextLength` | chars of visible text in `body`, excluding chrome-flagged subtrees | baseline for coverage |
| `sectionCount` / `sectionTextShare` | top-level `<section>`/`<article>` siblings under main content ancestors; share of visible text inside them | landing/composite pages |
| `paragraphLengthHistogram` | buckets of prose-node lengths | marketing copy (short blurbs) vs article prose |
| `headingDensity` | headings per 1k visible chars | sectioned landing/docs pages |
| `scoreDominance` | `score / (score + nextScore + 1)` from `findContent` | ambiguity of single-scope choice |
| `scopeCoverage` | visible text inside winning scope ÷ `visibleTextLength` | **the key partial-capture signal** |
| `articleSiblings` | count of sibling `<article>`/`role=article` elements with text | feeds/threads |
| `textDivShare` | share of prose in plain `<div>`s (isTextDiv) | app-shell UIs |
| `lazyMountSuspicion` | large `body` scroll area / element count but low `visibleTextLength`, or many empty section containers | content not yet mounted (extension should re-capture after readiness, §6) |

Output: `pageProfile = { archetype, signals, strategyRanking }` where `archetype ∈ "article" | "composite" | "feed" | "app-shell" | "sparse" | "unknown"`, derived from the signals by a small rule table (deterministic, unit-testable — no scoring magic that can't be asserted in tests).

### 5.2 Strategy registry

Each strategy: `{ name, run(doc, options, profile) → { blocks, scope(s), stats } }`. The existing pipeline becomes the `"article"` strategy, **code path untouched**.

New strategies, in priority order:

1. **`composite`** (landing/multi-section pages — the Palantir case). Scope = the union of top-scoring sibling sections: take the winning scope from `findContent`, then expand to its eligible siblings (same parent, same tag/structural signature, non-chrome, non-hidden, text ≥ threshold), and run `blocksFrom` over the minimal common container — typically `<main>` or the sections' shared wrapper — with chrome/hidden/dedup filters unchanged. Document order is preserved by the existing single-walk design. Short-copy handling: within a composite scope, the `minTextLength` filter is relaxed for blocks that sit under a captured heading (a blurb attached to a section heading is content, not noise); the 25-char rule still applies to orphan text.
2. **`feed`** (multiple article siblings — forums, social threads, comment pages). Iterate the sibling `<article>` elements as separate sections instead of letting the article-boundary rule pick one. Each item becomes a section with its own blocks. (The existing boundary rule stays correct for the `article` strategy; `feed` opts out deliberately.)
3. **`sparse`** is *not* an extraction strategy — it produces no alternative run. It annotates `diagnostics.lazyMountSuspicion = true` and a `content_not_mounted` warning so the caller (extension) knows to fix readiness and re-capture rather than accept a thin result.

`feed` can ship in a later phase than `composite` (see §9); the registry exists from day one so adding it is additive.

### 5.3 Coverage metric (new, applies to *all* results)

`coverage = capturedTextChars / visibleTextLength` (visible = not hidden, not chrome-flagged). Computed for every extraction, including the default path. This converts the "silently captured 20% of the page" failure into a number.

- New diagnostic: `diagnostics.coverage` (0–1, rounded).
- New warning: `low_coverage` when `coverage < 0.5` and `visibleTextLength > 1500` (thresholds to be tuned against fixtures; the floor avoids nagging on genuinely small pages).
- Frontmatter gains `coverage:` and `strategy:` lines (additive).

### 5.4 Quality gate and escalation

```
quality(result, profile) =
    w1 * coverage
  + w2 * min(blockCount, 12) / 12
  + w3 * (1 - chromeContamination)     // link density + chrome-signal share of captured blocks
  + w4 * headingStructureBonus         // captured headings ≥ 2 → document has skeleton
```

Escalation rule:

1. Run `article` strategy (today's code). Compute quality.
2. Escalate only if **any** of: `coverage < 0.5` with substantial page text; `status !== "completed"`; `ambiguous_scope` warning and profile archetype ≠ `article`.
3. Run the top-ranked alternative strategy from `profile.strategyRanking`. Compute its quality.
4. Return the alternative **only if** `quality(alt) > quality(default) + margin` (proposal: `margin = 0.1`). Otherwise return the default result. This is the monotonicity invariant.
5. Whichever result is returned, record `diagnostics.strategy`, `diagnostics.strategiesAttempted`, and — if escalation happened but lost — `diagnostics.escalationRejected = true`.

All weights and thresholds are named constants at the top of the strategy module so they are tunable in one place and assertable in tests.

### 5.5 API surface changes (additive only)

```ts
interface MantisExtractOptions {
  // ... existing fields unchanged ...
  strategy?: "auto" | "article" | "composite" | "feed";  // default "auto"
  // "auto" = profile + gate as above. A named strategy forces it (debug/tooling).
}

interface MantisDiagnostics {
  // ... existing fields unchanged ...
  strategy?: string;                 // strategy that produced the result
  strategiesAttempted?: string[];
  escalationRejected?: boolean;
  coverage?: number;                 // 0..1
  archetype?: string;                // profiler classification
  lazyMountSuspicion?: boolean;
}
```

New warning strings (additive): `low_coverage`, `content_not_mounted`. New export (optional but recommended): `Mantis.analyze(doc)` returning `pageProfile`, so the extension and tests can inspect classification without running a full extract.

`fromHTML` inherits all of the above (it calls `extract`). `fromImage` is unaffected.

### 5.6 What explicitly does not change

- `findContent`, `blocksFrom`, scoring weights, chrome lexicons, `minTextLength` default, `maxBlocks` default, dedup, inline runs, table/image passes, `toMarkdown` rendering, `toHTML`, `run()`. The `article` strategy *is* the current pipeline, invoked as today.
- Existing warning strings and their trigger conditions.
- Frontmatter keys emitted today, their order, and their value formats. New keys append at the end.

## 6. Extension changes (companion, separately versioned)

The core library cannot extract content that was never mounted. The extension owns capture readiness:

1. **DOM-quiet wait.** After injection, wait for a mutation-quiet window (e.g., no `MutationObserver` activity for ~400 ms, hard cap ~2 s) before extracting. Cheap, always on, fixes most hydration races.
2. **Auto-scroll pass (opt-in).** On `content_not_mounted` / `lazyMountSuspicion`, or via a setting: smooth-scroll to `scrollHeight` in steps, wait for quiet, scroll back to the original position, then re-extract. Restores scroll position so the UX is a brief page flicker at worst. Off by default in v1 of the feature; promote to default after real-page validation.
3. **Strategy memory.** `chrome.storage.local` map of `origin (+ optional path prefix) → { strategy, coverage, timestamp }`, written only when an escalated strategy won. On revisit, pass `strategy` from memory as a *hint* — the gate still runs and can reject it, so a site redesign can't lock in a bad strategy. Include a "reset site memory" affordance in the panel.
4. **Panel surfacing.** Footer line already shows warnings; add `strategy` and `coverage` to the stats line, and a distinct state for `content_not_mounted` ("page still loading — recapture?") with a one-click recapture button.

## 7. Testing plan

New fixtures (hand-built, following existing conventions in `fixtures/`):

- `landing-sections.html` — Palantir-style: hero + 8 sibling sections of heading + short blurb + CTA link, nav/footer chrome. Expectations: all section headings and blurbs captured; nav/footer excluded.
- `landing-short-copy.html` — same shape with sub-25-char blurbs under headings (tests the heading-attached relaxation).
- `feed-articles.html` — 5 sibling `<article>` items. Expectations: all 5 captured as sections, in order.
- `lazy-sparse.html` — large DOM, little text, empty section shells. Expectations: `content_not_mounted` warning, `lazyMountSuspicion: true`.
- `article-control.html` — a plain long article. Expectations: **byte-identical** blocks/text vs. current release (pins invariant 2).

Harness changes:

- `benchmark.js` / `expectations.json`: add per-fixture metric assertions — minimum `coverage`, expected `strategy`, expected `archetype` — alongside existing string-presence assertions.
- `test.js`: unit tests for the profiler rule table (each archetype), the gate (escalate, reject, tie→default), strategy forcing via options, and additivity of diagnostics/frontmatter.
- `perf.js`: run as today; record before/after medians in the PR.
- Real-page validation set (manual, pre-release): ~15 live URLs spanning articles, docs, landing pages, forums, and the original Palantir page; confirm no article page changes output and landing/feed pages improve.

## 8. Related fix (same release, separately revertable)

**Canonical URL provenance.** Frontmatter `url` currently emits `canonicalUrl || url`, which recorded a staging URL (`/pt-test/ontology/`) for the Palantir capture. Change: frontmatter `url` is always the actual page URL; add a separate `canonical:` line when it differs. `contentHash` input switches to the actual URL. This is a deliberate output change (values, not schema) — flagged here because it alters existing frontmatter values on pages whose canonical differs from the address; it fixes provenance, which is the point of the field. If we want zero output change in this release, defer to the next minor version.

## 9. Phasing

| Phase | Deliverable | Risk |
|---|---|---|
| 1 | Profiler + coverage diagnostic + `low_coverage`/`content_not_mounted` warnings + frontmatter/diagnostics additions. **No strategy switching** — observe-only. | Near zero: additive signals, default path untouched. |
| 2 | `composite` strategy + quality gate + escalation. Fixture and real-page gates green. | Moderate: first behavior-changing phase; protected by monotonicity gate and byte-identity tests. |
| 3 | Extension: DOM-quiet wait, panel surfacing, recapture button; then auto-scroll + strategy memory. | UX risk only; core untouched. |
| 4 | `feed` strategy; threshold tuning from real-page corpus; canonical fix if deferred. | Low; registry makes it additive. |

Each phase ships behind the same non-regression gates; phases 2+ can be disabled via `strategy: "article"` if a regression escapes.

## 10. Open questions

1. Quality-gate weights/margin (§5.4) — initial values need calibration against the fixture corpus; expect one tuning pass.
2. `low_coverage` threshold (0.5 / 1500 chars) — validate against docs pages, which legitimately have nav-heavy bodies.
3. Composite sibling-eligibility rule — "same parent + same tag" may be too strict for pages mixing `<section>` and `<div>` wrappers; consider structural-signature matching (child-tag multiset) instead. Decide during phase 2 with the landing fixtures.
4. Should `Mantis.analyze` be public API (committed surface) or internal with a debug flag? Leaning public — the extension's strategy memory and panel want it.
5. Auto-scroll default-on criteria: what real-page evidence is sufficient to flip the default?
