# Security architecture

## Security model

Searvia processes hostile URLs and HTML, tenant-private application data, authentication credentials, and potentially large usage costs. Controls fail closed at the web, repository, queue, worker, DNS, transport, and storage boundaries. A hidden control, opaque UUID, queue message, or client-selected organization is not authorization.

M1 introduces database-backed authentication and tenant authorization. M2 introduces durable crawl work and the first hostile-network boundary. The implementation does not by itself prove production egress isolation, managed-service policy, or release readiness; those require environment-specific evidence.

## Core invariants

1. Authenticate and authorize every protected action server-side.
2. Scope every tenant-owned data operation by the authenticated organization and subordinate resource.
3. Validate untrusted input at each trust boundary with explicit schemas and bounded sizes.
4. Never put server secrets in client environment variables, bundles, URLs, logs, analytics, or errors.
5. Treat crawl destinations, every DNS answer, redirects, response headers/bodies, robots files, sitemaps, and discovered links as hostile.
6. Resolve and validate before connecting, then pin the validated address set into the socket lookup.
7. Do not render customer HTML as trusted dashboard markup.
8. Keep deterministic evidence and security-relevant lifecycle events attributable and reviewable.
9. Deny expensive work transactionally before enqueue when authorization, active-crawl, or entitlement checks fail.

## Authentication and session controls

- Better Auth owns email/password accounts and database-backed sessions through the Drizzle adapter.
- Passwords are accepted only between 12 and 128 characters and are handled by the maintained authentication library; password hashes and auth secrets never enter client code.
- Session cookies are HttpOnly, `SameSite=Lax`, path `/`, and Secure in production. Cross-subdomain cookies and client-side cookie caching are disabled.
- Production requires a unique `BETTER_AUTH_SECRET`; the checked-in local example is explicitly rejected in production configuration.
- Login and signup use database-backed rate limits with stricter per-route rules. Responses use a generic authentication error rather than confirming whether an unrelated email exists.
- Protected `/app` navigation redirects unauthenticated users, but every protected server component, route handler, server action, and repository call still resolves and checks the session.
- Return paths are restricted to local `/app` destinations to prevent open redirects.
- Authentication mutations accept only the configured application origin. Crawl mutations additionally validate `Origin` and reject non-same-origin `Sec-Fetch-Site` values.
- Sessions are revocable records; authorization reloads current membership rather than treating a stale UI role as authority.

MFA, magic links, OAuth, email delivery, and ownership verification delivery are not represented as live until their own implementation and tests exist.

## Multi-tenant authorization

- `organization_id` is the tenant authority; project and crawl IDs are subordinate selectors only.
- Membership status and role are loaded server-side. Owner, admin, analyst, viewer, and client capabilities are centralized in shared types.
- Owner/admin/analyst can start and cancel crawls. Viewer and client cannot mutate crawls. A client must also have an explicit `membership_project_scopes` row for each readable project.
- Repositories include organization/project/crawl scope in SQL and reinforce it with composite foreign keys and unique constraints.
- Cross-tenant resources are not fetched and then revealed through authorization-specific detail. The API exposes only a stable scoped result.
- Queue jobs carry the tenant tuple, but workers re-read the persisted crawl and atomically claim that exact tuple before any write.
- Usage reservations, outbox rows, frontier/pages/robots/checkpoints, audit events, future exports, object keys, caches, cursors, and realtime channels follow the same tenant scope.
- Sensitive organization/member/role, crawl-start/cancel, queue terminal, and crawl terminal actions create append-only audit records with safe metadata and trace IDs.

Authorization evidence must cover role denial, client project scope, cross-tenant IDs, deleted/suspended membership, stale sessions, nested resources, duplicate background delivery, and timing-safe not-found behavior. This document does not claim those suites passed.

## Crawl-creation boundary

The crawl API accepts no crawl target override. It uses the normalized origin and bounded crawl configuration already stored for the authorized project. The create request requires:

