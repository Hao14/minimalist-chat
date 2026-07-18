import { getCrawlApiDependencies } from "@/lib/crawl-api-dependencies";
import { handleCreateCrawl, handleListCrawls } from "@/lib/crawl-api-handlers";

interface CrawlCollectionRouteContext {
  readonly params: Promise<{ readonly projectId: string }>;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: CrawlCollectionRouteContext) {
  const { projectId } = await context.params;
  return handleListCrawls(request, projectId, getCrawlApiDependencies());
}

export async function POST(request: Request, context: CrawlCollectionRouteContext) {
  const { projectId } = await context.params;
  return handleCreateCrawl(request, projectId, getCrawlApiDependencies());
}
