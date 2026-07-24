---
title: GBrain Setup
status: active
updated_on: 2026-07-22
scope: local-project-memory
tags:
  - minimalist-chat
  - gbrain
  - operations
  - local-ai
---

# GBrain Setup

## What GBrain does

GBrain is the private, local search memory for Minimalist Chat. It turns curated project notes and an explicit authored-code mirror into searchable embeddings, then returns the most relevant local evidence to Codex. It does not deploy the app, publish the vault, or write product decisions on its own.

The accepted runtime uses:

- local PGLite data under `C:\Users\jaysa\.gbrain`;
- tray Ollama only at `http://127.0.0.1:11434/v1`;
- `mxbai-embed-large` at 1,024 dimensions;
- a `schema_pack` configuration value of `gbrain-base-v2`; the live database still reports `gbrain-base`, so the manual-only v2 migration remains unapplied;
- balanced retrieval with query expansion disabled and the experimental reranker disabled;
- an authority-aware local MCP proxy for source verification, ranking, citations, conflicts, and explicit abstention.

Never route GBrain through Winston's protected Ollama runtime on port `11435`. Dream, autopilot, and other background writers remain disabled.

## Indexed sources

| Source | Scope | Current owned mirror |
| --- | --- | ---: |
| Curated vault notes | Federated default | 36 Markdown notes |
| Authored repository files | Explicit requests only | 743 files |

The owned refresh indexes the curated notes and the explicit authored-code inventory above, while the dashboard reports live page, embedded-chunk, note-link, tag, and timeline counts because they change with authored content. Each mirror manifest records its exact source root, file inventory, and per-file SHA-256. Health verifies every digest against both the mirror and the current source tree, so a same-path content change cannot masquerade as a current refresh. Native results without matching provenance are rejected instead of being assigned to the requested source.

## Authority and citation behavior

`tools/gbrain/gbrain-authority-mcp-proxy.mjs` wraps GBrain's native stdio server. It preserves source scope, verifies every candidate against trusted mirror manifests, removes duplicate source/slug identities, and applies deterministic current-versus-archived authority ranking.

The proxy also exposes a citation-aware query tool. It returns local file paths and ranked evidence, reports simple detected conflicts such as incompatible dates, and abstains when evidence is weak or conflicting. Optional Ollama synthesis is best-effort, requires every rendered sentence or bullet claim to contain an in-range citation, and never replaces the deterministic evidence record when validation fails. This is evidence routing, not a guarantee that every statement in a source is factually correct.

The proxy validates the same config file GBrain uses and forcibly pins the child process to tray Ollama. Unsupported config-path overrides cannot bypass that guard.

## Timeline image understanding

`tools/gbrain/Analyze-ProjectTimelineVision.mjs` analyzes the six curated [[Project Timeline|project timeline]] images with local `qwen3.6:latest` vision. It writes six owned `.vision.md` sidecars plus an index under [[Timeline Vision/Index|Timeline Vision]]. Every record binds the image SHA-256, model digest, prompt version, and structured analysis. The notes describe visible evidence conservatively; a concept image or screenshot is not proof of deployment.

Maintenance reuses matching sidecars and invokes vision only for a new or changed image. Stale sidecars are removed only when their ownership metadata is valid. Invalid model capability, endpoint, output, metadata, or ownership fails closed without partial writes.

## Retrieval gate

The production evaluator uses `gbrain-evals/qrels/minimalist-chat-v3.qrels.json`: 100 unique source-aware cases spanning current notes, code, aliases/typos, authority, timeline images, security, operations, and negative/source-scope checks. Results are deduplicated by source and slug before every ranking metric, so nDCG cannot exceed 1 and repeated native hits cannot satisfy negative checks.

The gate requires all retrieval, source-isolation, and negative thresholds to pass. Latency is recorded and reported, but it is not a gate. The machine-readable latest result lives at `C:\Users\jaysa\.gbrain\evals\minimalist-chat-latest.json`; the accepted measurements are summarized in [[../30 Audits/GBrain Upgrade and Retrieval Audit 2026-07-21|the retrieval audit]].

