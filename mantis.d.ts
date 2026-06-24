export interface MantisSource {
  selector: string;
  index?: number;
}

export interface MantisLink {
  object: "link";
  text: string;
  href: string;
  rel: string;
  source: MantisSource;
}

export interface MantisImage {
  object: "image";
  src: string;
  alt: string;
  title: string;
  source: MantisSource;
}

export interface MantisTable {
  object: "table";
  caption: string;
  headers: string[];
  rows: string[][];
  source: MantisSource;
}

export interface MantisInlineRun {
  type: "text" | "link" | "code" | "strong" | "em";
  text: string;
  href?: string;
}

export interface MantisListMeta {
  depth: number;
  ordered: boolean;
  index: number;
}

export interface MantisBlock {
  object: "block";
  type: "paragraph" | "blockquote" | "code" | "list_item" | "heading";
  tag: string;
  level: number;
  text: string;
  links: Array<Pick<MantisLink, "text" | "href">>;
  runs?: MantisInlineRun[];
  list?: MantisListMeta;
  language?: string;
  source: MantisSource;
}

export interface MantisSection {
  object: "section";
  heading: string;
  level: number;
  blocks: MantisBlock[];
}

export interface MantisCitation {
  object: "citation";
  text: string;
  selector: string;
  hrefs: string[];
  offset: number;
}

export interface MantisSelection {
  object: "selection";
  text: string;
  note: string;
  createdAt: string;
  source: MantisSource;
}

export interface MantisDiagnostics {
  scopeTag: string;
  linkDensity: number;
  score: number;
  nextScore: number;
  paragraphCount: number;
}

export interface MantisExtractOptions {
  maxBlocks?: number;
  minTextLength?: number;
  includeLinks?: boolean;
  includeImages?: boolean;
  includeTables?: boolean;
}

export interface MantisDOMParserLike {
  new (): { parseFromString(html: string, type: string): Document };
}

export interface MantisFromHTMLOptions extends MantisExtractOptions {
  url?: string;
  DOMParser?: MantisDOMParserLike;
}

export interface MantisMarkdownOptions {
  frontmatter?: boolean;
  images?: "omit" | "alt" | "links";
  tables?: boolean;
  maxChars?: number;
  budget?: "cut" | "outline";
  sourceSafety?: boolean;
}

export interface MantisRunOptions {
  endpoint?: string;
  fallbackUrl?: string;
  format?: "bundle" | "article" | "markdown";
  markdown?: MantisMarkdownOptions;
  keepalive?: boolean;
}

export interface MantisArticle {
  object: "article";
  captureMode?: "page" | "selection";
  title: string;
  byline: string;
  hero: string;
  url: string;
  canonicalUrl: string;
  siteName: string;
  publishedAt: string;
  modifiedAt: string;
  language: string;
  status: "completed" | "partial" | "empty";
  contentType: "article" | "docs" | "recipe" | "forum" | "newsletter" | "product" | "video" | "unknown";
  capturedAt: string;
  contentHash: string;
  textHash: string;
  warnings: string[];
  text: string;
  paragraphs: string[];
  blocks: MantisBlock[];
  sections: MantisSection[];
  citations: MantisCitation[];
  links: MantisLink[];
  images: MantisImage[];
  tables: MantisTable[];
  selection: MantisSelection | null;
  confidence: number;
  diagnostics: MantisDiagnostics;
}

export function extract(doc: Document, options?: MantisExtractOptions): MantisArticle;
export function fromHTML(html: string, options?: MantisFromHTMLOptions): MantisArticle;
export function toMarkdown(article: Partial<MantisArticle>, options?: MantisMarkdownOptions): string;
export function toHTML(article: Partial<MantisArticle>): string;
export function run(options?: MantisRunOptions): void;
export function run(scriptEl?: HTMLScriptElement, options?: MantisRunOptions): void;
