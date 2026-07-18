# Audit-rule contract and catalog

## Scope

M0 approved this contract and the 190-rule product catalog. M4A added the deterministic versioned engine, persistence model, and first 65 executable rules. The active `m5-partial-3` catalog now adds `ONS-001` through `ONS-025`, `CNT-001` through `CNT-020`, and `LNK-001` through `LNK-020`, for 130 registered definitions. The remaining 60 definitions and the complete scoring model are still M5 work; the repository must not imply that the 190-rule or 140-objective-check acceptance gate is complete. Integration-dependent, qualitative, ineligible, or unavailable checks remain `Not checked` or `Manual review`—never fabricated and never silently passed.

This file describes source scope and product semantics. It does not claim that migration, worker, integration, or release validation has passed. See `docs/AUDIT_RULE_DEVELOPMENT.md` for the authoring and versioning workflow.

## Rule contract

Every immutable rule version defines:

- stable rule ID and integer version;
- title, category, description, default severity, and page/site scope;
- eligibility conditions and required observations/integrations;
- deterministic or explicitly qualitative detector;
- bounded, serializable evidence generation;
- explanation, exact remediation, developer notes, and verification method;
- SEO, AI-search, conversion/user-experience impact areas;
- confidence policy, documentation references, and first supported product version.

Conceptual interface:

```ts
interface AuditRule {
  id: string;
  version: number;
  title: string;
  category: AuditCategory;
  defaultSeverity: Severity;
  scope: "page" | "site";
  eligibility: string;
  requiredData: readonly AuditObservationKey[];
  deterministic: true;
  explanation: string;
  expectedValue: string;
  recommendedFix: string;
  verification: string;
  confidence: Confidence;
  impactAreas: readonly ImpactArea[];
  responsibleOwner: ResponsibleOwner;
  evaluate(snapshot: AuditCrawlSnapshot, policy: AuditEnginePolicy): readonly RuleOutcome[];
}
```

Rules are pure with respect to a completed or partially completed crawl snapshot: identical versioned inputs and policy produce identical objective results. Every target carries explicit `eligible`, `ineligible`, or `unavailable` eligibility. A detector failure is isolated as a visible `Not checked` result and structured engine failure; it does not convert to `Passed`.

## Result states

Evaluation status:

- `Passed`: eligible objective check ran and found no violation.
- `Failed`: eligible objective check found evidence.
- `Warning`: evidence crosses a warning threshold.
- `Opportunity`: evidence suggests an optional improvement and never adds a health penalty.
- `Manual review`: evidence exists but a human conclusion is required.
- `Not checked`: missing observations, provider, permission, coverage, or supported method.

Observed lifecycle across immutable crawls:

- `New`, `Existing`, `Returned`, `Fixed`, and `Not evaluated`.

User disposition is stored separately as `Open`, `Ignored`, or `Accepted risk`. For an active `New`, `Existing`, or `Returned` finding, a non-open disposition becomes the effective state without rewriting the observed result. A rule cannot ignore or accept its own finding, and a disposition never turns an issue into a pass.

Comparison identity is stable rule ID plus normalized URL for page rules, or rule ID plus a documented stable site key for site rules. `Not evaluated` cannot become `Fixed`; a prior issue is fixed only when the same rule/target is eligible and passes. A later issue after an eligible pass is `Returned`.

## Finding evidence

Every finding stores rule/version, tenant/project/crawl, optional page and normalized URL, severity, status, confidence, bounded structured evidence, detected/expected values, explanation, recommendation, owner type, impact areas, first/last seen time, and source observation identifiers. Evidence must identify raw versus rendered DOM and collection time when relevant. Sensitive excerpts are minimized and masked.

No active Phase 1 rule has an LLM dependency. Checks that need semantic or business-context judgment return `Manual review` with the reason automation is inconclusive, or `Not checked` when the observations needed even to request review are unavailable. A future AI-assisted finding would additionally require supporting excerpts, prompt and model/provider versions, confidence, and review state, and could never override objective HTTP/HTML evidence.

Do not use an LLM for status, redirects, robots directives, title/canonical/link/sitemap extraction, structured-data parsing, headers, or objective performance thresholds. Suitable labeled assistance includes page-purpose clarity, claim/evidence review, topic consistency, answer directness, duplicate summaries, and suggested fixes.

