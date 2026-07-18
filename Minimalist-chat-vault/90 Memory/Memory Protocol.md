---
title: Memory Protocol
status: active
tags:
  - minimalist-chat
  - memory
  - workflow
---

# Memory Protocol

## Capture

Put fast, unclassified notes in [[90 Memory/Inbox|Memory Inbox]]. Include a date and a source link or file path whenever possible.

## Promote

- Stable project facts and constraints → [[90 Memory/Project Memory|Project Memory]].
- Product wording and capabilities → `10 Product/Current/`.
- Superseded product/legal text → `11 Product/Legacy/` with `status: archived`.
- External findings and analysis → `20 Research/`.
- Verification results and regressions → `30 Audits/`.
- Runbooks and security invariants → `40 Operations/`.
- Reusable execution prompts → `50 Skills/Prompt Library/`.

## Verify

Before promoting a claim:

1. Identify the canonical source.
2. Add or preserve source metadata.
3. Distinguish current truth from historical snapshots.
4. Cross-link related notes.
5. Update Graphify and GBrain indexes after material changes.

## Three memory layers

- Vault/GBrain: durable world and project knowledge.
- Agent memory: operating preferences and session continuity.
- Current conversation: temporary task context that does not need storage unless it becomes durable.

Never store credentials, access tokens, private keys, or unredacted secrets in the vault or generated graph.
