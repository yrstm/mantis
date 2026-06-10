import { extract, fromHTML, toHTML, toMarkdown, MantisArticle } from "./mantis";

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
  maxChars: 4000
});
const html: string = toHTML(article);

void parsed;
void markdown;
void html;
