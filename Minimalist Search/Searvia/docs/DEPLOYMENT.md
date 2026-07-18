# Deployment guide

## Current deployment posture

The repository contains the dynamic authenticated product through M3, the M4A deterministic audit boundary, and a partial M5 expansion: tenant projects, durable safe crawling, deterministic extraction, recursive sitemaps, queryable page evidence, private HTML artifacts, optional bounded rendering, and durable evaluation of 130 CRW/HTTP/RSM/URL/ONS/CNT/LNK rules. It is no longer compatible with the credential-free M0 static export. The remaining 60 definitions and score model are not live. No production full-stack Cloudflare runtime, managed database/Redis/object store, controlled crawler-egress policy, monitoring stack, or completed release rehearsal is implied by the implementation.

Do not expose authenticated routes or enable production crawling until the environment-specific authorization, migration, crawler-security, queue-delivery, network, drain/recovery, and quality gates have produced reviewable evidence.

## Target services

- One immutable dynamic web image from `apps/web/Dockerfile`.
- Independently scalable crawler, scheduler/outbox, and report images from their app Dockerfiles.
- Managed PostgreSQL with TLS, backups, point-in-time recovery, and separate migration/runtime roles.
- Managed Redis with TLS/authentication, persistence suitable for durable BullMQ use, and eviction disabled for queue keys.
- Private S3-compatible object storage with encryption, lifecycle/version policy, blocked public access, conditional writes, and narrowly scoped crawler identities for M3 HTML artifacts.
- Secret manager, centralized structured logs, error monitoring, metrics/traces, and controlled crawler egress.

Local Compose is a development convenience, not a production topology.

## Cloudflare and `searvia.online`

ADR-018 supersedes the M0 static-export decision in ADR-014 for authenticated product releases. The old topology—Cloudflare Workers Static Assets serving `apps/web/out` with no runtime—cannot execute Better Auth, session checks, PostgreSQL transactions, crawl APIs, or progress reads.

For an authenticated release, choose and review one dynamic target:

1. Deploy the existing standalone Node web image and worker images to a container platform, then route the Cloudflare-managed `searvia.online` DNS/proxy to that origin; or
2. Add and validate a supported dynamic Next.js Cloudflare adapter/runtime before deployment, with Node/PostgreSQL/Better Auth compatibility, managed service bindings, server-secret handling, and worker separation proven in staging.

The repository change does not select, provision, or deploy option 2. Do not run `build:web:cloudflare` or `deploy:web:cloudflare` for the authenticated application; those M0 static commands are historical and must be removed or replaced as part of the chosen hosting implementation. The small `www`-to-apex redirect may remain only if its route and DNS ownership do not conflict with the dynamic application.

Before changing Cloudflare routes or DNS, inventory the active apex/`www` records and Worker routes, identify the rollback target, and confirm certificates. After routing, verify the dynamic auth callback, protected route redirect, authenticated crawl APIs, canonical metadata, `robots.txt`, `sitemap.xml`, security headers, 404 behavior, and browser console. Never put database, Redis, object-storage, or Better Auth secrets in static assets, public variables, DNS, or Wrangler source.

## Environment separation and ownership

Use isolated preview, staging, and production projects with different PostgreSQL databases, Redis instances/namespaces, BullMQ prefixes, buckets, auth secrets, encryption keys, domains, provider credentials, and service identities. Never copy production secrets into preview or developer environments.

