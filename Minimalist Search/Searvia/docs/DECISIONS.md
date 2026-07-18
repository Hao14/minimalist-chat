# Architecture decisions

This is the lightweight ADR log for Searvia. New entries are appended; accepted entries are not rewritten to disguise a change. A superseding ADR references the old decision and updates the affected architecture, database, security, development, and deployment docs.

## ADR-001 — pnpm/Turborepo strict TypeScript monorepo

- **Status:** Accepted, 2026-07-15
- **Context:** Web, three workers, and reusable domain boundaries must evolve and validate together.
- **Decision:** Use Node.js 24, the pnpm 11 version pinned by `packageManager`, pnpm workspaces, Turborepo, one lockfile, strict shared TypeScript, ESLint, and Prettier.
- **Consequences:** Root commands provide one quality gate and workspace caching. npm/Yarn lockfiles are unsupported. Each workspace needs a valid entry point and its own build/type/test ownership.

## ADR-002 — Next.js web plus separate long-lived workers

- **Status:** Accepted, 2026-07-15
- **Context:** Crawls and report generation exceed safe web-request duration and resource bounds.
- **Decision:** Keep public/UI/API work in `apps/web`; run crawler, scheduler, and report responsibilities in independently deployed Node processes.
- **Consequences:** Route handlers perform bounded validation/authorization/data access and durable submission only. Workers require health, graceful shutdown, idempotency, backpressure, and independent scaling.

## ADR-003 — PostgreSQL with Drizzle and forward-only migrations

- **Status:** Accepted, 2026-07-15
- **Context:** Searvia needs relational tenant integrity, reproducible crawl snapshots, explicit indexes, and reviewed SQL.
- **Decision:** Use PostgreSQL 18 locally, managed PostgreSQL in hosted environments, Drizzle ORM, and committed reviewed migrations. M0 creates the connection/migration foundation but no speculative product tables.
- **Consequences:** M1 introduces the tenant schema with authorization tests. Applied migrations remain immutable; deployment migrates once with a separate role. JSONB and partitioning require demonstrated need. The database workspace alone skips rechecking dependency declaration files because Drizzle publishes declarations for optional non-PostgreSQL dialect peers; Searvia database source remains under every shared strict check, the exception is documented beside the compiler setting, and it must be removed when the pinned dependency no longer requires it.

## ADR-004 — Redis now; BullMQ when durable jobs arrive

- **Status:** Accepted, 2026-07-15
- **Context:** Workers need a durable queue, but M0 must not contain fake jobs or unnecessary dependencies.
- **Decision:** M0 validates Redis connectivity and worker lifecycle only. M2 introduces BullMQ typed, idempotent, tenant-scoped jobs with retries, cancellation, checkpointing, and dead-letter handling.
- **Consequences:** Readiness can be exercised without suggesting crawl capability. Job payload/version compatibility becomes a release concern beginning M2.

## ADR-005 — S3-compatible storage for large artifacts

- **Status:** Accepted, 2026-07-15
- **Context:** Raw/rendered HTML, screenshots, and reports are large and rarely suitable for hot relational rows.
- **Decision:** Use private S3-compatible object storage with MinIO locally. PostgreSQL stores scoped metadata, keys, hashes, sizes, and retention state.
- **Consequences:** Object authorization, encryption, lifecycle, reconciliation, and deletion are part of product correctness. Local bucket initialization is idempotent.

## ADR-006 — Explicit organization scoping with database defense in depth

- **Status:** Accepted, 2026-07-15
- **Context:** Opaque IDs and UI routing do not prevent cross-tenant access.
- **Decision:** `organization_id` is the tenant authority. Every protected repository/query/job/cache/object/export path includes verified tenant scope. Composite constraints reinforce ownership. Evaluate PostgreSQL RLS after application-scoped tests exist.
- **Consequences:** Some tables deliberately repeat organization ownership for safe queries/indexing. Authorization is checked server-side on every action; RLS can add defense but never replace it.

## ADR-007 — Honest provider adapter boundary

- **Status:** Accepted, 2026-07-15
- **Context:** Keyword, SERP, backlink, PageSpeed, Search Console, and AI-answer data require approved external sources and can be unavailable or costly.
- **Decision:** Provider capabilities live behind normalized adapters and retain attribution, retrieval time, coverage, cost, and error state. Before an adapter is configured, UI is disabled with explanation/setup—not synthetic results.
- **Consequences:** Phase 1 remains useful through site auditing without paid providers. No consumer SERP/AI interface scraping or internally invented authority metrics.

