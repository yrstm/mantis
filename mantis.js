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
 *   Mantis.extract(document) -> { title, byline, hero, paragraphs[], confidence, diagnostics }
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

  function textOf(el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }

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

  function paragraphsFrom(scope, stopAt) {
    var out = [];
    var used = {};
    var nodes = scope.querySelectorAll("p, blockquote, pre, li, h1, h2, h3");
    for (var i = 0; i < nodes.length && out.length < 150; i++) {
      var el = nodes[i];
      if (!KEEP[el.tagName]) continue;
      if (hidden(el)) continue;
      if (el !== scope && flagged(el, stopAt || scope)) continue;
      var heading = /^H/.test(el.tagName);
      var t = textOf(el);
      if (!t) continue;
      if (!heading && t.length < 25) continue;
      if (!heading && linkDensity(el) > 0.5) continue;
      var key = normalized(t);
      if (used[key]) continue;
      used[key] = true;
      out.push(t.slice(0, 8000));
    }
    return out;
  }

  function meta(doc, name) {
    var el = doc.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
    return el && el.getAttribute("content") ? el.getAttribute("content").trim() : "";
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

  function extract(doc) {
    var scopeInfo = findContent(doc);
    var scope = scopeInfo.el;
    var paragraphs = scope ? paragraphsFrom(scope, scope) : [];
    if (paragraphs.length < 2 && doc.body) paragraphs = paragraphsFrom(doc.body, doc.body);
    var h1 = doc.querySelector("h1");
    var title = meta(doc, "og:title") || meta(doc, "twitter:title") || (h1 && textOf(h1)) || cleanTitle(doc.title || "");
    return {
      title: title,
      byline: meta(doc, "author") || meta(doc, "article:author") || meta(doc, "byl") || meta(doc, "parsely-author") || "",
      hero: meta(doc, "og:image") || meta(doc, "twitter:image") || meta(doc, "twitter:image:src") || "",
      paragraphs: paragraphs,
      confidence: confidence(scopeInfo, scope, paragraphs),
      diagnostics: {
        scopeTag: scope ? scope.tagName : "",
        linkDensity: scope ? Math.round(linkDensity(scope) * 100) / 100 : 0,
        score: Math.round(scopeInfo.score),
        nextScore: Math.round(scopeInfo.nextScore),
        paragraphCount: paragraphs.length
      }
    };
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
      hero: a.hero, captured: true, body: body
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

  return { extract: extract, run: run };
});
