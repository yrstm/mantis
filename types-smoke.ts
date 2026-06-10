import { extract, toHTML, toMarkdown, MantisArticle } from "./mantis";

const article: MantisArticle = extract(document, {
  maxBlocks: 20,
  minTextLength: 20,
  includeLinks: true,
  includeImages: true,
  includeTables: true
});

const markdown: string = toMarkdown(article);
const html: string = toHTML(article);

void markdown;
void html;