## ADR-008 — Deterministic audit core separated from AI assistance

- **Status:** Accepted, 2026-07-15
- **Context:** Objective crawl evidence must be reproducible; qualitative analysis can be uncertain.
- **Decision:** Network/HTML/robots/sitemap/link/schema/header/objective performance checks are deterministic and versioned. AI-assisted checks are separately labeled, evidenced, model/prompt versioned, confidence-scored, reviewable, and cannot override objective evidence.
- **Consequences:** Missing data produces `Not checked`; score denominators include only eligible evaluated rules. Historical findings retain detector/model versions.

## ADR-009 — Typed environment boundary and redacted structured logs

- **Status:** Accepted, 2026-07-15
- **Context:** Multiple processes need consistent startup behavior without leaking server secrets into the browser or telemetry.
- **Decision:** Validate environment through shared schemas with separate server/client entry points. Safe local defaults are development-only; production fails closed. Emit structured logs with service, environment, level, timestamp, trace/correlation, normalized error, and safe metadata through a central redacting logger.
- **Consequences:** Imports cannot open network connections or pull server schemas into client bundles. Secrets, tokens, cookies, auth headers, connection strings, and crawl credentials are redacted at serialization.

## ADR-010 — Preserve and incrementally adapt the existing Searvia UI

- **Status:** Accepted, 2026-07-15
- **Context:** The repository already contains useful original Searvia marketing/application presentation and design assets.
- **Decision:** Retain the visual system and route work, correct product copy/data honesty, and add reusable public/application foundations incrementally instead of replacing it with a generated dashboard.
- **Consequences:** Visual regression and responsive browser checks accompany changes. Existing fake/demo-looking product states cannot be presented as live, and original Searvia identity remains distinct from competitor products.

## ADR-011 — Authentication implementation selected in M1

- **Status:** Deferred, 2026-07-15
- **Context:** The master product requires password, magic-link, OAuth, revocation, and MFA-ready tenant sessions, but adding an auth library in M0 would be unused and premature.
- **Decision:** M0 defines secure session and authorization requirements only. M1 evaluates maintained Next.js/Node 24-compatible options and records the exact provider/schema decision before implementation.
- **Consequences:** M0 `/app` routes are explicitly unprotected foundation screens and cannot hold customer data. M1 must include cross-tenant and session-revocation tests.

## ADR-012 — Temporary proprietary license posture

- **Status:** Accepted pending owner/legal decision, 2026-07-15
- **Context:** The repository owner has not selected an open-source license.
- **Decision:** Mark the package `UNLICENSED` and use a root license notice reserving rights until a deliberate license is approved.
- **Consequences:** No open-source permissions are implied. A future license change requires owner/legal approval and a superseding ADR.

## ADR-013 — Infrastructure versions are constrained and intentionally reviewed

- **Status:** Accepted, 2026-07-15
- **Context:** Floating database/cache/object images make local and CI behavior irreproducible.
- **Decision:** Constrain local Compose to PostgreSQL 18 and Redis 8.2 while date-pinning MinIO images; update through reviewed changes with compatibility validation. Release images require digest pins after image scanning.
- **Consequences:** Alpine patch images can advance during M0 local development. Production digest selection and security upgrades are explicit release work. Hosted providers may run compatible minor versions, but staging must validate differences.

## ADR-014 — M0 public web is a credential-free Cloudflare static export

- **Status:** Accepted, 2026-07-15
- **Context:** The M0 web surface is fully prerenderable and uses no database, object storage, sessions, or live providers. Deploying a server adapter would require either fake credentials or dependencies that M0 does not consume.
- **Decision:** Export `apps/web` as static Next.js output and serve it through Cloudflare Workers Static Assets at `searvia.online`. Use a separate minimal Worker for the `www`-to-apex redirect. Keep the standalone Node build and strict production environment validator unchanged.
- **Consequences:** The public M0 site has no backend runtime or secrets and cannot acquire dynamic product behavior accidentally. CI validates the export, canonical metadata, noindex boundaries, demo disclosure, absence of local credentials, and both Wrangler manifests. M1 must supersede this ADR before introducing server-side authentication or tenant data, using a reviewed full-stack deployment with real managed dependencies.

