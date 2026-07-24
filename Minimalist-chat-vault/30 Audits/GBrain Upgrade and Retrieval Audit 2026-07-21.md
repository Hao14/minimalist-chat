---
title: GBrain Upgrade and Retrieval Audit 2026-07-21
status: verified-local
verified_on: 2026-07-22
scope: local-knowledge-retrieval
tags:
  - minimalist-chat
  - gbrain
  - audit
  - retrieval
---

# GBrain Upgrade and Retrieval Audit — 2026-07-21

## Outcome

GBrain is now a guarded local project-memory system rather than only a semantic-search database. The upgrade adds native MCP authority ranking backed by trusted source manifests, citation-aware answers with conflict reporting and abstention, local timeline-image analysis, a health dashboard, owned weekly maintenance, stronger Graphify relationships, an isolated `gbrain-base-v2` trial, and a 100-case source-aware evaluation. No application deployment, hosted inference, or external data publication occurred.

## Runtime and safety boundary

- GBrain embeddings and optional answer synthesis use the tray Ollama endpoint `127.0.0.1:11434` only.
- Winston's protected runtime remains isolated on `127.0.0.1:11435`.
- Both `C:\Users\jaysa\.gbrain\config.json` and the proxy child environment pin the approved tray endpoint. The isolated trial rechecks that its config and inherited Ollama environment contain no protected-port endpoint; this is configuration-contract evidence, not a packet-capture claim.
- The proxy resolves `GBRAIN_HOME` with GBrain's own parent-directory semantics and ignores unsupported config-path overrides.
- PGLite remains local under `C:\Users\jaysa\.gbrain` and single-writer on Windows.
- Dream, autopilot, and other background knowledge writers remain disabled.
- Source refreshers require exact ownership markers and manifests before replacing mirror content. Per-file SHA-256 values are verified against both the copied mirror and current source, catching same-path drift as well as inventory changes.

## Indexed knowledge

The owned vault mirror contains 35 curated Markdown notes. The authored-code mirror contains 679 explicit-only files and remains excluded from normal federated note queries. The latest complete refresh recorded:

| Measure | Result |
| --- | ---: |
| Pages | 714 |
| Embedded chunks | 7,855 / 7,855 |
| Reconciled note links | 90 |
| Tags | 55 |
| Structured timeline entries | 12 |

The active embedding model is `mxbai-embed-large` at 1,024 dimensions. The accepted search profile remains balanced with expansion off. The tested Jina reranker stays disabled because it materially harmed this corpus.

## Authority-aware MCP and citations

`tools/gbrain/gbrain-authority-mcp-proxy.mjs` wraps the native GBrain stdio server. Native candidates are accepted only when their `(source_id, slug)` identity is verified by a matching owned source manifest. Unresolved, ambiguous, cross-source, and malformed candidate metadata fails closed instead of being relabeled as the requested source.

After native scoring, duplicate identities are collapsed to the highest-ranked occurrence and ranks are renumbered. Deterministic authority signals prefer current, canonical material over archived alternatives without widening source scope.

The added citation-aware tool returns deterministic local file paths and evidence metadata. It exposes simple conflicts such as incompatible dates and abstains on weak or conflicting evidence. Optional local Ollama synthesis is explicitly requested, best-effort, and subordinate to the deterministic citation record. These checks improve provenance and answer honesty; they do not prove that all source statements are factually correct.

## Timeline vision

Six curated project-timeline images were analyzed locally with vision-capable `qwen3.6:latest`. Each generated sidecar binds its source image path and SHA-256, timeline context, model digest, prompt version, structured visible details, uncertainty, and a conservative evidence class. The generated index and notes explicitly distinguish visible description from deployment proof.

The pipeline writes atomically only after every analysis validates, reuses unchanged hash/model/context records, removes only stale owned sidecars, and rejects unowned lookalike files. Health verification decodes both metadata comments, checks model/source/hash agreement, validates structured analysis, and re-hashes all six source images.

## Retrieval evaluation V3

V3 expands the gate from 50 to 100 unique source-aware questions: 77 vault cases and 23 explicit-code cases. It covers current notes, authored code, aliases and typos, current-versus-archived authority, timeline images, security and operations, source isolation, and negative assertions. Twenty-seven cases contain negative or explicit source-scope checks.

An audit found that six live cases contained seven duplicate native identities. The evaluator now deduplicates by `(source_id, slug)` before every hit, recall, MRR, nDCG, top-one, source-scope, and forbidden-window calculation. Per-case and summary duplicate counts are retained, and regression coverage proves nDCG cannot exceed 1 or repeated safe rows push a forbidden result outside its checked window.

Corrected 100-case acceptance snapshot from 2026-07-22 08:34 UTC:

| Measure | Result |
| --- | ---: |
| Hit@3 | 87% |
| Recall@10 | 94% |
| MRR | 0.7829 |
| nDCG@10 | 0.7991 |
| First relevant at rank 1 | 68% |
| Exact expected top result | 62% |
| Source-scope pass rate | 100% |
| Negative-check pass rate | 96.30% |

