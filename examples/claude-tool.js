// Mantis as a Claude tool (Anthropic SDK + Playwright)
//
// Install: npm install @anthropic-ai/sdk playwright @yrstm/mantis
// Run:     ANTHROPIC_API_KEY=... node examples/claude-tool.js

const Anthropic = require("@anthropic-ai/sdk");
const { chromium } = require("playwright");

// Tool definition — pass this in the `tools` array of client.messages.create()
const extractPageMarkdown = {
  name: "extract_page_markdown",
  description:
    "Fetches a URL in a real browser (after JavaScript renders), extracts the main article " +
    "content, and returns clean Markdown with a YAML frontmatter header containing url, title, " +
    "confidence score, content hash, and any extraction warnings. Prefer this over a plain HTTP " +
    "fetch whenever the page might be JS-rendered or you need structured metadata.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch and extract",
      },
      maxChars: {
        type: "integer",
        description:
          "Maximum output length in characters (~4 chars per token). Default 12000.",
        default: 12000,
      },
      budget: {
        type: "string",
        enum: ["cut", "outline"],
        description:
          "'cut' keeps leading blocks when over budget. " +
          "'outline' keeps every heading and each section's opening paragraph first. Default 'outline'.",
      },
    },
    required: ["url"],
  },
};

// Tool handler — call this when a tool_use block for extract_page_markdown arrives
async function handleExtractPageMarkdown({ url, maxChars = 12000, budget = "outline" }) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.addScriptTag({ path: require.resolve("@yrstm/mantis") });
    return await page.evaluate(
      (opts) => Mantis.toMarkdown(Mantis.extract(document), opts),
      { frontmatter: true, maxChars, budget }
    );
  } finally {
    await browser.close();
  }
}

// Minimal agentic loop — runs until the model stops requesting tools
async function run(userMessage) {
  const client = new Anthropic();
  const messages = [{ role: "user", content: userMessage }];

  while (true) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      tools: [extractPageMarkdown],
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const text = response.content.find((b) => b.type === "text");
      return text ? text.text : "";
    }

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      if (block.name === "extract_page_markdown") {
        const result = await handleExtractPageMarkdown(block.input);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }
}

run("Summarise the key points from https://example.com/article").then(console.log);