## ADR-015 — Better Auth with database-backed email/password sessions

- **Status:** Accepted, 2026-07-15; supersedes ADR-011.
- **Context:** M1 requires real accounts, revocable sessions, password hashing, authentication rate limits, secure cookies, and a schema that participates in the same PostgreSQL tenant boundary. The M0 deferral in ADR-011 has reached its decision point.
- **Decision:** Use Better Auth with its Drizzle/PostgreSQL adapter for email/password accounts, database-backed sessions, verification records, and database rate-limit state. Require 12–128 character passwords; disable automatic sign-in after signup and client cookie caching; use HttpOnly, `SameSite=Lax`, production-Secure, host-only cookies; trust only the configured application origin. Keep organization membership, role capabilities, invitations, projects, and audit events in Searvia-owned repositories rather than delegating tenant authorization to the auth library.
- **Consequences:** Better Auth tables and compatibility become migration/release concerns. Every protected action still reloads membership and resource scope; authentication is not authorization. Magic links, OAuth, MFA, and transactional invitation email are not live until separately implemented. Production must supply a unique `BETTER_AUTH_SECRET`, and the local example secret fails production validation.

## ADR-016 — PostgreSQL transactional outbox feeding BullMQ

- **Status:** Accepted, 2026-07-15; implements the M2 portion of ADR-004.
- **Context:** Creating a crawl and publishing directly to Redis are two independent writes. A web crash between them could create an undispatched crawl, while a retry could create duplicate work or usage.
- **Decision:** Create the crawl, immutable configuration snapshot, usage reservation, audit event, and versioned `crawl.execute` intent in one PostgreSQL transaction. A scheduler/outbox worker leases rows with `FOR UPDATE SKIP LOCKED` and publishes them to BullMQ. Use the crawl UUID as the deterministic BullMQ job ID, maintain a separate typed dead-letter queue, and retain PostgreSQL as the authoritative lifecycle/progress store. Use expiring publication and execution leases plus idempotent terminal writes for at-least-once delivery.
- **Consequences:** Redis success followed by database acknowledgement failure is safe to republish after lease recovery. Publisher failures are capped and visible; exhaustion terminates the undispatched crawl and releases usage. Transient execution failure returns persisted state to `queued`; an independent heartbeat maintains the execution fence, and claimed terminal failure derives `failed` or `partially_completed` from locked durable progress while inserting its dead-letter outbox intent in the same transaction. Queue contract/version compatibility, Redis persistence/no-eviction, drain, reconciliation, and replay become release responsibilities.

## ADR-017 — Safe fetches pin fully validated DNS answers

- **Status:** Accepted, 2026-07-15.
- **Context:** Validating only the submitted hostname or its first DNS result does not prevent private-address answers, resolver time-of-check/time-of-use changes, or redirects to internal/cloud metadata endpoints. Local deterministic fixture servers still need loopback access without weakening production controls.
- **Decision:** Normalize HTTP(S) URLs, reject credentials/unsafe ports, resolve every A/AAAA answer under a deadline, and reject the destination if any answer is non-public. Supply the validated address set to a per-request custom lookup so the socket cannot perform an unchecked second resolution. Freshly normalize, scope-check, resolve, validate, and pin every redirect. Apply encoded/decoded byte, header, timeout, content-type, redirect, breadth/depth/page/query, per-host pacing, robots, sitemap, cancellation, and total-crawl limits. Expose loopback access only from the separate `@searvia/crawler-core/testing` entry point through an opaque exact-origin capability issued and accepted solely under `NODE_ENV=test`.
- **Consequences:** Ports outside the explicit safe-web allowlist and private/reserved destinations fail in production even when the original host appears public. Production also requires controlled egress as defense in depth. Tests cannot enable a broad allowlist: changing an environment variable or fabricating the capability's visible shape is insufficient. Authenticated crawling still requires a separate security decision; optional rendering is constrained by ADR-020.

## ADR-018 — Dynamic product runtime supersedes the M0 static export

