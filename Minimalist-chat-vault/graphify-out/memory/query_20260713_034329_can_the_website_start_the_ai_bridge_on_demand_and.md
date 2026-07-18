---
type: "query"
date: "2026-07-13T03:43:29.579038+00:00"
question: "Can the website start the AI bridge on demand and stop it after two idle hours?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Protected Ollama Public Gateway", "Local Bridge"]
---

# Q: Can the website start the AI bridge on demand and stop it after two idle hours?

## Answer

Expanded from original query via graph vocab: [bridge, gateway, ollama, service, functions, start, model]. The protected bridge must remain reachable; it now starts Ollama for authenticated approved AI traffic and stops only its owned Ollama process after 120 idle minutes. A fully powered-off PC cannot be woken through an offline bridge without separate Wake-on-LAN infrastructure.

## Outcome

- Signal: useful

## Source Nodes

- Protected Ollama Public Gateway
- Local Bridge