---
type: "query"
date: "2026-07-15T08:25:51.081140+00:00"
question: "Audit Firebase rules and trigger patterns for a durable per-user AI queue with ownership, cancellation, TTL, FIFO, idempotence, and no context or secret exposure"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Protected Ollama Public Gateway", "Request 91 Gets HTTP 429 Without a FIFO Queue", "Transactional Capacity Leases and Retryable Admission Control", "Optional 10 / 40 / 40 Text-AI Overflow Router", "Firebase Functions Runtime Config"]
---

# Q: Audit Firebase rules and trigger patterns for a durable per-user AI queue with ownership, cancellation, TTL, FIFO, idempotence, and no context or secret exposure

## Answer

Expanded from the original query via graph vocab: [auth, capacity, context, fifo, firebase, leases, queue, request, result, rules, secret, status]. The current 10/40/40 router has transactional expiring provider leases but request 91 is rejected, not stored. A secure durable queue should split Admin-only job metadata and sanitized payloads from an owner-readable, client-write-denied status/result mirror; use a server-assigned monotonic ticket for FIFO; deduplicate by uid plus requestId plus canonical payload hash; cancel only queued jobs through an authenticated Function; reserve Bananas on admission and make retries reuse the existing charge; reauthorize room/tier/ban state before execution; purge payloads on terminal state, expire queued work, retain short public results and bounded dedupe tombstones; and test rules, projection allowlists, trigger duplication, lease recovery, FIFO, cancellation, and 500 admissions in emulators. Realtime Database triggers are at-least-once, so every claim and terminal transition must be transactionally idempotent.

## Outcome

- Signal: useful

## Source Nodes

- Protected Ollama Public Gateway
- Request 91 Gets HTTP 429 Without a FIFO Queue
- Transactional Capacity Leases and Retryable Admission Control
- Optional 10 / 40 / 40 Text-AI Overflow Router
- Firebase Functions Runtime Config