- **Status:** Accepted, 2026-07-15; supersedes ADR-014 for authenticated/product deployments.
- **Context:** Better Auth handlers, server sessions, PostgreSQL-backed onboarding, crawl APIs, and progress polling require runtime execution. The credential-free static `apps/web/out` topology chosen for M0 cannot provide these capabilities.
- **Decision:** Retire the M0 Cloudflare static-export path for authenticated product releases. Use independently deployed dynamic web, crawler, scheduler/outbox, and report processes with real managed PostgreSQL/Redis/object services and server-secret injection. `searvia.online` may proxy to the standalone web container, or a future supported dynamic Cloudflare Next.js adapter may be adopted only after a separate compatibility/security/deployment review.
- **Consequences:** The old `build:web:cloudflare`/`deploy:web:cloudflare` commands are historical and must not publish the authenticated product. The small `www` redirect can remain only if routes/DNS do not conflict. This decision does not provision or claim a production Cloudflare runtime; hosting selection, DNS changes, managed dependencies, crawler egress, observability, staging evidence, and rollback remain explicit deployment work.

## ADR-019 — Normalized extraction with immutable private HTML artifacts

- **Status:** Accepted, 2026-07-15.
- **Context:** M3 needs complete queryable page evidence, but raw/rendered HTML bodies are large, hostile, and unsuitable for the frequently queried page table. At-least-once execution can fail between object and database writes.
- **Decision:** Keep bounded transport evidence in `crawl_pages`; persist raw/rendered extraction, headings, URL graph, images/resources, structured data, recursive sitemaps, and artifact metadata in tenant-scoped subordinate tables. Gzip raw/rendered HTML into private S3-compatible storage under keys derived exclusively from organization/project/crawl/page UUIDs, with a 5,000,000-byte runtime input ceiling. Use immutable conditional object writes, content and compressed-storage hashes, source uniqueness, and idempotent repository inserts. Treat required raw artifact metadata plus raw extraction as the HTML-fetch completion boundary. Before artifact metadata exists, replay checks the page-derived object key: a verified orphan object is registered and paired with the original transport snapshot, while verified absence permits replacement with the retry response. Afterward it reloads the immutable object through a signed private read and verifies scope, sizes, decompression, and both hashes before extraction. Sitemap observations persist response digests and parse issues; exact replay is a no-op and changed immutable evidence conflicts.
- **Consequences:** PostgreSQL page queries remain bounded and can join normalized evidence without reading object bodies. A failed object/database write remains retryable rather than becoming a remote-page failure, and replay does not increment page counters twice. Object retention/deletion and relational retention require reconciliation, and storage authorization is part of the tenant boundary. A verified orphan object is recovered on retry; an orphan that never receives a retry remains a retention/reconciliation responsibility. No public object URL is implied by a stored key.

## ADR-020 — Optional rendering uses no-outbound `setContent`

- **Status:** Accepted, 2026-07-15.
- **Context:** Some pages expose no meaningful raw content or critical metadata until JavaScript runs, while browser navigation would reopen SSRF/DNS-rebinding and unbounded-resource risks already closed by the HTTP crawler.
- **Decision:** Keep raw HTTP extraction as the default. Render only when the project and worker gates are enabled and deterministic raw evidence indicates missing content/metadata or client-rendered behavior. Load the already validated raw HTML with Chromium `setContent` instead of navigating. Block service workers and abort every browser request; reject configured input/output bounds above 5,000,000 bytes and apply duration, settle, blocked-request, V8 heap, close, and shutdown controls. Store raw/rendered artifacts and extractions separately with rendering errors.
- **Consequences:** Inline client JavaScript can enrich evidence without granting the browser network access. External script/API-dependent applications may remain incomplete and must say so; rendering is not a general authenticated/full-fidelity browser crawl. Worker images need an explicitly configured compatible Chromium executable plus independent container memory/PID limits. Enabling navigation or browser egress requires a new security decision and destination validation design.

## ADR-021 — Immutable audit reports with separate observed lifecycle and user disposition

