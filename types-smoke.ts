import { extract, fromHTML, run, toHTML, toMarkdown, MantisArticle } from "./mantis";

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
  budget: "outline"
});
const html: string = toHTML(article);
run({
  endpoint: "http://127.0.0.1:4111/capture",
  format: "bundle",
  markdown: { frontmatter: true, maxChars: 12000, budget: "outline" }
});

void parsed;
void markdown;
void html;