| Configuration group                                                   | Owner/runtime                   | Production requirement                                                                                           |
| --------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `APP_URL`, `BETTER_AUTH_SECRET`                                       | Web secret/config               | Exact HTTPS application origin; unique non-default secret                                                        |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`                         | Web build/public                | Public origins only                                                                                              |
| `DATABASE_*`                                                          | Web, crawler, scheduler; secret | TLS/private endpoint, bounded pools/timeouts, least-privilege runtime role                                       |
| `REDIS_URL`, `REDIS_CONNECT_TIMEOUT_MS`                               | Crawler and scheduler; secret   | TLS/auth/private endpoint, persistence enabled, no eviction of queue keys                                        |
| `QUEUE_PREFIX`                                                        | Crawler and scheduler config    | Same stable prefix for one environment; different from every other environment                                   |
| `CRAWL_JOB_*`, `CRAWL_WORKER_CONCURRENCY`, `CRAWL_EXECUTION_LEASE_MS` | Worker config                   | Capacity, retry, and lease values reviewed against request deadlines and shutdown behavior                       |
| `OUTBOX_*`                                                            | Scheduler config                | Poll, lease, batch, and capped publication attempts sized for database/Redis capacity                            |
| `WORKER_*`                                                            | Worker config                   | Health interval and termination grace compatible with platform kill timeout                                      |
| `OBJECT_STORAGE_*`                                                    | Web/crawler secret/config       | Private HTTPS endpoint/bucket/identity, optional session token, path style, request bound; public access blocked |
| `CRAWL_ARTIFACT_MAX_HTML_BYTES`                                       | Crawler config                  | Reviewed uncompressed artifact bound within the enforced 1 KiB–5,000,000-byte range                              |
| `CRAWL_RENDERING_ENABLED`, `CRAWL_RENDER_BROWSER_EXECUTABLE`          | Crawler config/image            | Rendering off by default; explicit compatible Chromium path required when enabled                                |
| `CRAWL_RENDER_*`                                                      | Crawler config                  | Reviewed render time, settle, input/output, blocked-request, V8 heap, and close bounds                           |
| crawler egress/firewall                                               | Platform/network                | Public HTTP(S) only; internal, metadata, private, reserved, and unsafe ports denied                              |
| `REDIS_INTEGRATION_URL`                                               | CI/test only                    | Isolated ephemeral Redis database; never defined in production                                                   |

Production configuration is injected at runtime and validated before readiness. Public client configuration is restricted to deliberate non-secret origins. Authentication, database, Redis, object-storage, provider, webhook, email, and observability credentials are server-only.

## Build and verification sequence

From a clean checkout with Node 24 and the pinned pnpm 11 version:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the explicit durable Redis delivery test against an isolated CI/staging Redis database:

```bash
REDIS_INTEGRATION_URL=redis://isolated-test-redis:6379/15 pnpm --filter @searvia/job-queue test:redis
```

This command must never target production. The suite fails if its URL is absent; a standard root unit-test run is not a substitute for real BullMQ delivery evidence.

Before enabling M3 in staging, separately exercise the exact S3-compatible service with a private bucket: conditional create/replay/conflict, signed private read, bounded decompression, content and compressed-object hash verification, blocked anonymous reads, interrupted-write recovery, and tenant-key rejection. If optional rendering is enabled, execute the worker image with its configured Chromium and prove inline rendering, outbound-request/service-worker blocking, time/byte/request limits, cancellation, and shutdown. Mocked unit tests are not substitutes for those integration gates.

The workflow in `.github/workflows/ci.yml` assumes Searvia is the repository root. In the current nested parent-worktree arrangement GitHub will not discover it; extraction to a dedicated repository or a deliberately scoped parent-root workflow is a release prerequisite.

Build immutable images using the repository root as Docker context. The web image requires real public origins at build time:

```bash
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_APP_URL=https://searvia.online \
  --build-arg NEXT_PUBLIC_SITE_URL=https://searvia.online \
  -t searvia-web .
docker build -f apps/crawler-worker/Dockerfile -t searvia-crawler-worker .
docker build -f apps/scheduler-worker/Dockerfile -t searvia-scheduler-worker .
docker build -f apps/report-worker/Dockerfile -t searvia-report-worker .
```

The root verification build may use `http://localhost:3000` when public origins are absent. Never publish that local verification artifact.

## Release sequence