## Eligibility and coverage

Eligibility is evaluated before detection. Examples: a canonical rule requires a successfully parsed HTML page; a field-performance rule requires current provider coverage; a hreflang return rule requires declared alternates. When required data is absent or unusable, record whether the target is ineligible or unavailable, list the missing observation keys, explain why the rule was `Not checked`, and attach evidence for that decision. An ineligible or unavailable result can never be `Passed`. Store counts for eligible, evaluated, failed, manual, and not-checked coverage so users can interpret scores.

## Executable-catalog status

M4A category arrays retain all 65 approved rules in sections A through D. The active manifest composes those with the 65 ONS/CNT/LNK definitions in sections E through G. The M4A definitions retain their explicit version distribution (20 at version 2, 27 at version 3, 13 at version 4, and 5 at version 5). The expansion has 36 active version-1 definitions, 21 active version-2 definitions, and 8 active version-3 definitions, all with first-supported version `M5`. Version 2 is selected for ONS-003, ONS-005, ONS-006, ONS-009, ONS-011, ONS-012, ONS-014, ONS-016, ONS-022, ONS-023, ONS-025, CNT-003, CNT-006, CNT-016, CNT-017, CNT-018, LNK-004, LNK-005, LNK-013, LNK-018, and LNK-020. Version 3 is selected for CNT-001, CNT-002, CNT-012, CNT-014, CNT-015, LNK-010, LNK-011, and LNK-019. These versions preserve corrected required-data, eligibility, target provenance, evidence attribution, secret redaction, requested-URL redirect identity, language segmentation, request errors, and raw-versus-rendered link-graph semantics without reinterpreting earlier versions. The complete active distribution is 36 at version 1, 41 at version 2, 35 at version 3, 13 at version 4, and 5 at version 5. Evaluation is synchronous and deterministic over a normalized crawl snapshot. The engine validates stable IDs, positive versions, unique ID/version pairs, target scope, eligibility/status invariants, declared missing-data dependencies, evidence shape and size, and deterministic output ordering. A rule must return at least one coverage result.

The audit database model stores immutable full-definition hashes and rule manifests, one immutable evaluation report per tenant/project/crawl, every rule/target occurrence including missing-observation keys, cross-crawl first/last-seen lifecycle, and separately authorized `Ignored` or `Accepted risk` dispositions. Delayed reports are reconciled in crawl-snapshot order so they cannot regress the newest projection. These records are derived audit evidence, not a score. The score and the remaining 60 executable definitions remain M5 work.

Examples of explicit versioned hardening include canonical-normalization provenance, crawler-owned robots directives, collection-completeness flags, crawler-policy URL identity, bounded response-prefix HTML detection, raw redirect signals, historical-redirect coverage, page/sitemap robots-observation identity, and first-header HSTS processing. Legacy rows that cannot prove the newer contract are `Not checked`; raw secret-bearing URL details are not retained in findings.

The category source and tests are in `packages/audit-engine/src/rules` and `packages/audit-engine/test`. Every ONS/CNT/LNK definition has positive-or-review, issue-or-review, and boundary-or-unavailable coverage. Objective detectors use passing and failing fixtures; qualitative or currently unobservable checks instead use representative `Manual review` and `Not checked` scenarios because manufacturing passing or failing fixtures would misstate their capability. Objective failures are page-scoped and retain observed source evidence. This status statement does not itself record a validation result.

Current coverage limitations are deliberate. ONS-023 deterministically reports a missing or malformed social-image declaration, but a syntactically valid declaration remains `Not checked` until a protected resource fetch proves availability. ONS-024 remains `Not checked` until a protected fetch covers declared icons and the conventional favicon path. CNT semantic concepts such as hidden importance, purpose, answer quality, authorship/expertise, claim support, organization identity, contact sufficiency, policy applicability, commercial clarity, citation role, and freshness route to `Manual review` or `Not checked`; lexical presence alone cannot settle them. CNT word-shingle and lexical-diversity checks return `Not checked` for scripts that need language-aware segmentation, and the keyword-repetition detector currently requires declared English content because its stopword policy is English-specific. Link-dependent CNT review remains `Not checked` when rendered content is selected because Phase 1 does not persist rendered link observations. LNK-007, LNK-008, and LNK-017 remain unavailable where persistence lacks invalid-href, event-handler navigation, or fragment-target-ID observations. External-link health requires an observed external target response. Graph-absence conclusions remain `Not checked` when a client-rendered source lacks rendered-link evidence. Contextual relevance, navigation intent, and ambiguous accessible anchor names request manual review. These states are deterministic coverage results, not missing registrations.

