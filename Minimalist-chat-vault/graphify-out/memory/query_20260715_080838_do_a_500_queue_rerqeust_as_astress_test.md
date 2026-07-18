---
type: "query"
date: "2026-07-15T08:08:38.337091+00:00"
question: "do a 500 queue rerqeust as astress test"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Transactional Capacity Leases and Retryable Admission Control", "Request 91 Gets HTTP 429 Without a FIFO Queue", "Ordered 10 / 40 / 40 AI Capacity", "Optional 10 / 40 / 40 Text-AI Overflow Router"]
---

# Q: do a 500 queue rerqeust as astress test

## Answer

Expanded from original query via graph vocab: [admission, capacity, concurrency, queue, request, router, routing, rtdb, overflow, leases, test, limit]. Ran a safe local 500-arrival stress test using 500 same-burst RTDB emulator transactions with all admitted leases held. Result: 90 accepted (10 protected Ollama, 40 Cloudflare, 40 Groq), 410 capacity-full, 0 transaction errors, 0 invalid leases, 90 unique stored leases, and all assertions passed. The emulator burst completed in 181.062 ms with p50 15.727 ms, p95 171.477 ms, p99 175.696 ms, and max 177.52 ms. The permanent router suite also passed 10/10. This is admission control rather than a FIFO queue: the 410 full attempts would receive HTTP 429 and are not stored. No AI providers, production services, credentials, or deployment were used; this does not prove end-to-end Function or inference throughput.

## Outcome

- Signal: useful

## Source Nodes

- Transactional Capacity Leases and Retryable Admission Control
- Request 91 Gets HTTP 429 Without a FIFO Queue
- Ordered 10 / 40 / 40 AI Capacity
- Optional 10 / 40 / 40 Text-AI Overflow Router