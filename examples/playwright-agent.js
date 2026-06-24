// Mantis + Playwright — standalone page extraction
//
// Loads a URL in a real browser, runs Mantis after JavaScript renders,
// and prints clean Markdown. Use this as the extraction step inside any
// agent that drives a browser — swap the console.log for whatever your
// agent loop expects.
//
// Install: npm install playwright @yrstm/mantis
// Run:     node examples/playwright-agent.js https://example.com/article

const { chromium } = require("playwright");

async function extractMarkdown(url, options = {}) {
  const {
    maxChars = 12000,
    budget = "outline",
    waitUntil = "networkidle",
    timeout = 30000,
  } = options;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil, timeout });
    await page.addScriptTag({ path: require.resolve("@yrstm/mantis") });

    return await page.evaluate(
      ({ maxChars, budget }) => {
        const article = Mantis.extract(document);
        return {
          markdown: Mantis.toMarkdown(article, { frontmatter: true, maxChars, budget }),
          status: article.status,
          warnings: article.warnings,
          confidence: article.confidence,
          title: article.title,
          url: article.canonicalUrl || article.url,
        };
      },
      { maxChars, budget }
    );
  } finally {
    await browser.close();
  }
}

// Run from the command line
const url = process.argv[2];
if (!url) {
  console.error("Usage: node examples/playwright-agent.js <url>");
  process.exit(1);
}

extractMarkdown(url)
  .then(({ markdown, status, warnings, confidence, title }) => {
    if (warnings.length) {
      process.stderr.write(`warnings: ${warnings.join(", ")}\n`);
    }
    process.stderr.write(`status: ${status}  confidence: ${confidence}  title: ${title}\n`);
    console.log(markdown);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
