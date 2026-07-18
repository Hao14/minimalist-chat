---
type: "query"
date: "2026-07-15T06:33:29.465892+00:00"
question: "so what is our limit currently"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Optional 3 / 3 / 4 text-AI overflow router", "Firebase Functions Runtime Config", "Protected Ollama Public Gateway"]
---

# Q: so what is our limit currently

## Answer

Expanded from graph vocabulary: [active, cloudflare, config, firebase, free, groq, ollama, overflow, request, router]. Current live production is not running the prepared 3/3/4 router: AI_MULTI_PROVIDER_ROUTING is absent/false and the deployed aiGateway does not bind the new Cloudflare secret. Live therefore has no fixed application-level 10-request concurrency cap and text AI follows the legacy protected Ollama path. After activation and deployment, the prepared router supports 10 simultaneous active text requests: 3 Ollama PC, 3 Cloudflare Workers AI, and 4 Groq; request 11 receives HTTP 429 and is not durably queued. Cloudflare Free provides 10,000 neurons/day, roughly 270-500 answers for typical prompt/output sizes; Groq Free base limits are 30 RPM, 1,000 RPD, 8,000 TPM, and 200,000 TPD.

## Outcome

- Signal: useful

## Source Nodes

- Optional 3 / 3 / 4 text-AI overflow router
- Firebase Functions Runtime Config
- Protected Ollama Public Gateway