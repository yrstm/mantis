#!/usr/bin/env node
/* Real-browser smoke test for the demo (Playwright + Chromium). Covers what
   jsdom structurally can't: shadow-DOM rendering, script injection, and CSP
   blocking with the fallback alert. Not part of `npm test` — Playwright is
   installed ad hoc:

     npm i --no-save playwright
     npx playwright install --with-deps chromium
     npm run test:browser
*/
"use strict";

const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEMO_PORT = 8787;
const PAGE_PORT = 8899;

const ARTICLE = `<!doctype html><html><head><title>Browser Smoke - Site</title>
<meta property="og:title" content="Browser Smoke"></head><body><article>
<h1>Browser Smoke</h1>
<p>${"real browser prose long enough to clear the extraction floor ".repeat(6)}</p>
<p>And an inline <a href="https://x.example.com/">link</a> ${"with plenty of words around it to stay in the body ".repeat(4)}</p>
</article></body></html>`;

function servePages() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const headers = { "Content-Type": "text/html; charset=utf-8" };
      if (req.url === "/csp") headers["Content-Security-Policy"] = "script-src 'none'";
      res.writeHead(200, headers);
      res.end(ARTICLE);
    });
    server.listen(PAGE_PORT, "127.0.0.1", () => resolve(server));
  });
}

function waitForServer(url, tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      http.get(url, (res) => { res.resume(); resolve(); })
        .on("error", () => left ? setTimeout(() => attempt(left - 1), 200) : reject(new Error("demo server never came up")));
    };
    attempt(tries);
  });
}

async function main() {
  const { chromium } = require("playwright");
  const demo = spawn(process.execPath, [path.join(__dirname, "server.js"), String(DEMO_PORT)], { stdio: "ignore" });
  const pages = await servePages();
  await waitForServer(`http://127.0.0.1:${DEMO_PORT}/`);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // take the bookmarklet code from the landing page so the test exercises
  // exactly what a developer drags to the bookmarks bar
  await page.goto(`http://127.0.0.1:${DEMO_PORT}/`);
  const href = await page.getAttribute("#bm", "href");
  const loader = decodeURIComponent(href.replace(/^javascript:/, ""));

  // happy path: overlay renders markdown from the live DOM
  await page.goto(`http://127.0.0.1:${PAGE_PORT}/`);
  await page.evaluate(loader);
  await page.waitForSelector("#mantis-md-demo");
  const markdown = await page.evaluate(
    () => document.getElementById("mantis-md-demo").shadowRoot.querySelector("textarea").value);
  assert(markdown.startsWith("---"), "frontmatter missing");
  assert(markdown.includes("# Browser Smoke"), "h1 missing");
  assert(markdown.includes("[link](https://x.example.com/)"), "inline link missing");
  console.log("happy path: ok");

  // re-click replaces the overlay, never stacks a second one
  await page.evaluate(loader);
  await page.waitForSelector("#mantis-md-demo");
  const count = await page.evaluate(() => document.querySelectorAll("#mantis-md-demo").length);
  assert.strictEqual(count, 1, "overlays stacked on re-click");
  console.log("idempotent re-click: ok");

  // CSP-locked page: the injected script is blocked and the bookmarklet alerts
  const dialog = new Promise((resolve) => {
    page.once("dialog", (d) => { resolve(d.message()); d.accept().catch(() => {}); });
  });
  await page.goto(`http://127.0.0.1:${PAGE_PORT}/csp`);
  await page.evaluate(loader);
  const message = await dialog;
  assert(message.includes("paste fallback"), "CSP alert wrong: " + message);
  const overlayPresent = await page.evaluate(() => !!document.getElementById("mantis-md-demo"));
  assert(!overlayPresent, "overlay appeared despite CSP");
  console.log("csp fallback alert: ok");

  await browser.close();
  pages.close();
  demo.kill();
  console.log("browser smoke: all assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
