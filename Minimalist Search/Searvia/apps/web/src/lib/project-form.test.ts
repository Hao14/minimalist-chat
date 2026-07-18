import { describe, expect, it } from "vitest";

import { parseProjectFormData } from "./project-form";

function form(overrides: Readonly<Record<string, string>> = {}): FormData {
  const values = {
    organizationName: "Acme Search",
    projectName: "Main website",
    website: "https://www.example.com/docs?source=signup",
    pageLimit: "75",
    maxDepth: "4",
    queryPolicy: "ignore_tracking",
    ...overrides,
  };
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }
  formData.set("includeSubdomains", "on");
  return formData;
}

describe("project form parsing", () => {
  it("normalizes a URL to its origin without fetching it", () => {
    const result = parseProjectFormData(form(), { onboarding: true });

    expect(result).toEqual({
      success: true,
      data: {
        organizationName: "Acme Search",
        name: "Main website",
        target: {
          hostname: "www.example.com",
          origin: "https://www.example.com",
          port: null,
          protocol: "https:",
        },
        crawlConfig: {
          pageLimit: 75,
          maxDepth: 4,
          includeSubdomains: true,
          renderingEnabled: false,
          submittedSitemapUrls: [],
          queryPolicy: "ignore_tracking",
        },
      },
    });
  });

  it.each(["ftp://example.com", "https://user:secret@example.com", "localhost", "not a host"])(
    "rejects invalid website input %s",
    (website) => {
      const result = parseProjectFormData(form({ website }), { onboarding: true });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fieldErrors.website).toBeTruthy();
      }
    },
  );

  it("enforces crawl limits before persistence", () => {
    const result = parseProjectFormData(form({ pageLimit: "101", maxDepth: "11" }), {
      onboarding: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors).toMatchObject({
        pageLimit: expect.any(String),
        maxDepth: expect.any(String),
      });
    }
  });

  it("normalizes submitted sitemaps and persists the rendering choice", () => {
    const input = form();
    input.set("renderingEnabled", "on");
    input.set(
      "submittedSitemapUrls",
      "https://EXAMPLE.com:443/sitemap.xml\nhttps://example.com/news.xml.gz\nhttps://example.com/sitemap.xml",
    );

    const result = parseProjectFormData(input, { onboarding: false });

    expect(result).toMatchObject({
      success: true,
      data: {
        crawlConfig: {
          renderingEnabled: true,
          submittedSitemapUrls: [
            "https://example.com/sitemap.xml",
            "https://example.com/news.xml.gz",
          ],
        },
      },
    });
  });

  it.each([
    "ftp://example.com/sitemap.xml",
    "https://user:secret@example.com/sitemap.xml",
    "https://127.0.0.1/sitemap.xml",
    "https://example.com/sitemap.xml#fragment",
  ])("rejects unsafe submitted sitemap input %s", (submittedSitemapUrls) => {
    const input = form();
    input.set("submittedSitemapUrls", submittedSitemapUrls);
    const result = parseProjectFormData(input, { onboarding: false });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.fieldErrors.submittedSitemapUrls).toBeTruthy();
  });

  it("bounds the submitted sitemap collection", () => {
    const input = form();
    input.set(
      "submittedSitemapUrls",
      Array.from({ length: 21 }, (_, index) => `https://example.com/sitemap-${index}.xml`).join(
        "\n",
      ),
    );
    const result = parseProjectFormData(input, { onboarding: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.fieldErrors.submittedSitemapUrls).toContain("20");
    }
  });
});