## Scoring model

Severity multipliers: Critical `10`, High `6`, Medium `3`, Low `1`, Opportunity/Passed `0`. Confidence: High `1.0`, Medium `0.75`, Low `0.5`. Page importance: homepage `5`, primary navigation/major landing page `3`, sitemap/strongly linked page `2`, other crawlable page `1`.

```text
affectedCoverage =
  sum(importance weights of affected eligible pages)
  / sum(importance weights of all eligible pages)

rulePenalty =
  ruleWeight × severityMultiplier × sqrt(affectedCoverage) × confidenceMultiplier

ruleMaximum = ruleWeight × 10

categoryScore = round(100 × (1 - sum(rulePenalty) / sum(ruleMaximum)))
```

Only eligible objective outcomes that were actually evaluated enter a future score denominator. `Not checked` and `Manual review` are both excluded and neither is a pass. Category weights for overall Site Health are crawlability `20%`, HTTP/redirects `10%`, robots/sitemaps `10%`, canonicals/duplication `12%`, on-page HTML `12%`, content/trust `10%`, links/architecture `10%`, images/media `4%`, performance/accessibility `8%`, and structured/international/security `4%`.

Caps: unintentionally blocked entire public site `10`; unavailable homepage `25`; widespread 5xx `35`; invalid TLS or insecure credential form `40`. AI Readiness weights are crawler accessibility `20%`, text accessibility/extractability `15%`, entity/brand clarity `20%`, evidence/trust `15%`, direct-answer quality `15%`, structured-data alignment `10%`, and freshness/ownership `5%`.

When scoring is implemented, every score stores the scoring model version, evaluated coverage, input finding references, and cap reason. The current scoring package defines denominator coverage semantics only; it does not calculate or display a Site Health score.

## Approved 190-rule catalog

### A. Crawlability and indexability (15)

```text
CRW-001 | Critical | Domain DNS resolution failed
CRW-002 | Critical | Homepage is unreachable
CRW-003 | High     | Page request timed out
CRW-004 | High     | Internally linked page returns a 4xx response
CRW-005 | Critical | Internally linked page returns a 5xx response
CRW-006 | High     | Page appears to be a soft 404
CRW-007 | High     | Intended indexable page contains meta noindex
CRW-008 | High     | Intended indexable page contains X-Robots-Tag noindex
CRW-009 | High     | Meta robots and X-Robots directives conflict
CRW-010 | High     | Important page is blocked by robots.txt
CRW-011 | High     | Sitemap URL is blocked from crawling
CRW-012 | Medium   | Indexable page is orphaned from internal navigation
CRW-013 | Medium   | Important page exceeds the configured crawl-depth threshold
CRW-014 | High     | URL pattern indicates a crawl trap or infinite URL space
CRW-015 | Medium   | Page-like internal URL returns an unexpected non-HTML content type
```

### B. HTTP, HTTPS, and redirects (15)

```text
HTTP-001 | Critical | HTTP does not redirect consistently to HTTPS
HTTP-002 | High     | www and non-www host variants resolve inconsistently
HTTP-003 | High     | Redirect chain exceeds the configured threshold
HTTP-004 | Critical | Redirect loop detected
HTTP-005 | Medium   | Internal links point to redirected URLs
HTTP-006 | Medium   | Temporary redirect is used for an apparently permanent move
HTTP-007 | High     | Redirect target returns a 4xx response
HTTP-008 | High     | Redirect target returns a 5xx response
HTTP-009 | Medium   | Meta-refresh redirect detected
HTTP-010 | Medium   | Page depends on a JavaScript-only redirect
HTTP-011 | High     | Redirect Location header is missing, malformed, or unsafe
HTTP-012 | Medium   | HTML content is served with an incorrect MIME type
HTTP-013 | High     | Page response exceeds the configured size threshold
HTTP-014 | Medium   | Compressible text response is not compressed
HTTP-015 | Low      | HTTPS site lacks an appropriate HSTS policy
```

