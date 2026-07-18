import { CrawlError } from "./errors.js";
import { normalizeCrawlUrl } from "./url.js";
import type { QueryParameterPolicy } from "./types.js";

const DEFAULT_MAX_DISCOVERED_LINKS = 10_000;
const MAX_DISCOVERED_LINK_LENGTH = 4_096;

function decodeEntities(value: string): string {
  return value.replace(
    /&(?:#(\d{1,7})|#x([\da-f]{1,6})|(amp|apos|gt|lt|quot));/giu,
    (
      _match,
      decimal: string | undefined,
      hexadecimal: string | undefined,
      named: string | undefined,
    ) => {
      if (decimal !== undefined) {
        const codePoint = Number.parseInt(decimal, 10);
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "\uFFFD";
      }
      if (hexadecimal !== undefined) {
        const codePoint = Number.parseInt(hexadecimal, 16);
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "\uFFFD";
      }
      switch (named?.toLowerCase()) {
        case "amp":
          return "&";
        case "apos":
          return "'";
        case "gt":
          return ">";
        case "lt":
          return "<";
        case "quot":
          return '"';
        default:
          return "\uFFFD";
      }
    },
  );
}

function attributeValue(tag: string, name: string): string | null {
  const expression = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
    "iu",
  );
  const match = expression.exec(tag);
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "") || null;
}

export interface DiscoveryOptions {
  readonly maxUrls?: number;
  readonly queryPolicy?: QueryParameterPolicy;
}

export function discoverAnchorUrls(
  html: string,
  responseUrl: string,
  options: DiscoveryOptions = {},
): readonly string[] {
  const maximum = options.maxUrls ?? DEFAULT_MAX_DISCOVERED_LINKS;
  const baseTag = /<base\b[^>]*>/iu.exec(html)?.[0];
  let baseUrl = responseUrl;
  if (baseTag !== undefined) {
    const href = attributeValue(baseTag, "href");
    if (href !== null && href.length <= MAX_DISCOVERED_LINK_LENGTH) {
      try {
        baseUrl = normalizeCrawlUrl(href, { baseUrl: responseUrl });
      } catch {
        baseUrl = responseUrl;
      }
    }
  }

  const urls = new Set<string>();
  const tags = html.matchAll(/<a\b[^>]*>/giu);
  for (const match of tags) {
    if (urls.size >= maximum) break;
    const href = attributeValue(match[0], "href");
    if (href === null || href.length > MAX_DISCOVERED_LINK_LENGTH) continue;
    try {
      urls.add(
        normalizeCrawlUrl(href, {
          baseUrl,
          ...(options.queryPolicy === undefined ? {} : { queryPolicy: options.queryPolicy }),
        }),
      );
    } catch {
      // Invalid, unsupported, and credential-bearing links are not frontier candidates.
    }
  }
  return Object.freeze([...urls]);
}

export function discoverSitemapUrls(
  xml: string,
  sitemapUrl: string,
  options: DiscoveryOptions = {},
): readonly string[] {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new CrawlError(
      "parse_error",
      "Sitemaps containing DTD or entity declarations are rejected.",
    );
  }
  const maximum = options.maxUrls ?? DEFAULT_MAX_DISCOVERED_LINKS;
  const urls = new Set<string>();
  for (const match of xml.matchAll(/<loc\b[^>]*>([^<]*)<\/loc\s*>/giu)) {
    if (urls.size >= maximum) break;
    const value = decodeEntities(match[1] ?? "").trim();
    if (value === "" || value.length > MAX_DISCOVERED_LINK_LENGTH) continue;
    try {
      urls.add(
        normalizeCrawlUrl(value, {
          baseUrl: sitemapUrl,
          ...(options.queryPolicy === undefined ? {} : { queryPolicy: options.queryPolicy }),
        }),
      );
    } catch {
      // Invalid sitemap locations are ignored while parseable entries remain useful.
    }
  }
  return Object.freeze([...urls]);
}