- **Status:** Accepted, 2026-07-16.
- **Context:** M4A must derive reproducible technical findings from immutable crawl evidence, retain the exact rule meaning that produced each result, compare the same target across crawls, and allow users to ignore or accept an issue without rewriting what the crawler observed. Missing data and detector failures must not become passes.
- **Decision:** Keep `@searvia/audit-engine` pure and deterministic over a normalized completed-crawl snapshot. Select one immutable positive-integer version per stable rule ID, hash persisted definition metadata, and store the selected rule manifest plus engine/catalog/report hashes with one tenant-scoped evaluation report per crawl. Persist every rule/target occurrence, including `not_checked`, and maintain a separate cross-crawl finding projection. Model observed lifecycle as `new`, `existing`, `returned`, `fixed`, or `not_evaluated`; model `open`, `ignored`, and `accepted_risk` as authorized user dispositions layered over active findings. Treat ineligible, unavailable, invalid, or failed detector outcomes as visible `not_checked` coverage with reasons/evidence, never as `passed`.
- **Consequences:** Any persisted metadata or semantic change requires a new rule version, while historical occurrences continue to reference the old version. The M4A subset selects explicit hardened versions; the active manifest now composes that immutable subset with later category expansions. Compatibility rows remain history rather than being reinterpreted. Evaluation retries are idempotent only when their complete hashes and report match. Runs written under the current schema mark that proof `verified`; pre-`0021` hashes remain unchanged but are marked `legacy_unverifiable`, and direct replay fails closed rather than asserting equality after a historical occurrence correction. Crawl reports reconcile in snapshot order. `not_evaluated` cannot fix a prior issue, and ignored/accepted-risk actions require an audited actor and reason while later occurrences continue to record objective state. Findings do not imply a score; scoring and remaining catalog execution stay in M5. See `docs/AUDIT_RULE_DEVELOPMENT.md` for the authoring contract.

## ADR-022 — Audit evaluation has a separate durable queue

- **Status:** Accepted, 2026-07-16.
- **Context:** Routing `crawl.execute` and `audit.evaluate` through one BullMQ queue makes every crawl consumer reserve both workloads, couples independent concurrency and deployment concerns, and turns a missing audit handler into a terminal queue failure rather than leaving audit work available to the correct consumer.
- **Decision:** Keep the validated transactional outbox publisher, but route contracts to distinct versioned queues: `searvia-crawl-v1` for crawl execution, `searvia-audit-v1` for deterministic audit evaluation, and `searvia-crawl-dead-letter-v1` for crawl terminal records. Each BullMQ worker subscribes to exactly one queue and accepts exactly one live job type. The current crawler service owns independent crawl and audit worker handles and starts, health-checks, gracefully drains, cancels, and force-closes both as one process lifecycle.
- **Consequences:** A crawl-only worker cannot consume or fail an audit job, and the two workloads can be split or scaled independently later without moving queued data. Producers, consumers, monitoring, drain procedures, and rollbacks must retain the same environment prefix and compatible queue names/contracts. After validating the immutable queued snapshot, an audit consumer uses an exact tenant/project/crawl read to acknowledge an already persisted terminal run before evaluating the active catalog. If evaluation proceeds, the repository serializes project writes and returns an identical verified report idempotently; every persistence conflict propagates instead of being reclassified as a concurrent success. Queue isolation and replay acknowledgement do not weaken PostgreSQL tenant checks or the repository's conflict for a directly submitted different report.

## ADR-023 — Preserve crawler-specific robots directive applicability

- **Status:** Accepted, 2026-07-16.
- **Context:** M3 extraction retained each meta and X-Robots directive owner in memory but flattened owners before relational persistence. A crawler-specific directive could therefore be mistaken for a global policy by M4A, while historical rows cannot be truthfully reconstructed.
- **Decision:** At the worker boundary, select only global directives and directives whose owner matches the configured crawler product token. Persist those effective values with an extraction-level provenance boolean. Migration `0012` defaults existing rows to false; audit rules that require indexability return `not_checked` for those rows.
- **Consequences:** A `googlebot: noindex` response is not reported as a global or Searvia-crawler noindex, configured-crawler directives remain deterministic evidence, and legacy flattened observations can never produce a guessed pass or failure. Supporting separate per-provider visibility policies later requires a new versioned evidence model rather than reinterpreting these values.

## ADR-024 — Extraction attempts require explicit success provenance

- **Status:** Accepted, 2026-07-16.
- **Context:** A failed extraction was persisted as an immutable row containing synthetic null, empty, and zero placeholders plus an error, but the completed-crawl adapter treated the mere existence of a raw row as successful evidence. Objective rules could therefore mistake parser failure for observed absence and report a pass.
- **Decision:** Persist an explicit `succeeded`/`failed` status for each raw or rendered extraction attempt. New failed attempts require bounded error provenance and remain durable completion markers, but the audit adapter exposes only successful raw extractions and joins links/resources only through those rows. Repeat the provenance check at the audit-engine boundary. Migration `0013` defaults all earlier rows to `failed` because their success outcome was not stored and cannot be truthfully inferred from nullable content fields.
- **Consequences:** Failed and legacy extraction attempts produce unavailable/not-checked coverage instead of passes. Existing historical extractions must be recrawled to regain eligible M4A evidence. Optional rendering failure can coexist with a successful raw extraction and remains rendering-error evidence; it no longer misclassifies the raw parse itself as failed.

