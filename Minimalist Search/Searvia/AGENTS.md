# Searvia repository guidance

## Product

Searvia is a multi-tenant search-visibility SaaS. Phase 1 is a real technical SEO and AI-readiness website auditor; keyword, rank, backlink, and AI-answer data remain integration-dependent future modules. Never represent unavailable capabilities or fabricated observations as live data. See `docs/PRODUCT_SPEC.md` and `docs/PHASE_1_PLAN.md`.

## Repository layout

- `apps/web`: public website, SaaS UI, and short-lived HTTP handlers.
- `apps/crawler-worker`: crawl execution boundary.
- `apps/scheduler-worker`: scheduled-job boundary.
- `apps/report-worker`: export and report boundary.
- `packages/database`: Drizzle schema, migrations, connections, and database health.
- `packages/crawler-core`, `audit-engine`, `scoring`: deterministic Phase 1 domain logic.
- `packages/provider-adapters`: integration contracts; never synthetic provider results.
- `packages/shared-types`, `ui`, `config`, `logging`, `test-fixtures`: shared foundations.
- `docs`: product, architecture, security, database, audit, development, and deployment decisions.

## Architecture rules

1. Keep request/response work in `web`; crawls and reports run in workers.
2. Keep domain logic in packages, not route handlers or React components.
3. Validate all external input at trust boundaries and keep TypeScript strict.
4. Use PostgreSQL for normalized product data, Redis for durable job coordination, and S3-compatible storage for large artifacts.
5. Access the database through `@searvia/database`; do not create ad hoc pools.
6. Send background work through typed, idempotent job contracts once queues are introduced in M2.
7. Keep provider-specific behavior behind `@searvia/provider-adapters`.
8. Preserve server/client boundaries. A value is client-safe only when deliberately exposed by the client environment schema.
9. Prefer deterministic audit evidence. AI-assisted analysis must be labeled, evidenced, versioned, and reviewable.
10. Update `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, and `docs/DECISIONS.md` whenever an architectural boundary changes.

## Toolchain and commands

Use Node.js 24 and pnpm 11 through Corepack. Do not use npm, Yarn, or commit a second lockfile.

```bash
pnpm install
pnpm dev
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Local services and migrations:

```bash
docker compose up -d
pnpm db:migrate
docker compose down
```

Run a single workspace with `pnpm --filter <workspace-name> <script>`. See `docs/LOCAL_DEVELOPMENT.md` for exact setup and health checks.

## Database and migrations

- Generate migrations from the committed Drizzle schema, then review the SQL.
- Never edit an already-applied migration; create a forward migration.
- Make additive changes before destructive changes and document backfills.
- Migration code must not depend on a web process starting.
- Add constraints and tenant-aware indexes with the schema change.
- Run migration tests before merging. See `docs/DATABASE.md`.

## Security and multi-tenancy

- Every protected server action, query, mutation, job, export, and object key must verify the authenticated user's organization membership and resource scope server-side.
- Never trust an organization or project ID merely because the client supplied it. Scope the data access itself by tenant; a UI check is not authorization.
- Never expose or log secrets, tokens, cookies, authorization headers, crawl credentials, raw session data, or provider credentials.
- Redact sensitive fields in structured logs and preserve trace IDs and safe error details.
- Crawler code must enforce the SSRF and DNS-rebinding controls in `docs/SECURITY.md` before every request and redirect.
- Never render customer HTML as trusted dashboard markup.
- Use least-privilege service and database identities. Production secrets must fail closed when missing.

## Data integrity and product honesty

- No fabricated scores, rankings, backlinks, traffic, citations, mentions, customer data, jobs, or crawl results.
- Clearly label deterministic fixture data as test or demo data and keep it isolated from live records.
- Every displayed metric needs a source, retrieval time, and coverage limitation.
- `Not checked` is never equivalent to `Passed` and is excluded from score denominators.
- Features that need an unavailable integration show a disabled state, explanation, and setup action.

## Definition of done

A change is done only when its observable behavior is complete; affected docs and migrations are committed; security and tenant boundaries are covered; no misleading placeholder data was added; and relevant format, lint, typecheck, test, and build commands pass. Record environmental failures accurately rather than suppressing them.

## Prohibited practices

- Long crawls in web request handlers.
- Client-side authorization as the only access control.
- Cross-tenant queries without tenant scoping.
- Direct consumer SERP or AI-chat scraping that violates provider terms.
- Silently swallowed errors or fabricated fallback results.
- Logging secrets or embedding server credentials in public environment variables.
- Disabling lint rules, loosening strict TypeScript, broad `any`, or unchecked casts to make checks pass.
- Copying Semrush branding, wording, proprietary metrics, data, or interface layouts.
- Unnecessary dependencies, placeholder packages that do not compile, or generated artifacts committed without purpose.
