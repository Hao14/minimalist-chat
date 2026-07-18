---
type: "implementation"
date: "2026-07-15T07:37:42.425854+00:00"
question: "How should the Analysis app represent the website's new AI models?"
contributor: "graphify"
outcome: "useful"
---

# Q: How should the Analysis app represent the website's new AI models?

## Answer

The website still exposes only Fast and Smart profile IDs, plus fixed Vision locally. The July 14 addition is hosted overflow routing: PC Ollama 10 slots, Cloudflare Workers AI 40 slots using @cf/qwen/qwen3-30b-a3b-fp8, and Groq 40 slots using openai/gpt-oss-20b. Analysis now shows a read-only Website AI routing card in Local and Remote modes. Hosted IDs remain outside ApprovedOllamaModelProfile, local install buttons, and the protected bridge allowlist.

## Outcome

- Signal: useful