### C. robots.txt and XML sitemaps (15)

```text
RSM-001 | Low      | robots.txt is missing
RSM-002 | High     | robots.txt is inaccessible or returns a server error
RSM-003 | Medium   | robots.txt contains invalid or unrecognized syntax
RSM-004 | Critical | robots.txt appears to block the entire public site unintentionally
RSM-005 | Medium   | robots.txt blocks critical CSS or JavaScript resources
RSM-006 | Low      | robots.txt contains no sitemap declaration
RSM-007 | Medium   | No XML sitemap was discovered
RSM-008 | High     | Submitted or declared sitemap is inaccessible
RSM-009 | High     | Sitemap XML is invalid or cannot be parsed
RSM-010 | High     | Sitemap exceeds supported URL or file-size limits
RSM-011 | Medium   | Sitemap contains noncanonical URLs
RSM-012 | Medium   | Sitemap contains redirected URLs
RSM-013 | High     | Sitemap contains 4xx or 5xx URLs
RSM-014 | High     | Sitemap contains noindex or robots-blocked URLs
RSM-015 | Medium   | Sitemap inventory does not align with important crawlable pages
```

### D. URLs, canonicals, and duplication (20)

```text
URL-001 | Medium   | Indexable page has no canonical declaration
URL-002 | High     | Page contains multiple canonical declarations
URL-003 | High     | Canonical URL is malformed or cannot be resolved
URL-004 | High     | Canonical points to a redirected URL
URL-005 | High     | Canonical points to a 4xx URL
URL-006 | High     | Canonical points to a 5xx URL
URL-007 | High     | Canonical points to a blocked or noindex URL
URL-008 | High     | Canonical unexpectedly points to a different domain
URL-009 | Critical | Canonical loop detected
URL-010 | Medium   | Apparently unique page canonicals to a substantially different page
URL-011 | Medium   | Canonical uses an inconsistent protocol, hostname, or slash format
URL-012 | High     | Exact duplicate content exists on multiple indexable URLs
URL-013 | Medium   | Near-duplicate content exists on multiple indexable URLs
URL-014 | Medium   | Query parameters create duplicate versions of a page
URL-015 | Medium   | URL case variations create duplicate pages
URL-016 | Medium   | Trailing-slash variations create duplicate pages
URL-017 | Medium   | Default-document variants such as /index.html create duplicates
URL-018 | Low      | URL exceeds the configured readability or length threshold
URL-019 | Medium   | URL contains unsafe, malformed, or improperly encoded characters
URL-020 | High     | Paginated page is incorrectly canonicalized to the first page
```

### E. Titles, metadata, headings, and HTML (25)

```text
ONS-001 | High   | Page title is missing
ONS-002 | High   | Page title is empty
ONS-003 | Medium | Page title is duplicated across indexable pages
ONS-004 | High   | Page contains multiple title elements
ONS-005 | Low    | Page title is unusually short
ONS-006 | Medium | Page title is likely truncated because of excessive length
ONS-007 | Medium | Meta description is missing
ONS-008 | Medium | Meta description is empty
ONS-009 | Low    | Meta description is duplicated across pages
ONS-010 | Medium | Page contains multiple meta descriptions
ONS-011 | Low    | Meta description is unusually short
ONS-012 | Low    | Meta description is likely truncated because of excessive length
ONS-013 | High   | H1 heading is missing
ONS-014 | High   | H1 heading is empty
ONS-015 | Medium | Multiple H1 headings require review
ONS-016 | Medium | H1 is duplicated across important pages
ONS-017 | Low    | Heading hierarchy skips logical levels
ONS-018 | High   | Mobile viewport declaration is missing or invalid
ONS-019 | Medium | HTML language declaration is missing or invalid
ONS-020 | Medium | Character encoding is missing or declared too late
ONS-021 | Low    | HTML document type is missing
ONS-022 | Low    | Essential Open Graph metadata is missing or inconsistent
ONS-023 | Low    | Social sharing image is missing or cannot be fetched
ONS-024 | Low    | Favicon or application icon is missing
ONS-025 | High   | Source or rendered page contains no meaningful visible text
```

### F. Content quality, trust, and conversion (20)

