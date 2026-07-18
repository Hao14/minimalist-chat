# Searvia Phase 1 implementation plan

## Delivery strategy

Phase 1 is a sequence of independently reviewable vertical milestones. A later milestone cannot compensate for a failed earlier security, migration, tenant-isolation, or data-honesty gate. Each milestone ends with root format, lint, typecheck, test, and build checks plus the feature-specific tests listed below.

The repository contains the M1 dynamic authentication/tenant implementation, M2 crawl-control/queue/safe-fetch implementation, M3 extraction, recursive-sitemap, URL-graph, private-artifact, page-query, and optional-rendering implementation, the M4A versioned engine/persistence implementation, and the partial `m5-partial-3` expansion to 130 active CRW/HTTP/RSM/URL/ONS/CNT/LNK rules. The ONS/CNT/LNK expansion selects 36 version-1, 21 version-2, and 8 version-3 definitions so corrected semantics and evidence do not reinterpret historical versions. That statement describes source scope only. M5 is not complete: 60 approved definitions, the 140-objective-check acceptance gate, score formula, aggregates, APIs, and UI remain. The acceptance checklist remains unchecked until the exact migration, security, Redis/object/browser integration, rule-integration, quality, and deployment commands have produced reviewable evidence in their intended environments.

Live, disabled, and future states must be explicit:

- **Live:** backed by real application or crawl data.
- **Disabled integration:** requires an unavailable approved provider and shows setup guidance.
- **Manual review:** the application has evidence but cannot make a deterministic conclusion.
- **Not implemented:** no action or metric suggests otherwise.

## Milestone map

| Milestone | Outcome                                       | Primary dependency        |
| --------- | --------------------------------------------- | ------------------------- |
| M0        | Executable repository foundation              | Existing Searvia frontend |
| M1        | Authenticated organizations and projects      | M0 database/config/web    |
| M2        | Safe durable crawl queue and fetcher          | M1 ownership and limits   |
| M3        | Extraction and immutable crawl persistence    | M2 fetch pipeline         |
| M4        | Versioned engine and first 65 objective rules | M3 observations           |
| M5        | Complete executable catalog and scoring       | M4 engine                 |
| M6        | Evidence-first audit UI                       | M5 aggregates             |
| M7        | History, comparison, CSV, and schedules       | M6 findings               |
| M8        | Security, reliability, observability, release | Complete vertical slice   |

## M0 — Repository foundation

- **Goal:** Establish a clean, executable Node 24/pnpm 11/Turbo monorepo without claiming product capabilities that do not exist.
- **Affected:** all required app/package directories, root configuration, CI, Compose, documentation, and existing `apps/web` presentation.
- **Database:** Drizzle configuration, committed migration mechanism, lazy connection module, and `SELECT 1` health check; no speculative product tables.
- **API:** public/app route foundations and health/readiness endpoints only.
- **UI:** exact Searvia homepage copy, responsive public and application shells, `/app`, `/app/projects`, and `/app/settings` foundation states with no fake data.
- **Workers:** crawler, scheduler, and report processes validate environment, log structured startup/readiness, verify Redis where required, and stop gracefully; no jobs.
- **Tests:** environment/config, database config, health endpoint, worker startup config, workspace imports, and existing web behavior.
- **Security:** server/client environment separation, log redaction, safe local-only example credentials, no secret in the client bundle.
- **Dependencies:** PostgreSQL, Redis, MinIO; no queue, crawler, auth, or provider SDK before use.
- **Acceptance:** install, Compose validation, format, lint, typecheck, unit tests, and production builds succeed; all workspaces compile; docs and setup commands match the repository.
- **Risks:** preserving the existing frontend while changing package management; nested-repository assumptions; local Docker availability. Record environmental failures exactly.

## M1 — Authentication, organizations, and projects

