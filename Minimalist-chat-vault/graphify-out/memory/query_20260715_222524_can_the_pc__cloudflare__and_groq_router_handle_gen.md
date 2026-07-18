---
type: "query"
date: "2026-07-15T22:25:24.074308+00:00"
question: "Can the PC, Cloudflare, and Groq router handle genuine staged loads of 100, 200, 400, and 1000 requests while retaining overflow until completion?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Protected Ollama Public Gateway", "Ordered 10 / 40 / 40 AI Capacity", "Authenticated AI Gateway Path"]
---

# Q: Can the PC, Cloudflare, and Groq router handle genuine staged loads of 100, 200, 400, and 1000 requests while retaining overflow until completion?

## Answer

Yes. On 2026-07-15, local Auth and RTDB emulators drove the real protected Ollama, Cloudflare Workers AI, and Groq providers. All four stages passed: 1700 accepted, 1700 completed, 0 failed, 0 unresolved; 1397 requests queued, the largest queue reached 936, peak leases were exactly PC 10 / Cloudflare 40 / Groq 40, and the 1000-request stage drained reservations, jobs, leases, and wakes to zero. Groq throttling was retryable and caused no lost work. Production Firebase data was not touched and nothing was deployed.

## Outcome

- Signal: useful

## Source Nodes

- Protected Ollama Public Gateway
- Ordered 10 / 40 / 40 AI Capacity
- Authenticated AI Gateway Path