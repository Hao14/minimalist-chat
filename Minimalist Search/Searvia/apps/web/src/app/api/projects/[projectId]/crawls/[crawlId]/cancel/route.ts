import { getCrawlApiDependencies } from "@/lib/crawl-api-dependencies";
import { handleCancelCrawl } from "@/lib/crawl-api-handlers";

interface CrawlCancellationRouteContext {
  readonly params: Promise<{ readonly projectId: string; readonly crawlId: string }>;
}

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: CrawlCancellationRouteContext) {
  const { projectId, crawlId } = await context.params;
  return handleCancelCrawl(request, projectId, crawlId, getCrawlApiDependencies());
}
