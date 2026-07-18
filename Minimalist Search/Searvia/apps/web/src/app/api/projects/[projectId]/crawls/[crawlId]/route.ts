import { getCrawlApiDependencies } from "@/lib/crawl-api-dependencies";
import { handleGetCrawl } from "@/lib/crawl-api-handlers";

interface CrawlResourceRouteContext {
  readonly params: Promise<{ readonly projectId: string; readonly crawlId: string }>;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: CrawlResourceRouteContext) {
  const { projectId, crawlId } = await context.params;
  return handleGetCrawl(request, projectId, crawlId, getCrawlApiDependencies());
}
