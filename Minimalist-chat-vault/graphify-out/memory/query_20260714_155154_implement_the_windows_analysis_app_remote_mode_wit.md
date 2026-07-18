---
type: "query"
date: "2026-07-14T15:51:54.588604+00:00"
question: "Implement the Windows Analysis app remote mode with Cloudflare Access while preserving local-only administrator controls."
contributor: "graphify"
outcome: "useful"
source_nodes: ["Desktop-only AI Control & Analysis", "Security and AI invariants", "Public HTTPS Tunnel", "Protected Ollama Public Gateway"]
---

# Q: Implement the Windows Analysis app remote mode with Cloudflare Access while preserving local-only administrator controls.

## Answer

Expanded from original query via graph vocab: [agent, analysis, authenticated, bridge, control, desktop, local, protected, security, tunnel]. Implemented a separate read-only native remote mode using Cloudflare Managed OAuth dynamic client registration, Authorization Code with PKCE, an IPv4 loopback callback, and current-user DPAPI session protection. Local mode remains the launch default. Remote requests are fixed to the protected HTTPS agent and never fall back to localhost; Users, moderation, logs, model installation, AI mode, bridge, tunnel, and workspace controls are denied both in UI state and execution policy. The exact Minimalist Chat Remote Analysis Agent task identity is validated from ping and shown separately from the public gateway recovery task.

## Outcome

- Signal: useful

## Source Nodes

- Desktop-only AI Control & Analysis
- Security and AI invariants
- Public HTTPS Tunnel
- Protected Ollama Public Gateway