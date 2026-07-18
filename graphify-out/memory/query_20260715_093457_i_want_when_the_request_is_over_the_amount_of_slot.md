---
type: "query"
date: "2026-07-15T09:34:57.227738+00:00"
question: "I want when the request is over the amount of slot availiable its stay in the queue until it is finished"
contributor: "graphify"
outcome: "useful"
source_nodes: ["functions/index.js", "functions/ai-request-queue.js", "database.rules.json", "src/features/ai/localAiClient.js"]
---

# Q: I want when the request is over the amount of slot availiable its stay in the queue until it is finished

## Answer

Expanded from the original query via graph vocabulary: [durable, fifo, queue, request, capacity, leases, gateway, firebase, client, result, retryable, process]. The repository now routes active requests through PC slots 1-10, Cloudflare slots 11-50, and Groq slots 51-90. Request 91 and later are stored in an Admin-only Firebase RTDB FIFO with no capacity-wait expiry, pre-charge admission recovery, fenced claims, recoverable wake slots, transient retries, owner-only realtime status, and 24-hour terminal result retention. Queued HTTP submissions return 202 and complete asynchronously. The implementation and tests are local, not a deployment claim.

## Outcome

- Signal: useful

## Source Nodes

- functions/index.js
- functions/ai-request-queue.js
- database.rules.json
- src/features/ai/localAiClient.js