## ADR-025 — Robots findings require persisted policy provenance

- **Status:** Accepted, 2026-07-16.
- **Context:** M3 persisted page-level robots decisions and extracted script/stylesheet URLs, but it did not retain enough policy provenance to distinguish an explicit `Disallow` from an unavailable policy that the crawler blocked fail-closed. Sitemap and resource findings could therefore pass only fixture-supplied data or guess from a policy that was unavailable or may have changed.
- **Decision:** Have crawler-core return an immutable persistence receipt for each per-origin robots observation. Persist page, sitemap, script, and stylesheet decisions together with the same-tenant/project/crawl robots observation ID and require that observation's origin to match the normalized request or resource origin; allow `disallowed` only from a fetched explicit rule and `allowed` only from a fetched or intentional not-found result. A cross-origin redirect denial that lacks a persisted destination binding remains operationally blocked but records `not_checked`. Unavailable, invalid, unobserved, and unsupported-delay outcomes behave the same way with their underlying safe error. Persist at most 500,000 bytes of valid fetched robots text plus its digest, expose text to audit rules only for `fetched`, and reject changed retries. Migration `0016` conservatively clears any legacy body/digest attached to a non-fetched result and any fetched legacy body without a digest before adding the provenance constraint; it never fabricates a digest or rewrites the historical result. Resource-policy evaluation may use only policies already fetched by normal crawl/frontier work and never initiates audit-only egress.
- **Consequences:** Robots findings remain reproducible after the crawl, an unrelated same-crawl policy receipt cannot manufacture a decision, fail-closed behavior cannot manufacture crawlability or indexability failures, a hostile page cannot amplify egress through many resource origins, and retries conflict rather than silently changing the policy behind an earlier result. Historical rows without provenance are downgraded to `not_checked`; none can become a pass or explicit denial without a later crawl that obtains conclusive policy evidence through ordinary crawl work.

## ADR-026 — Absence-based audit rules require completeness provenance

- **Status:** Accepted, 2026-07-16.
- **Context:** A bounded crawler can legitimately truncate links, directives, history, response inspection, or other high-cardinality observations. Empty or retained subsets do not prove that a condition was absent, and applying a different query-parameter policy in the audit adapter can disconnect graph edges from their persisted pages.
- **Decision:** Persist conservative completeness and source provenance at the collection boundary. Raw extractions record whether directives and links survived all parser/worker/storage bounds; transport records the bounded response-prefix HTML decision; redirect history records its distinct-crawl lookback and truncation state. Normalize link and sitemap target identities with the crawl's persisted query policy and associate them by crawler-computed hashes. Legacy or truncated evidence remains incomplete. Rules that conclude from absence must require the relevant completeness flag, while retained positive evidence may still support a finding when the rule's semantics permit it.
- **Consequences:** `Not checked` coverage increases for legacy, partial, or bounded observations, but a missing edge, directive, redirect signal, MIME signature, or historical row can no longer become an accidental pass. Semantic and evidence changes use explicit new rule versions. Additional absence-based rules must add provenance before they can claim healthy coverage.

## ADR-027 — Partial M5 catalog uses bounded evidence and explicit human judgment

