"use strict";

/*
 * Mantis eval harness (Phase 0 instrument).
 *
 * Runs Mantis — and any baselines that happen to be installed — over the
 * offline corpus and prints a per-page-type scorecard:
 *
 *   - word-level precision / recall / F1 against hand-authored ground truth
 *   - noise rejection: fraction of `forbidden` strings kept out
 *   - confidence calibration: ECE, Brier, and a reliability table
 *   - latency: median wall-clock per page
 *
 * It deliberately fetches nothing and depends only on jsdom (already a dev
 * dependency). Baselines are optional: if `@mozilla/readability` or `defuddle`
 * are installed they are scored alongside Mantis so every change reports a
 * delta; if they are absent the harness still runs and says so.
 *
 *   npm run eval            full scorecard
 *   npm run eval -- --json  machine-readable dump
 */

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { JSDOM, VirtualConsole } = require("jsdom");
const Mantis = require("../mantis.js");

// Baselines run third-party code against jsdom; keep their page-script noise
// (unsupported selectors etc.) out of the scorecard.
const quietConsole = new VirtualConsole();

const fixtureDir = path.join(__dirname, "..", "fixtures");
const snapshotDir = path.join(__dirname, "snapshots");
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus.json"), "utf8"));

// captured real snapshots live in eval/snapshots/; synthetic fixtures in
// fixtures/. Prefer a captured snapshot when both exist.
function resolveSnapshot(file) {
  const captured = path.join(snapshotDir, file);
  if (fs.existsSync(captured)) return captured;
  return path.join(fixtureDir, file);
}

const OK_F1 = 0.8;        // an extraction at/above this F1 is "acceptable" (the label calibration predicts)
const LATENCY_RUNS = 25;  // repeats per page for a stable median
const CAL_BINS = 5;       // reliability bins (small corpus -> few bins)

// ---- text scoring ----------------------------------------------------------

function tokens(text) {
  const out = (text || "").toLowerCase().match(/[a-z0-9]+/g);
  return out || [];
}

function counts(list) {
  const map = new Map();
  for (const w of list) map.set(w, (map.get(w) || 0) + 1);
  return map;
}

