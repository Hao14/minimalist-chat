import type { RedirectHop } from "./types.js";

import type { CanonicalNormalizationFailureCode } from "@searvia/shared-types";

export type HtmlSourceKind = "raw" | "rendered";

export interface PageExtractionLimits {
  readonly maxDocumentBytes: number;
  readonly maxExtractedItems: number;
  readonly maxJsonLdCharacters: number;
  readonly maxNodes: number;
  readonly maxTextCharacters: number;
}

export interface HtmlDocumentInput {
  readonly body: string | Uint8Array;
  readonly kind: HtmlSourceKind;
  readonly renderingErrors?: readonly RenderingError[];
}

export interface RenderingError {
  readonly code: string;
  readonly message: string;
  readonly resourceUrl?: string;
}

export type ResponseHeaderInput = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface PageExtractionInput {
  readonly contentType: string | null;
  readonly depth: number;
  readonly finalUrl: string;
  readonly headers: ResponseHeaderInput;
  readonly includeSubdomains: boolean;
  readonly normalizedUrl: string;
  readonly raw: HtmlDocumentInput;
  readonly redirectChain: readonly RedirectHop[];
  readonly rendered?: HtmlDocumentInput;
  readonly requestedUrl: string;
  readonly responseBytes: number;
  readonly scopeHostname: string;
  readonly statusCode: number;
  readonly transferSize: number;
}

export interface ExtractedResponseHeader {
  readonly name: string;
  readonly redacted: boolean;
  readonly values: readonly string[];
}

export interface ResponseMetadataExtraction {
  readonly cacheHeaders: readonly ExtractedResponseHeader[];
  readonly compression: string | null;
  readonly contentLength: number | null;
  readonly contentType: string | null;
  readonly excludedSensitiveHeaderNames: readonly string[];
  readonly headers: readonly ExtractedResponseHeader[];
  readonly responseBytes: number;
  readonly securityHeaders: readonly ExtractedResponseHeader[];
  readonly transferSize: number;
}

export interface HtmlEncodingExtraction {
  readonly declared: string | null;
  /** Ending byte offset of the effective meta charset declaration token, when known. */
  readonly declarationOffsetBytes: number | null;
  readonly source: "bom" | "http_header" | "meta" | "default";
  readonly used: string;
}

export interface HtmlParseIssue {
  readonly code: string;
  readonly column: number | null;
  readonly line: number | null;
  readonly message: string;
}

export interface ResolvedUrlReference {
  readonly error: CanonicalNormalizationFailureCode | null;
  readonly normalizedUrl: string | null;
  readonly rawValue: string;
  readonly resolvedUrl: string | null;
}

export interface HreflangReference extends ResolvedUrlReference {
  readonly language: string;
}

export interface HeadingExtraction {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
}

export interface MetadataProperty {
  readonly key: string;
  readonly values: readonly string[];
}

export interface RobotsDirectiveSource {
  readonly content: string;
  readonly directives: readonly string[];
  readonly userAgent: string;
}

export interface RobotsDirectiveExtraction {
  /** False when a source-level extraction bound omitted one or more directive sources. */
  readonly complete: boolean;
  readonly conflicts: readonly string[];
  readonly effective: readonly string[];
  readonly meta: readonly RobotsDirectiveSource[];
  readonly xRobotsTag: readonly RobotsDirectiveSource[];
}

export interface LinkExtraction {
  readonly anchorText: string;
  readonly discoveryDepth: number;
  readonly discoverySource: "link";
  readonly discoveredPage: boolean;
  readonly internal: boolean | null;
  readonly linkType: "anchor" | "area";
  readonly normalizedTargetUrl: string | null;
  readonly rawTarget: string;
  readonly rel: readonly string[];
  readonly resolvedTargetUrl: string | null;
  readonly sourceUrl: string;
}

export interface ImageSourceCandidate {
  readonly descriptor: string | null;
  readonly normalizedUrl: string | null;
  readonly rawUrl: string;
  readonly resolvedUrl: string | null;
}

export interface ImageExtraction {
  readonly alt: string | null;
  readonly height: number | null;
  readonly loading: string | null;
  readonly source: ResolvedUrlReference;
  readonly sourceSet: readonly ImageSourceCandidate[];
  readonly title: string | null;
  readonly width: number | null;
}

