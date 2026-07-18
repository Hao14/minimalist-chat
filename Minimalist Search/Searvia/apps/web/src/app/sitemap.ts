import type { MetadataRoute } from "next";

import { clientEnvironment } from "@/lib/client-environment";

export const dynamic = "force-static";

const routes = [
  "",
  "/features/site-audit",
  "/features/keyword-research",
  "/features/rank-tracking",
  "/features/competitor-analysis",
  "/features/backlinks",
  "/features/ai-visibility",
  "/pricing",
  "/about",
  "/security",
  "/privacy",
  "/terms",
  "/contact",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${clientEnvironment.siteUrl}${route}`,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : route.startsWith("/features") ? 0.8 : 0.6,
  }));
}
