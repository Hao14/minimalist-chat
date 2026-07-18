---
title: GBrain Setup
status: active
configuration: verified-free
updated_on: 2026-07-10
tags:
  - minimalist-chat
  - gbrain
  - memory
  - tooling
---

# GBrain Setup

## Installed

- GBrain CLI `0.42.58.0` installed with Bun `1.3.14`.
- Source pinned at install time to commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`.
- CLI location: `C:\Users\jaysa\.bun\bin\gbrain.exe`.
- Pinned skill-source clone: `C:\Users\jaysa\gbrain`.
- The current bundle manifest scaffolded 38 skills (68 upstream files) into `skills/`; see [[skills/GBrain Skill Catalog|GBrain Skill Catalog]].

## Active free configuration

- Native Windows PGLite is initialized at `C:\Users\jaysa\.gbrain\brain.pglite` with schema version 122.
- The pinned build was tested end to end on Windows: initialization, import, keyword retrieval, graph traversal, backlinks, and MCP all work.
- Search mode is `conservative`: 4,000-token budget, result limit 10, cache and intent weighting enabled, expansion disabled.
- Embeddings are disabled. The database contains 0 embedded chunks and has no configured embedding-provider API key.
- This mode uses local keyword retrieval and the local knowledge graph, so GBrain makes no paid embedding or model API calls. Normal Codex plan usage still applies when an agent answers a question.
- WSL2 was not required. Its Ubuntu path was unavailable because firmware virtualization is disabled on this computer.

## Imported vault

- 89 Markdown pages imported successfully.
- 324 chunks indexed for keyword retrieval.
- 52 typed `mentions` links imported with source provenance `obsidian-import`.
- 33 tags indexed.
- 0 embeddings and 0 timeline entries. Both are intentional for this vault and mode.

GBrain's pinned Windows Obsidian resolver joins paths with backslashes while imported slugs use forward slashes. `tools/import-gbrain-obsidian-links.py` bridges that mismatch deterministically from validated vault wikilinks. It resolved all 52 project-note links with 0 unresolved targets.

## Codex connection

- Global MCP name: `gbrain`.
- Command: `C:\Users\jaysa\.bun\bin\gbrain.exe serve`.
- The stdio handshake and tool catalog were verified. New Codex tasks can use this MCP connection after their tool list loads.

## Verification

- Keyword searches returned the protected Ollama gateway, product-opportunity, and Lighthouse history notes.
- `graph-query` from the Knowledge Hub returned its expected outgoing relationships.
- Backlinks to [[90 Memory/Project Memory|Project Memory]] returned the Knowledge Hub and Memory Protocol.
- JSONB integrity is clean under PGLite.
- Doctor warnings about absent embeddings, pgvector, and a missing embedding-provider key are expected in this deliberately free profile.

## Refresh workflow

After vault notes change, run:

```powershell
gbrain import 'C:\Users\jaysa\Documents\minimalist-chat\Minimalist-chat-vault' --no-embed --workers 1
python 'C:\Users\jaysa\Documents\minimalist-chat\tools\import-gbrain-obsidian-links.py' --apply
gbrain extract timeline --source db
gbrain doctor --json
```

Use `gbrain search '<exact project terms>'` as the default free lookup. Do not run embedding, dream-cycle, autopilot, remediation, or external integration jobs unless the user explicitly opts in to their resource and privacy implications.

## Optional later upgrade

Local Ollama embeddings could add semantic and synonym-based recall without a hosted API bill, but no Ollama embedding model is installed or configured. The current keyword-plus-graph profile remains the approved default.
