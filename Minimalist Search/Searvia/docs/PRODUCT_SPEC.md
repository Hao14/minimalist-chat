# Searvia product specification

## Product definition

**Searvia** is a public marketing website and authenticated, browser-based, multi-tenant SaaS application. It helps website owners understand what search engines and AI retrieval systems can access, which technical problems exist, the evidence for each problem, the exact remediation, and what changed between crawls.

Pronunciation: **SEER-vee-uh**.

The name blends search, visibility, and _via_: the path through which people and AI systems discover a brand. The brand is original, minimalist, accessible, and never imitates Semrush.

Primary tagline: **Search visibility, made clear.**

Action tagline: **Audit. Rank. Get cited.**

M0 homepage copy:

- Product name: **Searvia**
- Headline: **Find what is limiting your search visibility.**
- Supporting copy: **Crawl your website, uncover technical problems, and understand what search engines and AI retrieval systems can access.**
- Primary action: **Start a site audit**
- Secondary action: **Explore the platform**

The visual identity uses a lowercase `searvia` wordmark, near-black type, white or soft-neutral surfaces, and a restrained indigo/electric-blue/teal accent. A preferred mark is an abstract S formed from two directional search paths with one discovered-result point. Avoid magnifying-glass clichés, decorative/excessive gradients, robot-brain imagery, vintage styling, and competitor-like layouts. Status always combines text/iconography with color.

## Users and outcomes

Primary users are small-business owners, SaaS founders, marketing and content teams, developers, SEO consultants, and agencies. Searvia should answer:

1. Can search engines and AI retrieval systems access the site?
2. What is broken, how serious is it, and which pages are affected?
3. What exact change should be made and how can it be verified?
4. Which findings are new, existing, returned, fixed, ignored, or not evaluated?
5. Which provider-backed search or AI opportunities exist, when those providers are connected?

## Non-negotiable principles

- Use real crawl data and preserve evidence for every finding.
- Keep deterministic technical checks separate from AI-assisted analysis.
- Record rule, prompt, model, provider, and retrieval versions needed for reproducibility.
- Identify every metric's source, retrieval time, coverage, and estimation status.
- Never treat `Not checked` as `Passed`.
- Never invent keyword volume, rankings, backlinks, traffic, citations, mentions, or customer activity.
- Respect robots.txt, website ownership, rate limits, budgets, and provider terms.
- Use licensed or approved APIs for web-wide search, backlink, and AI-answer data.
- Protect crawl infrastructure from SSRF, DNS rebinding, internal-network access, malicious pages, and credential leakage.
- Provide accessible, responsive, keyboard-operable interfaces targeting WCAG 2.2 AA where practical.
- Support data export and deletion; collect and retain no more customer content than necessary.
- Never imply that `llms.txt`, any individual check, or an audit score guarantees rankings or AI citations.

## Product shape

The complete product direction includes technical auditing, keyword research, rank tracking, competitor research, backlink intelligence, AI-search visibility, content opportunities, reports, teams, billing, and provider integrations. The delivery order is intentionally narrower:

- **Phase 1 — Functional site audit:** authentication, organizations, projects, safe crawling, extraction, versioned rules, evidence, scoring, crawl history/comparison, and CSV export.
- **Phase 2 — Production SaaS:** roles, billing, entitlements, schedules, notifications, reports, Search Console and performance integrations, observability, and retention.
- **Phase 3 — Search intelligence:** licensed keyword, SERP, competitor, rank, and backlink integrations.
- **Phase 4 — AI visibility:** compliant prompt monitoring, mentions, citations, competitor gaps, evidence-backed opportunities, and AI reports.
- **Phase 5 — Scale and agencies:** distributed crawling, client access, white-label reports, public APIs, webhooks, warehouse export, and enterprise-ready identity.

Provider-dependent modules may exist before their delivery phase only as disabled integration states. They must explain the dependency and offer a setup action; they must not show invented results.

## Phase 1 vertical slice

The first production slice is complete only when a user can:

1. Create an account and organization.
2. Add and configure a website project.
3. Safely start a real crawl.
4. Observe durable worker progress.
5. Store extracted page and sitemap data.
6. Run independently testable audit rules.
7. Inspect findings with evidence and exact fixes.
8. Export findings.
9. Run a second crawl and see new, existing, returned, and fixed results.

Phase 1 must function without paid keyword, backlink, SERP, or AI-answer providers. The default project suggestion is `https://minimalist.chat`; no crawl begins until the user requests it. `https://discord.com` and `https://slack.com` are future competitor suggestions, not pre-observed competitor data.

## M0 scope and status

M0 establishes an executable repository foundation: workspace structure, public and application shells, worker processes, local PostgreSQL/Redis/MinIO, Drizzle migrations, typed environment configuration, safe structured logging, tests, CI, and documentation.

M0 does **not** deliver authentication, tenant data, projects, crawling, audit execution, scoring, reports, billing, or provider results. Product screens in M0 must describe this foundation state plainly. Passing health checks mean a process is alive or ready for its configured dependencies; they do not mean crawling or authentication is implemented.

## M0 routes

Public routes:

- `/`
- `/features/site-audit`
- `/pricing`
- `/login`
- `/signup`

Application foundation routes:

- `/app`
- `/app/projects`
- `/app/settings`

The application routes are navigation and layout foundations only until M1 authorization is present.

## Current implementation through partial M5

M1 added authenticated, tenant-scoped organizations and projects. M2 added authorized durable crawl execution, network safety controls, robots handling, cancellation, and real progress. M3 adds bounded source extraction, recursive robots-declared and user-submitted sitemap processing, a queryable URL graph, private compressed HTML artifacts, and optional separately gated rendering. M4A added the versioned deterministic engine and first 65 CRW/HTTP/RSM/URL rules. The active partial-M5 catalog adds 65 ONS/CNT/LNK rules, for 130 definitions evaluated from immutable completed or partially completed crawl evidence by a separate durable worker queue. It persists every eligible and not-evaluated occurrence plus cross-crawl first/last-seen lifecycle and authorized ignored/accepted-risk dispositions. Qualitative checks request manual review without an LLM or invented conclusion. Findings APIs/UI, the remaining 60 definitions, score formula, and score aggregates are not live yet; page evidence alone is not a finding or pass/fail result.

## Data and empty-state language

Missing data must have an intentional state: no project, no crawl, queued, in progress, partial, failed, provider disconnected, provider quota exceeded, delayed, no findings, access denied, verification required, robots blocked, and export failure. State messages explain what happened, whether data was saved, what the user can do, and a trace reference when available. Never render an empty chart as if zero were observed.

## Phase 1 acceptance summary

Phase 1 requires a safe real crawl of `minimalist.chat`, visible progress, robots and sitemap handling, persisted page evidence, at least 140 functioning eligible objective checks from a complete 190-rule catalog, reproducible scoring, filtering and export, second-crawl comparison, tenant isolation, responsive UI, usable error states, passing automated checks, documented local operation, and no secrets or fabricated live metrics. Detailed delivery gates are in `docs/PHASE_1_PLAN.md`.
