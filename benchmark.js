"use strict";

/**
 * Fidelity gate + extraction scorecard.
 *
 * Two instruments over one fixture corpus (fixtures/expectations.json):
 *
 * 1. Fidelity gate (pass/fail): expected/forbidden strings, metadata,
 *    markdown, occurrence counts, warnings, and diagnostics assertions.
 * 2. Scorecard (measured): word-level precision / recall / F1 of the
 *    extracted content against per-fixture gold annotations (CSS selectors
 *    over the fixture DOM), plus extraction latency and confidence. Metrics
 *    are reported per fixture and aggregated per page type, so regressions
 *    on non-article pages are visible instead of averaged away.
 *
 * Each gold-annotated fixture also gates on `word-level F1 >= minF1`
 * (fixture `gold.minF1`, default DEFAULT_MIN_F1), so the scorecard is a
 * regression instrument, not just a report.
 *
 * Usage:
 *   node benchmark.js          # human-readable gate + scorecard
 *   node benchmark.js --json   # machine-readable scorecard JSON on stdout
 */

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const Mantis = require("./mantis.js");

const fixtureDir = path.join(__dirname, "fixtures");
const fixtures = JSON.parse(fs.readFileSync(path.join(fixtureDir, "expectations.json"), "utf8"));
const jsonOutput = process.argv.includes("--json");

const DEFAULT_MIN_F1 = 0.98;
const LATENCY_RUNS = 12;