- **Goal:** A real user can authenticate, create an organization, create an owned website project, configure a bounded crawl, and sign out.
- **Affected:** `apps/web`, `packages/database`, `shared-types`, `config`, `logging`, and test fixtures.
- **Database:** Better Auth users/accounts/sessions/verifications/rate-limit records; organizations, memberships and client project scopes, invitations, projects, project verifications, crawl configuration, and audit logs with tenant-aware constraints/indexes.
- **API:** Better Auth route, validated server actions for onboarding/project/team work, and tenant-aware repository methods with stable domain errors.
- **UI:** sign-up/login, organization onboarding, project list/create/detail, crawl settings, team invitation state, sign-out, and intentional empty/error/access-denied states.
- **Workers:** none for M1; submitting a website does not fetch it.
- **Tests:** auth/session policy, organization creation, project/domain validation, role matrix, invitation behavior, IDOR/cross-tenant denial, migration up on a clean database, and protected routes/actions.
- **Security:** Better Auth password hashing/session handling, HttpOnly/SameSite/Secure cookie policy, trusted-origin/CSRF controls, authentication rate limits, normalized origins, server-side membership checks, project-scoped client reads, and sensitive-action audit logs.
- **Dependencies:** Better Auth with the Drizzle adapter; transactional invitation email remains disabled until a real delivery provider is configured.
- **Acceptance:** two organizations cannot observe or mutate one another; invalid/duplicate domains are handled; no protected data is rendered before authorization.
- **Risks:** auth-library coupling, invitation enumeration, domain ownership ambiguity, and accidental unscoped repositories.

## M2 — Safe crawler and durable queue

- **Goal:** An authorized owner, admin, or analyst can enqueue, observe, cancel, and safely execute a bounded real crawl without running audit rules.
- **Affected:** `apps/web`, `crawler-worker`, `scheduler-worker`, `crawler-core`, `job-queue`, `database`, `shared-types`, `config`, `logging`, and test fixtures.
- **Database:** immutable crawl configuration snapshots, lifecycle/counters/execution leases, frontier, checkpoints, per-origin robots results, bounded M2 page-fetch observations, usage reservations, job outbox/idempotency, and crawl audit events.
- **API:** create/list/get/cancel crawls and authenticated no-store polling; all reads/mutations are tenant/project scoped and entitlement checked.
- **UI:** start/cancel controls, queued/validating/discovering/crawling/cancelled/failed/partially-completed/completed states, real counters, and 1.5-second polling while active. No audit score is displayed.
- **Workers:** PostgreSQL transactional outbox publisher, BullMQ execution and dead-letter queues, deterministic job IDs, bounded exponential retry/jitter, execution leases, cancellation, persisted checkpoints, graceful drain/abort, robots/sitemap discovery, and safe HTTP fetch.
- **Tests:** URL normalization/IDNA, blocked host/address classes, DNS rebinding and redirect-to-private simulation, unsafe ports, robots, sitemap, breadth-first frontier/dedupe/query traps, size/decompression/time/redirect limits, retries, cancellation, duplicate delivery, fixtures, and explicit Redis queue integration.
- **Security:** validate every DNS answer and pin the accepted addresses before connection; freshly resolve/revalidate/pin each redirect; HTTP(S) without credentials only; private/loopback/link-local/CGNAT/multicast/reserved/metadata blocking; total/request/resource limits; controlled user agent; per-host pacing; test capability unavailable to production callers.
- **Dependencies:** BullMQ and ioredis; crawler HTTP, robots, sitemap, and frontier behavior use bounded Node primitives with no browser rendering.
- **Acceptance:** a permitted public target fetches within configured limits; unsafe targets never receive a request; duplicate jobs do not duplicate crawl state; robots and cancellation are respected.
- **Risks:** TOCTOU DNS attacks, URL normalization mistakes, crawl traps, unbounded memory, transient network classification, and robots edge cases.

## M3 — Page extraction and crawl persistence

- **Goal:** Persist reproducible crawl snapshots and structured page observations from real responses.
- **Affected:** `crawler-core`, `crawler-worker`, `database`, `shared-types`, `test-fixtures`, and MinIO integration.
- **Database:** expand the minimal M2 crawl-page observations with structured redirects, links, resources, headings, images, structured data, sitemaps/sitemap URLs, artifact metadata, content/similarity hashes, and extraction-stage counters.
- **API:** paginated crawl-page list/detail and progress reads with stable cursors and tenant scope.
- **UI:** crawl progress detail and basic crawled-pages/page-evidence views without scores.
- **Workers:** parse raw HTML, resolve links, discover sitemaps/frontier, extract source metadata, upload compressed artifacts, recover incomplete HTML from verified private objects, and finalize immutable snapshots; bounded rendering is a separately gated path.
- **Tests:** missing metadata, multiple canonical/H1, conflicting robots directives, invalid JSON-LD, broken HTML, legacy encodings, relative/base URLs, client-rendered source, sitemap indexes/gzip, exact/near duplicates, object-write failure, artifact recovery, and replay behavior.
- **Security:** content-type and byte limits before parsing, safe parser configuration, private artifact access control and platform encryption requirements, sanitized display, object keys include tenant scope without secrets.
- **Dependencies:** bounded HTML/XML parsers, native SigV4 S3-compatible object adapter, and an optional injected `playwright-core` Chromium adapter.
- **Acceptance:** every stored observation points to its crawl and tenant, raw and rendered sources are distinguished, frontier dedupes normalized URLs, and a restart resumes without duplicate pages.
- **Risks:** hostile markup, decompression bombs, large DOMs, artifact/database divergence, hash instability, and rendering resource exhaustion.

