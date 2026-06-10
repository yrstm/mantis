"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const Mantis = require("./mantis.js");

const fixtureDir = path.join(__dirname, "fixtures");
const fixtures = JSON.parse(fs.readFileSync(path.join(fixtureDir, "expectations.json"), "utf8"));

function occurrences(text, needle) {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count++;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function scoreFixture(fixture) {
  const html = fs.readFileSync(path.join(fixtureDir, fixture.file), "utf8");
  const doc = new JSDOM(html, { pretendToBeVisual: true }).window.document;
  const actual = Mantis.extract(doc);
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
  }

  const passed = checks.filter((check) => check.ok).length;
  return { name: fixture.name, passed, total: checks.length, checks, actual };
}

const results = fixtures.map(scoreFixture);
const passed = results.reduce((sum, result) => sum + result.passed, 0);
const total = results.reduce((sum, result) => sum + result.total, 0);

for (const result of results) {
  console.log(`${result.name}: ${result.passed}/${result.total}`);
  for (const check of result.checks) {
    console.log(`  ${check.ok ? "ok" : "miss"} ${check.label}`);
  }
}

console.log(`\nscore: ${passed}/${total} (${(passed / total * 100).toFixed(1)}%)`);
if (passed !== total) process.exitCode = 1;