// multiset word-level precision / recall / F1
function prf(truthText, predText) {
  const truth = counts(tokens(truthText));
  const pred = counts(tokens(predText));
  let truthTotal = 0, predTotal = 0, overlap = 0;
  for (const n of truth.values()) truthTotal += n;
  for (const n of pred.values()) predTotal += n;
  for (const [w, n] of pred) overlap += Math.min(n, truth.get(w) || 0);
  const precision = predTotal ? overlap / predTotal : 0;
  const recall = truthTotal ? overlap / truthTotal : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

function noiseRejection(predText, forbidden) {
  if (!forbidden || !forbidden.length) return { kept: 0, total: 0, rate: 1 };
  let kept = 0;
  for (const phrase of forbidden) if (predText.includes(phrase)) kept++;
  return { kept, total: forbidden.length, rate: (forbidden.length - kept) / forbidden.length };
}

// ---- extractors (Mantis + optional baselines) ------------------------------

function freshDoc(html) {
  return new JSDOM(html, { pretendToBeVisual: true, virtualConsole: quietConsole }).window.document;
}

// baselines can throw on pages they don't handle; a throw means "extracted
// nothing", not a crashed harness
function safeRun(system, html) {
  try {
    return system.run(html);
  } catch (e) {
    return system === mantisExtractor ? { text: "", confidence: 0 } : "";
  }
}

function loadBaselines() {
  const baselines = [];
  try {
    const { Readability } = require("@mozilla/readability");
    baselines.push({
      name: "Readability",
      run(html) {
        const doc = freshDoc(html);
        const parsed = new Readability(doc).parse();
        return (parsed && parsed.textContent) || "";
      }
    });
  } catch (e) { /* not installed */ }
  try {
    const Defuddle = require("defuddle");
    const Ctor = Defuddle.Defuddle || Defuddle.default || Defuddle;
    baselines.push({
      name: "Defuddle",
      run(html) {
        const doc = freshDoc(html);
        const result = new Ctor(doc).parse();
        return (result && (result.content || result.textContent) || "").replace(/<[^>]+>/g, " ");
      }
    });
  } catch (e) { /* not installed */ }
  return baselines;
}

const mantisExtractor = {
  name: "Mantis",
  run(html) {
    const doc = freshDoc(html);
    const article = Mantis.extract(doc);
    return { text: article.text, confidence: article.confidence };
  }
};

// ---- calibration -----------------------------------------------------------

// ECE + Brier over (predicted confidence, observed ok) pairs, plus a binned
// reliability table. Tiny corpus -> read these as a wired-up instrument, not a
// verdict; they get meaningful once the corpus grows.
function calibration(points) {
  if (!points.length) return null;
  let brier = 0;
  for (const p of points) brier += (p.conf - (p.ok ? 1 : 0)) ** 2;
  brier /= points.length;

  const bins = [];
  for (let b = 0; b < CAL_BINS; b++) bins.push({ lo: b / CAL_BINS, hi: (b + 1) / CAL_BINS, items: [] });
  for (const p of points) {
    let idx = Math.floor(p.conf * CAL_BINS);
    if (idx >= CAL_BINS) idx = CAL_BINS - 1;
    if (idx < 0) idx = 0;
    bins[idx].items.push(p);
  }
  let ece = 0;
  const rows = [];
  for (const bin of bins) {
    if (!bin.items.length) continue;
    const conf = bin.items.reduce((s, p) => s + p.conf, 0) / bin.items.length;
    const acc = bin.items.reduce((s, p) => s + (p.ok ? 1 : 0), 0) / bin.items.length;
    ece += (bin.items.length / points.length) * Math.abs(acc - conf);
    rows.push({ range: `${bin.lo.toFixed(1)}-${bin.hi.toFixed(1)}`, n: bin.items.length, conf, acc });
  }
  return { ece, brier, rows };
}

// ---- run -------------------------------------------------------------------

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function run() {
  const asJson = process.argv.includes("--json");
  const baselines = loadBaselines();
  const systems = [mantisExtractor, ...baselines];

  // Some baselines (Defuddle) log their own swallowed errors straight to
  // console.error on pages they don't handle; keep that out of the scorecard.
  const realError = console.error, realWarn = console.warn;
  console.error = console.warn = function () {};

  const perEntry = [];
  const calPoints = [];

  for (const entry of corpus.entries) {
    const html = fs.readFileSync(resolveSnapshot(entry.file), "utf8");
    const row = { name: entry.name, type: entry.type, systems: {} };

    for (const system of systems) {
      const result = safeRun(system, html);
      const text = typeof result === "string" ? result : result.text;
      const score = prf(entry.truth, text);
      const noise = noiseRejection(text, entry.forbidden);

      // latency (median of repeated runs)
      const times = [];
      for (let i = 0; i < LATENCY_RUNS; i++) {
        const start = performance.now();
        safeRun(system, html);
        times.push(performance.now() - start);
      }

      row.systems[system.name] = {
        precision: score.precision,
        recall: score.recall,
        f1: score.f1,
        noiseRejection: noise.rate,
        noiseKept: noise.kept,
        noiseTotal: noise.total,
        latencyMs: median(times)
      };

      if (system === mantisExtractor && typeof result.confidence === "number") {
        calPoints.push({ conf: result.confidence, ok: score.f1 >= OK_F1 });
        row.systems[system.name].confidence = result.confidence;
      }
    }
    perEntry.push(row);
  }

  console.error = realError;
  console.warn = realWarn;

  const cal = calibration(calPoints);
  const report = { systems: systems.map((s) => s.name), perEntry, calibration: cal, gaps: corpus.gaps };

  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  printScorecard(report, systems);
}

function printScorecard(report, systems) {
  const types = [...new Set(report.perEntry.map((e) => e.type))].sort();

  console.log("Mantis eval scorecard");
  console.log(`corpus: ${report.perEntry.length} pages across ${types.length} types`);
  console.log(`systems: ${report.systems.join(", ")}`);
  if (systems.length === 1) {
    console.log("(no baselines installed — `npm i -D @mozilla/readability defuddle` to compare)");
  }

  // per-type word-level F1 per system (the headline: where each system holds or falls off)
  console.log("\nword-level F1 by page type");
  const head = ["type".padEnd(12), ...report.systems.map((s) => s.padStart(12))].join("");
  console.log(head);
  for (const type of types) {
    const rows = report.perEntry.filter((e) => e.type === type);
    const cells = report.systems.map((s) => mean(rows.map((r) => r.systems[s] ? r.systems[s].f1 : 0)).toFixed(3).padStart(12));
    console.log(type.padEnd(12) + cells.join(""));
  }
  const allCells = report.systems.map((s) =>
    mean(report.perEntry.map((r) => r.systems[s] ? r.systems[s].f1 : 0)).toFixed(3).padStart(12));
  console.log("ALL".padEnd(12) + allCells.join(""));

  // Mantis detail: precision/recall/noise/latency per page
  console.log("\nMantis per-page detail");
  console.log("page".padEnd(28) + "type".padEnd(12) + "P".padStart(7) + "R".padStart(7) + "F1".padStart(7) + "noise".padStart(8) + "conf".padStart(7) + "ms".padStart(8));
  for (const e of report.perEntry) {
    const m = e.systems.Mantis;
    const noise = m.noiseTotal ? `${m.noiseTotal - m.noiseKept}/${m.noiseTotal}` : "-";
    console.log(
      e.name.slice(0, 27).padEnd(28) +
      e.type.padEnd(12) +
      m.precision.toFixed(2).padStart(7) +
      m.recall.toFixed(2).padStart(7) +
      m.f1.toFixed(2).padStart(7) +
      noise.padStart(8) +
      (m.confidence != null ? m.confidence.toFixed(2) : "-").padStart(7) +
      m.latencyMs.toFixed(3).padStart(8)
    );
  }

  // noise rejection summary
  let kept = 0, total = 0;
  for (const e of report.perEntry) { kept += e.systems.Mantis.noiseKept; total += e.systems.Mantis.noiseTotal; }
  console.log(`\nnoise rejection: ${total - kept}/${total} forbidden phrases kept out`);

  // calibration
  if (report.calibration) {
    const c = report.calibration;
    console.log(`\nconfidence calibration (ok = F1 >= ${OK_F1})`);
    console.log(`ECE: ${c.ece.toFixed(3)}   Brier: ${c.brier.toFixed(3)}`);
    console.log("reliability  " + "conf".padStart(8) + "acc".padStart(8) + "n".padStart(5));
    for (const r of c.rows) {
      console.log(r.range.padEnd(13) + r.conf.toFixed(2).padStart(8) + r.acc.toFixed(2).padStart(8) + String(r.n).padStart(5));
    }
  }

  if (report.gaps && report.gaps.length) {
    console.log(`\nuncovered page types (corpus gaps): ${report.gaps.join(", ")}`);
  }
}

run();
