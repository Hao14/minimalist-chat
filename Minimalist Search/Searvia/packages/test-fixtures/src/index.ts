export interface TestFixtureProvenance {
  readonly kind: "test-fixture";
  readonly name: string;
  readonly synthetic: true;
  readonly permittedEnvironment: "test";
}

export function identifyTestFixture(name: string): TestFixtureProvenance {
  const normalizedName = name.trim();
  if (normalizedName.length === 0) {
    throw new TypeError("A test fixture name is required.");
  }

  return Object.freeze({
    kind: "test-fixture",
    name: normalizedName,
    synthetic: true,
    permittedEnvironment: "test",
  });
}

export {
  CRAWLER_FIXTURE_KINDS,
  startCrawlerFixtureSite,
  type CrawlerFixtureKind,
  type CrawlerFixtureSite,
  type FixtureRequestRecord,
} from "./crawler-site.js";
export { HTML_PARSING_FIXTURES, SITEMAP_PARSING_FIXTURES } from "./parsing-fixtures.js";