The M3 source implementation and forward migrations `0003` and `0004` are present. This is not a claim that environment-dependent PostgreSQL, Redis, S3-compatible storage, browser-image, or release checks have passed; acceptance still requires recorded execution evidence in the target environment.

## M4 — Audit-rule engine and first technical rules

- **Goal:** Execute the independently testable, versioned M4A objective catalog: `CRW-001`–`CRW-015`, `HTTP-001`–`HTTP-015`, `RSM-001`–`RSM-015`, and `URL-001`–`URL-020`.
- **Affected:** `audit-engine`, `database`, `shared-types`, crawler/scheduler integration, and later audit APIs.
- **Database:** immutable rule IDs and hashed versions; one tenant/project/crawl evaluation run and manifest; versioned occurrences; cross-crawl findings with first/last-seen lifecycle; separately authorized ignored/accepted-risk dispositions.
- **API:** crawl findings list/detail and occurrence reads remain part of the complete M4 surface; no score claims are permitted before the M5 model is present.
- **UI:** a findings table/detail remains part of the complete M4 surface and must show eligibility, evidence, explanation, remediation, source, confidence, and rule version without implying a score.
- **Workers:** evaluation consumes a completed or partially completed immutable crawl snapshot outside the web request, selects one version per rule, isolates detector failures, and persists a tenant-scoped immutable report. `audit.evaluate` uses its own versioned durable queue and consumer, separate from `crawl.execute`; delivery and retry behavior remain idempotent.
- **Tests:** engine contract, unique catalog registration, eligibility/status invariants, evidence serialization/bounds, failure isolation, repeatability, passing/failing/boundary-or-unavailable fixtures for every M4A rule, completed-crawl integration, lifecycle/disposition behavior, and cross-tenant persistence denial.
- **Security:** never execute stored page code; safely render and bound evidence; avoid sensitive content in evidence/logs; tenant-scope snapshot reads, report writes, finding reads, and dispositions.
- **Dependencies:** M3 immutable observations; no LLM is used for these objective checks.
- **Acceptance:** all 65 definitions reproduce the same evidence from the same versioned snapshot, unavailable/ineligible data is never passed, every issue has an exact fix, and persisted lifecycle does not treat `Not checked` as `Fixed`.
- **Risks:** inconsistent eligibility, unstable target identity, rule-version drift, duplicate findings, vague or sensitive evidence, missing snapshot observations, and detector coupling to UI wording.

The M4A engine/rule source and forward audit-persistence migrations are present. This is not a claim that the complete worker/API/UI surface or any validation command has passed; acceptance still requires recorded execution evidence for the exact source and environment under review.

## M5 — Complete objective catalog and scoring

- **Goal:** Complete executable definitions for the approved 190-rule catalog, execute at least 140 objective checks when eligible, and calculate transparent scores from stored results.
- **Affected:** `audit-engine`, `scoring`, `database`, fixtures, workers, and score explanation API.
- **Database:** category/score aggregates, evaluated/not-checked coverage, score model version, cap reasons, and any required performance samples.
- **API:** category/overall score breakdown and rule-coverage endpoints; provider/manual checks retain explicit non-passing states.
- **UI:** score explanation, evaluated coverage, category breakdown, cap reason, and labels for manual, AI-assisted, integration-required, and not checked.
- **Workers:** complete objective evaluation, aggregation, and reproducible score calculation; expensive performance checks use explicit sampling.
- **Tests:** every rule definition contract, at least one eligible positive/negative fixture for executable rules, formula/property tests, caps, denominator exclusion, and snapshot reproducibility.
- **Security:** performance/browser tasks isolated and budgeted; no provider call without entitlement and explicit configuration.
- **Dependencies:** M4 engine; approved performance provider optional and absence must produce `Not checked`.
- **Acceptance:** all 190 IDs are registered, at least 140 objective checks execute when eligible, every result has evidence/remediation, and `Not checked` never improves a score.
- **Risks:** false positives, threshold disputes, catalog-count drift, performance cost, and scores hiding crawl coverage.

