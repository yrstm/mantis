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
  /**
   * Index of the block this image follows in the document flow (-1 to lead the
   * document). Set for images captured from a live DOM so toMarkdown can render
   * them at their original position. Absent for vision-pipeline or stored
   * articles, which render images in a list at the end instead.
   */
  position?: number;
  /** DOM order shared by positioned images and tables at the same block anchor. */
  flowOrder?: number;
}

export interface MantisTable {
  object: "table";
  caption: string;
  headers: string[];
  rows: string[][];
  source: MantisSource;
  /**
   * Index of the block this data table follows in the document flow (-1 to lead
   * the document). Set for plain data tables so toMarkdown can render them under
   * their own heading. Absent for layout/nested tables or tables truncated past
   * maxBlocks, which are appended at the end instead.
   */
  position?: number;
  /** DOM order shared by positioned tables and images at the same block anchor. */
  flowOrder?: number;
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
  /** Block extraction reached the maxBlocks cap with candidate nodes remaining. */
  maxBlocksHit?: boolean;
  /** Approximate count of structurally-eligible blocks dropped by the maxBlocks cap. */
  droppedBlockCount?: number;
  /** Table extraction reached its internal cap with tables remaining. */
  maxTablesHit?: boolean;
  /** A fallback scope (main/body) was used because the scored scope was too thin. */
  fallbackScopeUsed?: boolean;
  /** Tables not spliced into the flow (layout/nested) and appended at the tail. */
  unpositionedTables?: number;
  /** Images not spliced into the flow and appended at the tail. */
  unpositionedImages?: number;
  /** Extraction strategy that produced the result ("article" is the default pipeline). */
  strategy?: string;
  /** Strategies run during this extraction, in order. */
  strategiesAttempted?: string[];
  /** An alternative strategy ran but lost the quality gate to the default. */
  escalationRejected?: boolean;
  /** Share of visible page text captured (0-1). Low values indicate a partial capture. */
  coverage?: number;
  /** Visible (non-chrome, non-hidden) text length of the page, in characters. */
  visibleTextLength?: number;
  /** Profiler classification of the page structure. */
  archetype?: "article" | "composite" | "feed" | "app-shell" | "sparse" | "linklist" | "unknown";
  /** Page looks like a client-rendered app whose content has not mounted yet. */
  lazyMountSuspicion?: boolean;
}

export type MantisStrategy = "auto" | "article" | "composite" | "feed" | "linklist";

export interface MantisPageProfile {
  object: "page_profile";
  archetype: string;
  strategyRanking: string[];
  signals: {
    visibleTextLength: number;
    totalTextLength: number;
    elementCount: number;
    scopeCoverage: number;
    scoreDominance: number;
    feedSiblings: number;
    feedParentSelector: string;
    sectionedSections: number;
    headingDensity: number;
    medianParagraphLength: number;
    /** Links with substantial non-metadata text (link-list detection). */
    contentLinks: number;
    /** Total characters of such link text. */
    linkTextLength: number;
    /** Share of visible page text that is link text. */
    linkTextShare: number;
    lazyMountSuspicion: boolean;
  };
}

export interface MantisExtractOptions {
  maxBlocks?: number;
  minTextLength?: number;
  includeLinks?: boolean;
  includeImages?: boolean;
  includeTables?: boolean;
  /**
   * Extraction strategy. "auto" (default) profiles the page and may escalate
   * to a fitting strategy when the default single-scope result covers too
   * little of the visible page; a named strategy forces it. "article" is the
   * classic single-scope pipeline.
   */
  strategy?: MantisStrategy;
}

export interface MantisDOMParserLike {
  new (): { parseFromString(html: string, type: string): Document };
}

export interface MantisFromHTMLOptions extends MantisExtractOptions {
  url?: string;
  DOMParser?: MantisDOMParserLike;
}

export interface MantisFromImageOptions {
  url?: string;
  canonicalUrl?: string;
  title?: string;
  byline?: string;
  siteName?: string;
  hero?: string;
  language?: string;
  publishedAt?: string;
  modifiedAt?: string;
  contentType?: MantisArticle["contentType"];
  prompt?: string;
  DOMParser?: MantisDOMParserLike;
}

export interface MantisImageVisionContext {
  prompt: string;
  url: string;
  title: string;
  imageCount: number;
}

export type MantisImageInput = unknown;

export type MantisImageVisionResult =
  | string
  | Partial<MantisArticle>
  | {
      markdown?: string;
      text?: string;
      html?: string;
      title?: string;
      byline?: string;
      siteName?: string;
      hero?: string;
      url?: string;
      canonicalUrl?: string;
      language?: string;
      publishedAt?: string;
      modifiedAt?: string;
      contentType?: MantisArticle["contentType"];
      confidence?: number;
      warnings?: string[];
      blocks?: MantisBlock[];
      links?: MantisLink[];
      images?: MantisImage[];
      tables?: MantisTable[];
    };

export type MantisImageVisionFn = (
  images: MantisImageInput[],
  context: MantisImageVisionContext
) => MantisImageVisionResult | Promise<MantisImageVisionResult>;

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
  captureMode?: "page" | "selection" | "image";
  imageCount?: number;
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
export function fromImage(
  imageOrImages: MantisImageInput | MantisImageInput[],
  visionFn: MantisImageVisionFn,
  options?: MantisFromImageOptions
): Promise<MantisArticle>;
export function analyze(doc: Document): MantisPageProfile;
export function toMarkdown(article: Partial<MantisArticle>, options?: MantisMarkdownOptions): string;
export function toHTML(article: Partial<MantisArticle>): string;
export function run(options?: MantisRunOptions): void;
export function run(scriptEl?: HTMLScriptElement, options?: MantisRunOptions): void;
