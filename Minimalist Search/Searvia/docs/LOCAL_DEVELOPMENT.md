# Local development

## Prerequisites

- Node.js `24.x`
- Corepack with pnpm `11.x` (the exact version is pinned in root `package.json`)
- Docker Engine with Docker Compose v2
- Git

Run commands from the Searvia repository root. npm and Yarn are unsupported; `pnpm-lock.yaml` is the only lockfile.

## First setup

```bash
corepack enable
pnpm install
```

Create the untracked local environment file:

```powershell
Copy-Item .env.example .env
```

On macOS/Linux, use `cp .env.example .env`. The included database, auth, Redis, and object-storage values are local-only. Do not reuse them outside development or add real/provider credentials to `.env.example`.

## Start local infrastructure

```bash
pnpm infra:up
docker compose ps
```

Compose starts:

| Service       | Local endpoint          | Purpose and health behavior                                                   |
| ------------- | ----------------------- | ----------------------------------------------------------------------------- |
| PostgreSQL 18 | `localhost:5432`        | Product/auth/crawl system of record; `pg_isready` health                      |
| Redis 8       | `localhost:6379`        | Separate BullMQ crawl/audit/dead-letter coordination; `redis-cli ping` health |
| MinIO API     | `http://localhost:9000` | Private S3-compatible storage for gzip raw/rendered M3 page artifacts         |
| MinIO console | `http://localhost:9001` | Local inspection only; use the local example credentials                      |

The one-shot `minio-init` service creates the private development bucket idempotently. `Exited (0)` after successful initialization is expected.

Inspect status and logs:

```bash
docker compose ps
docker compose logs postgres redis minio minio-init
```

Stop services without deleting data:

```bash
pnpm infra:down
```

Named volumes persist PostgreSQL, Redis, and MinIO state. Destructive volume deletion is not an ordinary setup or troubleshooting step.

## Migrate and verify PostgreSQL

With PostgreSQL healthy and `.env` present:

```bash
pnpm db:migrate
pnpm db:check
```

`db:check` verifies connectivity only. It does not prove migrations, tenant isolation, authorization, or crawl behavior.

Generate a migration only after editing the Drizzle schema:

```bash
pnpm db:generate
```

Review the SQL and committed Drizzle metadata. Follow `docs/DATABASE.md`; never edit a migration that has been applied.

## Run Searvia

Start all development processes through Turbo so internal packages build first:

```bash
pnpm dev
```

Or start the dynamic web application and workers in separate terminals:

```bash
pnpm dev:web
```

```bash
pnpm dev:workers
```

Useful single-workspace commands are:

```bash
pnpm exec turbo run dev --filter=@searvia/web
pnpm exec turbo run dev --filter=@searvia/scheduler-worker
pnpm exec turbo run dev --filter=@searvia/crawler-worker
pnpm exec turbo run dev --filter=@searvia/report-worker
```

The web app is available at `http://localhost:3000`. M1/M2 pages require the migrated PostgreSQL database. A crawl request writes only PostgreSQL state/outbox data in the web process. The scheduler/outbox worker routes crawl and terminal audit intents to separate Redis queues. The crawler service runs distinct crawl and audit consumers: crawl work safely fetches the site, while audit work evaluates only an immutable completed or partially completed snapshot. Keep the scheduler and crawler services running to move a crawl beyond `queued` and evaluate its M4A report.

The report worker remains a foundation process; reports are not an M2 capability.

## Create an account and crawl locally

1. Open `http://localhost:3000/signup` and create a local account with a 12–128 character development password.
2. Complete organization and project onboarding. Inputs such as `example.com`, `https://example.com`, and an HTTPS URL with a path normalize to a project origin; onboarding does not fetch the site.
3. Open the project dashboard and start the first crawl. The browser uses an idempotent mutation and polls persisted progress every 1.5 seconds while the crawl is active.
4. Use **Cancel crawl** to request cooperative cancellation.
5. Sign out when finished.

Use only sites you are authorized to crawl. Local loopback fixture servers are deliberately rejected by the production crawler entry point and cannot be made crawlable with an environment toggle.

## Health and readiness

Use `GET http://localhost:3000/api/health` for web liveness. It is not database, Redis, queue, or object-storage readiness. `pnpm db:check` verifies PostgreSQL separately. Worker startup verifies its required Redis/database adapters and emits structured readiness/failure logs without exposing connection details.