Current source status: ONS-001–ONS-025, CNT-001–CNT-020, and LNK-001–LNK-020 are registered as immutable M5 definitions and run in the active 130-rule worker manifest. The expansion selects 36 version-1, 21 version-2, and 8 version-3 definitions so corrected semantics and evidence remain versioned. Objective detectors are bounded and deterministic; rules that require semantic or business-context judgment return `Manual review` or `Not checked` without an LLM. The scoring package excludes both states from objective coverage, but no score formula or aggregate is implemented. This partial status does not satisfy M5 acceptance.

## M6 — Audit dashboard and page-level evidence

- **Goal:** Make a completed real audit actionable without obscuring evidence or data limitations.
- **Affected:** `apps/web`, `ui`, findings/page APIs, database read models, and accessibility tests.
- **Database:** read-model/aggregate indexes only; do not duplicate source evidence without an invalidation strategy.
- **API:** paginated/filterable/sortable findings and pages with stable cursors; issue status mutation with audit history.
- **UI:** overview, issues, crawled pages, page detail, internal links, sitemaps, performance, crawl settings; filters, evidence drawer, exact fix and verification guidance.
- **Workers:** aggregate read models after crawl completion; never recompute the complete crawl on dashboard requests.
- **Tests:** filters/sorts/cursors, large lists, accessibility/keyboard/mobile behavior, empty/partial/failed crawls, unsafe HTML rendering, and cross-tenant reads.
- **Security:** authorization on every detail/occurrence/status action, safe text rendering, CSP, export-safe formulas, and traceable errors.
- **Dependencies:** M5 complete findings and aggregates.
- **Acceptance:** a user can locate an issue, inspect affected URLs and source evidence, understand the fix, and distinguish observed, estimated, manual, and not-checked data.
- **Risks:** dense responsive tables, N+1 queries, stale aggregates, client-side filtering leaks, and inaccessible charts.

## M7 — Crawl history, comparison, exports, and schedules

- **Goal:** Show what changed between immutable crawls and deliver safe CSV exports and reliable schedules.
- **Affected:** web, scheduler/report workers, audit/scoring/database packages, object storage, and notifications boundary.
- **Database:** comparisons, finding lifecycle links, annotations, schedules, reports/exports, object metadata, revocable share primitives only if in scope, notification outbox.
- **API:** history/comparison, annotation, export creation/status/download, and schedule CRUD with tenant scope and entitlement checks.
- **UI:** history selector, comparison dashboard, new/existing/returned/fixed states, annotations, CSV export, schedule settings, pending/failed report states.
- **Workers:** comparison jobs, confirmation logic for transient regressions, timezone-safe scheduling, resumable report generation, signed short-lived downloads.
- **Tests:** normalized URL/rule matching, added/removed pages, returned/fixed findings, score deltas, timezone/DST schedules, duplicate scheduler delivery, CSV escaping/formula injection, report access and expiry.
- **Security:** signed non-guessable downloads, no secrets in URLs, tenant-scoped object keys, export authorization at creation and download, recipients validated.
- **Dependencies:** M6 read models and immutable crawl snapshots.
- **Acceptance:** a second crawl produces correct lifecycle states and a safe CSV; schedules enqueue once at the intended local time; failures are visible and retryable.
- **Risks:** ambiguous URL changes, false transient alerts, DST duplication, large exports, spreadsheet injection, and stale signed links.

## M8 — Security hardening, testing, observability, and release readiness

- **Goal:** Prove the complete Phase 1 vertical slice is safe, operable, recoverable, and deployable.
- **Affected:** every workspace, CI/CD, infrastructure, runbooks, dependencies, and docs.
- **Database:** retention/deletion jobs, backup/restore verification, audit completeness, final indexes, migration rehearsal; partition only when evidence justifies it.
- **API:** consistent rate limits, security headers, request IDs, bounded errors, readiness, and operational endpoints protected as appropriate.
- **UI:** final responsive/accessibility pass; complete empty/error/recovery states; privacy/export/deletion controls required by Phase 1 policy.
- **Workers:** concurrency/backpressure tuning, queue metrics, dead-letter runbooks, graceful deploy drains, resource limits, cancellation/recovery drills.
- **Tests:** full unit/integration/E2E suite, migration from empty and previous release, load tests, authorization matrix, crawler attack suite, malicious HTML, forged/expired tokens, backups and restore.
- **Security:** threat-model signoff, dependency/secret scanning, least privilege, encrypted credentials, CSP/CSRF/session review, controlled crawler egress, data-retention enforcement.
- **Dependencies:** completed M1–M7 behavior; staging environment resembling production.
- **Acceptance:** all 30 Phase 1 product criteria below pass with evidence; dashboards/alerts/runbooks work; rollback and restore are rehearsed; no high-severity security finding remains.
- **Risks:** production-only behavior, queue/database saturation, egress policy gaps, incomplete deletion, monitoring noise, and release pressure bypassing gates.

