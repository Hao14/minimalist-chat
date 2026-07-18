import type { AuditPageResource } from "../src/snapshot.js";
import {
  extraction,
  fixtureSet,
  page,
  redirect,
  robots,
  sitemap,
  snapshot,
  type RuleFixtureSet,
} from "./fixtures.js";

function renderingResource(overrides: Partial<AuditPageResource> = {}): AuditPageResource {
  return Object.freeze({
    id: "resource-app-css",
    resourceType: "stylesheet",
    sourceUrl: "https://example.com/assets/app.css",
    normalizedUrl: "https://example.com/assets/app.css",
    scope: "internal",
    robotsDecision: "allowed",
    robotsObservationId: "robots-example",
    robotsResult: "fetched",
    ...overrides,
  });
}

const missingSitemapTarget = sitemap({
  entries: [
    {
      id: "sitemap-entry-missing",
      entryType: "url",
      loc: "https://example.com/missing",
      normalizedLoc: "https://example.com/missing",
      targetPageId: null,
    },
  ],
});

export const RSM_FIXTURES: Readonly<Record<string, RuleFixtureSet>> = Object.freeze({
  "RSM-001": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      robots: [
        robots({
          statusCode: 404,
          result: "not_found",
          content: null,
          sitemapUrls: [],
        }),
      ],
    }),
    boundary: snapshot({
      robots: [robots({ statusCode: null, result: "unavailable", content: null })],
    }),
  }),
  "RSM-002": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      robots: [robots({ statusCode: 503, result: "unavailable", content: null })],
    }),
    boundary: snapshot({ robots: [] }),
  }),
  "RSM-003": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      robots: [
        robots({
          content:
            "User-agent: *\nAllow: /\nBan-all: /private\nSitemap: https://example.com/sitemap.xml\n",
        }),
      ],
    }),
    boundary: snapshot({ robots: [robots({ content: null })] }),
  }),
  "RSM-004": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      robots: [
        robots({
          content: "User-agent: *\nDisallow: /\nSitemap: https://example.com/sitemap.xml\n",
        }),
      ],
    }),
    boundary: snapshot({ robots: [robots({ content: null })] }),
  }),
  "RSM-005": fixtureSet({
    passing: snapshot({ pages: [page({ resources: [renderingResource()] })] }),
    failing: snapshot({
      pages: [page({ resources: [renderingResource({ robotsDecision: "disallowed" })] })],
    }),
    boundary: snapshot({
      pages: [
        page({
          resources: [
            renderingResource({
              robotsDecision: "not-checked",
              robotsObservationId: "robots-unavailable",
              robotsResult: "unavailable",
            }),
          ],
        }),
      ],
    }),
  }),
  "RSM-006": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      robots: [
        robots({
          content: "User-agent: *\nAllow: /\n",
          sitemapUrls: [],
        }),
      ],
    }),
    boundary: snapshot({
      robots: [robots({ statusCode: 404, result: "not_found", content: null, sitemapUrls: [] })],
    }),
  }),
  "RSM-007": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      robots: [robots({ content: "User-agent: *\nAllow: /\n", sitemapUrls: [] })],
      sitemaps: [],
    }),
    boundary: snapshot({
      robots: [robots({ statusCode: null, result: "unavailable", content: null })],
      sitemaps: [],
    }),
  }),
  "RSM-008": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      sitemaps: [
        sitemap({
          status: "failed",
          statusCode: 503,
          errorType: "network_error",
          errorMessage: "The sitemap server returned an unavailable response.",
          entries: [],
        }),
      ],
    }),
    boundary: snapshot({
      sitemaps: [
        sitemap({
          status: "skipped",
          statusCode: null,
          errorType: "robots_disallowed",
          errorMessage: "The sitemap URL was disallowed by robots.txt.",
          entries: [],
        }),
      ],
    }),
  }),
  "RSM-009": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      sitemaps: [
        sitemap({
          status: "failed",
          statusCode: 200,
          format: "unknown",
          errorType: "parse_error",
          errorMessage: "The sitemap XML could not be parsed.",
          parseIssues: [{ code: "xml_error", entryIndex: null, message: "The XML is malformed." }],
          entries: [],
        }),
      ],
    }),
    boundary: snapshot({
      sitemaps: [
        sitemap({
          status: "failed",
          statusCode: null,
          errorType: "network_error",
          errorMessage: "No response was available.",
          entries: [],
        }),
      ],
    }),
  }),
  "RSM-010": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      sitemaps: [
        sitemap({
          status: "failed",
          errorType: "parse_error",
          errorMessage: "The sitemap entry limit was exceeded.",
          parseIssues: [
            {
              code: "entry_limit",
              entryIndex: 50_000,
              message: "The sitemap entry limit was exceeded.",
            },
          ],
          entries: [],
        }),
      ],
    }),
    boundary: snapshot({
      sitemaps: [
        sitemap({
          status: "failed",
          statusCode: null,
          errorType: "network_error",
          errorMessage: "No size observation was available.",
          entries: [],
        }),
      ],
    }),
  }),
  "RSM-011": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [page({ extraction: extraction({ canonicalUrl: "https://example.com/preferred" }) })],
    }),
    boundary: snapshot({ sitemaps: [missingSitemapTarget] }),
  }),
  "RSM-012": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [
        page({
          finalUrl: "https://example.com/final",
          redirectChain: [
            redirect({
              requestedUrl: "https://example.com/",
              resolvedUrl: "https://example.com/final",
            }),
          ],
        }),
      ],
    }),
    boundary: snapshot({ sitemaps: [missingSitemapTarget] }),
  }),
  "RSM-013": fixtureSet({
    passing: snapshot(),
    failing: snapshot({ pages: [page({ statusCode: 404 })] }),
    boundary: snapshot({ sitemaps: [missingSitemapTarget] }),
  }),
  "RSM-014": fixtureSet({
    passing: snapshot(),
    failing: snapshot({
      pages: [page({ extraction: extraction({ metaRobots: ["noindex", "follow"] }) })],
    }),
    boundary: snapshot({ pages: [page({ extraction: null })] }),
  }),
  "RSM-015": fixtureSet({
    passing: snapshot(),
    failing: snapshot({ sitemaps: [sitemap({ entries: [] })] }),
    boundary: snapshot({ status: "partially_completed" }),
  }),
});

export function rsmFixtureFor(ruleId: string): RuleFixtureSet {
  const fixtures = RSM_FIXTURES[ruleId];
  if (fixtures === undefined) throw new TypeError(`Missing RSM fixture set for ${ruleId}.`);
  return fixtures;
}