- **Status:** Accepted, 2026-07-16.
- **Context:** ONS, content-quality, and link-architecture checks need more extraction and graph evidence than M4A. Bounded persistence can truncate metadata, headings, visible text, or links; optional rendering can make an empty raw shell incomplete; semantic concepts such as purpose, authority, citations, trust policies, contextual relevance, and freshness cannot be concluded reliably from lexical guesses. Large text/graphs also create denial-of-service risk if detectors tokenize or rescan them without budgets.
- **Decision:** Expand the active manifest to 130 definitions with immutable version-1 `ONS-001`–`ONS-025`, `CNT-001`–`CNT-020`, and `LNK-001`–`LNK-020`. Persist conservative completeness for document metadata, headings, visible text, directives, and links, and expose successful raw and rendered extraction separately. Require complete coverage before absence-based passes; retained conclusive positives may still fail with bounded page-scoped evidence. Route human-judgment checks deterministically to `manual_review` with an explanation, or `not_checked` when their trigger/coverage is unavailable. Use no LLM dependency in Phase 1. Bound text/token/shingle analysis, build linear graph indexes, cap evidence samples, and exclude `manual_review` and `not_checked` from objective score coverage.
- **Consequences:** Legacy rows default to incomplete and need a recrawl for eligible absence-based outcomes. Empty raw shells do not become ONS-025 failures when rendered evidence is absent. Some approved catalog concepts remain manual or not checked until a stronger persisted observation contract exists. The active `m5-partial-1` manifest does not complete M5: 60 definitions, the 140-objective-check gate, and the score formula/aggregates remain. Deployments must drain in-flight old workers before provenance migrations because immutable pre-migration extraction rows are not rewritten on retry.

## ADR-028 — Partial M5 semantic corrections require version-2 definitions

- **Status:** Accepted, 2026-07-16.
- **Context:** Completion review found that several active ONS/CNT/LNK detectors had changed required-data, eligibility, evidence meaning, target provenance, or detector semantics after their initial version-1 registration. Reusing version 1 would let the same persisted identity acquire a different definition hash or historical meaning. Review also found that short-page similarity evidence, raw-versus-rendered shell handling, redirect-target schemes, graph absence, pagination reciprocity, and query-variant aggregation needed stricter provenance or bounded evaluation.
- **Decision:** Select `m5-partial-2` as the active 130-rule manifest. Keep 47 expansion definitions at version 1 and select version 2 for ONS-005, ONS-006, ONS-011, ONS-012, ONS-014, ONS-022, ONS-023, ONS-025, CNT-001, CNT-002, CNT-012, CNT-014, CNT-015, LNK-005, LNK-010, LNK-011, LNK-018, and LNK-019. Register historical version-1 rows without mutation and allow active version-2 rows to coexist under the same stable rule IDs. Pin both the expansion distribution and the complete active distribution in catalog and worker-persistence regression tests.
- **Consequences:** The active distribution is 47 version-1, 38 version-2, 27 version-3, 13 version-4, and 5 version-5 definitions. Existing version-1 reports remain reproducible and are not rewritten. New reports use corrected eligibility and evidence contracts. This supersedes only ADR-027's active manifest/version-selection statement; its bounded-evidence, human-review, no-LLM, and incomplete-M5 decisions remain unchanged.

## ADR-029 — Requested-URL, language, and rendered-graph corrections require later rule versions

- **Status:** Accepted, 2026-07-17.
- **Context:** Completion review found that redirect responses were being treated as indexable requested URLs in duplicate and orphan checks, external request errors without status codes could evade LNK-004, Unicode tokenization could produce false certainty for scripts that need language-aware word boundaries, the English-only keyword stopword policy could be applied to other languages, and rules could combine rendered text with the raw shell's link graph even though Phase 1 does not persist rendered links. Reusing the selected definitions would change persisted semantics under existing rule/version identities.
- **Decision:** Select `m5-partial-3` as the active 130-rule manifest. Keep historical definitions immutable. Select version 2 for ONS-003, ONS-005, ONS-006, ONS-009, ONS-011, ONS-012, ONS-014, ONS-016, ONS-022, ONS-023, ONS-025, CNT-003, CNT-006, CNT-016, CNT-017, CNT-018, LNK-004, LNK-005, LNK-013, LNK-018, and LNK-020. Select version 3 for CNT-001, CNT-002, CNT-012, CNT-014, CNT-015, LNK-010, LNK-011, and LNK-019. Classify the requested URL of a redirect as non-indexable, return `not_checked` when deterministic language segmentation or the required rendered-link graph is unavailable, and treat an observed request error as broken transport even when no status code exists.
- **Consequences:** The expansion distribution is 36 version-1, 21 version-2, and 8 version-3 definitions; the complete active distribution is 36 version-1, 41 version-2, 35 version-3, 13 version-4, and 5 version-5 definitions. Existing reports remain reproducible, while new reports avoid false passes, false duplicate/orphan findings, and unsupported language or graph conclusions. This supersedes ADR-028 only for active selection and distribution; prior history and the bounded-evidence, no-LLM, manual-review, and incomplete-M5 decisions remain in force.