- an authenticated session and active membership;
- `crawl:start` capability and project scope;
- a valid same-origin request with an empty bounded body;
- a syntactically bounded `Idempotency-Key` and trace ID;
- the one-active-crawl and current Phase 1 page entitlement.

Creation, configuration snapshot, hashed idempotency, usage reservation, outbox insert, and audit event are one transaction. The web request does not fetch the submitted site. Cancellation is another authorized transaction and is idempotent for terminal state.

## Destination validation

The production crawler accepts only normalized HTTP(S) URLs without embedded usernames/passwords. Hostnames are IDNA-normalized and syntactically bounded. Unsupported schemes and ports are rejected before connection.

Before the initial request and every redirect, the crawler:

1. Rejects explicit localhost and common cloud metadata hostnames.
2. Resolves all A/AAAA answers under a DNS deadline.
3. Fails closed on an empty, invalid, or unknown address family.
4. Rejects the destination if **any** answer is loopback, unspecified, IPv4 private, IPv6 unique-local/site-local, link-local, carrier-grade NAT, multicast, reserved/documentation/benchmark, transition, metadata, or otherwise outside accepted public IPv6 unicast space.
5. Supplies only the validated addresses to the request's custom lookup, preventing an unchecked resolver decision between validation and connect.
6. Repeats fresh resolution and validation for the next redirect destination.

Redirect syntax, HTTP(S) scheme, safe port, host scope, loop detection, hop limit, and HTTPS downgrade are checked before following. Application validation is supplemented—not replaced—by a production egress firewall/proxy that denies internal, metadata, and reserved networks.

## Network and resource limits

The safe HTTP layer enforces:

- DNS, connect, headers, idle-body, per-request, and abort deadlines;
- maximum response-header bytes;
- maximum encoded bytes and maximum decompressed bytes;
- supported content encodings and fetch-kind content types;
- redirect count, loop, invalid-location, and HTTPS-downgrade rejection;
- omission of credential-bearing response values (`authorization`, proxy-authentication fields, cookies, and `www-authenticate`) while retaining only the normalized omitted header names as evidence;
- no socket reuse across unchecked destinations;
- safe user-facing error classification without leaking response bodies or infrastructure detail.

The crawl runner adds a total crawl deadline, page/discovery/depth/query-variant/sitemap bounds, normalized URL deduplication, breadth-first ordering, include/exclude patterns, optional subdomain scope, per-host concurrency and delay, cancellation checks, and capped retries only for classified transient network/HTTP failures. Permanent 4xx responses are not silently retried. An oversized, timed-out, unsupported, or failed page becomes a bounded persisted observation; it does not crash the worker process.

Raw HTTP HTML remains the default. Optional M3 rendering is disabled unless both the project snapshot and worker deployment enable it and the raw extraction has no meaningful content, lacks critical metadata, or has client-rendered signals. Rendering runs in a separately bounded Chromium context via `setContent`; it never navigates to the customer URL. Service workers and every browser-originated request are aborted, downloads are disabled, and input/output configuration cannot exceed 5,000,000 bytes; duration, settle window, blocked-request count, V8 heap budget, page close, and process shutdown are also bounded. The worker container still requires an independent memory/PID limit. Raw and rendered evidence remain distinct, and render/console/page errors persist.

## Robots and sitemap policy