```text
CNT-001 | Medium        | Page contains very little unique content
CNT-002 | Medium        | Boilerplate content dominates unique page content
CNT-003 | Medium        | Large content sections are duplicated across multiple pages
CNT-004 | High          | Page contains placeholder or lorem ipsum content
CNT-005 | High          | Visible text contains broken character encoding
CNT-006 | Medium        | Keyword repetition suggests possible keyword stuffing
CNT-007 | Manual review | Important text may be hidden or visually inaccessible
CNT-008 | Medium        | Page purpose, product, service, or primary topic is unclear
CNT-009 | Opportunity   | Informational page lacks a concise answer-first summary
CNT-010 | Opportunity   | Question-oriented content does not answer questions directly
CNT-011 | Medium        | Editorial content has no identifiable author
CNT-012 | Opportunity   | Author lacks biography, expertise, or credential information
CNT-013 | Low           | Time-sensitive content lacks publish or modified dates
CNT-014 | Medium        | Material factual claims lack supporting evidence or citations
CNT-015 | Medium        | Outbound citations or supporting-source links are broken
CNT-016 | Medium        | Website lacks clear company or organization identity information
CNT-017 | Medium        | Website lacks discoverable contact or support information
CNT-018 | High          | Website lacks required privacy, terms, or policy pages for its use case
CNT-019 | Medium        | Product functionality, pricing, limitations, or availability is unclear
CNT-020 | Manual review | Content contains potentially stale claims or outdated details
```

### G. Internal links and site architecture (20)

```text
LNK-001 | High        | Internal link returns a 4xx response
LNK-002 | High        | Internal link returns a 5xx response
LNK-003 | Medium      | Internal link points through a redirect
LNK-004 | Medium      | External link is broken
LNK-005 | Medium      | Internal HTTPS page links to an HTTP URL
LNK-006 | Medium      | Internal link points to a noncanonical URL
LNK-007 | Medium      | Link has an empty or malformed href
LNK-008 | Medium      | Essential navigation depends on JavaScript event handlers instead of links
LNK-009 | Low         | Placeholder hash link is present
LNK-010 | High        | Indexable page has no discovered internal links pointing to it
LNK-011 | Medium      | Important page has insufficient internal-link support
LNK-012 | Medium      | Important page is buried at excessive depth
LNK-013 | Opportunity | Page has few relevant contextual internal links
LNK-014 | Low         | Page contains an excessive number of links
LNK-015 | Medium      | Internal navigational link uses nofollow unexpectedly
LNK-016 | Low         | Link has empty, generic, or uninformative anchor text
LNK-017 | Low         | Fragment link points to a missing target
LNK-018 | High        | Pagination sequence is incomplete or broken
LNK-019 | High        | Facets, calendars, filters, or parameters generate unbounded crawl paths
LNK-020 | Opportunity | Important page is missing from relevant navigation or breadcrumbs
```

### H. Images, video, audio, and embeds (12)

```text
IMG-001 | Medium      | Image resource is broken
IMG-002 | Medium      | Informative image has no alt attribute
IMG-003 | Medium      | Informative image has an empty alt value
IMG-004 | Low         | Alt text appears duplicated, filename-based, or uninformative
IMG-005 | Medium      | Image transfer size exceeds the configured threshold
IMG-006 | Medium      | Image lacks width and height dimensions
IMG-007 | Opportunity | Image lacks responsive source variants
IMG-008 | Opportunity | Offscreen image is not lazy-loaded
IMG-009 | High        | Likely LCP image is incorrectly lazy-loaded
IMG-010 | Medium      | Important image is blocked from crawling
IMG-011 | Medium      | Iframe lacks a descriptive title
IMG-012 | Opportunity | Important video or audio content lacks transcript or captions
```

### I. Performance, mobile, and accessibility (16)

```text
PRF-001 | High   | Largest Contentful Paint is poor
PRF-002 | High   | Interaction to Next Paint is poor
PRF-003 | High   | Cumulative Layout Shift is poor
PRF-004 | High   | Time to First Byte is poor
PRF-005 | Medium | First Contentful Paint or Speed Index is poor
PRF-006 | Medium | Render-blocking resources delay initial rendering
PRF-007 | Medium | Significant unused CSS is delivered
PRF-008 | Medium | Significant unused JavaScript is delivered
PRF-009 | High   | JavaScript bundles are excessively large
PRF-010 | Medium | Text resources are served without compression
PRF-011 | Medium | Static resources lack effective caching
PRF-012 | Medium | DOM size or depth is excessive
PRF-013 | Medium | Third-party scripts create significant main-thread work
PRF-014 | High   | Mobile layout has overflow, small text, or inadequate tap targets
PRF-015 | High   | Form controls or interactive elements lack accessible names
PRF-016 | High   | Critical contrast, ARIA, focus, or keyboard-accessibility problems exist
```