function occurrences(text, needle) {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count++;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function parseFixture(html) {
  return new JSDOM(html, { pretendToBeVisual: true }).window.document;
}

// Word tokens for bag-of-words scoring. Lowercased alphanumeric runs; applied
// identically to gold and extracted text, so the exact tokenization is not
// load-bearing as long as it is consistent.
function tokens(text) {
  return String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
}

function bag(words) {
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  return counts;
}

// Word-level precision/recall/F1 via multiset intersection.
function wordScores(extractedWords, goldWords) {
  const extracted = bag(extractedWords);
  const gold = bag(goldWords);
  let truePositives = 0;
  for (const [word, count] of extracted) {
    truePositives += Math.min(count, gold.get(word) || 0);
  }
  const precision = extractedWords.length ? truePositives / extractedWords.length : goldWords.length ? 0 : 1;
  const recall = goldWords.length ? truePositives / goldWords.length : extractedWords.length ? 0 : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

// Text of a node with whitespace at element boundaries (textContent would
// concatenate adjacent table cells like "nameDescription" into one token).
function nodeText(node) {
  if (node.nodeType === 3) return node.nodeValue;
  return Array.from(node.childNodes, nodeText).join(" ");
}

// Gold text: visible text of `gold.include` selector matches (nested matches
// deduplicated), after removing `gold.exclude` matches from the document.
function goldText(html, gold) {
  const doc = parseFixture(html);
  for (const selector of gold.exclude || []) {
    for (const node of doc.querySelectorAll(selector)) node.remove();
  }
  const matched = [];
  for (const selector of gold.include) {
    for (const node of doc.querySelectorAll(selector)) {
      if (!matched.includes(node)) matched.push(node);
    }
  }
  const roots = matched.filter((node) => !matched.some((other) => other !== node && other.contains(node)));
  return roots.map(nodeText).join("\n");
}

// The content an agent receives: block text plus extracted table content
// (tables live on their own pass, not in the block stream).
function extractedText(article) {
  const parts = article.blocks.map((block) => block.text);
  for (const table of article.tables) {
    if (table.caption) parts.push(table.caption);
    parts.push(table.headers.join(" "));
    for (const row of table.rows) parts.push(row.join(" "));
  }
  return parts.join("\n");
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measureLatency(html) {
  const docs = [];
  for (let i = 0; i < LATENCY_RUNS + 3; i++) docs.push(parseFixture(html));
  const samples = [];
  for (let i = 0; i < docs.length; i++) {
    const start = process.hrtime.bigint();
    Mantis.extract(docs[i]);
    const micros = Number(process.hrtime.bigint() - start) / 1000;
    if (i >= 3) samples.push(micros); // skip warmup rounds
  }
  return median(samples);
}

function scoreFixture(fixture) {
  const html = fs.readFileSync(path.join(fixtureDir, fixture.file), "utf8");
  const actual = Mantis.extract(parseFixture(html));
  const body = actual.paragraphs.join("\n");
  const checks = [];

  for (const text of fixture.expected) {
    checks.push({ ok: body.includes(text), label: `includes ${text}` });
  }
  for (const text of fixture.forbidden) {
    checks.push({ ok: !body.includes(text), label: `excludes ${text}` });
  }
  for (const [key, value] of Object.entries(fixture.metadata || {})) {
    checks.push({ ok: actual[key] === value, label: `${key} is ${value}` });
  }
  for (const warning of fixture.warnings || []) {
    checks.push({ ok: actual.warnings.includes(warning), label: `warns ${warning}` });
  }
  if (fixture.markdown) {
    const markdown = Mantis.toMarkdown(actual);
    for (const text of fixture.markdown) {
      checks.push({ ok: markdown.includes(text), label: `markdown includes ${JSON.stringify(text)}` });
    }
  }
  for (const [text, count] of Object.entries(fixture.counts || {})) {
    checks.push({ ok: occurrences(body, text) === count, label: `${text} occurs ${count} time(s)` });
  }
  if (fixture.diagnostics) {
    if (fixture.diagnostics.scopeTag) {
      checks.push({
        ok: actual.diagnostics && actual.diagnostics.scopeTag === fixture.diagnostics.scopeTag,
        label: `scope tag is ${fixture.diagnostics.scopeTag}`
      });
    }
    if (fixture.diagnostics.minConfidence !== undefined) {
      checks.push({
        ok: actual.confidence >= fixture.diagnostics.minConfidence,
        label: `confidence >= ${fixture.diagnostics.minConfidence}`
      });
    }
    if (fixture.diagnostics.strategy) {
      checks.push({
        ok: actual.diagnostics && actual.diagnostics.strategy === fixture.diagnostics.strategy,
        label: `strategy is ${fixture.diagnostics.strategy}`
      });
    }
    if (fixture.diagnostics.archetype) {
      checks.push({
        ok: actual.diagnostics && actual.diagnostics.archetype === fixture.diagnostics.archetype,
        label: `archetype is ${fixture.diagnostics.archetype}`
      });
    }
    if (fixture.diagnostics.minCoverage !== undefined) {
      checks.push({
        ok: actual.diagnostics && (actual.diagnostics.coverage || 0) >= fixture.diagnostics.minCoverage,
        label: `coverage >= ${fixture.diagnostics.minCoverage}`
      });
    }
  }

  let metrics = null;
  if (fixture.gold) {
    const scores = wordScores(tokens(extractedText(actual)), tokens(goldText(html, fixture.gold)));
    const minF1 = fixture.gold.minF1 !== undefined ? fixture.gold.minF1 : DEFAULT_MIN_F1;
    checks.push({
      ok: scores.f1 >= minF1,
      label: `word-level F1 ${scores.f1.toFixed(3)} >= ${minF1}`
    });
    metrics = {
      pageType: fixture.pageType || "unknown",
      precision: scores.precision,
      recall: scores.recall,
      f1: scores.f1,
      confidence: actual.confidence,
      strategy: (actual.diagnostics && actual.diagnostics.strategy) || "article",
      latencyMicros: measureLatency(html)
    };
  }

  const passed = checks.filter((check) => check.ok).length;
  return { name: fixture.name, file: fixture.file, passed, total: checks.length, checks, metrics };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildScorecard(results) {
  const scored = results.filter((result) => result.metrics);
  if (!scored.length) return null;
  const byType = new Map();
  for (const result of scored) {
    const type = result.metrics.pageType;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(result.metrics);
  }
  const pageTypes = {};
  for (const [type, metrics] of [...byType.entries()].sort()) {
    pageTypes[type] = {
      fixtures: metrics.length,
      precision: mean(metrics.map((m) => m.precision)),
      recall: mean(metrics.map((m) => m.recall)),
      f1: mean(metrics.map((m) => m.f1))
    };
  }
  return {
    fixtures: scored.map((result) => ({
      name: result.name,
      file: result.file,
      pageType: result.metrics.pageType,
      strategy: result.metrics.strategy,
      precision: result.metrics.precision,
      recall: result.metrics.recall,
      f1: result.metrics.f1,
      confidence: result.metrics.confidence,
      latencyMicros: result.metrics.latencyMicros
    })),
    pageTypes,
    overall: {
      fixtures: scored.length,
      precision: mean(scored.map((r) => r.metrics.precision)),
      recall: mean(scored.map((r) => r.metrics.recall)),
      f1: mean(scored.map((r) => r.metrics.f1)),
      noiseRate: 1 - mean(scored.map((r) => r.metrics.precision)),
      medianLatencyMicros: median(scored.map((r) => r.metrics.latencyMicros))
    }
  };
}

function printScorecard(scorecard) {
  const pad = (value, width) => String(value).padEnd(width);
  const num = (value) => value.toFixed(3);
  console.log("\nscorecard (word-level, vs gold annotations)");
  console.log(`  ${pad("fixture", 30)} ${pad("type", 10)} ${pad("strategy", 10)} ${pad("P", 6)} ${pad("R", 6)} ${pad("F1", 6)} ${pad("conf", 6)} us`);
  for (const row of scorecard.fixtures) {
    console.log(`  ${pad(row.file.replace(/\.html$/, ""), 30)} ${pad(row.pageType, 10)} ${pad(row.strategy, 10)} ${pad(num(row.precision), 6)} ${pad(num(row.recall), 6)} ${pad(num(row.f1), 6)} ${pad(num(row.confidence), 6)} ${Math.round(row.latencyMicros)}`);
  }
  console.log("\n  per page type (mean):");
  for (const [type, stats] of Object.entries(scorecard.pageTypes)) {
    console.log(`  ${pad(type, 30)} ${pad("n=" + stats.fixtures, 10)} ${pad("", 10)} ${pad(num(stats.precision), 6)} ${pad(num(stats.recall), 6)} ${num(stats.f1)}`);
  }
  const overall = scorecard.overall;
  console.log(`\n  overall: mean F1 ${num(overall.f1)} (P ${num(overall.precision)}, R ${num(overall.recall)}) | noise rate ${num(overall.noiseRate)} | median extract ${Math.round(overall.medianLatencyMicros)}us | ${overall.fixtures} fixtures`);
}

const results = fixtures.map(scoreFixture);
const passed = results.reduce((sum, result) => sum + result.passed, 0);
const total = results.reduce((sum, result) => sum + result.total, 0);
const scorecard = buildScorecard(results);

if (jsonOutput) {
  console.log(JSON.stringify({ gate: { passed, total }, scorecard }, null, 2));
} else {
  for (const result of results) {
    console.log(`${result.name}: ${result.passed}/${result.total}`);
    for (const check of result.checks) {
      console.log(`  ${check.ok ? "ok" : "miss"} ${check.label}`);
    }
  }
  console.log(`\nscore: ${passed}/${total} (${(passed / total * 100).toFixed(1)}%)`);
  if (scorecard) printScorecard(scorecard);
}
if (passed !== total) process.exitCode = 1;
