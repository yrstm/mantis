(function () {
  "use strict";

  const HOST_ID = "mantis-extension-capture";

  function removeExisting() {
    const old = document.getElementById(HOST_ID);
    if (old) old.remove();
  }

  function metadataLine(article, markdown) {
    const tokens = Math.round(markdown.length / 4);
    const parts = [
      article.contentType || "unknown",
      `confidence ${Number(article.confidence || 0).toFixed(2)}`,
      `${markdown.length} chars`,
      `~${tokens} tokens`
    ];
    if (article.warnings && article.warnings.length) {
      parts.push(`warnings: ${article.warnings.join(", ")}`);
    }
    return parts.join(" - ");
  }

  function showPanel(markdown, article, copied) {
    removeExisting();

    const host = document.createElement("div");
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .panel { position: fixed; inset: auto 16px 16px auto; width: min(620px, calc(100vw - 32px));
                 height: min(620px, calc(100vh - 32px)); z-index: 2147483647; display: flex;
                 flex-direction: column; background: #fff; color: #111; border: 1px solid #222;
                 border-radius: 8px; box-shadow: 0 18px 48px rgba(0,0,0,.35);
                 font: 13px/1.45 system-ui, sans-serif; }
        header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #ddd; }
        strong { margin-right: auto; font-size: 14px; }
        textarea { flex: 1; border: 0; margin: 0; resize: none; padding: 12px; outline: none;
                   background: #fafafa; color: #111; font: 12px/1.5 ui-monospace, monospace; }
        footer { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-top: 1px solid #ddd; }
        .stats { color: #555; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        button { font: inherit; padding: 4px 10px; border: 1px solid #222; border-radius: 4px;
                 background: #fff; color: #111; cursor: pointer; }
        button.primary { background: #111; color: #fff; }
        @media (max-width: 700px) {
          .panel { inset: 0; width: auto; height: auto; border-radius: 0; }
          footer { align-items: stretch; flex-direction: column; }
          .stats { white-space: normal; }
        }
      </style>
      <div class="panel">
        <header>
          <strong>Mantis Markdown</strong>
          <button class="primary" id="copy">${copied ? "Copied" : "Copy"}</button>
          <button id="close">Close</button>
        </header>
        <textarea readonly spellcheck="false"></textarea>
        <footer>
          <span class="stats"></span>
        </footer>
      </div>`;

    const textarea = root.querySelector("textarea");
    const copy = root.querySelector("#copy");
    const close = root.querySelector("#close");
    textarea.value = markdown;
    root.querySelector(".stats").textContent = metadataLine(article, markdown);

    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(markdown).then(() => {
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy"; }, 1200);
      }, () => {
        textarea.focus();
        textarea.select();
        copy.textContent = "Copy manually";
      });
    });
    close.addEventListener("click", () => host.remove());

    document.documentElement.appendChild(host);
  }

  function copyMarkdown(markdown) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      return Promise.resolve(false);
    }
    return navigator.clipboard.writeText(markdown).then(() => true, () => false);
  }

  if (!window.Mantis || !window.Mantis.extract || !window.Mantis.toMarkdown) {
    alert("Mantis extension could not load the extractor.");
    return;
  }

  const article = window.Mantis.extract(document);
  const markdown = window.Mantis.toMarkdown(article, {
    frontmatter: true,
    images: "alt",
    maxChars: 12000,
    budget: "outline"
  });

  copyMarkdown(markdown).then((copied) => showPanel(markdown, article, copied));
})();
