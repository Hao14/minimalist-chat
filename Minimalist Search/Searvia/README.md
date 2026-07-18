# Searvia

**Search visibility, made clear.**

Searvia is a browser-based platform for auditing a website and, in later milestones, understanding its visibility across search engines and AI retrieval systems. This repository contains the public website, authenticated multi-tenant application, safe crawler, durable job workers, shared packages, and local infrastructure.

## Current status

The source implementation for milestones M0 through M3, the M4A rule-engine slice, and a partial M5 catalog expansion is present. Users can create an account, create an organization and project, configure a crawl, start or cancel it from the project dashboard, and observe real persisted lifecycle/progress counters. PostgreSQL is the source of truth; a transactional outbox publishes versioned work to BullMQ, and `crawler-worker` safely discovers allowed public pages while honoring robots.txt and configured limits. M3 extracts queryable page evidence, persists the internal URL graph and recursive sitemap results, and writes compressed source artifacts to private S3-compatible storage. The active worker catalog evaluates 130 CRW/HTTP/RSM/URL/ONS/CNT/LNK definitions on a separate durable queue and persists immutable occurrences plus cross-crawl finding lifecycle and dispositions. Objective checks are deterministic; qualitative or unavailable checks remain `Manual review` or `Not checked`. Production acceptance still depends on the documented environment-specific migration, Redis, object-storage, browser, security, and release checks; source presence is not evidence those gates passed.

The partial M5 implementation does not calculate or display a crawl score. Findings APIs/UI, the remaining 60 approved definitions, and the complete scoring model remain later work. Keyword research, rank tracking, backlink monitoring, and AI-answer monitoring remain integration-dependent future modules. The existing `/demo` experience is an isolated, visibly labeled deterministic design fixture; it is not customer or provider data.

## Architecture

- `apps/web` — Next.js 16 public site, authenticated SaaS UI, and short-lived HTTP/API handlers
- `apps/crawler-worker` — separate BullMQ crawl and audit consumers, safe discovery, extraction, private artifact writes, optional bounded rendering, and persisted audit evaluation
- `apps/scheduler-worker` — PostgreSQL transactional-outbox publisher for crawl execution, audit evaluation, and dead-letter jobs
- `apps/report-worker` — report generation boundary; report execution remains a later milestone
- `packages/*` — audit, crawl, database, provider, scoring, configuration, logging, UI, shared-type, and test-fixture boundaries
- PostgreSQL — durable source of truth for authentication, tenants, projects, crawls, progress, structured page/sitemap evidence, graph records, artifact references, leases, and outbox state
- Redis/BullMQ — durable worker coordination infrastructure, never the product system of record
- MinIO — local private S3-compatible storage for compressed raw and rendered HTML artifacts

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and [`docs/PHASE_1_PLAN.md`](./docs/PHASE_1_PLAN.md) for the implementation sequence.

## Prerequisites

- Node.js 24 LTS
- pnpm 11.7 through Corepack
- Docker Desktop or another Docker Engine with Compose v2

## Install

From this Searvia directory:

```powershell
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

The values in `.env.example` are local-only defaults. Never reuse them outside local development.

## Start local infrastructure and migrate

```powershell
pnpm infra:up
pnpm db:migrate
pnpm db:check
```

Compose starts PostgreSQL on `5432`, Redis on `6379`, the MinIO API on `9000`, and the MinIO console on `9001`. It creates the private `searvia-local` bucket after MinIO becomes healthy.

## Run the product

Run the website alone:

```powershell
pnpm dev:web
```

Run the crawler, outbox, and report processes after PostgreSQL and Redis are healthy:

```powershell
pnpm dev:workers
```

Or run the website and workers together:

```powershell
pnpm dev
```

Open `http://localhost:3000`. Health is available at `http://localhost:3000/api/health`.

## Quality checks

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the deterministic local gate with `pnpm check`. The checked-in CI workflow executes the same checks from a frozen lockfile when Searvia is the repository root. Environment-dependent Redis delivery is a separate gate: with a disposable Redis instance running, execute `pnpm --filter @searvia/job-queue test:redis`. Neither `pnpm check` nor the current CI workflow starts Redis or runs that integration.

## Hosting posture

Authentication and crawl APIs make the current application dynamic. The historical M0 static-export commands have been removed so they cannot publish an application without its required server runtime, PostgreSQL, Redis, sessions, and worker processes. `searvia.online` remains the intended canonical origin, but this repository does not claim that a production full-stack target or managed dependencies have been provisioned. See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) before changing DNS or deploying.

## Production build and processes

```powershell
pnpm build
pnpm --filter @searvia/web start
pnpm --filter @searvia/crawler-worker start
pnpm --filter @searvia/scheduler-worker start
pnpm --filter @searvia/report-worker start
```

Production processes require platform-provided environment variables. Do not deploy the Compose credentials. Deployment responsibilities and container guidance are in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Database changes

Edit `packages/database/src/schema.ts`, generate a migration, inspect the SQL, and commit both schema and migration artifacts:

```powershell
pnpm db:generate
pnpm db:migrate
```

Production uses migrations only; schema push is prohibited. See [`docs/DATABASE.md`](./docs/DATABASE.md).

## Known limitations

- The active partial-M5 catalog executes and persists 130 CRW/HTTP/RSM/URL/ONS/CNT/LNK definitions; the remaining 60 definitions, findings APIs/UI, and audit scores are not implemented yet.
- Provider-backed keyword, rank, backlink, and AI-answer data; billing; schedules; and report artifacts are not live yet and are never fabricated.
- A production dynamic web runtime, managed PostgreSQL/Redis/object storage, controlled crawler egress, and monitoring stack still require deployment-specific provisioning and rehearsal.
- Local services are intentionally unauthenticated or use well-known local credentials and must not be internet-exposed.
- The Searvia directory currently lives inside a separate parent repository; commands, staging, and CI must remain scoped to this directory until it is extracted or deliberately integrated.
- GitHub does not discover nested `.github/workflows` directories. The included workflow becomes active when Searvia is extracted as its own repository; until then, a parent-root workflow must deliberately invoke these path-scoped commands.

## Security reporting

Do not disclose vulnerabilities or secrets in a public issue. Follow [`SECURITY.md`](./SECURITY.md) for private reporting and [`docs/SECURITY.md`](./docs/SECURITY.md) for engineering requirements.
