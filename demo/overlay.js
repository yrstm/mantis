// Injected into the visited page by the demo bookmarklet. Loads the working
// copy of mantis.js from the demo server, extracts the article from the live
// DOM, and shows the Markdown in a shadow-DOM overlay with a copy button.
// Everything stays in the page; nothing is posted anywhere.
(function () {
  "use strict";

  const script = document.currentScript;
  const origin = script && script.src ? new URL(script.src).origin : "";

  function ensureMantis(done) {
    if (window.Mantis && window.Mantis.toMarkdown) return done();
    const s = document.createElement("script");
    s.src = origin + "/mantis.js?t=" + Date.now();
    s.onload = done;
    s.onerror = () => alert("Mantis demo: could not load mantis.js — is `npm run demo` still running?");
    (document.body || document.documentElement).appendChild(s);
  }

  ensureMantis(() => {
    const previous = document.getElementById("mantis-md-demo");
    if (previous) previous.remove();

    const article = window.Mantis.extract(document);
    const host = document.createElement("div");
    host.id = "mantis-md-demo";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .panel { position: fixed; top: 16px; right: 16px; bottom: 16px; width: min(560px, calc(100vw - 32px));
                 z-index: 2147483647; display: flex; flex-direction: column; background: #fff; color: #111;
                 border: 1px solid #222; border-radius: 6px; box-shadow: 0 8px 32px rgba(0,0,0,.25);
                 font: 13px/1.45 system-ui, sans-serif; }
        header { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-bottom: 1px solid #ddd; }
        header strong { font-size: 14px; margin-right: auto; }
        label { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
        input[type="number"] { width: 64px; }
        textarea { flex: 1; margin: 0; padding: 12px; border: 0; resize: none; outline: none;
                   font: 12px/1.5 ui-monospace, monospace; background: #fafafa; color: #111; }
        footer { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-top: 1px solid #ddd; }
        footer .stats { margin-right: auto; color: #555; }
        button { font: inherit; padding: 4px 12px; border: 1px solid #222; border-radius: 4px;
                 background: #fff; color: #111; cursor: pointer; }
        button.primary { background: #111; color: #fff; }
      </style>
      <div class="panel">
        <header>
          <strong>Mantis &rarr; Markdown</strong>
          <label><input type="checkbox" id="fm" checked> frontmatter</label>
          <label><input type="checkbox" id="outline"> outline</label>
          <label>budget <input type="number" id="max" value="1200" min="200" step="200"></label>
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

    function render() {
      const options = { frontmatter: el("#fm").checked, images: "alt" };
      if (el("#outline").checked) {
        options.budget = "outline";
        options.maxChars = Number(el("#max").value) || 1200;
      }
      const markdown = window.Mantis.toMarkdown(article, options);
      output.value = markdown;
      el(".stats").textContent =
        `${article.contentType} · confidence ${article.confidence.toFixed(2)} · ` +
        `${markdown.length} chars (~${Math.round(markdown.length / 4)} tokens)`;
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
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }

    el("#fm").addEventListener("change", render);
    el("#outline").addEventListener("change", render);
    el("#max").addEventListener("change", render);
    el("#copy").addEventListener("click", copy);
    el("#close").addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);

    render();
    document.documentElement.appendChild(host);
  });
})();
