/*!
 * mantis - capture readable content from the current browser DOM.
 *
 * A zero-dependency, client-side article extractor. It runs inside the page
 * (bookmarklet today, extension content script tomorrow), so it sees the DOM
 * that the browser rendered. Nothing is fetched a second time.
 *
 * The extraction is a small Readability-style core (the arc90 lineage that
 * ships in Firefox Reader Mode and Safari Reader): score containers by the
 * prose directly inside them, penalize link-dense and chrome-flagged blocks,
 * take the winner's paragraphs.
 *
 * API (no side effects unless asked):
 *   Mantis.extract(document) -> article object with text, blocks, sections, links, images, tables
 *   Mantis.toMarkdown(article) -> Markdown string
 *   Mantis.toHTML(article)     -> reader HTML string
 *   Mantis.run(scriptEl)     -> extract + POST to the origin the script was
 *                                    loaded from, with an in-page confirmation.
 *                                    Falls back to the /save popup if CSP
 *                                    blocks the POST.
 *
 * Standalone by design and suitable for reuse in applications or extensions.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Mantis = api;
  // loaded by the bookmarklet? capture immediately.
  if (typeof document !== "undefined" && document.currentScript &&
      document.currentScript.getAttribute("data-mantis-run")) {
    api.run(document.currentScript);
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Negative signals in id/class names.
  var BAD = /comment|reply|sidebar|footer|header|navbar|nav-|menu|share|social|promo|related|recommend|advert|sponsor|cookie|newsletter|subscribe|masthead|breadcrumb|disclaimer|meter-banner|jump-to-recipe/i;
  var GOOD = /article|body|content|entry|main|markdown|markup|post|story|text|docs|recipe/i;
  var HIDDEN_CLASS = /(^|\s)(hidden|collapsed|visually-hidden|sr-only|screen-reader|u-hidden|is-hidden)(\s|$)/i;
  var KEEP = { P: 1, BLOCKQUOTE: 1, PRE: 1, LI: 1, H1: 1, H2: 1, H3: 1 };
  var BLOCK_TYPE = { P: "paragraph", BLOCKQUOTE: "blockquote", PRE: "code", LI: "list_item", H1: "heading", H2: "heading", H3: "heading" };

  function textOf(el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }

  function attr(el, name) {
    return el && el.getAttribute ? (el.getAttribute(name) || "").trim() : "";
  }

  function absoluteUrl(doc, value) {
    if (!value) return "";
    try { return new doc.defaultView.URL(value, doc.location && doc.location.href).href; } catch (e) { return value; }
  }

  function escapeHtml(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function escapeMarkdown(s) {
    return (s || "").replace(/\\/g, "\\\\").replace(/([`*_{}\[\]()#+.!|>~-])/g, "\\$1");
  }

  function defaults(options) {
    options = options || {};
    return {
      maxBlocks: options.maxBlocks || 150,
      minTextLength: options.minTextLength || 25,
      includeLinks: options.includeLinks !== false,
      includeImages: options.includeImages !== false,
      includeTables: options.includeTables !== false
    };
  }

  function hashString(s) {
    var h = 2166136261;
    s = s || "";
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return ("0000000" + (h >>> 0).toString(16)).slice(-8);
  }

  function signature(el) {
    return (el.id || "") + " " + (el.className && el.className.baseVal !== undefined ? "" : el.className || "") + " " +
      (el.getAttribute && (el.getAttribute("role") || "") + " " + (el.getAttribute("itemprop") || ""));
  }

  function classText(el) {
    return el.className && el.className.baseVal !== undefined ? "" : el.className || "";
  }

  function hidden(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) return true;
      if (n.hidden || n.getAttribute("aria-hidden") === "true") return true;
      if (HIDDEN_CLASS.test(classText(n))) return true;
      var style = n.getAttribute("style") || "";
      if (/(^|;)\s*display\s*:\s*none\s*(;|$)/i.test(style)) return true;
      if (/(^|;)\s*visibility\s*:\s*hidden\s*(;|$)/i.test(style)) return true;
      try {
        var w = n.ownerDocument && n.ownerDocument.defaultView;
        var cs = w && w.getComputedStyle ? w.getComputedStyle(n) : null;
        if (cs && (cs.display === "none" || cs.visibility === "hidden")) return true;
      } catch (e) { /* computed style unavailable */ }
    }
    return false;
  }

  function flagged(el, stopAt) {
    // does any ancestor up to the candidate look like page chrome?
    for (var n = el; n && n !== stopAt; n = n.parentElement) {
      if (hidden(n)) return true;
      var sig = signature(n);
      if (BAD.test(sig)) return true;
      if (/^(NAV|FOOTER|HEADER|ASIDE|FORM)$/.test(n.tagName)) return true;
    }
    return false;
  }

  function linkDensity(el) {
    var total = textOf(el).length || 1;
    var linked = 0;
    var links = el.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) linked += textOf(links[i]).length;
    return linked / total;
  }

  function semanticMultiplier(el) {
    var sig = signature(el);
    var m = 1;
    if (/^(ARTICLE)$/.test(el.tagName)) m += 0.45;
    if (/^(MAIN)$/.test(el.tagName)) m += 0.35;
    if (/^(SECTION)$/.test(el.tagName)) m += 0.2;
    if (/^(article|main)$/i.test(el.getAttribute && (el.getAttribute("role") || ""))) m += 0.25;
    if (GOOD.test(sig)) m += 0.25;
    if (BAD.test(sig) || /^(NAV|FOOTER|HEADER|ASIDE|FORM)$/.test(el.tagName)) m *= 0.15;
    return m;
  }

  function addScore(el, points, scores, seen) {
    if (!el || /^(HTML|BODY)$/.test(el.tagName) || hidden(el)) return;
    var at = seen.indexOf(el);
    if (at === -1) { seen.push(el); scores.push(0); at = seen.length - 1; }
    scores[at] += points * semanticMultiplier(el);
  }

  // score readable nodes, weighting direct containers and semantic ancestors
  function findContent(doc) {
    var ps = doc.querySelectorAll("p, blockquote, pre, li");
    var scores = [];
    var seen = [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (hidden(p) || flagged(p)) continue;
      var len = textOf(p).length;
      if (len < 25) continue;
      var points = Math.min(len, 600);
      var parent = p.parentElement;
      var grand = parent && parent.parentElement;
      addScore(parent, points, scores, seen);
      addScore(grand, points * 0.65, scores, seen);
      for (var a = grand && grand.parentElement; a && !/^(HTML|BODY)$/.test(a.tagName); a = a.parentElement) {
        if (/^(ARTICLE|MAIN|SECTION)$/.test(a.tagName) || GOOD.test(signature(a))) {
          addScore(a, points * 0.45, scores, seen);
        }
      }
    }
    var best = null, bestScore = 0, nextScore = 0;
    for (var j = 0; j < seen.length; j++) {
      var adjusted = scores[j] * (1 - linkDensity(seen[j]));
      if (adjusted > bestScore) {
        nextScore = bestScore;
        bestScore = adjusted;
        best = seen[j];
      } else if (adjusted > nextScore) {
        nextScore = adjusted;
      }
    }
    return { el: best, score: bestScore, nextScore: nextScore };
  }

  function normalized(t) {
    return t.toLowerCase().replace(/[.,;:!?"'()[\]{}]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function selectorFor(el) {
    if (!el || !el.tagName) return "";
    var parts = [];
    for (var n = el; n && n.nodeType === 1 && !/^(HTML)$/.test(n.tagName); n = n.parentElement) {
      var part = n.tagName.toLowerCase();
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) {
        part += "#" + n.id;
        parts.unshift(part);
        break;
      }
      var index = 1;
      for (var p = n.previousElementSibling; p; p = p.previousElementSibling) {
        if (p.tagName === n.tagName) index++;
      }
      part += ":nth-of-type(" + index + ")";
      parts.unshift(part);
      if (/^(BODY)$/.test(n.tagName)) break;
    }
    return parts.join(" > ");
  }

  function linksFromElement(el, doc) {
    var out = [];
    var links = el.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) {
      var t = textOf(links[i]);
      var href = absoluteUrl(doc, attr(links[i], "href"));
      if (!href) continue;
      out.push({ text: t, href: href });
    }
    return out;
  }

  function blocksFrom(scope, stopAt, doc, options) {
    var out = [];
    var used = {};
    var nodes = scope.querySelectorAll("p, blockquote, pre, li, h1, h2, h3");
    for (var i = 0; i < nodes.length && out.length < options.maxBlocks; i++) {
      var el = nodes[i];
      if (!KEEP[el.tagName]) continue;
      if (hidden(el)) continue;
      if (el !== scope && flagged(el, stopAt || scope)) continue;
      var heading = /^H/.test(el.tagName);
      var t = textOf(el);
      if (!t) continue;
      if (!heading && t.length < options.minTextLength) continue;
      if (!heading && linkDensity(el) > 0.5) continue;
      var key = normalized(t);
      if (used[key]) continue;
      used[key] = true;
      var type = BLOCK_TYPE[el.tagName] || "paragraph";
      out.push({
        object: "block",
        type: type,
        tag: el.tagName,
        level: type === "heading" ? parseInt(el.tagName.slice(1), 10) : 0,
        text: t.slice(0, 8000),
        links: options.includeLinks ? linksFromElement(el, doc) : [],
        source: {
          selector: selectorFor(el),
          index: out.length
        }
      });
    }
    return out;
  }

  function paragraphsFromBlocks(blocks) {
    var out = [];
    for (var i = 0; i < blocks.length; i++) out.push(blocks[i].text);
    return out;
  }

  function sectionsFromBlocks(blocks) {
    var sections = [];
    var current = { heading: "", level: 0, blocks: [] };
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (block.type === "heading") {
        if (current.heading || current.blocks.length) sections.push(current);
        current = { heading: block.text, level: block.level, blocks: [] };
      } else {
        current.blocks.push(block);
      }
    }
    if (current.heading || current.blocks.length) sections.push(current);
    return sections;
  }

  function citationsFromBlocks(blocks) {
    var out = [];
    var offset = 0;
    for (var i = 0; i < blocks.length; i++) {
      out.push({
        object: "citation",
        text: blocks[i].text,
        selector: blocks[i].source.selector,
        hrefs: blocks[i].links.map(function (link) { return link.href; }),
        offset: offset
      });
      offset += blocks[i].text.length + 2;
    }
    return out;
  }

  function linksFrom(scope, doc) {
    var out = [];
    var seen = {};
    var links = scope ? scope.getElementsByTagName("a") : [];
    for (var i = 0; i < links.length && out.length < 200; i++) {
      var el = links[i];
      if (hidden(el) || flagged(el, scope)) continue;
      var href = absoluteUrl(doc, attr(el, "href"));
      if (!href || seen[href]) continue;
      seen[href] = true;
      out.push({
        object: "link",
        text: textOf(el),
        href: href,
        rel: attr(el, "rel"),
        source: { selector: selectorFor(el) }
      });
    }
    return out;
  }

  function imagesFrom(scope, doc) {
    var out = [];
    var seen = {};
    var images = scope ? scope.getElementsByTagName("img") : [];
    for (var i = 0; i < images.length && out.length < 100; i++) {
      var el = images[i];
      if (hidden(el) || flagged(el, scope)) continue;
      var src = absoluteUrl(doc, attr(el, "src") || attr(el, "data-src"));
      if (!src || seen[src]) continue;
      seen[src] = true;
      out.push({
        object: "image",
        src: src,
        alt: attr(el, "alt"),
        title: attr(el, "title"),
        source: { selector: selectorFor(el) }
      });
    }
    return out;
  }

  function tablesFrom(scope) {
    var out = [];
    var tables = scope ? scope.getElementsByTagName("table") : [];
    for (var i = 0; i < tables.length && out.length < 50; i++) {
      var table = tables[i];
      if (hidden(table) || flagged(table, scope)) continue;
      var rows = [];
      var headers = [];
      var trs = table.getElementsByTagName("tr");
      for (var r = 0; r < trs.length; r++) {
        var row = [];
        var cells = trs[r].querySelectorAll("th, td");
        for (var c = 0; c < cells.length; c++) row.push(textOf(cells[c]));
        if (!row.length) continue;
        if (!headers.length && trs[r].getElementsByTagName("th").length) headers = row;
        else rows.push(row);
      }
      if (!headers.length && rows.length) headers = rows.shift();
      if (!headers.length && !rows.length) continue;
      out.push({
        object: "table",
        caption: textOf(table.getElementsByTagName("caption")[0]),
        headers: headers,
        rows: rows,
        source: { selector: selectorFor(table) }
      });
    }
    return out;
  }

  function meta(doc, name) {
    var el = doc.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
    return el && el.getAttribute("content") ? el.getAttribute("content").trim() : "";
  }

  function canonicalUrl(doc) {
    var el = doc.querySelector('link[rel="canonical"]');
    return absoluteUrl(doc, attr(el, "href"));
  }

  function siteName(doc) {
    return meta(doc, "og:site_name") || "";
  }

  function language(doc) {
    return attr(doc.documentElement, "lang") || meta(doc, "language") || "";
  }

  function inferContentType(doc, scope) {
    var sig = (signature(scope || doc.body || doc.documentElement) + " " + meta(doc, "og:type")).toLowerCase();
    if (/recipe/.test(sig)) return "recipe";
    if (/docs|documentation|reference|guide/.test(sig)) return "docs";
    if (/forum|thread|discussion|comment/.test(sig)) return "forum";
    if (/newsletter|email/.test(sig)) return "newsletter";
    if (/product/.test(sig)) return "product";
    if (/video/.test(sig)) return "video";
    if (/article|post|story|entry/.test(sig)) return "article";
    if (scope && scope.tagName === "ARTICLE") return "article";
    return "unknown";
  }

  function cleanTitle(title) {
    title = (title || "").replace(/\s+/g, " ").trim();
    if (!title) return "";
    var parts = title.split(/\s+(?:[|]|[-\u2013\u2014])\s+/);
    if (parts.length > 1 && parts[0].length >= 8) return parts[0].trim();
    return title;
  }

  function confidence(scopeInfo, scope, paragraphs) {
    if (!scope) return 0;
    var dominance = scopeInfo.score / (scopeInfo.score + scopeInfo.nextScore + 1);
    var paraScore = Math.min(paragraphs.length, 8) / 8;
    var semantic = semanticMultiplier(scope) > 1 ? 1 : 0;
    var density = 1 - Math.min(linkDensity(scope), 1);
    var c = 0.15 + dominance * 0.25 + paraScore * 0.25 + semantic * 0.2 + density * 0.15;
    return Math.round(Math.max(0, Math.min(0.99, c)) * 100) / 100;
  }

  function warnings(article, scopeInfo) {
    var out = [];
    if (!article.blocks.length) out.push("empty_content");
    else if (article.blocks.length < 2) out.push("short_content");
    if (article.confidence < 0.45) out.push("low_confidence");
    if (article.diagnostics.linkDensity > 0.35) out.push("high_link_density");
    if (!scopeInfo.el) out.push("no_content_scope");
    if (article.diagnostics.nextScore && article.diagnostics.score / (article.diagnostics.nextScore + 1) < 1.2) out.push("ambiguous_scope");
    return out;
  }

  function statusFrom(article) {
    if (!article.blocks.length) return "empty";
    if (article.warnings.indexOf("low_confidence") !== -1 || article.warnings.indexOf("short_content") !== -1) return "partial";
    return "completed";
  }

  function elementFromSelectionNode(node) {
    if (!node) return null;
    if (node.nodeType === 1) return node;
    return node.parentElement || null;
  }

  function selectionFrom(doc) {
    var w = doc.defaultView;
    if (!w || !w.getSelection) return null;
    try {
      var sel = w.getSelection();
      var text = ("" + sel).replace(/\s+/g, " ").trim();
      if (!text) return null;
      var anchor = elementFromSelectionNode(sel.anchorNode);
      return {
        object: "selection",
        text: text.slice(0, 8000),
        note: "",
        createdAt: new Date().toISOString(),
        source: { selector: selectorFor(anchor) }
      };
    } catch (e) {
      return null;
    }
  }

  function extract(doc, options) {
    options = defaults(options);
    var scopeInfo = findContent(doc);
    var scope = scopeInfo.el;
    var blocks = scope ? blocksFrom(scope, scope, doc, options) : [];
    if (blocks.length < 2 && doc.body) blocks = blocksFrom(doc.body, doc.body, doc, options);
    var paragraphs = paragraphsFromBlocks(blocks);
    var sections = sectionsFromBlocks(blocks);
    var citations = citationsFromBlocks(blocks);
    var h1 = doc.querySelector("h1");
    var title = meta(doc, "og:title") || meta(doc, "twitter:title") || (h1 && textOf(h1)) || cleanTitle(doc.title || "");
    var pageUrl = doc.location && doc.location.href ? doc.location.href : "";
    var article = {
      object: "article",
      title: title,
      byline: meta(doc, "author") || meta(doc, "article:author") || meta(doc, "byl") || meta(doc, "parsely-author") || "",
      hero: meta(doc, "og:image") || meta(doc, "twitter:image") || meta(doc, "twitter:image:src") || "",
      url: pageUrl,
      canonicalUrl: canonicalUrl(doc) || pageUrl,
      siteName: siteName(doc),
      publishedAt: meta(doc, "article:published_time") || meta(doc, "date") || "",
      modifiedAt: meta(doc, "article:modified_time") || meta(doc, "lastmod") || "",
      language: language(doc),
      text: paragraphs.join("\n\n"),
      paragraphs: paragraphs,
      blocks: blocks,
      sections: sections,
      citations: citations,
      links: options.includeLinks ? linksFrom(scope || doc.body, doc) : [],
      images: options.includeImages ? imagesFrom(scope || doc.body, doc) : [],
      tables: options.includeTables ? tablesFrom(scope || doc.body) : [],
      selection: selectionFrom(doc),
      capturedAt: new Date().toISOString(),
      contentType: inferContentType(doc, scope),
      confidence: confidence(scopeInfo, scope, paragraphs),
      diagnostics: {
        scopeTag: scope ? scope.tagName : "",
        linkDensity: scope ? Math.round(linkDensity(scope) * 100) / 100 : 0,
        score: Math.round(scopeInfo.score),
        nextScore: Math.round(scopeInfo.nextScore),
        paragraphCount: paragraphs.length
      }
    };
    article.textHash = hashString(article.text);
    article.contentHash = hashString(JSON.stringify({
      title: article.title,
      byline: article.byline,
      url: article.canonicalUrl || article.url,
      text: article.text,
      tables: article.tables
    }));
    article.warnings = warnings(article, scopeInfo);
    article.status = statusFrom(article);
    return article;
  }

  function tableMarkdown(table) {
    var headers = table.headers && table.headers.length ? table.headers.slice() : [];
    var rows = table.rows ? table.rows.slice() : [];
    if (!headers.length && rows.length) headers = rows.shift();
    if (!headers.length) return "";
    var out = [];
    out.push("| " + headers.map(escapeMarkdown).join(" | ") + " |");
    out.push("| " + headers.map(function () { return "---"; }).join(" | ") + " |");
    for (var r = 0; r < rows.length; r++) {
      out.push("| " + rows[r].map(escapeMarkdown).join(" | ") + " |");
    }
    return out.join("\n");
  }

  function markdownText(block) {
    var text = block.text || "";
    var links = block.links || [];
    if (!links.length) return escapeMarkdown(text);
    var out = "";
    var index = 0;
    for (var i = 0; i < links.length; i++) {
      var label = links[i].text || links[i].href;
      var at = text.indexOf(label, index);
      if (at === -1) continue;
      out += escapeMarkdown(text.slice(index, at));
      out += "[" + escapeMarkdown(label) + "](" + links[i].href.replace(/\)/g, "%29") + ")";
      index = at + label.length;
    }
    out += escapeMarkdown(text.slice(index));
    return out || escapeMarkdown(text);
  }

  function toMarkdown(article) {
    var out = [];
    if (article.title) out.push("# " + escapeMarkdown(article.title));
    if (article.byline) out.push(escapeMarkdown(article.byline));
    var blocks = article.blocks || [];
    if (!blocks.length && article.paragraphs) {
      for (var p = 0; p < article.paragraphs.length; p++) {
        blocks.push({ type: "paragraph", text: article.paragraphs[p] });
      }
    }
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.type === "heading") out.push(new Array(Math.min(Math.max(b.level, 1), 6) + 1).join("#") + " " + markdownText(b));
      else if (b.type === "blockquote") out.push("> " + markdownText(b));
      else if (b.type === "code") out.push("```\n" + b.text + "\n```");
      else if (b.type === "list_item") out.push("- " + markdownText(b));
      else out.push(markdownText(b));
    }
    var tables = article.tables || [];
    for (var t = 0; t < tables.length; t++) {
      var md = tableMarkdown(tables[t]);
      if (md) out.push(md);
    }
    return out.join("\n\n").trim();
  }

  function toHTML(article) {
    var out = ['<article class="mantis-reader">'];
    if (article.title) out.push("<h1>" + escapeHtml(article.title) + "</h1>");
    if (article.byline) out.push('<p class="byline">' + escapeHtml(article.byline) + "</p>");
    var blocks = article.blocks || [];
    if (!blocks.length && article.paragraphs) {
      for (var p = 0; p < article.paragraphs.length; p++) {
        blocks.push({ type: "paragraph", text: article.paragraphs[p] });
      }
    }
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.type === "heading") out.push("<h" + b.level + ">" + escapeHtml(b.text) + "</h" + b.level + ">");
      else if (b.type === "blockquote") out.push("<blockquote>" + escapeHtml(b.text) + "</blockquote>");
      else if (b.type === "code") out.push("<pre><code>" + escapeHtml(b.text) + "</code></pre>");
      else if (b.type === "list_item") out.push("<ul><li>" + escapeHtml(b.text) + "</li></ul>");
      else out.push("<p>" + escapeHtml(b.text) + "</p>");
    }
    var tables = article.tables || [];
    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];
      out.push("<table>");
      if (table.caption) out.push("<caption>" + escapeHtml(table.caption) + "</caption>");
      if (table.headers && table.headers.length) {
        out.push("<thead><tr>");
        for (var h = 0; h < table.headers.length; h++) out.push("<th>" + escapeHtml(table.headers[h]) + "</th>");
        out.push("</tr></thead>");
      }
      out.push("<tbody>");
      for (var r = 0; r < table.rows.length; r++) {
        out.push("<tr>");
        for (var c = 0; c < table.rows[r].length; c++) out.push("<td>" + escapeHtml(table.rows[r][c]) + "</td>");
        out.push("</tr>");
      }
      out.push("</tbody></table>");
    }
    out.push("</article>");
    return out.join("");
  }

  /* ---------- the bookmarklet flow: capture, seal, confirm ---------- */

  function confirmOverlay(doc, line, detail) {
    var d = doc.createElement("div");
    d.setAttribute("style",
      "position:fixed;z-index:2147483647;right:24px;bottom:24px;max-width:320px;" +
      "background:#0A0A0A;color:#F1EFE8;border:1px solid rgba(241,239,232,.18);" +
      "border-radius:10px;padding:14px 18px;font:500 14px/1.45 Inter,system-ui,sans-serif;" +
      "box-shadow:0 18px 44px rgba(0,0,0,.55);opacity:0;transition:opacity .5s ease");
    d.textContent = line;
    if (detail) {
      var s = doc.createElement("div");
      s.setAttribute("style", "margin-top:4px;font-weight:400;font-size:12px;color:rgba(241,239,232,.55)");
      s.textContent = detail;
      d.appendChild(s);
    }
    doc.body.appendChild(d);
    setTimeout(function () { d.style.opacity = "1"; }, 30);
    setTimeout(function () { d.style.opacity = "0"; }, 2200);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 2900);
  }

  function run(scriptEl) {
    var w = (scriptEl && scriptEl.ownerDocument || document).defaultView || window;
    var doc = w.document;
    if (w.__mantisCapturing) return;
    w.__mantisCapturing = true;
    setTimeout(function () { w.__mantisCapturing = false; }, 3000);

    var receiverOrigin = "";
    try { receiverOrigin = new w.URL(scriptEl.src).origin; } catch (e) { /* fall through */ }

    var a = extract(doc);
    var selection = "";
    try { selection = ("" + (w.getSelection ? w.getSelection() : "")).trim().slice(0, 2000); } catch (e) {}

    var host = w.location.hostname.replace(/^www\./i, "");
    var body = (selection ? ['"' + selection + '"'] : []).concat(a.paragraphs);
    var crate = {
      type: "web", source: "Web", origin: host, url: w.location.href,
      title: a.title || host,
      byline: (a.byline ? a.byline + " - " : "") + "captured from the browser DOM",
      hero: a.hero, captured: true, body: body, article: a
    };

    function fallback() {
      // CSP or mixed content blocked the POST. Use the /save popup fallback.
      var u = "&url=" + encodeURIComponent(w.location.href) +
              "&title=" + encodeURIComponent(crate.title) +
              "&text=" + encodeURIComponent(selection);
      w.open(receiverOrigin + "/save?via=fallback" + u, "mantis", "width=440,height=260");
    }

    if (!receiverOrigin) return fallback();
    try {
      w.fetch(receiverOrigin + "/api/crates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(crate),
        keepalive: true
      }).then(function (r) {
        if (!r.ok) throw new Error("refused");
        confirmOverlay(doc, "Page captured.",
          body.length > 1 ? "Extracted from the current browser DOM." : crate.title);
      }).catch(fallback);
    } catch (e) {
      fallback();
    }
  }

  return { extract: extract, toMarkdown: toMarkdown, toHTML: toHTML, run: run };
});
