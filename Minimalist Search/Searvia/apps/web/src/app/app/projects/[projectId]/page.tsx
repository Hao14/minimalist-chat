import { z } from "zod";
import { roleHasCapability } from "@searvia/shared-types";
import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/components/application/application-shell.module.css";
import { CrawlLaunchBoundary } from "@/components/application/CrawlLaunchBoundary";
import { getSearviaCrawlRepository, getSearviaRepository } from "@/lib/database";
import { serializeCrawlProgress } from "@/lib/crawl-progress";
import { requireOrganizationScope } from "@/lib/session";

interface ProjectPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const [{ scope }, route] = await Promise.all([requireOrganizationScope(), params]);
  if (!z.uuid().safeParse(route.projectId).success) {
    notFound();
  }

  const project = await getSearviaRepository().getProject(scope, route.projectId);
  if (project === null) {
    notFound();
  }

  const crawls = await getSearviaCrawlRepository().listCrawls(scope, project.id, 10);
  const latestCrawl = crawls[0] ?? null;
  const latestPages =
    latestCrawl === null
      ? null
      : await getSearviaCrawlRepository().listCrawlPages(scope, project.id, latestCrawl.id, {
          limit: 50,
        });

  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Project</p>
        <h1>{project.name}</h1>
        <p className={styles.lede}>{project.normalizedOrigin}</p>
      </header>

      <CrawlLaunchBoundary
        canCancel={roleHasCapability(scope.membership.role, "crawl:cancel")}
        canStart={roleHasCapability(scope.membership.role, "crawl:start")}
        initialCrawls={crawls.map(serializeCrawlProgress)}
        projectId={project.id}
      />

      {latestCrawl !== null && latestPages !== null ? (
        <section className={styles.tableCard} aria-labelledby="latest-pages-heading">
          <h2 id="latest-pages-heading">Pages from crawl {latestCrawl.id.slice(0, 8)}</h2>
          {latestPages.items.length === 0 ? (
            <p className={styles.cardCopy}>No page responses have been persisted for this crawl.</p>
          ) : (
            <>
              <div className={styles.tableScroller}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">URL</th>
                      <th scope="col">Status</th>
                      <th scope="col">Depth</th>
                      <th scope="col">Robots</th>
                      <th scope="col">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestPages.items.map((page) => (
                      <tr key={page.id}>
                        <td className={styles.urlCell}>{page.normalizedUrl}</td>
                        <td>{page.statusCode ?? "—"}</td>
                        <td>{page.depth}</td>
                        <td>{page.robotsDecision.replace("_", " ")}</td>
                        <td>
                          <Link
                            className={styles.tableLink}
                            href={`/app/projects/${project.id}/crawls/${latestCrawl.id}/pages/${page.id}`}
                          >
                            Inspect
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {latestPages.nextCursor !== null ? (
                <p className={styles.cardCopy}>
                  Showing the first 50 pages in crawl order. Use the page API cursor to query more.
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <section className={styles.cardGrid} aria-label="Project configuration">
        <article className={styles.card}>
          <h2>Website</h2>
          <dl className={styles.compactDetails}>
            <div>
              <dt>Origin</dt>
              <dd>{project.normalizedOrigin}</dd>
            </div>
            <div>
              <dt>Hostname</dt>
              <dd>{project.normalizedHostname}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>{project.verificationStatus}</dd>
            </div>
          </dl>
        </article>
        <article className={styles.card}>
          <h2>Crawl configuration</h2>
          <dl className={styles.compactDetails}>
            <div>
              <dt>Maximum pages</dt>
              <dd>{project.crawlConfig.pageLimit}</dd>
            </div>
            <div>
              <dt>Maximum depth</dt>
              <dd>{project.crawlConfig.maxDepth}</dd>
            </div>
            <div>
              <dt>Respect robots.txt</dt>
              <dd>{project.crawlConfig.respectRobots ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Subdomains</dt>
              <dd>{project.crawlConfig.includeSubdomains ? "Included" : "Excluded"}</dd>
            </div>
            <div>
              <dt>Browser rendering</dt>
              <dd>{project.crawlConfig.renderingEnabled ? "Limited fallback" : "Disabled"}</dd>
            </div>
            <div>
              <dt>Submitted sitemaps</dt>
              <dd>{project.crawlConfig.submittedSitemapUrls.length}</dd>
            </div>
          </dl>
        </article>
      </section>
    </>
  );
}
