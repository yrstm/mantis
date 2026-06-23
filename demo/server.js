#!/usr/bin/env node
"use strict";

// Mantis agent Markdown demo. Serves the landing page, the overlay script, and
// your working copy of mantis.js — nothing else. All extraction happens in
// the visited page; this server never receives or stores anything.

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.join(__dirname, "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || process.argv[2] || 8787);

const routes = {
  "/": { file: path.join(__dirname, "index.html"), type: "text/html; charset=utf-8" },
  "/overlay.js": { file: path.join(__dirname, "overlay.js"), type: "application/javascript; charset=utf-8" },
  "/mantis.js": { file: path.join(root, "mantis.js"), type: "application/javascript; charset=utf-8" }
};

const server = http.createServer((req, res) => {
  const route = routes[(req.url || "").split("?")[0]];
  if (!route) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "not_found" }));
  }
  res.writeHead(200, {
    "Content-Type": route.type,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(fs.readFileSync(route.file));
});

server.listen(port, host, () => {
  console.log(`Mantis agent Markdown demo at http://${host}:${port}`);
  console.log("Drag the capture button from that page, then click it on any article.");
});
