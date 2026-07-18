---
type: "query"
date: "2026-07-15T05:39:33.262441+00:00"
question: "what credentials do you need?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Protected Ollama Public Gateway", "Firebase Functions Runtime Config", "Optional 3 / 3 / 4 text-AI overflow router"]
---

# Q: what credentials do you need?

## Answer

Expanded tokens: cloudflare, config, firebase, functions, gateway, groq, ollama, protected, router, security, token. Required secrets are CLOUDFLARE_AI_API_TOKEN created through the Workers AI REST API token template, GROQ_API_KEY, and the existing OLLAMA_SERVER_TOKEN. Required non-secret configuration is CLOUDFLARE_ACCOUNT_ID plus the feature flag, model IDs, and protected gateway URL. Never paste secrets into chat or commit them; store them in Google Secret Manager. The Cloudflare tunnel connector token is unrelated.

## Outcome

- Signal: useful

## Source Nodes

- Protected Ollama Public Gateway
- Firebase Functions Runtime Config
- Optional 3 / 3 / 4 text-AI overflow router