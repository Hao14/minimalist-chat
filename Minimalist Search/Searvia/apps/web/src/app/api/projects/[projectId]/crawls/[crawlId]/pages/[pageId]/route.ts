import { getCrawlApiDependencies } from "@/lib/crawl-api-dependencies";
import { handleGetCrawlPage } from "@/lib/crawl-api-handlers";

interface CrawlPageRouteContext {
  readonly params: Promise<{
    readonly projectId: string;
    readonly crawlId: string;
    readonly pageId: string;
  }>;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: CrawlPageRouteContext) {
  const { projectId, crawlId, pageId } = await context.params;
  return handleGetCrawlPage(request, projectId, crawlId, pageId, getCrawlApiDependencies());
}