Stopping a worker with `Ctrl+C` should begin graceful shutdown:

- The scheduler stops polling, finishes the current bounded outbox dispatch, and closes publisher/persistence handles. At the deadline it disconnects Redis and exits nonzero, intentionally leaving any in-flight outbox claim leased for safe recovery rather than racing a live database operation with closure.
- The crawler stops intake on both the crawl and audit queues and drains both consumers. If `WORKER_SHUTDOWN_TIMEOUT_MS` expires, it cancels and force-closes both; interrupted crawl work checkpoints before retry, and audit report persistence remains idempotent.

A readiness log is not proof that a job ran. PostgreSQL crawl/outbox state plus the explicit Redis integration test provide that evidence.

## Quality commands

Run the complete repository gate:

```bash
pnpm check
```

Or run each stage:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused M1/M2 suites can be run with:

```bash
pnpm --filter @searvia/database test
pnpm --filter @searvia/web test
pnpm --filter @searvia/crawler-core test
pnpm --filter @searvia/test-fixtures test
pnpm --filter @searvia/job-queue test
pnpm --filter @searvia/scheduler-worker test
pnpm --filter @searvia/crawler-worker test
```

The standard root test suite exercises queue contracts and port-backed lifecycle behavior without requiring a live Redis instance. It does not silently claim real Redis delivery.

## Explicit Redis integration test

Start Redis with Compose, choose a dedicated local Redis database, set the opt-in URL, and run the separate suite:

```powershell
$env:REDIS_INTEGRATION_URL = "redis://127.0.0.1:6379/15"
pnpm --filter @searvia/job-queue test:redis
Remove-Item Env:REDIS_INTEGRATION_URL
```

On macOS/Linux:

```bash
REDIS_INTEGRATION_URL=redis://127.0.0.1:6379/15 pnpm --filter @searvia/job-queue test:redis
```

The command creates a unique queue prefix and proves a versioned crawl job reaches only the crawl consumer, an audit job remains pending while only that crawl consumer is running, and the audit job reaches its dedicated consumer after it starts. The suite fails if `REDIS_INTEGRATION_URL` is absent; it never skips silently. Never point it at a shared preview, staging, or production Redis database.

## Crawler security and fixture tests

The crawler-core and test-fixtures suites cover URL/network validation, DNS answer changes, pinned lookup, redirects, robots, recursive/gzip sitemaps, bounded responses/timeouts, extraction/encoding/metadata/graph fixtures, duplicate fingerprints, query traps, server errors, and cancellation/frontier behavior:

```bash
pnpm --filter @searvia/crawler-core test
pnpm --filter @searvia/test-fixtures test
```

Fixture servers and their loopback capability require `NODE_ENV=test`, exact origins, and an opaque capability issued by the separate testing entry point. Do not add a development/production allowlist to make local fixture URLs work in the application.

## Environment reference