### J. Structured data, internationalization, and security (12)

```text
STR-001 | High        | JSON-LD, microdata, or RDFa contains parsing errors
STR-002 | Opportunity | Relevant organization, website, software, product, article, or breadcrumb schema is missing
STR-003 | Medium      | Structured data lacks required or important recommended properties
STR-004 | High        | Multiple schema entities contain conflicting identity information
STR-005 | High        | Schema URL, price, currency, rating, availability, or dates conflict with visible content
STR-006 | High        | hreflang contains invalid language or region codes
STR-007 | Medium      | hreflang return links or x-default handling are incomplete
STR-008 | High        | hreflang target redirects, errors, is blocked, is noindex, or is noncanonical
STR-009 | Medium      | Page language, URL locale, and hreflang values conflict
STR-010 | Critical    | TLS, mixed-content, or insecure-form problems exist
STR-011 | Medium      | Important security headers or cookie protections are missing
STR-012 | Critical    | Page exposes secrets, sensitive files, credentials, or PII in URLs or HTML
```

### K. AI-search and generative-engine readiness (20)

AI crawler user agents and policies live in a configurable, dated registry because names and behavior change. These checks assess declared access and content readiness; they do not claim actual AI citations.

```text
AIO-001 | High        | OAI-SearchBot is blocked from relevant public content
AIO-002 | Medium      | ChatGPT-User is blocked from relevant public content
AIO-003 | Opportunity | Google-Extended policy is absent or conflicts with the site's stated preference
AIO-004 | High        | Perplexity retrieval crawlers are blocked from relevant public content
AIO-005 | High        | Claude retrieval crawlers are blocked from relevant public content
AIO-006 | High        | AI-crawler rules are contradictory across robots.txt, headers, or environments
AIO-007 | Opportunity | llms.txt is absent where the owner chooses to provide one
AIO-008 | Medium      | llms.txt is malformed, stale, misleading, or links to unavailable content
AIO-009 | High        | Important product or company facts require login, interaction, or inaccessible UI state
AIO-010 | High        | Important content is available only after unreliable client-side rendering
AIO-011 | Medium      | Brand, organization, and product names are inconsistent across pages
AIO-012 | Opportunity | Website lacks a concise, factual organization or product definition
AIO-013 | Medium      | Important claims lack primary evidence, source links, or verifiable support
AIO-014 | Opportunity | Authorship, ownership, expertise, and editorial responsibility are unclear
AIO-015 | Medium      | Important facts are present only in images, video, canvas, or inaccessible widgets
AIO-016 | Opportunity | Question-oriented pages lack direct, extractable answers
AIO-017 | Medium      | Important content lacks freshness, date, version, or ownership signals
AIO-018 | Opportunity | Tracked AI prompts mention competitors but not the user's brand
AIO-019 | Opportunity | AI citation share or topic coverage trails selected competitors
AIO-020 | High        | A page cited by an AI answer is unavailable, redirected, noncanonical, blocked, or outdated
```

AIO-018 through AIO-020 require compliant provider observations; without them they are `Not checked`. Robots and page-access checks do not prove that a model used, mentioned, ranked, or cited a site.

## Rule authoring and review

Follow the complete workflow in `docs/AUDIT_RULE_DEVELOPMENT.md`.

1. Add or change a rule through a new immutable version; never reinterpret historical results in place.
2. Define eligibility and unavailable-data behavior before the detector.
3. Add positive, negative, ineligible, boundary, and malformed fixture tests.
4. Prove evidence is sufficient, bounded, safely renderable, and contains no unnecessary sensitive data.
5. Add exact remediation and a deterministic verification method.
6. Measure false positives across representative fixture sites and peer review SEO/security implications.
7. Register the rule and update catalog/coverage counts. Catalog CI must reject duplicate IDs and missing metadata.
8. Re-run score and comparison tests; a version change must not rewrite older crawl outcomes.
