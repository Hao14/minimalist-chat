# Audit-rule development guide

This guide covers the deterministic, versioned rule boundary in `@searvia/audit-engine` and audit persistence in `@searvia/database`. It explains how to add or revise a rule without changing historical meaning, turning missing data into a pass, or coupling objective evaluation to a worker, route handler, database query, or LLM.

The approved product catalog remains in `docs/AUDIT_RULES.md`. The active `m5-partial-3` manifest contains 130 definitions: the 65 M4A CRW/HTTP/RSM/URL rules plus `ONS-001`–`ONS-025`, `CNT-001`–`CNT-020`, and `LNK-001`–`LNK-020`. This is a partial M5 expansion, not the complete 190-rule catalog or a completed score model.

## Boundary and data flow

An audit rule evaluates one immutable `AuditCrawlSnapshot`. The snapshot adapter is responsible for loading tenant-scoped M3 crawl observations and translating them into the engine contract. A rule never fetches a URL, reads PostgreSQL or object storage, publishes a job, mutates the snapshot, or renders customer HTML.

```text
tenant-scoped completed crawl observations
  -> AuditCrawlSnapshot
  -> VersionedAuditEngine(selected rule versions)
  -> AuditEvaluationReport
  -> tenant-scoped evaluation run, occurrences, and finding lifecycle
```

Only `completed` and `partially_completed` crawl snapshots are valid inputs. Partial coverage is handled by rule eligibility; it is not permission to infer a pass from an absent observation.

The main source files are:

- `packages/audit-engine/src/contracts.ts` — rule, eligibility, target, outcome, report, and policy contracts;
- `packages/audit-engine/src/snapshot.ts` — normalized crawl observations available to rules;
- `packages/audit-engine/src/engine.ts` — catalog validation, result bounds, deterministic ordering, failure isolation, and coverage counts;
- `packages/audit-engine/src/catalog.ts` — historical M4A and active 130-rule catalog composition and engine factories;
- `packages/audit-engine/src/rules/helpers.ts` — definition, target, evidence, eligibility, and shared detector helpers;
- `packages/audit-engine/src/rules/{crw,http,rsm,url,ons,cnt,lnk}.ts` — implemented category definitions and category arrays;
- `packages/audit-engine/test` — shared snapshot builders, per-category fixtures, contract tests, and completed-crawl integration coverage;
- `packages/database/src/audit-repository.ts` — immutable definition/report registration, occurrence persistence, lifecycle reconciliation, and disposition authorization.

## Rule contract

Every `AuditRuleDefinition` supplies:

- stable catalog ID and positive integer version;
- title, category, description, default severity, and `page` or `site` scope;
- a precise eligibility statement and nonempty `requiredData` keys;
- deterministic evaluation from the supplied snapshot and versioned policy;
- an expected value and plain-language explanation;
- an exact recommended fix and deterministic verification method;
- default confidence, impact areas, responsible owner, and first supported product version.

The evaluator returns one or more `AuditRuleOutcome` values. Each outcome contains a stable target, explicit eligibility, result status, bounded evidence, detected value, and optional overrides for expected value or confidence. A rule must return at least one coverage outcome, including when the necessary observation is unavailable.

Target identity is part of persisted history:

- A page result uses the page's normalized URL as `target.key` and supplies that crawl's page ID and normalized URL.
- A rule-wide page coverage result may use `unavailablePageTarget` with a stable synthetic key and no page identity only when the outcome is ineligible or unavailable and `not-checked`. Persistence will not attach that occurrence to a finding.
- A site result uses a stable, documented key derived from the project origin and the particular site-level subject. It has no page ID or normalized page URL.
- Do not use array position, crawl order, a mutable title, or an error message as a target key.
- Do not invent a page ID for rule-wide unavailable coverage or use a coverage-only target for an eligible result.

## Eligibility and unavailable data

Eligibility is evaluated before the detector reaches a conclusion. It has three states:

- `eligible` — every observation needed for this target is present and usable;
- `ineligible` — the rule does not logically apply to this target, such as a canonical-target rule on a non-HTML resource;
- `unavailable` — the rule would apply, but required evidence was not collected, retained, supported, or successfully parsed.

