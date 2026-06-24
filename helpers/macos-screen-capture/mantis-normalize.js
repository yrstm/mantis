#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Mantis = require(path.resolve(__dirname, "../../mantis.js"));

const HELPER_NAME = "mantis-screen-capture";
const HELPER_VERSION = "0.1.0";
const VISION_ENGINE = "apple-vision";

function usage() {
  return [
    `${HELPER_NAME} ${HELPER_VERSION}`,
    "",
    "Reads Apple Vision OCR JSON from stdin and writes Mantis Markdown to stdout."
  ].join("\n");
}

function yamlEscape(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function basename(value) {
  return value ? path.basename(String(value)) : "";
}

function sortedLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => ({
      text: String(line && line.text || "").replace(/\s+/g, " ").trim(),
      confidence: Number(line && line.confidence || 0),
      x: Number(line && line.x || 0),
      y: Number(line && line.y || 0),
      width: Number(line && line.width || 0),
      height: Number(line && line.height || 0)
    }))
    .filter((line) => line.text)
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 0.015) return b.y - a.y;
      return a.x - b.x;
    });
}

function averageConfidence(lines) {
  const scored = lines.filter((line) => line.confidence > 0);
  if (!scored.length) return 0;
  return scored.reduce((sum, line) => sum + line.confidence, 0) / scored.length;
}

function ocrMarkdown(lines) {
  if (!lines.length) return "No readable text was detected in this screenshot.";
  return lines.map((line) => line.text).join("\n\n");
}

function injectHelperFrontmatter(markdown, payload, lineCount) {
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return markdown;
  const extra = [
    ["helper", HELPER_NAME],
    ["helperVersion", HELPER_VERSION],
    ["visionEngine", VISION_ENGINE],
    ["hotkey", payload.hotkey || ""],
    ["imageFile", basename(payload.imagePath)]
  ].filter(([, value]) => value);

  const lines = extra.map(([key, value]) => `${key}: ${yamlEscape(value)}`);
  lines.push(`ocrLineCount: ${lineCount}`);
  lines.push('layout: "apple-vision-reading-order"');
  return markdown.slice(0, end) + "\n" + lines.join("\n") + markdown.slice(end);
}

async function normalize(payload) {
  const lines = sortedLines(payload.lines);
  const confidence = Number(payload.confidence || averageConfidence(lines) || 0);
  const warnings = [];
  if (!lines.length) warnings.push("empty_content");

  const article = await Mantis.fromImage(payload.imagePath || "screenshot.png", () => ({
    markdown: ocrMarkdown(lines),
    confidence,
    warnings,
    contentType: "screenshot"
  }), {
    title: payload.title || "Screenshot Capture",
    url: "",
    contentType: "screenshot"
  });

  const markdown = Mantis.toMarkdown(article, {
    frontmatter: true,
    maxChars: Number(payload.maxChars || 12000),
    budget: "outline",
    images: "omit"
  });
  return injectHelperFrontmatter(markdown, payload, lines.length);
}

async function main() {
  if (process.argv.includes("--version")) {
    process.stdout.write(`${HELPER_NAME} ${HELPER_VERSION}\n`);
    return;
  }
  if (process.argv.includes("--help")) {
    process.stdout.write(usage() + "\n");
    return;
  }

  const input = fs.readFileSync(0, "utf8");
  const payload = input.trim() ? JSON.parse(input) : {};
  process.stdout.write(await normalize(payload));
}

main().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.stderr.write("\n");
  process.exitCode = 1;
});