## Phase 1 acceptance checklist

- [ ] A user can create an account and workspace.
- [ ] The user can add `https://minimalist.chat` as a project and the URL is safely validated.
- [ ] A real crawl starts only after an authorized user requests it.
- [ ] Crawl progress, partial completion, cancellation, and failure are observable.
- [ ] robots.txt is evaluated; sitemaps are discovered and parsed.
- [ ] Internal links are followed only within configured scope and limits.
- [ ] Page, redirect, link, image, heading, structured-data, and sitemap observations persist.
- [ ] At least 140 objective audit checks execute when eligible.
- [ ] The complete 190-rule catalog accurately identifies unavailable/manual checks.
- [ ] Every finding contains evidence, an exact remediation, and a verification method.
- [ ] Findings are filterable and affected page evidence can be opened.
- [ ] A safe CSV export can be downloaded by an authorized tenant member.
- [ ] A second crawl is compared with the first and lifecycle states are correct.
- [ ] The score is reproducible from stored findings and model version.
- [ ] `Not checked` is excluded from the denominator and never displayed as `Passed`.
- [ ] Private, local, metadata, and rebound destinations cannot be crawled.
- [ ] Cross-tenant access is denied across UI, API, jobs, exports, cache, and storage.
- [ ] Usage limits and cancellation are enforced server-side.
- [ ] No fabricated live metric or provider result appears.
- [ ] Error and empty states explain recovery and data preservation.
- [ ] Desktop and mobile interfaces are keyboard-accessible and original to Searvia.
- [ ] Migrations work on a clean database and from the prior release.
- [ ] Automated format, lint, typecheck, unit, integration, E2E, and build checks pass.
- [ ] The app and workers start from documented commands.
- [ ] Production environment variables and secret ownership are documented.
- [ ] No secret is committed or emitted in logs/client bundles.
- [ ] Queue retries, dead letters, drains, and recovery are observable.
- [ ] Backups and a restore procedure are verified.
- [ ] Data export, deletion, and retention controls match policy.
- [ ] Release, rollback, incident, and security-reporting paths are documented.

## Phase 1 risk register

| Risk                        | Impact                         | Mitigation                                                                    | Gate               |
| --------------------------- | ------------------------------ | ----------------------------------------------------------------------------- | ------------------ |
| SSRF or DNS rebinding       | Internal/cloud compromise      | Fresh DNS validation on every hop, egress controls, attack tests              | M2/M8              |
| Cross-tenant reference      | Customer data disclosure       | Scoped repositories, composite constraints, authorization matrix              | M1 onward          |
| Crawl traps/unbounded data  | Cost and outage                | frontier limits, normalization, pattern detection, backpressure               | M2/M3              |
| At-least-once delivery      | Duplicate observations/charges | idempotency keys, unique constraints, transactional state                     | M2 onward          |
| Malicious HTML/artifacts    | XSS or resource exhaustion     | bounded parse, isolation, text rendering, CSP                                 | M3/M6              |
| False audit conclusions     | Loss of trust                  | explicit eligibility, fixtures, evidence, versions, manual/not-checked states | M4/M5              |
| Score misinterpretation     | Misleading decisions           | transparent formula, coverage, model version, caps                            | M5                 |
| Provider unavailability     | Misleading blank/zero data     | disabled integration states; no fabricated fallback                           | All                |
| Export/report leakage       | Tenant or formula injection    | authorization, signed URLs, safe CSV encoding                                 | M7                 |
| Schedule/time ambiguity     | Duplicate/missed jobs          | UTC storage, IANA timezone, idempotent scheduler, DST tests                   | M7                 |
| Migration/retention failure | Data loss or outage            | forward migrations, rehearsals, backups, deletion audits                      | Every DB milestone |
| Existing UI regression      | Lost useful work               | incremental refactor, visual and route tests                                  | M0 onward          |