export interface ScriptExtraction {
  readonly async: boolean;
  readonly contentHash: string | null;
  readonly defer: boolean;
  readonly inlineBytes: number;
  readonly module: boolean;
  readonly source: ResolvedUrlReference | null;
  readonly type: string | null;
}

export interface StylesheetExtraction {
  readonly contentHash: string | null;
  readonly inline: boolean;
  readonly media: string | null;
  readonly source: ResolvedUrlReference | null;
}

export interface IframeExtraction {
  readonly loading: string | null;
  readonly sandbox: readonly string[];
  readonly source: ResolvedUrlReference;
  readonly title: string | null;
}

export interface FormExtraction {
  readonly action: ResolvedUrlReference;
  readonly enctype: string;
  readonly hasFileInput: boolean;
  readonly hasPasswordInput: boolean;
  readonly inputCount: number;
  readonly method: string;
}

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | Readonly<{ readonly [key: string]: JsonValue }>;

export interface JsonLdExtraction {
  readonly error: string | null;
  readonly raw: string;
  readonly value: JsonValue | null;
}

export interface MicrodataProperty {
  readonly names: readonly string[];
  readonly value: string;
  readonly valueUrl: string | null;
}

export interface MicrodataItemExtraction {
  readonly identifier: string | null;
  readonly properties: readonly MicrodataProperty[];
  readonly types: readonly string[];
}

export interface HtmlDocumentExtraction {
  readonly baseUrl: string;
  readonly canonical: ResolvedUrlReference | null;
  readonly canonicals: readonly ResolvedUrlReference[];
  readonly characterEncoding: HtmlEncodingExtraction;
  readonly clientRenderedSignals: readonly string[];
  readonly contentHash: string;
  readonly decodedHtml: string;
  /** True when bounded title/description/viewport/icon collections are complete. */
  readonly documentMetadataComplete: boolean;
  readonly domHash: string;
  readonly forms: readonly FormExtraction[];
  readonly headings: readonly HeadingExtraction[];
  readonly headingsComplete: boolean;
  readonly hreflang: readonly HreflangReference[];
  readonly htmlLanguage: string | null;
  readonly htmlDoctypePresent: boolean;
  readonly iconDeclarationCount: number;
  readonly iframes: readonly IframeExtraction[];
  readonly images: readonly ImageExtraction[];
  readonly jsonLd: readonly JsonLdExtraction[];
  readonly links: readonly LinkExtraction[];
  /** False when one or more anchor/area elements were omitted by the extraction bound. */
  readonly linksComplete: boolean;
  readonly meaningfulContent: boolean;
  /** First safely resolved meta-refresh destination found in the bounded document. */
  readonly metaRefreshUrl: string | null;
  readonly metaDescriptions: readonly string[];
  readonly metaDescriptionTagCount: number;
  readonly microdata: readonly MicrodataItemExtraction[];
  readonly openGraph: readonly MetadataProperty[];
  readonly parseIssues: readonly HtmlParseIssue[];
  readonly renderingErrors: readonly RenderingError[];
  readonly robots: RobotsDirectiveExtraction;
  /** First literal JavaScript navigation destination found in executable inline script text. */
  readonly javascriptRedirectUrl: string | null;
  readonly scripts: readonly ScriptExtraction[];
  readonly similarityFingerprint: string;
  readonly socialCards: readonly MetadataProperty[];
  readonly sourceKind: HtmlSourceKind;
  readonly stylesheets: readonly StylesheetExtraction[];
  readonly title: string | null;
  readonly titles: readonly string[];
  readonly viewportDeclarations: readonly string[];
  readonly visibleText: string;
  readonly wordCount: number;
}

export interface HtmlSniffResult {
  readonly detected: boolean;
  readonly source: "bounded_response_prefix";
  readonly bytesInspected: number;
}

export interface RenderingDecision {
  readonly render: boolean;
  readonly reasons: readonly (
    "client_rendered" | "critical_metadata_absent" | "no_meaningful_content"
  )[];
}

export interface PageExtractionResult {
  readonly depth: number;
  readonly finalUrl: string;
  readonly normalizedUrl: string;
  readonly raw: HtmlDocumentExtraction;
  readonly redirectChain: readonly RedirectHop[];
  readonly rendered: HtmlDocumentExtraction | null;
  readonly requestedUrl: string;
  readonly response: ResponseMetadataExtraction;
  readonly statusCode: number;
}
