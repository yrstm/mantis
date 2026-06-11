// Injected into the visited page by the demo bookmarklet. Loads the working
// copy of mantis.js from the demo server, extracts the article from the live
// DOM, and shows the Markdown in a shadow-DOM overlay with a copy button.
// Everything stays in the page; nothing is posted anywhere.
(function () {
  "use strict";

  const TEARDOWN = "mantis-md-demo-teardown";
  const script = document.currentScript;
  const origin = script && script.src ? new URL(script.src).origin : "";

  function ensureMantis(done) {
    if (window.Mantis && window.Mantis.toMarkdown) return done();
    const s = document.createElement("script");
    s.src = origin + "/mantis.js?t=" + Date.now();
    s.onload = done;
    s.onerror = () => alert(
      "Mantis demo: could not load mantis.js.\n" +
      "Either `npm run demo` is not running, or this site's CSP blocks injected scripts — " +
      "use the paste fallback at " + (origin || "the demo page") + " instead."
    );
    (document.body || document.documentElement).appendChild(s);
  }

  ensureMantis(() => {
    // a re-click tears down the previous overlay (and its listeners) first
    document.dispatchEvent(new Event(TEARDOWN));

    const article = window.Mantis.extract(document);
    const selectionText = article.selection ? article.selection.text : "";
    let rawArticle = null;

    const host = document.createElement("div");
    host.id = "mantis-md-demo";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .panel { position: fixed; top: 16px; right: 16px; bottom: 16px; width: min(560px, calc(100vw - 32px));
                 z-index: 2147483647; display: flex; flex-direction: column; background: #fff; color: #111;
                 border: 1px solid #222; border-radius: 6px; box-shadow: 0 8px 32px rgba(0,0,0,.25);
                 font: 13px/1.45 system-ui, sans-serif; }
        header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 12px;
                 border-bottom: 1px solid #ddd; }
        header strong { font-size: 14px; margin-right: auto; }
        label { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
        input[type="number"] { width: 64px; }
        textarea { flex: 1; margin: 0; padding: 12px; border: 0; resize: none; outline: none;
                   font: 12px/1.5 ui-monospace, monospace; background: #fafafa; color: #111; }
        footer { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-top: 1px solid #ddd; }
        footer .stats { margin-right: auto; color: #555; }
        footer .stats .hint { color: #a40; }
        button { font: inherit; padding: 4px 12px; border: 1px solid #222; border-radius: 4px;
                 background: #fff; color: #111; cursor: pointer; }
        button.primary { background: #111; color: #fff; }
      </style>
      <div class="panel">
        <header>
          <strong>Mantis &rarr; Markdown</strong>
          <label hidden id="sel-label"><input type="checkbox" id="sel" checked> selection only</label>
          <label><input type="checkbox" id="fm" checked> frontmatter</label>
          <label><input type="checkbox" id="outline"> outline</label>
          <label>budget <input type="number" id="max" value="1200" min="200" step="200"></label>
          <label title="re-extract keeping short blocks the default pass filters out">
            <input type="checkbox" id="raw"> raw</label>
        </header>
        <textarea readonly spellcheck="false"></textarea>
        <footer>
          <span class="stats"></span>
          <button class="primary" id="copy">Copy</button>
          <button id="close">Close</button>
        </footer>
      </div>`;

    const el = (sel) => root.querySelector(sel);
    const output = el("textarea");
    if (selectionText) el("#sel-label").hidden = false;

    function selectionArticle(base) {
      return {
        object: "article",
        title: base.title, byline: base.byline, url: base.url,
        canonicalUrl: base.canonicalUrl, siteName: base.siteName,
        publishedAt: base.publishedAt, capturedAt: base.capturedAt,
        contentType: base.contentType, confidence: base.confidence,
        warnings: base.warnings, text: selectionText,
        paragraphs: selectionText.split(/\n+/).map((p) => p.trim()).filter(Boolean)
      };
    }

    function render() {
      let source = article;
      if (el("#raw").checked) {
        rawArticle = rawArticle || window.Mantis.extract(document, { minTextLength: 0 });
        source = rawArticle;
      }
      if (selectionText && el("#sel").checked) source = selectionArticle(source);

      const options = { frontmatter: el("#fm").checked, images: "alt" };
      if (el("#outline").checked) {
        options.budget = "outline";
        options.maxChars = Number(el("#max").value) || 1200;
      }
      const markdown = window.Mantis.toMarkdown(source, options);
      output.value = markdown;

      const lowConfidence = article.confidence < 0.5 && !el("#raw").checked;
      el(".stats").innerHTML =
        `${article.contentType} · confidence ${article.confidence.toFixed(2)} · ` +
        `${markdown.length} chars (~${Math.round(markdown.length / 4)} tokens)` +
        (lowConfidence ? ' <span class="hint">low — content may be missing; try raw</span>' : "");
    }

    function copy() {
      const flash = (ok) => {
        el("#copy").textContent = ok ? "Copied" : "Copy failed";
        setTimeout(() => { el("#copy").textContent = "Copy"; }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(output.value).then(() => flash(true), () => fallback());
      } else fallback();
      function fallback() {
        output.focus();
        output.select();
        flash(document.execCommand && document.execCommand("copy"));
      }
    }

    function close() {
      host.remove();
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener(TEARDOWN, close);
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }

    ["#sel", "#fm", "#outline", "#max", "#raw"].forEach((sel) =>
      el(sel).addEventListener("change", render));
    el("#copy").addEventListener("click", copy);
    el("#close").addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener(TEARDOWN, close);

    render();
    document.documentElement.appendChild(host);
  });
})();