1. Record source revision, lockfile, all queue names/contract versions, migration version, image digests, and configuration revision.
2. Scan dependencies, source, secrets, images, and licenses. Stop for unresolved release-blocking findings.
3. Back up PostgreSQL and test the forward migration on a staging copy of the prior release.
4. Stop new outbox publication and application crawl creation for the maintenance window, while preserving committed `pending` rows.
5. Drain old crawler jobs within the configured grace period. Interrupted work must checkpoint/retry; never mark it complete merely to deploy.
6. Run `pnpm db:migrate` once as the least-privilege migration release job.
7. Deploy the crawler image with both independent consumers using the same environment queue prefix and compatible version-1 contracts. Verify `searvia-crawl-v1` and `searvia-audit-v1` readiness separately plus database/Redis/private-object readiness, without enabling broad egress. Keep rendering disabled unless the reviewed Chromium image and rendering gates passed.
8. Deploy the scheduler/outbox worker, recover expired publication leases, and verify typed routing to the crawl, audit, and crawl dead-letter queues in the intended namespace.
9. Deploy dynamic web replicas and verify liveness/readiness inside the service network.
10. Re-enable crawl creation/outbox intake, then run an authorized staging smoke crawl against a controlled public fixture.
11. Verify session/login/logout, tenant isolation, idempotent create, queue handoff, progress polling, cancellation, page list/detail, sitemap/graph persistence, private artifact metadata, interrupted-write resume, terminal/dead-letter state, and product-honest empty audit state.
12. Observe errors, outbox age, queue depth, stalled/blocked crawls, dead letters, database/Redis/object saturation, artifact divergence, rendering failures, and egress denials before completing rollout.

Do not delete pending/dead-letter queue or outbox records as cleanup. Reconciliation and replay are explicit authorized operator actions.

## Migrations

Application containers do not auto-migrate. A single release job uses the migration role, has a bounded timeout, and records the resulting version. Prefer expand/backfill/contract so old/new replicas overlap safely. If migration fails, stop rollout and use the reviewed roll-forward/rollback plan; never mutate an applied migration.

`0002_m2-safe-crawler-queue.sql` is additive to the M1 schema. `0003`–`0004` add and correct M3 extraction, graph, sitemap, and artifact persistence. `0005`–`0006` harden M2 indexes and queue identity. `0007`–`0011` add immutable audit reports/findings and complete definition/result coverage. `0012`–`0016` add conservative extraction, canonical, robots, link, redirect, and response-sniff provenance. `0017`–`0019` add bounded document/heading/encoding/viewport/icon and visible-text completeness for the expanded catalog. Existing rows default to incomplete rather than being backfilled with guessed evidence. Drain crawler/audit consumers and let active pre-release crawls finish before applying `0017`–`0019`; then migrate before starting workers that emit the new provenance, because immutable legacy-false extraction rows will conflict with a post-deploy retry that attempts to rewrite them as complete. Applied migrations remain immutable; corrections are forward migrations.

## Health and readiness

- Liveness proves the event loop responds; it must not depend on every downstream service.
- Readiness checks only dependencies required to serve/consume work and returns generic unavailable state without connection details or tenant data.
- Web readiness requires its dynamic runtime configuration and database access; the historical static `/api/health` asset is not an authenticated-product readiness signal.
- Scheduler readiness requires database/outbox and Redis publisher readiness. It is not proof that a row was published.
- Crawler readiness requires database/executor, BullMQ consumer, and required private-object configuration. When rendering is enabled it also requires the explicit Chromium configuration. Readiness is not proof that a public target, object write, or browser execution will succeed.
- During termination, scheduler polling and crawler intake stop before clients close.

Queue/outbox age, published acknowledgement, execution claim, persisted progress, and explicit integration evidence prove workflow behavior—not a generic health endpoint.

## Queue durability, drain, and recovery

- Use managed Redis persistence appropriate to BullMQ and disable eviction for queue keys.
- Keep the queue prefix stable during a release; changing it creates a separate logical queue and can strand old work.
- Outbox publishers use expiring PostgreSQL leases. A crashed publisher's row returns to `pending`; deterministic BullMQ job ID makes republish safe.
- Crawl workers use persisted execution leases. Duplicate delivery cannot establish a second active execution.
- BullMQ transient retries use capped exponential backoff/jitter. Permanent or exhausted execution failures persist a terminal crawl and one typed dead-letter outbox intent.
- Graceful crawler shutdown calls drain first. When the platform grace expires, active work is aborted/checkpointed and the process closes forcibly.
- Graceful scheduler shutdown stops polling and finishes the active dispatch before closing clients. At its deadline it disconnects Redis and exits nonzero while leaving an ambiguous outbox claim leased for expiry recovery; configure the platform termination grace longer than the application deadline.
- Dead letters are retained for operator diagnosis. Replay requires reviewing the error classification, current authorization/entitlement, contract compatibility, and target safety.