| Variable                                                     | Scope         | Local purpose and bound                                                                                                         |
| ------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`, `APP_ENV`                                        | Server        | Runtime mode; production schemas and test capabilities fail closed                                                              |
| `APP_URL`                                                    | Server        | Trusted canonical application origin                                                                                            |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`                | Client-safe   | Public origins only; never credentials                                                                                          |
| `BETTER_AUTH_SECRET`                                         | Server        | Better Auth secret; unique in deployment, local example rejected in production                                                  |
| `LOG_LEVEL`                                                  | Server/worker | Structured log threshold                                                                                                        |
| `DATABASE_URL`, `DATABASE_POOL_MAX`                          | Server/worker | PostgreSQL connection and per-process pool bound                                                                                |
| `DATABASE_CONNECTION_TIMEOUT_MS`, `DATABASE_IDLE_TIMEOUT_MS` | Server/worker | Database connection/pool bounds                                                                                                 |
| `DATABASE_QUERY_TIMEOUT_MS`, `DATABASE_STATEMENT_TIMEOUT_MS` | Server/worker | Query/statement bounds                                                                                                          |
| `REDIS_URL`, `REDIS_CONNECT_TIMEOUT_MS`                      | Worker        | BullMQ Redis connection and startup timeout                                                                                     |
| `QUEUE_PREFIX`                                               | Worker        | Environment-isolated BullMQ prefix; defaults to `searvia-<NODE_ENV>`                                                            |
| `CRAWL_WORKER_CONCURRENCY`                                   | Worker        | BullMQ worker concurrency, 1–32; default 2                                                                                      |
| `CRAWL_JOB_ATTEMPTS`                                         | Worker        | Execution attempts, 1–10; default 4                                                                                             |
| `CRAWL_EXECUTION_LEASE_MS`                                   | Worker        | PostgreSQL execution lease, 30000–900000 ms; default 300000                                                                     |
| `CRAWL_JOB_BACKOFF_MS`, `CRAWL_JOB_BACKOFF_JITTER`           | Worker        | Exponential retry base and jitter; defaults 1000 ms / 0.5                                                                       |
| `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_LEASE_MS`                 | Worker        | Publisher poll/lease bounds; defaults 500 / 30000 ms                                                                            |
| `OUTBOX_BATCH_SIZE`, `OUTBOX_MAX_PUBLISH_ATTEMPTS`           | Worker        | Publisher batch and capped attempts; defaults 20 / 10                                                                           |
| `WORKER_HEALTH_INTERVAL_MS`, `WORKER_SHUTDOWN_TIMEOUT_MS`    | Worker        | Health-log and graceful-stop bounds                                                                                             |
| `OBJECT_STORAGE_*`                                           | Server/worker | Private MinIO/S3 endpoint, bucket, credentials, path style, session token, and request timeout for M3 artifacts                 |
| `CRAWL_ARTIFACT_MAX_HTML_BYTES`                              | Crawler       | Maximum uncompressed raw/rendered artifact input, 1 KiB–5,000,000 bytes; default and ceiling 5,000,000                          |
| `CRAWL_RENDERING_ENABLED`                                    | Crawler       | Deployment gate; false by default and still requires the project setting                                                        |
| `CRAWL_RENDER_BROWSER_EXECUTABLE`                            | Crawler       | Explicit Chromium path; required only when the deployment rendering gate is true                                                |
| `CRAWL_RENDER_*`                                             | Crawler       | Browser time, settle, quiet, input/output, blocked-request, V8 heap, and close bounds; input/output byte ceilings are 5,000,000 |
| `POSTGRES_*`, `MINIO_ROOT_*`                                 | Compose only  | Local service initialization                                                                                                    |
| `REDIS_INTEGRATION_URL`                                      | Test only     | Explicit isolated Redis target for `test:redis`; never set in production                                                        |
| `SEARVIA_ENABLE_DEV_SEED`, `SEARVIA_DEV_SEED_EMAIL/PASSWORD` | Development   | Explicit seed policy; production refuses enablement                                                                             |

OAuth, billing, email-delivery, SEO-provider, backlink-provider, and AI-provider variables remain absent until a milestone validates and uses them. Server secrets never receive a `NEXT_PUBLIC_` prefix.

## Troubleshooting

- **Wrong Node/pnpm:** run `node --version` and `pnpm --version`; use the versions declared in `package.json`.
- **Port in use:** identify the owning process before changing Compose ports. Keep examples, docs, and health checks aligned if a project-wide change is approved.
- **Database not migrated:** run `docker compose ps`, inspect `docker compose logs postgres`, then run `pnpm db:migrate`. Do not increase timeouts to hide a failed service.
- **Crawl stays queued:** ensure Redis is healthy and both scheduler/crawler workers are running; inspect safe structured logs and the PostgreSQL outbox state.
- **Artifact write fails:** confirm `minio-init` exited successfully, the configured bucket matches, and the endpoint/credentials are reachable from the crawler process. Do not make the bucket public.
- **Rendering is unavailable:** rendering is intentionally off by default. When testing it, set the deployment gate and an explicit compatible Chromium executable; the project must also enable rendering and raw evidence must meet the render heuristic.
- **Worker exits on startup:** read the validation/dependency error. Missing production values and unreachable dependencies are intentional hard failures.
- **Target blocked:** a private/reserved address, unsafe port, redirect, malformed URL, or unsupported protocol is expected to fail. Do not weaken validation for convenience.
- **Redis integration suite fails immediately:** set `REDIS_INTEGRATION_URL` to an isolated reachable database; the suite intentionally refuses to skip.
- **Docker unavailable:** run the non-infrastructure checks that remain possible and record the exact Compose/Redis limitation rather than claiming integration passed.