## Relationship graph

Graphify remains the visual relationship layer. The latest 2026-07-22 maintenance snapshot has 1,265 nodes and 2,662 edges, with zero isolated nodes and 39 nodes with degree one or less. The enrichment pass canonicalizes verified vault-relative source paths, rejects dangling/self/duplicate relationships, and refuses any apply that increases isolated or weak nodes.

Scheduled maintenance runs deterministic relationship enrichment and output regeneration. A full semantic Graphify refresh of document content remains a manual Graphify-skill operation because the installed `graphify update` command is code-oriented.

## Pack-v2 trial

The corrected `gbrain-base-v2` trial was performed in a disposable `GBRAIN_HOME` clone and accepted only after both 100-case V3 gates, trusted cloned provenance catalogs, config/database/snapshot integrity, and endpoint isolation passed. Baseline and trial had identical quality metrics with zero per-case rank regressions. Observed p95 was 1.834 seconds for baseline and 1.831 seconds for v2; latency is reported, not gated. The endpoint check proves the isolated configuration and inherited Ollama environment exclude protected port `11435`; it is not a packet-capture claim. The file configuration was already marked v2 when the trial was recorded, so the baseline was reconstructed in the disposable clone; this was a logical isolated comparison, not a literal migration of the live database. A post-maintenance doctor check on 2026-07-22 confirmed that the live database pack identity remains `gbrain-base` and still offers the v2 change as a manual-only migration; do not describe the live database as migrated until that separate apply and validation succeeds.

## Local health dashboard

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\gbrain\Start-GBrainHealthDashboard.ps1
```

The dashboard is available only on `http://127.0.0.1:4317`. It reports verified source inventories, evaluation readiness, graph integrity/alignment, maintenance steps, vision ownership, pack status, endpoint pinning, MCP registration, and the live scheduled-task contract. It rejects foreign Host headers, uses same-origin assets, and serves the Graphify viewer's JavaScript locally.

## Safe maintenance

Preview the owned workflow:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\gbrain\Invoke-GBrainMaintenance.ps1 -DryRun
```

Run the complete workflow:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\gbrain\Invoke-GBrainMaintenance.ps1
```

The coordinator takes an exclusive lock, validates and temporarily removes the exact GBrain MCP registration, verifies a SHA-256 snapshot, proves a disposable restore/query drill, refreshes both owned sources, refreshes cached vision records, runs the 100-case V3 gate, enriches and validates Graphify, and restores the exact MCP registration in `finally` on success or failure. GBrain is briefly unavailable to Codex while its single-writer PGLite database is being refreshed.

## Scheduled maintenance

Install or repair the owned local task:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\gbrain\Install-GBrainMaintenanceTask.ps1
```

Verify it without mutation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\gbrain\Install-GBrainMaintenanceTask.ps1 -Verify
```

The accepted contract runs Sundays at 03:00 for the current interactive user with limited privileges, ignores overlapping starts, caps execution at three hours, does not wake the computer, and may run after the next login when a scheduled start was missed. The task runs the same guarded coordinator and can temporarily disconnect GBrain MCP.

## Recovery and limits

- The coordinator retains seven ownership-verified local database snapshots and drills the newest one before refresh.
- Rollback databases remain separate from the active `brain.pglite` directory.
- Local snapshots do not protect against device loss; off-device backup is a separate decision.
- Windows PGLite remains single-writer.
- Citation conflict detection is intentionally heuristic, and generated vision descriptions remain secondary evidence.
- No hosted deployment, external publication, dream cycle, or autonomous knowledge writer is part of this setup.

See also [[../30 Audits/GBrain Upgrade and Retrieval Audit 2026-07-21|GBrain Upgrade and Retrieval Audit]], [[Project Memory|Project Memory]], and [[Project Timeline|Project Timeline]].