The status invariant is strict:

- an eligible outcome must be checked and cannot be `not-checked`;
- an ineligible or unavailable outcome must be `not-checked` and cannot be passed, failed, or warned;
- a `not-checked` outcome names the missing observation keys, gives a user-readable reason, and includes evidence showing why no conclusion was possible;
- every missing-data key must also appear in that rule version's `requiredData`; the engine rejects undeclared missing dependencies instead of silently widening the contract;
- a detector exception is isolated by the engine as a visible `not-checked` result and a structured detector failure. It is never converted to a pass.

Use `notCheckedOutcome`, `siteUnavailable`, or `pageUnavailable` where their target identity matches the rule's persisted scope. Do not use an empty result array to mean “not applicable”; the engine treats empty coverage as a detector error.

Examples of unavailable rather than passed behavior include missing raw HTML for a meta-refresh check, absent user-agent-aware robots directives, an uncrawled canonical target, or an incomplete sitemap response. “No evidence of a problem” is a pass only when the rule had sufficient evidence to look for that problem.

For robots meta and X-Robots evidence, require `directiveScopePreserved` before concluding either a pass or a directive-based failure. New worker rows contain only global directives plus directives applicable to the configured crawler and set this flag; legacy flattened rows keep it false and must remain `not-checked`.

An absence-based conclusion also requires collection-completeness provenance. For example, “no internal link points here” cannot pass or fail from a truncated link set, “no redirect signal exists” requires a successful raw extraction, and a historical-pattern rule must know whether its bounded lookback query was complete. Persist a conservative completeness flag with the observation and adapt legacy rows to `false`; never infer completeness from an empty array.

Robots decisions must be tied to the exact persisted robots observation used for that page, sitemap, or resource. An explicit matching `Disallow` is different from an unavailable robots fetch, an excessive crawl delay, or another policy stop. Missing or mismatched provenance is `not-checked`, even when the crawler correctly refused to make the request.

## Deterministic evaluation

Objective rules must produce the same ordered result for the same rule version, engine policy, and immutable snapshot. An evaluator must not use:

- current time, randomness, process-local state, or input iteration with unstable ordering;
- network, database, object-store, provider, browser, or filesystem calls;
- an LLM or heuristic text generation for an objective technical conclusion;
- UI labels or rendered dashboard state as detector input.

Use timestamps already attached to the source observation. Sort any derived target set before returning it when the source order is not itself meaningful. Put configurable thresholds in `AuditEnginePolicy`; changing a threshold's meaning requires deliberate versioning and boundary fixtures.

Qualitative checks still use deterministic routing: the same snapshot must produce the same `Manual review` request and explanation. Do not guess the human conclusion. The result must state which judgment automation cannot make and identify the affected page and observed trigger. If even the trigger or required collection coverage is unavailable, return `Not checked` instead. `Manual review` and `Not checked` are excluded from objective scoring coverage and neither can be counted as a pass.

Text and graph detectors need explicit analysis budgets. Avoid eager tokenization for rules that do not need it, quadratic page-pair or page-edge scans, and unbounded regex match arrays. Build linear indexes where possible, cap retained samples, and return `Not checked` when a safe budget prevents proving a negative result. A retained positive observation may still support a failure when its semantics are conclusive and its evidence is bounded.

Normalize graph and sitemap identities with the crawl's persisted query-parameter policy. Retain raw requested URLs only in the crawl observation layer; use the crawler-computed normalized URL/hash for target association and the engine's privacy-safe target formatter for findings. The audit adapter must not re-normalize with a different policy or reconstruct a secret-bearing identity.

## Evidence quality and bounds

Evidence must let a developer reproduce the result without opening untrusted customer HTML. Each item records:

- evidence kind and source (`transport`, `raw`, `rendered`, `robots`, `sitemap`, `graph`, configuration, crawl, or engine);
- the exact observation ID and its collection timestamp;
- a precise field name and a scalar or bounded scalar array;
- the affected URL where relevant;
- only the minimum safe excerpt needed to explain the result.

Use source-specific IDs and timestamps. For example, raw or rendered metadata evidence points to the extraction observation and `extractedAt`; status/header evidence points to the page transport observation and `observedAt`; robots and sitemap evidence use their own records.

