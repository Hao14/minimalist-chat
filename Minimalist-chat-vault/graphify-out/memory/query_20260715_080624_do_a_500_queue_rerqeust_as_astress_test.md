---
type: "query"
date: "2026-07-15T08:06:24.142033+00:00"
question: "do a 500 queue rerqeust as astress test"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Optional 10 / 40 / 40 Text-AI Overflow Router", "Request 91 Gets HTTP 429 Without a FIFO Queue", "Transactional Capacity Leases and Retryable Admission Control", "Protected Ollama Public Gateway"]
---

# Q: do a 500 queue rerqeust as astress test

## Answer

Expanded from original query via vocab: [capacity, cloudflare, concurrency, durable, firebase, groq, leases, ollama, overflow, queue, request, router]. The 10/40/40 design is admission control, not a durable queue. A held-lease 500-arrival simulation should yield 90 accepted and 410 full, while an actual gateway burst may accept more as leases release and can fail earlier on auth, Bananas, function scaling, transaction contention, or provider quotas. Acquisition retries are idempotent by stable lease UUID; release is best-effort in finally; 150-second leases expire lazily on later acquisition.

## Outcome

- Signal: useful

## Source Nodes

- Optional 10 / 40 / 40 Text-AI Overflow Router
- Request 91 Gets HTTP 429 Without a FIFO Queue
- Transactional Capacity Leases and Retryable Admission Control
- Protected Ollama Public Gateway