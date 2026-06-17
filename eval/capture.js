#!/usr/bin/env node
/* Capture real rendered-DOM snapshots for the eval corpus.
 *
 * Mantis works on the DOM the browser actually rendered (after JS), so the
 * corpus needs *rendered* HTML, not raw server HTML. This drives a headless
 * Chromium, waits for the page to settle, and saves document outerHTML into
 * eval/snapshots/, then prints a ready-to-paste corpus-entry stub for each
 * page (you fill in `truth` + `forbidden`).
 *
 * Playwright is optional and installed ad hoc, same as the browser smoke test:
 *
 *   npm i --no-save playwright
 *   npx playwright install --with-deps chromium
 *
 * Usage:
 *   node eval/capture.js                       # reads eval/urls.json
 *   node eval/capture.js path/to/urls.json
 *   node eval/capture.js --url https://x/y --type article --name "my page"
 *
 * urls.json is an array of { url, type, name? }. See eval/urls.example.json.
 *
 * NOTE: outbound fetches obey this environment's network egress allowlist. If a
 * host isn't allowed you'll get a navigation error — add the target domains to
 * the environment's egress settings first (see eval/README.md).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const snapshotDir = path.join(__dirname, "snapshots");

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "page";
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[i + 1], i++;
    else positional.push(argv[i]);
  }
  return { flags, positional };
}

function loadTargets() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  if (flags.url) return [{ url: flags.url, type: flags.type || "article", name: flags.name }];
  const file = positional[0] || path.join(__dirname, "urls.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `No URL list found at ${file}.\n` +
      `Create it (see eval/urls.example.json) or pass --url <url> --type <type>.`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (e) {
    throw new Error(
      "Playwright is not installed. Install it ad hoc:\n" +
      "  npm i --no-save playwright\n" +
      "  npx playwright install --with-deps chromium"
    );
  }
}

async function capture() {
  const targets = loadTargets();
  const { chromium } = loadPlaywright();
  fs.mkdirSync(snapshotDir, { recursive: true });

  const browser = await chromium.launch();
  const stubs = [];
  try {
    for (const target of targets) {
      const name = target.name || slugify(target.url);
      const file = slugify(name) + ".html";
      const dest = path.join(snapshotDir, file);
      const page = await browser.newPage();
      try {
        await page.goto(target.url, { waitUntil: "networkidle", timeout: 45000 });
        await page.waitForTimeout(target.settle || 1500); // let late hydration land
        const html = await page.evaluate(() => "<!doctype html>\n" + document.documentElement.outerHTML);
        fs.writeFileSync(dest, html);
        console.error(`captured ${target.url} -> eval/snapshots/${file} (${html.length} bytes)`);
        stubs.push({ name: name, file: file, type: target.type || "article", truth: "TODO: main-content text that should survive", forbidden: ["TODO: noise phrase"] });
      } catch (e) {
        console.error(`FAILED ${target.url}: ${e.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (stubs.length) {
    console.error("\nAdd these to eval/corpus.json `entries` (fill truth + forbidden):\n");
    process.stdout.write(JSON.stringify(stubs, null, 2) + "\n");
  }
}

capture().catch((e) => { console.error(e.message); process.exitCode = 1; });