A non-null extraction is proven successful evidence. Persistence rows with `status = failed`, including conservative legacy rows whose outcome was never persisted, are adapted to `extraction: null`; their synthetic null/zero placeholders, links, and resources must never satisfy eligibility or a passing detector. Any rule that needs extraction data must return `unavailable`/`not-checked` when extraction is null.

For URL-003, a new single-canonical extraction records either a normalized canonical URL or one constrained normalization failure code. The raw `href` is not persisted because malformed values, query strings, and embedded credentials may contain secrets. Legacy rows with one declaration but neither normalized URL nor failure provenance are `not-checked`; absence of the newer failure code is not evidence of either a valid or malformed canonical.

The engine currently enforces one to 25 evidence items, no more than 65,536 serialized UTF-8 bytes, observation IDs no longer than 256 characters, field names no longer than 160 characters, and nonempty detected/expected/explanation/remediation text no longer than 4,096 characters at result normalization. The shared evidence helper truncates excerpts to 1,000 characters. Treat these as ceilings, not targets.

The database repository independently requires 1–100 strict evidence items with allowed kind/source values, finite scalar values, bounded identifiers/fields/timestamps/URLs/excerpts, and no extra object keys. It reapplies credential/query/fragment masking to evidence, detected/expected values, and not-evaluated reasons before hashing or storage. This is defense in depth, not permission for an engine rule to emit unsafe evidence.

At result normalization, the engine preserves URL origins and paths but redacts query values and fragment details from evidence values, evidence URLs, excerpts, and detected or expected values.

Page-result target keys and normalized URLs use the same engine-boundary protection. The engine first proves that the rule's page ID and raw target URL identify the same snapshot page, then supplies that page's crawler-computed `url_hash` to the shared privacy-safe formatter. Query, fragment, or defensive user-info details are replaced by that precomputed SHA-256 identity token while the origin and path remain useful. The audit layer never hashes the secret-bearing URL itself. The database independently derives the expected safe target from the tenant-scoped crawl page and rejects mismatches before persistence. Distinct variants therefore keep distinct cross-crawl finding identities without storing raw sensitive details in findings or occurrences.

Never include cookies, authorization values, credentials, tokens, full raw HTML, unnecessary query values, personal data, or unrestricted response bodies. Preserve the M3 safe-header omissions. Evidence is data for escaped display; it is never trusted markup.

A failing fixture should prove that the evidence:

- identifies the exact target and source observation;
- contains the detected condition and a materially different expected value;
- distinguishes raw from rendered evidence when applicable;
- remains bounded for high-cardinality site conditions;
- is sufficient to follow the recommended fix and verification method.

## Stable IDs and rule versions

Implemented rule IDs follow the approved catalog and `^(CRW|HTTP|RSM|URL|ONS|CNT|LNK)-[0-9]{3}$`. Reuse an ID only for the same product concept. Do not renumber a released rule to reorder a category.

M4A's active `defineRule` helper creates immutable version-2 definitions. Version 1 is reserved for historical rows created before the complete definition contract and the final eligibility/evidence hardening were available; those rows remain immutable and are never selected by the active catalog. Once a definition has been registered, every persisted field covered by its definition hash is immutable. The repository rejects the same `ruleId@version` when its title, description, category, severity, default confidence, scope, determinism flag, eligibility description, required data, explanation, expected value, remediation, verification method, impact areas, owner, or first-supported version changes.

Create a new positive integer version when any persisted metadata or detector semantics change, including:

- eligibility, required observations, target identity, or page/site scope;
- pass/fail logic, threshold, normalization, confidence, or severity;
- evidence meaning or evidence schema;
- explanation, expected value, recommended fix, verification method, impact areas, or owner.

