import { isDatabaseDomainError, type StoredHeaderMap } from "@searvia/database/runtime";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import styles from "@/components/application/application-shell.module.css";
import { getSearviaCrawlRepository, getSearviaRepository } from "@/lib/database";
import { requireOrganizationScope } from "@/lib/session";

interface CrawlPageDetailProps {
  readonly params: Promise<{
    readonly projectId: string;
    readonly crawlId: string;
    readonly pageId: string;
  }>;
}

function display(value: string | number | null): string | number {
  return value === null || value === "" ? "—" : value;
}

function HeaderRows({ headers }: { readonly headers: StoredHeaderMap }) {
  const entries = Object.entries(headers);
  return entries.length === 0 ? (
    <p className={styles.cardCopy}>None recorded.</p>
  ) : (
    <dl className={styles.compactDetails}>
      {entries.map(([name, values]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{values.join(", ")}</dd>
        </div>
      ))}
    </dl>
  );
}

export const dynamic = "force-dynamic";

export default async function CrawlPageDetail({ params }: CrawlPageDetailProps) {
  const [{ scope }, route] = await Promise.all([requireOrganizationScope(), params]);
  const identifiers = z
    .object({ projectId: z.uuid(), crawlId: z.uuid(), pageId: z.uuid() })
    .safeParse(route);
  if (!identifiers.success) notFound();

  let result;
  try {
    result = await Promise.all([
      getSearviaRepository().getProject(scope, identifiers.data.projectId),
      getSearviaCrawlRepository().getCrawlPage(
        scope,
        identifiers.data.projectId,
        identifiers.data.crawlId,
        identifiers.data.pageId,
      ),
    ]);
  } catch (error) {
    if (isDatabaseDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [project, detail] = result;
  if (project === null) notFound();

  const { page } = detail;
  const visibleLinks = detail.links.slice(0, 100);
  const visibleImages = detail.images.slice(0, 50);
  const visibleStructuredData = detail.structuredData.slice(0, 100);

  return (
    <>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Crawl page</p>
        <h1>Response and extraction.</h1>
        <p className={styles.lede}>{page.normalizedUrl}</p>
        <Link className={styles.inlineLink} href={`/app/projects/${project.id}`}>
          Back to {project.name}
        </Link>
      </header>

      <div className={styles.detailStack}>
        <section className={styles.tableCard} aria-labelledby="response-heading">
          <div className={styles.sectionHeading}>
            <h2 id="response-heading">Response</h2>
            <span>{page.statusCode ?? "No status"}</span>
          </div>
          <dl className={styles.metadataGrid}>
            <div>
              <dt>Requested URL</dt>
              <dd>{page.requestedUrl}</dd>
            </div>
            <div>
              <dt>Final URL</dt>
              <dd>{display(page.finalUrl)}</dd>
            </div>
            <div>
              <dt>Content type</dt>
              <dd>{display(page.contentType)}</dd>
            </div>
            <div>
              <dt>Content length</dt>
              <dd>{page.contentLength?.toLocaleString("en-US") ?? "—"}</dd>
            </div>
            <div>
              <dt>Transfer size</dt>
              <dd>{page.transferSize.toLocaleString("en-US")}</dd>
            </div>
            <div>
              <dt>Compression</dt>
              <dd>{display(page.compression)}</dd>
            </div>
            <div>
              <dt>Depth</dt>
              <dd>{page.depth}</dd>
            </div>
            <div>
              <dt>Robots decision</dt>
              <dd>{page.robotsDecision.replace("_", " ")}</dd>
            </div>
            <div>
              <dt>Discovered from</dt>
              <dd>{page.discoverySource.replace("_", " ")}</dd>
            </div>
            <div>
              <dt>Redirects</dt>
              <dd>{page.redirectChain.length}</dd>
            </div>
            <div>
              <dt>Fetched at</dt>
              <dd>{page.fetchedAt?.toISOString() ?? "—"}</dd>
            </div>
            <div>
              <dt>Error</dt>
              <dd>{page.errorMessage ?? page.errorType ?? "None"}</dd>
            </div>
          </dl>
        </section>

        {detail.extractions.length === 0 ? (
          <section className={styles.tableCard} aria-labelledby="extraction-empty-heading">
            <h2 id="extraction-empty-heading">Extraction</h2>
            <p className={styles.cardCopy}>No extraction record was persisted for this response.</p>
          </section>
        ) : (
          detail.extractions.map((extraction) => {
            const headings = detail.headings.filter(
              (heading) => heading.extractionId === extraction.id,
            );
            const visibleHeadings = headings.slice(0, 100);
            return (
              <section
                className={styles.tableCard}
                aria-labelledby={`extraction-${extraction.id}`}
                key={extraction.id}
              >
                <div className={styles.sectionHeading}>
                  <h2 id={`extraction-${extraction.id}`}>{extraction.source} extraction</h2>
                  <span>{extraction.wordCount.toLocaleString("en-US")} words</span>
                </div>
                <dl className={styles.metadataGrid}>
                  <div>
                    <dt>Title</dt>
                    <dd>{display(extraction.title)}</dd>
                  </div>
                  <div>
                    <dt>Meta description</dt>
                    <dd>{display(extraction.metaDescription)}</dd>
                  </div>
                  <div>
                    <dt>Canonical</dt>
                    <dd>{display(extraction.canonicalUrl)}</dd>
                  </div>
                  <div>
                    <dt>Canonical tags</dt>
                    <dd>{extraction.canonicalTagCount}</dd>
                  </div>
                  <div>
                    <dt>Meta robots</dt>
                    <dd>{extraction.metaRobots.join(", ") || "—"}</dd>
                  </div>
                  <div>
                    <dt>X-Robots-Tag</dt>
                    <dd>{extraction.xRobotsTag.join(", ") || "—"}</dd>
                  </div>
                  <div>
                    <dt>Language</dt>
                    <dd>{display(extraction.htmlLanguage)}</dd>
                  </div>
                  <div>
                    <dt>Encoding</dt>
                    <dd>{display(extraction.characterEncoding)}</dd>
                  </div>
                  <div>
                    <dt>Meaningful content</dt>
                    <dd>{extraction.meaningfulContent ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt>Client rendered</dt>
                    <dd>{extraction.clientRendered ? "Yes" : "No"}</dd>
                  </div>
                  <div>
                    <dt>Content hash</dt>
                    <dd>{display(extraction.contentHash)}</dd>
                  </div>
                  <div>
                    <dt>DOM hash</dt>
                    <dd>{display(extraction.domHash)}</dd>
                  </div>
                  <div>
                    <dt>Similarity fingerprint</dt>
                    <dd>{display(extraction.similarityFingerprint)}</dd>
                  </div>
                  <div>
                    <dt>Rendering error</dt>
                    <dd>
                      {extraction.renderingErrorMessage ?? extraction.renderingErrorType ?? "None"}
                    </dd>
                  </div>
                  <div>
                    <dt>Extracted at</dt>
                    <dd>{extraction.extractedAt.toISOString()}</dd>
                  </div>
                </dl>

                {headings.length > 0 ? (
                  <div className={styles.tableScroller}>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Heading</th>
                          <th scope="col">Text</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleHeadings.map((heading) => (
                          <tr key={heading.id}>
                            <td>H{heading.level}</td>
                            <td>{heading.text || "(empty)"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {detail.collectionTruncated.headings || headings.length > visibleHeadings.length ? (
                  <p className={styles.cardCopy}>
                    Showing a bounded heading summary in extraction order.
                  </p>
                ) : null}

                {extraction.visibleText !== null ? (
                  <>
                    <pre className={styles.textExcerpt}>
                      {extraction.visibleText.slice(0, 2_000)}
                      {extraction.visibleText.length > 2_000 ? "\n…" : ""}
                    </pre>
                    {extraction.visibleTextTruncated ? (
                      <p className={styles.cardCopy}>
                        Visible-text preview is limited to protect the dashboard response.
                      </p>
                    ) : null}
                  </>
                ) : null}
              </section>
            );
          })
        )}

        <section className={styles.tableCard} aria-labelledby="links-heading">
          <div className={styles.sectionHeading}>
            <h2 id="links-heading">URL graph</h2>
            <span>
              {detail.links.length.toLocaleString("en-US")}
              {detail.collectionTruncated.links ? "+" : ""} links
            </span>
          </div>
          {visibleLinks.length === 0 ? (
            <p className={styles.cardCopy}>No links were extracted.</p>
          ) : (
            <div className={styles.tableScroller}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Target</th>
                    <th scope="col">Scope</th>
                    <th scope="col">Type</th>
                    <th scope="col">Anchor</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLinks.map((link) => (
                    <tr key={link.id}>
                      <td className={styles.urlCell}>
                        {link.targetPageId === null ? (
                          link.normalizedTargetUrl
                        ) : (
                          <Link
                            className={styles.tableLink}
                            href={`/app/projects/${project.id}/crawls/${page.crawlId}/pages/${link.targetPageId}`}
                          >
                            {link.normalizedTargetUrl}
                          </Link>
                        )}
                      </td>
                      <td>{link.scope}</td>
                      <td>{link.linkType.replace("_", " ")}</td>
                      <td>{link.anchorText || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {detail.collectionTruncated.links || detail.links.length > visibleLinks.length ? (
            <p className={styles.cardCopy}>Showing the first 100 links in extraction order.</p>
          ) : null}
        </section>

        <section className={styles.tableCard} aria-labelledby="assets-heading">
          <div className={styles.sectionHeading}>
            <h2 id="assets-heading">Assets and structured data</h2>
            <span>
              {detail.images.length}
              {detail.collectionTruncated.images ? "+" : ""} images · {detail.resources.length}
              {detail.collectionTruncated.resources ? "+" : ""} resources ·{" "}
              {detail.structuredData.length}
              {detail.collectionTruncated.structuredData ? "+" : ""} structured records
            </span>
          </div>
          {visibleImages.length > 0 ? (
            <div className={styles.tableScroller}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Image</th>
                    <th scope="col">Scope</th>
                    <th scope="col">Alt text</th>
                    <th scope="col">Dimensions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleImages.map((image) => (
                    <tr key={image.id}>
                      <td className={styles.urlCell}>
                        {image.normalizedUrl ?? image.sourceUrl ?? "—"}
                      </td>
                      <td>{image.scope ?? "—"}</td>
                      <td>{image.altText ?? "—"}</td>
                      <td>
                        {image.width === null && image.height === null
                          ? "—"
                          : `${image.width ?? "?"} × ${image.height ?? "?"}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.cardCopy}>No images were extracted.</p>
          )}
          {detail.collectionTruncated.images ? (
            <p className={styles.cardCopy}>Showing the first 50 images in extraction order.</p>
          ) : null}
          {visibleStructuredData.length > 0 ? (
            <ul>
              {visibleStructuredData.map((entry) => (
                <li key={entry.id}>
                  {entry.kind.replace("_", "-")} · {entry.parseStatus} ·{" "}
                  {entry.schemaTypes.join(", ") || "No schema type"}
                </li>
              ))}
            </ul>
          ) : null}
          {detail.collectionTruncated.structuredData ||
          detail.structuredData.length > visibleStructuredData.length ? (
            <p className={styles.cardCopy}>
              Showing a bounded structured-data summary in extraction order.
            </p>
          ) : null}
        </section>

        <section className={styles.cardGrid} aria-label="Persisted response metadata">
          <article className={styles.card}>
            <h2>Cache headers</h2>
            <HeaderRows headers={page.cacheHeaders} />
          </article>
          <article className={styles.card}>
            <h2>Security headers</h2>
            <HeaderRows headers={page.securityHeaders} />
          </article>
        </section>

        <section className={styles.tableCard} aria-labelledby="artifacts-heading">
          <div className={styles.sectionHeading}>
            <h2 id="artifacts-heading">Stored HTML artifacts</h2>
            <span>{detail.artifacts.length} objects</span>
          </div>
          {detail.artifacts.length === 0 ? (
            <p className={styles.cardCopy}>No HTML artifact reference was persisted.</p>
          ) : (
            <div className={styles.tableScroller}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Encoding</th>
                    <th scope="col">Original bytes</th>
                    <th scope="col">Stored bytes</th>
                    <th scope="col">Content hash</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.artifacts.map((artifact) => (
                    <tr key={artifact.id}>
                      <td>{artifact.kind.replace("_", " ")}</td>
                      <td>{artifact.contentEncoding}</td>
                      <td>{artifact.uncompressedBytes.toLocaleString("en-US")}</td>
                      <td>{artifact.storedBytes.toLocaleString("en-US")}</td>
                      <td className={styles.urlCell}>{artifact.contentSha256}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