- Every origin has its own safely fetched `/robots.txt` policy and configured Searvia user agent.
- M2 configurations must set `respectRobots=true`; the runner refuses a configuration that disables it.
- Allow/disallow selection follows the most specific applicable group/rule and records the decision plus its same-crawl policy observation for each page and sitemap fetch. An unavailable policy or unsupported delay still blocks fail-closed but records `not_checked`, never a fabricated `disallowed` decision.
- Robots request paths and rule patterns use the same percent-encoding canonicalization before matching. Encoded unreserved bytes cannot bypass a disallow, and reaching the bounded global rule limit fails closed to a disallow-all policy.
- Bounded crawl delay is interpreted as an additional per-host delay.
- Robots status, request/final URL, content type/bytes/digest, parsed state, user agent, crawl delay, error state, and declared sitemap URLs persist per crawl/origin. Valid fetched source is capped at 500,000 bytes and immutable; unavailable or invalid observations retain no source text.
- Robots-declared and user-submitted sitemaps are credential-free HTTP(S), limited in file/depth/entry/decompressed size, normalized, scope checked, deduplicated, and subject to the same DNS/redirect/size/time/robots controls. XML parsing rejects entity/doctype constructs; indexes, URL sets, gzip, redirects, strict lastmod validity, source/parent relationships, HTTP failures, content digests, and bounded parse issues remain visible. New parsed observations require a digest; legacy parsed rows retained from migration `0003` may have no digest because unavailable source bytes are never fabricated. An exact replay is idempotent; a different immutable observation for the same crawl/normalized URL fails closed as a conflict.
- An unavailable or unreachable robots result remains visible and can cause partial completion; it is never relabeled as a successful robots check.

## DNS rebinding and test fixtures

Production fetches cannot enable a broad local-network allowlist. Loopback fixture access exists only through `@searvia/crawler-core/testing`:

- capability issuance throws unless `NODE_ENV=test`;
- every capability is bound to exact HTTP(S) origins without credentials, paths, query, or fragments;
- the capability object is registered in a module-private `WeakMap` and cannot be recreated from its visible shape;
- the production `createSafeHttpClient` API has no capability argument;
- fixture servers themselves refuse to start outside the test environment.

This permits deterministic healthy, robots-blocked, redirect, oversized, query-trap, sitemap, broken-link, timeout, and server-error fixtures without weakening production IP controls. A production environment string or ordinary caller cannot accidentally opt in; importing and calling the separate testing entry point under a real test process is required.

## Queues, workers, and usage

- Queue contracts are strict, versioned, tenant-scoped, and contain references/safe metadata only—no credentials, cookies, raw HTML, or session tokens.
- Client idempotency is hashed at rest; outbox and BullMQ job identity are deterministic per logical crawl.
- The PostgreSQL transactional outbox prevents a committed crawl from losing its enqueue intent.
- Outbox and execution claims use opaque, expiring leases. Updates require the current token.
- BullMQ retries are bounded and use exponential backoff with jitter. Live-lease contention and temporary failure of a required terminal/retry persistence write use per-job delayed deferral with the BullMQ lock token, so they neither acknowledge the job nor burn a retry. A processor-owned heartbeat renews claimed execution leases independently of crawl progress and aborts into retry handling if renewal fails. Permanent failures become unrecoverable; terminal claimed failures and their typed dead-letter intent commit atomically under the tenant tuple and unexpired execution-token fence, while pre-claim failures use full tenant/contract reconciliation.
- Retried executions reload only tenant-scoped pending frontier rows and calculate remaining page and discovery allowances from durable counters; stale `fetching` rows are reset under the new fenced execution token.
- Incomplete HTML replay does not trust a relational object reference alone. The worker checks the page-derived private key before replacing incomplete transport evidence, recovers a verified orphan object with the original stored observation, and permits replacement only after verified absence. Once raw artifact metadata exists, it performs a signed private read, validates tenant-derived metadata and both stored/content hashes, bounds gzip decompression, and extracts the recovered bytes; missing or divergent objects fail into durable error handling.
- Cancellation is persisted, checked before work and during frontier processing, and wins over later completion/retry state.
- Estimated page usage is reserved before enqueue and released/consumed exactly once at terminal state.
- Graceful shutdown stops intake/polling and drains within a configured deadline. The crawler aborts and checkpoints active work rather than pretending it completed. A scheduler forced path disconnects Redis, leaves an ambiguous outbox claim leased for deterministic-ID recovery, and exits nonzero without closing persistence beneath a live dispatch.

Redis persistence, eviction policy, TLS/auth, queue metrics, and dead-letter operating procedures are production infrastructure responsibilities. Passing an in-memory/unit test does not establish those controls.

## Hostile content and data display