Keep every persisted definition immutable for historical manifests. PostgreSQL retains historical `audit_rule_versions`; the source-level `M4A_RULES` catalog may contain only the currently selected version of each stable ID. When replay or migration code needs to register a historical manifest, it must supply that exact historical definition rather than reinterpret it through the active catalog. Select exactly one version of a rule in any evaluation catalog. A catalog hash records the selected rule/version/definition hashes; a report hash also records the engine version and normalized results. Current writes mark that hash `verified`. Pre-`0021` runs retain their original hash as `legacy_unverifiable` because later eligibility correction cannot be reconstructed with enough certainty to rewrite an immutable digest; direct persistence replay fails closed for those rows. A crawl cannot later accept a different report under the same tenant/project/crawl identity.

The `defineRule` convenience helper remains fixed to the M4A version-2 baseline. A new ONS/CNT/LNK definition uses `defineM5Rule`, immutable version 1, and first-supported version `M5`. A later metadata or semantic change uses `defineM5RuleVersion` (or a category builder that delegates to it) with the next positive version. Retain historical registrations for persisted manifests and review how the active catalog selects exactly one version. Do not change either baseline helper globally to reinterpret registered definitions.

The M4A subset contains 20 version-2, 27 version-3, 13 version-4, and 5 version-5 definitions. The expansion selects 36 version-1, 21 version-2, and 8 version-3 definitions. The complete active distribution is 36 version-1, 41 version-2, 35 version-3, 13 version-4, and 5 version-5 definitions. Later versions cover changes such as canonical-normalization provenance, robots-observation identity, query-policy target association, collection completeness, raw redirect signals, response-prefix HTML detection, bounded historical coverage, first-header HSTS processing, required-data declarations, source/target evidence attribution, secret-safe URL evidence, requested-URL redirect indexability, language-aware segmentation eligibility, request-error transport, and rendered-link graph coverage. `catalog.test.ts` asserts the exact manifest. Do not infer a rule version from its category or edit an earlier definition in place after registration.

## Adding and registering a rule

1. Confirm the ID, title, default severity, and category in `docs/AUDIT_RULES.md`. Decide whether the result is page- or site-scoped and document its stable target key.
2. List the exact observations needed. If the snapshot contract lacks one, add a normalized, bounded field at the snapshot-adapter boundary; do not query a runtime dependency from the detector.
3. Write eligibility first. Define separately what is ineligible, what is unavailable, and what constitutes enough evidence to evaluate.
4. Add the immutable definition to the appropriate category file and category array. Confirm that `ACTIVE_AUDIT_RULES` in `packages/audit-engine/src/catalog.ts` composes it exactly once and selects one version per stable ID. Keep `M4A_RULES` unchanged unless deliberately versioning that historical subset.
5. Implement the evaluator with helpers from `rules/helpers.ts`. Return deterministic, stable targets and explicit `not-checked` outcomes for uncovered cases.
6. Add the fixture matrix and tests described below. Inspect failing evidence by content, source, timestamp, URL, size, detected/expected values, fix, and verification—not only by status.
7. Update the catalog status or required-data notes in `docs/AUDIT_RULES.md` and this guide if the shared contract changes.
8. Let the evaluation integration translate engine definitions and outcomes into the database repository contract. A detector does not call `registerRuleVersions` or `persistEvaluationReport` itself.

Before persisting a catalog, registration must include the same metadata the engine executed. Before persisting a result, preserve rule ID/version, scope key, page identity, eligibility, status, severity, confidence, missing-data reason, evidence, detected/expected values, explanation, and remediation. Never derive tenant IDs from a rule result; the authorized crawl tuple supplies organization, project, and crawl scope.

## Fixture and test matrix

Every objective detector requires at least:

- a passing fixture with enough data to be eligible and prove the healthy condition;
- a failing fixture with enough data to be eligible and prove the exact issue;
- a boundary or unavailable-data fixture. An eligible threshold boundary may pass or fail according to the documented comparison; missing or unusable data must be `not-checked`, never passed;
- a unit test for metadata/registration, passing behavior, failing behavior, boundary or unavailable behavior, evidence bounds, and deterministic repeatability;
- integration coverage using a completed crawl snapshot through `VersionedAuditEngine`, with no detector failure and with the expected coverage counts.

A qualitative or currently unobservable rule must not manufacture a passing or failing fixture. Instead, add a representative eligible `manual-review` fixture that explains why automated certainty is unavailable, an unavailable or ineligible `not-checked` fixture, deterministic-repeatability coverage, and completed-crawl integration coverage. If the observation contract cannot even establish an eligible review trigger, use only truthful `not-checked` cases and document that limitation.

