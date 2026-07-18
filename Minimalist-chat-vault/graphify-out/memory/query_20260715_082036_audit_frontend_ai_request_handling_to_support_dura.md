---
type: "query"
date: "2026-07-15T08:20:36.022952+00:00"
question: "Audit frontend AI request handling to support durable queued AI responses with queued, processing, completed, failed, retry, cancel, and timeout states while preserving provider labels and Bananas."
contributor: "graphify"
outcome: "useful"
source_nodes: ["Protected Ollama Public Gateway", "Request 91 Gets HTTP 429 Without a FIFO Queue", "Transactional Capacity Leases and Retryable Admission Control", "Ordered 10 / 40 / 40 AI Capacity"]
---

# Q: Audit frontend AI request handling to support durable queued AI responses with queued, processing, completed, failed, retry, cancel, and timeout states while preserving provider labels and Bananas.

## Answer

Expanded from original query via vocab: [client, gateway, queue, request, provider, status, retryable, firebase, ollama, cloudflare, groq, profile]. The current client assumes every successful gateway POST returns reply immediately: fetchAuthedJson discards HTTP status and chatWithGateway rejects a valid 202 as an empty response. For the requested 500-client scale, use the authenticated Function for submit and cancel plus an owner-only RTDB status mirror at ai_queue_status/{uid}/{requestId}; keep prompts/context in a server-only path. Map processing to a running UI state. Resolve completed jobs through the existing result shape so provider/model labels and Bananas meters remain unchanged. Keep busy true while queued/running, allow cancel only while queued, retry status attachment without enqueuing a duplicate, and use a new requestId only for an explicit terminal retry. Add stale-result protection to profile spotlight and do not treat queue failures as gateway availability failures.

## Outcome

- Signal: useful

## Source Nodes

- Protected Ollama Public Gateway
- Request 91 Gets HTTP 429 Without a FIFO Queue
- Transactional Capacity Leases and Retryable Admission Control
- Ordered 10 / 40 / 40 AI Capacity