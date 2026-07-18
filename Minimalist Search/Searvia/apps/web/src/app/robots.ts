import type { MetadataRoute } from "next";

import { clientEnvironment } from "@/lib/client-environment";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/demo", "/login", "/onboarding", "/signup"],
    },
    sitemap: `${clientEnvironment.siteUrl}/sitemap.xml`,
  };
}
