/* mantis perf harness - node perf.js (requires dev dep: jsdom)
 *
 * Autoresearch-style fixed benchmark for the render path: a fixed corpus
 * (the fixture snapshots), a fixed metric (microseconds per toMarkdown pass
 * over the corpus, median of repeated rounds), and a fidelity gate (the
 * markdown expectations in fixtures/expectations.json). Renderer changes are
 * kept only when the gate stays green and the metric does not regress.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const Mantis = require("./mantis.js");

const fixtureDir = path.join(__dirname, "fixtures");
const fixtures = JSON.parse(fs.readFileSync(path.join(fixtureDir, "expectations.json"), "utf8"));

const articles = fixtures.map((fixture) => {
  const html = fs.readFileSync(path.join(fixtureDir, fixture.file), "utf8");
  const doc = new JSDOM(html, { pretendToBeVisual: true }).window.document;
  return { name: fixture.name, expected: fixture.markdown || [], article: Mantis.extract(doc) };
});

/* ---------- fidelity gate ---------- */
let misses = 0;
for (const entry of articles) {
  const markdown = Mantis.toMarkdown(entry.article);
  for (const text of entry.expected) {
    if (!markdown.includes(text)) {
      misses++;
      console.log(`miss ${entry.name}: markdown lacks ${JSON.stringify(text)}`);
    }
  }
}

/* ---------- metric: median corpus pass ---------- */
const WARMUP = 200;
const ITERATIONS = 500;
const ROUNDS = 9;

function pass() {
  let bytes = 0;
  for (const entry of articles) bytes += Mantis.toMarkdown(entry.article).length;
  return bytes;
}

const outputChars = pass();
for (let i = 0; i < WARMUP; i++) pass();

const times = [];
for (let r = 0; r < ROUNDS; r++) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITERATIONS; i++) pass();
  times.push(Number(process.hrtime.bigint() - start) / 1e3 / ITERATIONS);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];

/* ---------- metric: large synthetic article ---------- */
const big = { object: "article", title: "Synthetic Stress Article", byline: "Perf Harness", blocks: [], tables: [], images: [], warnings: [], confidence: 0.9 };
for (let i = 0; i < 1200; i++) {
  if (i % 10 === 4) {
    big.blocks.push({ type: "heading", level: (i % 5) + 2, text: `Heading number ${i} with some words` });
  } else if (i % 10 === 7) {
    big.blocks.push({ type: "list_item", text: `List item ${i} with [brackets] and *stars* inside it`, list: { depth: i % 3, ordered: i % 2 === 0, index: i % 9 + 1 } });
  } else if (i % 25 === 9) {
    big.blocks.push({ type: "code", language: "js", text: `function f${i}() {\n  return ${i};\n}` });
  } else {
    big.blocks.push({
      type: "paragraph",
      text: `Paragraph ${i} of running prose with a linked phrase and some bold words to render every pass.`,
      runs: [
        { type: "text", text: `Paragraph ${i} of running prose with a ` },
        { type: "link", text: "linked phrase", href: `https://example.com/${i}` },
        { type: "text", text: " and some " },
        { type: "strong", text: "bold words" },
        { type: "text", text: " to render every pass." }
      ]
    });
  }
}
const bigTimes = [];
for (let r = 0; r < ROUNDS; r++) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < 50; i++) Mantis.toMarkdown(big, { frontmatter: true });
  bigTimes.push(Number(process.hrtime.bigint() - start) / 1e3 / 50);
}
bigTimes.sort((a, b) => a - b);
const bigMedian = bigTimes[Math.floor(bigTimes.length / 2)];

console.log(`corpus: ${articles.length} articles`);
console.log(`output: ${outputChars} chars per corpus pass`);
console.log(`median: ${median.toFixed(1)} us per corpus pass (${(median / articles.length).toFixed(1)} us per article)`);
console.log(`spread: ${times[0].toFixed(1)}-${times[times.length - 1].toFixed(1)} us`);
console.log(`large: ${bigMedian.toFixed(1)} us per 1200-block article (${(Mantis.toMarkdown(big).length / 1024).toFixed(1)} KiB output)`);
console.log(`fidelity: ${misses === 0 ? "green" : misses + " miss(es)"}`);
if (misses) process.exitCode = 1;