Add malformed input when parsing or normalization is part of eligibility. Add multi-page/site fixtures when the rule depends on graph relationships, duplicates, sitemap inventory, redirect targets, or historical observations. Tests must assert exact IDs and version uniqueness so an omitted or duplicate catalog entry cannot hide.

Relevant commands are:

```bash
pnpm --filter @searvia/audit-engine lint
pnpm --filter @searvia/audit-engine typecheck
pnpm --filter @searvia/audit-engine test
pnpm --filter @searvia/audit-engine build
pnpm --filter @searvia/database test
pnpm --filter @searvia/crawler-worker test
pnpm --filter @searvia/job-queue test:redis
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the database tests when registration, report mapping, target identity, lifecycle, or persistence changes. The Redis command requires a disposable live Redis service and is intentionally outside `pnpm check` and the current CI workflow; report it as unexecuted or failed when that service is unavailable. Run the complete deterministic root gates before declaring a milestone complete. Documentation must report the exact commands actually executed; this guide records no passing validation result.

## Persistence lifecycle and dispositions

Persistence separates immutable observations from the current finding projection:

- `audit_rules` owns stable IDs;
- `audit_rule_versions` stores immutable, hashed definition versions;
- `audit_evaluation_runs` stores one tenant/project/crawl report manifest, hashes, coverage counters, snapshot time, and terminal status;
- `audit_finding_occurrences` stores every evaluated or not-checked rule/target result for one run, including rule version and evidence;
- `audit_findings` stores the cross-crawl projection for targets that have produced an issue.

Issue statuses are `failed`, `warning`, `opportunity`, and `manual-review`. A first issue is `new`; another consecutive issue is `existing`; an issue after the last eligible result passed is `returned`. An eligible pass fixes an existing finding but does not create an empty finding when none existed. A `not-checked` result records `not-evaluated`; it never fixes a prior issue and does not advance `lastSeenAt`.

`firstSeenAt` is the first issue snapshot, `lastSeenAt` is the most recent issue snapshot, and `lastFixedAt` records the most recent eligible fix. `lastEvaluatedAt` records the newest applicable catalog snapshot; it may advance to a `not-evaluated` state when a formerly failing page target is absent from that newer report. Evaluation reports are reconciled in crawl-snapshot order so delayed jobs cannot move the projection backward.

`ignored` and `accepted-risk` are user dispositions, not detector conclusions. They overlay an active `new`, `existing`, or `returned` finding to produce its effective state while preserving the observed lifecycle and occurrence evidence. Setting either disposition requires project-update authorization, a bounded reason, actor membership, timestamp, trace ID, and audit-log entry. Each append-only log records both the previous and new dispositions and their reasons, so changing or reopening a disposition does not erase its historical justification. Reopening restores the `open` disposition. A fixed finding cannot be newly ignored or accepted.

Rules never apply dispositions and never suppress occurrence persistence because of a disposition. A later eligible result still updates the observed lifecycle. Scoring and dashboard behavior must decide explicitly how dispositions affect presentation; M4A persistence does not fabricate a pass or rewrite evidence.

## Review checklist

- The rule ID and active version are unique and match the approved catalog.
- Scope and target identity remain stable across crawls.
- Eligibility is evaluated before detection; unavailable or ineligible data is not passed.
- Required-data keys match every observation the detector reads.
- Evaluation is deterministic and contains no runtime I/O or LLM call.
- Objective detectors have independent, meaningful passing, failing, and boundary/unavailable fixtures; qualitative or unobservable rules have truthful `manual-review` and `not-checked` fixtures instead of invented conclusions.
- Evidence points to real observation IDs/timestamps, is bounded, and contains no secrets or unsafe HTML.
- Detected/expected values, explanation, exact fix, verification, confidence, impact areas, and owner are actionable.
- Completed-crawl integration coverage exercises the registered rule version.
- Persistence mapping preserves tenant, crawl, page/site target, rule version, and missing-data reason.
- A semantic or persisted-metadata change creates a new version rather than changing historical meaning.
