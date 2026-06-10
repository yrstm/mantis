#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.join(__dirname, "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || process.argv[2] || 8787);
let latest = null;

function send(res, status, type, body) {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(body);
}

function readBody(req, done) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 2_000_000) req.destroy();
  });
  req.on("end", () => done(body));
}

function html() {
  const origin = `http://${host}:${port}`;
  const bookmarklet = `javascript:(function(){var s=document.createElement('script');s.src='${origin}/mantis.js?t='+Date.now();s.setAttribute('data-mantis-run','1');s.onerror=function(){alert('Unable to load Mantis demo server')};(document.body||document.documentElement).appendChild(s);})();`;
  const capture = latest ? JSON.stringify(latest, null, 2) : "{\n  \"status\": \"waiting\"\n}";
  const article = latest && latest.article ? JSON.stringify(latest.article, null, 2) : "{\n  \"status\": \"waiting\"\n}";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mantis demo</title>
  <style>
    body { font: 15px/1.5 system-ui, sans-serif; margin: 32px; max-width: 920px; }
    a.bookmarklet { display: inline-block; padding: 8px 12px; border: 1px solid #222; color: #111; text-decoration: none; border-radius: 4px; }
    pre { background: #f5f5f5; padding: 16px; overflow: auto; border: 1px solid #ddd; }
    code { background: #f5f5f5; padding: 2px 4px; }
  </style>
</head>
<body>
  <h1>Mantis demo</h1>
  <p>Drag this link to your bookmarks bar, visit a page, then click it:</p>
  <p><a class="bookmarklet" href="${bookmarklet.replace(/"/g, "&quot;")}">Capture with Mantis</a></p>
  <p>This server receives captures at <code>/api/crates</code>. Refresh this page after capture.</p>
  <h2>Extracted article</h2>
  <pre>${article.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
  <h2>Full capture payload</h2>
  <pre>${capture.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "text/plain", "");
  if (req.method === "GET" && req.url === "/") return send(res, 200, "text/html; charset=utf-8", html());
  if (req.method === "GET" && req.url && req.url.startsWith("/mantis.js")) {
    return send(res, 200, "application/javascript; charset=utf-8", fs.readFileSync(path.join(root, "mantis.js"), "utf8"));
  }
  if (req.method === "GET" && req.url === "/latest") {
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify(latest || { status: "waiting" }, null, 2));
  }
  if (req.method === "POST" && req.url === "/api/crates") {
    return readBody(req, (body) => {
      try {
        latest = JSON.parse(body);
        latest.receivedAt = new Date().toISOString();
        send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true }));
      } catch (e) {
        send(res, 400, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: "invalid_json" }));
      }
    });
  }
  send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "not_found" }));
});

server.listen(port, host, () => {
  console.log(`Mantis demo running at http://${host}:${port}`);
  console.log("Keep this process running while using the bookmarklet.");
});