All production quality minimums remained satisfied. Latency is recorded and reported but is not gated; this snapshot's p95 was 2.159 seconds. The current run-specific timings and complete case ledger are stored in `C:\Users\jaysa\.gbrain\evals\minimalist-chat-latest.json`.

## Graphify relationship repair

The initial scheduled enrichment exposed mixed source-path semantics: some Graphify records used vault-relative paths while code-derived records used a redundant `Minimalist-chat-vault/` prefix. That mismatch removed 755 managed relationships even though the unmanaged base remained intact.

The repaired pass canonicalizes only paths verified against the vault, handles node/link/hyperedge source metadata, and rejects any apply that increases isolated or degree-one-or-less nodes. It preserved the newer unmanaged base and produced:

| Graph measure | Result |
| --- | ---: |
| Nodes / edges | 1,202 / 2,493 |
| Managed nodes / edges | 162 / 1,501 |
| Isolated nodes | 0 |
| Degree ≤ 1 nodes | 39 |
| Invalid, dangling, self, or duplicate edges | 0 |

A repeated dry run is idempotent. Scheduled maintenance performs deterministic enrichment and output regeneration only. Full semantic document refresh remains a manual Graphify-skill workflow because the installed `graphify update` path is code-oriented.

## Isolated pack-v2 trial

The corrected `gbrain-base-v2` pack was exercised in a disposable `GBRAIN_HOME` clone with two read-only trusted provenance catalogs, 714 SHA-verified source files, endpoint isolation, and active database/config/snapshot integrity checks. Baseline and trial both achieved 87% hit@3, 94% recall@10, 0.7829 MRR, 0.7993 nDCG, 62% exact expected top-one, 100% source-scope checks, and 96.30% negative checks, with zero per-case rank regressions. Observed p95 was 1.834 seconds for baseline and 1.831 seconds for v2; latency remains an observation rather than an acceptance gate.

The active config was already marked v2 when the trial was recorded, so the baseline was reconstructed through a controlled environment override in the disposable clone. This is a valid isolated logical comparison, not a literal pre-v2 migration of the live database. Preflight verified source, mirror, and manifest hashes; the frozen clone was reverified after both evaluations; live mirrors remained unchanged; and the disposable workspace was removed.

## Health dashboard

The local dashboard binds only to `127.0.0.1:4317`. It reports manifest-backed source counts, fresh V3 evaluation status, current graph integrity and maintenance alignment, verified backup/restore evidence, timeline-vision ownership, pack acceptance, exact endpoint pinning, authority-proxy registration, and the live scheduled-task contract.

The server enforces the exact loopback Host/port, denies framing and unnecessary permissions, and serves the Graphify viewer's `vis-network` bundle locally rather than contacting a CDN. Health is fail-closed when a required maintenance step, sidecar proof, manifest hash, current-source match, task property, or current artifact is absent.

## Guarded maintenance and schedule

`tools/gbrain/Invoke-GBrainMaintenance.ps1` is the supported coordinator. It locks the workflow; validates and temporarily disconnects the exact MCP owner; creates an ownership-verified SHA-256 snapshot; proves an isolated restore/query drill; refreshes notes, code, and cached vision; runs the 100-case evaluation; applies guarded Graphify enrichment; records every required step; and restores the same MCP registration in `finally`.

The owned Windows task runs Sunday at 03:00 for the current interactive user with limited privileges. It ignores overlapping invocations, caps execution at three hours, does not wake the computer, and uses StartWhenAvailable so a missed start can run at the next suitable login. Installation and health checks compare the complete live task contract, not merely the task name.

## Verification ledger

- Authority proxy and provenance tests cover malformed, unresolved, ambiguous, cross-source, duplicate, and unavailable candidates.
- Citation tests cover deterministic paths, conflicts, weak-evidence abstention, and optional synthesis separation.
- Vision tests cover atomic success, cache idempotency, stale cleanup ownership, model capability, endpoint separation, and partial-failure rollback.
- Health tests cover graph integrity, exact MCP registration, manifest inventory equality, corrupted vision metadata, and incomplete-maintenance rejection.
- Scheduler tests cover exact ownership and read-only verification behavior.
- Graph enrichment tests cover canonicalization, idempotency, preservation, rollback, and non-regression quality gates.
- Pack trial tests cover disposable ownership, endpoint isolation, config immutability, and acceptance gates.
- Evaluation tests cover V3 structure, duplicate-safe rank metrics, bounded nDCG, negative windows, and authority ranking.

## Known limits

- GBrain is briefly unavailable during the coordinator's single-writer refresh window.
- The health dashboard and scheduler are local operational tools, not hosted services.
- Citation conflict detection is heuristic; human review remains appropriate for consequential decisions.
- Vision notes are model-generated secondary evidence and can contain imperfect readings.
- Local snapshots protect database integrity, not loss of the computer; off-device backup remains a separate choice.
- No dream/autopilot cycle, deployment, or external publication was enabled.

## Related

- [[../90 Memory/GBrain Setup|GBrain Setup]]
- [[../90 Memory/Project Memory|Project Memory]]
- [[../90 Memory/Project Timeline|Project Timeline]]
- [[../00 Home/Minimalist Chat Knowledge Hub|Minimalist Chat Knowledge Hub]]
