// Mantis as an OpenAI function (OpenAI SDK + Playwright)
//
// Install: npm install openai playwright mantis
// Run:     OPENAI_API_KEY=... node examples/openai-function.js

const OpenAI = require("openai");
const { chromium } = require("playwright");

// Function definition — pass this in the `tools` array of client.chat.completions.create()
const extractPageMarkdown = {
  type: "function",
  function: {
    name: "extract_page_markdown",
    description:
      "Fetches a URL in a real browser (after JavaScript renders), extracts the main article " +
      "content, and returns clean Markdown with a YAML frontmatter header containing url, title, " +
      "confidence score, content hash, and any extraction warnings. Prefer this over a plain HTTP " +
      "fetch whenever the page might be JS-rendered or you need structured metadata.",
    parameters: {
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
        },
        budget: {
          type: "string",
          enum: ["cut", "outline"],
          description:
            "'cut' keeps leading blocks when over budget. " +
            "'outline' keeps every heading and each section's opening paragraph first.",
        },
      },
      required: ["url"],
    },
  },
};

// Tool handler — call this when a tool_calls entry for extract_page_markdown arrives
async function handleExtractPageMarkdown({ url, maxChars = 12000, budget = "outline" }) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.addScriptTag({ path: require.resolve("mantis") });
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
  const client = new OpenAI();
  const messages = [{ role: "user", content: userMessage }];

  while (true) {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      tools: [extractPageMarkdown],
      messages,
    });

    const choice = response.choices[0];
    messages.push(choice.message);

    if (choice.finish_reason === "stop") {
      return choice.message.content;
    }

    const toolResults = [];
    for (const call of choice.message.tool_calls || []) {
      if (call.function.name === "extract_page_markdown") {
        const args = JSON.parse(call.function.arguments);
        const result = await handleExtractPageMarkdown(args);
        toolResults.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
    messages.push(...toolResults);
  }
}

run("Summarise the key points from https://example.com/article").then(console.log);
