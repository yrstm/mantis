import { extract, fromHTML, fromImage, run, toHTML, toMarkdown, MantisArticle } from "./mantis";

const article: MantisArticle = extract(document, {
  maxBlocks: 20,
  minTextLength: 20,
  includeLinks: true,
  includeImages: true,
  includeTables: true
});

const parsed: MantisArticle = fromHTML("<p>hello</p>", { url: "https://example.com/", DOMParser });

const markdown: string = toMarkdown(article, {
  frontmatter: true,
  images: "alt",
  tables: true,
  maxChars: 4000,
  budget: "outline",
  sourceSafety: true
});
const html: string = toHTML(article);
const imageArticle: Promise<MantisArticle> = fromImage(["data:image/png;base64,AAAA"], async (images, context) => {
  const count: number = images.length;
  const prompt: string = context.prompt;
  void count;
  void prompt;
  return { markdown: "# Screenshot\n\nCaptured text from an image.", confidence: 0.8 };
}, { title: "Screenshot", url: "https://example.com/screenshot" });
run({
  endpoint: "http://127.0.0.1:4111/capture",
  format: "bundle",
  markdown: { frontmatter: true, maxChars: 12000, budget: "outline" }
});

void parsed;
void imageArticle;
void markdown;
void html;