- M3 stores bounded fetch metadata and deterministic raw/rendered extraction in normalized subordinate tables. Large raw/rendered HTML bodies are excluded from frequently queried relational columns.
- Raw HTML/XML extraction does not execute scripts. Sitemap XML rejects entity/doctype constructs. The optional renderer follows the isolated no-outbound-network policy above.
- Response titles, visible text, URLs, errors, robots text, metadata, structured data, and graph labels are escaped as data in the dashboard and exports. Customer HTML is never inserted as trusted dashboard markup.
- Raw/rendered artifacts are gzip-compressed into private object storage using immutable keys derived from validated organization/project/crawl/page UUIDs. The worker refuses uncompressed artifact input above 5,000,000 bytes. Conditional writes, content and stored-byte SHA-256 hashes, bounded reads/decompression, safe content metadata, and PostgreSQL references make replay and divergence observable.
- Possessing an object key or page/crawl UUID is never authorization. Product reads scope organization, project, crawl, and page in the same repository query; the current web API exposes artifact metadata but no public object URL. Production buckets block anonymous access and identities are limited to their required object operations.
- Detected secrets or PII are sensitive evidence: minimize, mask, restrict, and never log them.

## Secrets and configuration

- `.env.example` contains local-only examples. Real secrets live in an approved secret manager and are unique per environment.
- Production startup fails when required application, auth, database, Redis, or object-storage values are missing, default, malformed, use the known local auth secret, or configure worker Redis without TLS (`rediss://`).
- Client environment exposes only deliberate public origins. Server schemas cannot enter a client dependency path.
- Logs redact authorization/cookie headers, passwords, keys, tokens, database/Redis/object URLs, session data, and credential-shaped nested values.
- Worker queue prefixes and integration-test Redis databases must be isolated by environment to prevent test or preview jobs reaching production consumers.

## Database, storage, and operations

- Runtime and migration roles are separate and least-privilege; production services cannot alter schema.
- Parameterized Drizzle queries and database constraints reinforce tenant ownership, lifecycle, and idempotency.
- Managed PostgreSQL, Redis, and object storage remain private with encryption in transit and at rest.
- Web and worker containers run as non-root with CPU/memory/PID bounds and distinct identities. Crawler workers alone receive controlled public HTTP(S) egress.
- Backups and point-in-time recovery are enabled and restores are rehearsed before release.
- Retention, project/organization deletion, queued-work cancellation, and artifact deletion are audited and resumable.
- Customer crawl content is never used to train unrelated models without explicit consent.

## Release security gates

- [ ] Cross-tenant authorization matrix passes for API, UI, jobs, exports, cache, and objects.
- [ ] SSRF, every blocked address class, DNS rebinding, redirect-to-private, metadata, port, timeout, oversized/decompressed response, and crawl-trap tests pass.
- [ ] Robots, sitemap, cancellation, duplicate delivery, retry, outbox recovery, dead-letter, and graceful drain behavior pass in the intended environment.
- [ ] Private object-store conditional writes, tenant-key enforcement, integrity reconciliation, interrupted-write resume, and blocked anonymous reads pass against the intended storage service.
- [ ] Optional Chromium rendering proves outbound requests/service workers are blocked and all time/byte/request/memory/shutdown limits fail closed in the intended worker image.
- [ ] A real Redis integration run proves durable producer-to-consumer delivery against an isolated database.
- [ ] No default or real credential appears in source, images, bundles, logs, fixtures, or CI output.
- [ ] CSP, CSRF/origin, cookie, rate-limit, session revocation, and open-redirect controls are tested.
- [ ] Managed Redis persistence/no-eviction, controlled crawler egress, private data services, and least-privilege identities are verified.
- [ ] Dependency and secret scans have no unresolved high-severity finding.
- [ ] Backup restore, queue drain/recovery, rollback, deletion, and retention procedures are rehearsed.
- [ ] Security failures remain visible and actionable; none are converted to success or a fabricated audit result.

Report suspected vulnerabilities through the private process in the root `SECURITY.md`; never disclose customer data in public issues.