Before production, rehearse publisher crash between Redis success/database acknowledgement, expired outbox lease recovery, worker death during fetch/object write/extraction, incomplete HTML rehydration, cancellation during retry/rendering, Redis/object outage, dead-letter publication failure, and rollback with queued version-1 contracts.

## Network and identity

- Web and workers run as non-root with read-only filesystems where practical, dropped Linux capabilities, bounded CPU/memory/PIDs, and separate service identities.
- PostgreSQL, Redis, and object storage remain private. Only required applications can reach them.
- Crawler workers use a dedicated outbound subnet/proxy/firewall that denies internal, metadata, private, reserved, and unsafe-port destinations while allowing validated public HTTP(S).
- Scheduler workers need database/Redis only and no general public egress. Report workers generally need database/object storage only.
- Administrative consoles and database access require private networking and strong operator authentication.

Application SSRF validation remains mandatory even with firewall controls. Firewall controls remain mandatory defense in depth even with passing unit tests.

## Scaling and capacity

- Scale web on bounded request latency/concurrency, not crawl volume.
- Scale scheduler publication on outbox age and database/Redis capacity while preserving lease correctness.
- Scale crawler workers on queue depth, pages/minute, per-host fairness, memory, and egress, with global/per-host backpressure.
- Keep the total database pool below the managed budget across all replicas and release overlap.
- Scale report workers independently when M7 implements exports.
- Do not introduce partitioning or network-enabled/browser-navigation rendering fleets without measured need and a new security review.

## Observability and alerts

Production logs include service/environment/level/time/trace and safe error metadata. Release gates require metrics/dashboards/alerts for:

- authentication and authorization failures;
- outbox pending age, expired leases, publication retries/exhaustion, and acknowledgement deferral;
- crawl-execution, audit-evaluation, and crawl dead-letter queue depth and failed jobs, reported separately;
- crawl status age, progress rate, cancellation latency, partial/failed completion, and blocked destinations;
- database pool/statement saturation and Redis availability/persistence;
- worker shutdown timeout/checkpoint/retry behavior;
- object writes/conflicts/reconciliation, extraction/render failures, and later provider/report/deletion failures.

Metrics and traces use opaque tenant/project/crawl identifiers only when required and access controlled. Never place credentials, raw session/queue payloads, customer page content, or credential-bearing URLs in telemetry.

## Backup, rollback, and recovery

- Enable encrypted automated PostgreSQL backups and point-in-time recovery; version object storage where policy permits.
- Test restore and schema migration before release. Redis queue persistence is not a substitute for PostgreSQL backup.
- Keep source/image/config/migration/contract provenance for every release.
- Code rollback is allowed only while schema and all version-1 queue contracts/names remain backward compatible; an older crawler that listens only to `searvia-crawl-v1` cannot drain `searvia-audit-v1`, so otherwise use the reviewed roll-forward plan.
- Reconcile PostgreSQL crawl/outbox state with BullMQ jobs after queue/worker incidents.
- Dead-letter and partial-crawl recovery are explicit operator workflows; never relabel abandoned work as complete.

## Production checklist

- [ ] All root quality gates and image/security scans pass from a clean checkout.
- [ ] Explicit crawler-security and isolated Redis integration suites pass with retained command output.
- [ ] Dynamic hosting target and `searvia.online` DNS/route rollback are reviewed and staged.
- [ ] Environment values are valid, unique per environment, and stored outside source.
- [ ] Database migration and restore are rehearsed on the prior release schema.
- [ ] Tenant authorization, session/CSRF, SSRF/DNS rebinding, robots, cancellation, duplicate, and dead-letter suites pass.
- [ ] Managed PostgreSQL/Redis/object TLS, private networking, persistence, no-eviction, least privilege, retention, and backup policies are verified.
- [ ] Controlled crawler egress independently denies internal/metadata/private/reserved ranges and unsafe ports.
- [ ] Health, logs, metrics, traces, dashboards, alerts, and incident runbooks are active.
- [ ] Worker drain, publisher acknowledgement recovery, queue retry/dead-letter, cancellation, rollback, and replay paths are rehearsed.
- [ ] No fake metric, audit score, demo record, unsupported coverage claim, or default production credential is present.
