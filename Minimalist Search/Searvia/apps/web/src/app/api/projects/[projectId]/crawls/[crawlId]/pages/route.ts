import { getCrawlApiDependencies } from "@/lib/crawl-api-dependencies";
import { handleListCrawlPages } from "@/lib/crawl-api-handlers";

interface CrawlPagesRouteContext {
  readonly params: Promise<{ readonly projectId: string; readonly crawlId: string }>;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: CrawlPagesRouteContext) {
  const { projectId, crawlId } = await context.params;
  return handleListCrawlPages(request, projectId, crawlId, getCrawlApiDependencies());
}
