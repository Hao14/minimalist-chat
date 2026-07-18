---
type: "query"
date: "2026-07-15T06:45:33.450935+00:00"
question: "Audit docs, env examples, UI copy, and configuration for references to the existing 3/3/4 or total-10 AI provider router; target is PC/Ollama 1-10, Cloudflare 11-50, Groq 51-90, and 91+ HTTP 429."
contributor: "graphify"
outcome: "useful"
source_nodes: ["Protected Ollama Public Gateway", "Firebase Functions Runtime Config", "Optional 3 / 3 / 4 text-AI overflow router"]
---

# Q: Audit docs, env examples, UI copy, and configuration for references to the existing 3/3/4 or total-10 AI provider router; target is PC/Ollama 1-10, Cloudflare 11-50, Groq 51-90, and 91+ HTTP 429.

## Answer

Expanded from the audit question via graph vocab: [cloudflare, config, configuration, firebase, gateway, groq, ollama, overflow, queue, request, router]. The canonical gateway documentation and functions/.env.example are the checked-in operational copies that require exact 10/40/40 ranges and request-91 rejection wording. The generated vault copy of Protected Ollama Public Gateway must be regenerated from the canonical doc, not hand-edited. Current UI disclosure text is provider-generic and does not hardcode capacity, so it should remain unchanged. The routing mode name also does not encode capacity, while totalCapacity is computed from provider tiers.

## Outcome

- Signal: useful

## Source Nodes

- Protected Ollama Public Gateway
- Firebase Functions Runtime Config
- Optional 3 / 3 / 4 text-AI overflow router