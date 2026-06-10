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

export interface MantisBlock {
  object: "block";
  type: "paragraph" | "blockquote" | "code" | "list_item" | "heading";
  tag: string;
  level: number;
  text: string;
  links: Array<Pick<MantisLink, "text" | "href">>;
  source: MantisSource;
}

export interface MantisSection {
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

export interface MantisArticle {
  object: "article";
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
export function toMarkdown(article: Partial<MantisArticle>): string;
export function toHTML(article: Partial<MantisArticle>): string;
export function run(scriptEl?: HTMLScriptElement): void;
