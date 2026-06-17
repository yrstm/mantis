#!/usr/bin/env node
/* Offline calibration fitter for Mantis `pOk`.
 *
 * The library can't fit a model at runtime (zero-dep, one file), so calibration
 * happens here, in dev: run Mantis over the labeled corpus, label each page ok
 * (word-level F1 >= threshold) or not, fit a logistic over the same signal-bus
 * features the library uses, and print a POK_WEIGHTS block to paste into
 * mantis.js. Pure JS, no dependencies beyond jsdom (already a dev dep).
 *
 *   npm run eval:calibrate
 *
 * A real fit needs BOTH classes. The current synthetic corpus has no failures
 * (Mantis scores F1 1.0 across it), so this will refuse to fit and say so — it
 * becomes useful once eval/snapshots/ holds real pages where Mantis sometimes
 * misses. Until then mantis.js ships hand-set heuristic weights.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const Mantis = require("../mantis.js");

const fixtureDir = path.join(__dirname, "..", "fixtures");
const snapshotDir = path.join(__dirname, "snapshots");
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, "corpus.json"), "utf8"));

const OK_F1 = 0.8;
const FEATURES = ["dominance", "textRetained", "paragraphs", "hasTitle", "prose"];

function resolveSnapshot(file) {
  const captured = path.join(snapshotDir, file);
  return fs.existsSync(captured) ? captured : path.join(fixtureDir, file);
}

function tokens(text) { return (text || "").toLowerCase().match(/[a-z0-9]+/g) || []; }

function f1(truthText, predText) {
  const t = new Map(), p = new Map();
  for (const w of tokens(truthText)) t.set(w, (t.get(w) || 0) + 1);
  for (const w of tokens(predText)) p.set(w, (p.get(w) || 0) + 1);
  let tn = 0, pn = 0, ov = 0;
  for (const n of t.values()) tn += n;
  for (const [w, n] of p) { pn += n; ov += Math.min(n, t.get(w) || 0); }
  const prec = pn ? ov / pn : 0, rec = tn ? ov / tn : 0;
  return prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
}

// the same feature vector mantis.js builds for pOk
function featuresOf(article) {
  const d = article.diagnostics;
  return {
    dominance: d.dominance || 0,
    textRetained: d.textRetained || 0,
    paragraphs: Math.min((d.paragraphCount || 0) / 5, 1),
    hasTitle: article.title ? 1 : 0,
    prose: 1 - Math.min(d.linkDensity || 0, 1)
  };
}

function buildSamples() {
  const samples = [];
  for (const entry of corpus.entries) {
    const html = fs.readFileSync(resolveSnapshot(entry.file), "utf8");
    const doc = new JSDOM(html, { pretendToBeVisual: true }).window.document;
    const article = Mantis.extract(doc);
    samples.push({ x: featuresOf(article), y: article.blocks.length && f1(entry.truth, article.text) >= OK_F1 ? 1 : 0 });
  }
  return samples;
}

// plain batch gradient-descent logistic regression
function fit(samples, opts) {
  const lr = opts.lr || 0.3, iters = opts.iters || 20000, l2 = opts.l2 || 0.001;
  const w = { bias: 0 };
  for (const f of FEATURES) w[f] = 0;
  for (let it = 0; it < iters; it++) {
    const grad = { bias: 0 };
    for (const f of FEATURES) grad[f] = 0;
    for (const s of samples) {
      let z = w.bias;
      for (const f of FEATURES) z += w[f] * s.x[f];
      const err = 1 / (1 + Math.exp(-z)) - s.y;
      grad.bias += err;
      for (const f of FEATURES) grad[f] += err * s.x[f];
    }
    w.bias -= lr * grad.bias / samples.length;
    for (const f of FEATURES) w[f] -= lr * (grad[f] / samples.length + l2 * w[f]);
  }
  return w;
}

function main() {
  const samples = buildSamples();
  const pos = samples.filter((s) => s.y === 1).length;
  const neg = samples.length - pos;
  console.log(`corpus: ${samples.length} samples (${pos} ok, ${neg} not-ok)`);

  if (pos < 3 || neg < 3) {
    console.log(
      `\nCannot fit a meaningful calibration: need at least 3 of each class, have ` +
      `${pos} ok / ${neg} not-ok.\nGrow eval/snapshots/ with real pages (including ones Mantis gets wrong), ` +
      `then re-run.\nmantis.js keeps its hand-set heuristic POK_WEIGHTS until then.`
    );
    return;
  }

  const w = fit(samples, {});
  console.log("\nFitted weights — paste into mantis.js POK_WEIGHTS:\n");
  const order = ["bias", ...FEATURES];
  console.log("  var POK_WEIGHTS = { " +
    order.map((k) => `${k}: ${w[k].toFixed(3)}`).join(", ") + " };");
}

main();
