---
type: "query"
date: "2026-07-13T05:01:59.470860+00:00"
question: "Photo import failed because qwen2.5vl:7b is not installed"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Protected Ollama Public Gateway", "Local Bridge"]
---

# Q: Photo import failed because qwen2.5vl:7b is not installed

## Answer

The runtime check confirmed Ollama had only nomic-embed-text. Installed qwen2.5vl:7b (5.56 GB), verified its vision capability, restarted the protected bridge after removing a conflicting Python server from port 8787, and confirmed the authenticated bridge lists the model. The separate trycloudflare tunnel remains offline with 502 and requires a new stable URL plus an explicitly authorized Firebase Functions deployment.

## Outcome

- Signal: useful

## Source Nodes

- Protected Ollama Public Gateway
- Local Bridge