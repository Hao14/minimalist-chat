---
type: "query"
date: "2026-07-15T04:37:40.312010+00:00"
question: "re work regular subscription page and billing, also its not taking me to checkout page there just an error"
contributor: "graphify"
outcome: "dead_end"
source_nodes: ["Firebase Functions Runtime Config", "3. Subscriptions & Refunds"]
---

# Q: re work regular subscription page and billing, also its not taking me to checkout page there just an error

## Answer

Expanded from original query via graph vocabulary: [error, firebase, functions, plan, subscriptions]. The vault graph did not contain the account checkout implementation. Current source and live Firebase logs showed the request fails before redirect because a stored test-mode Stripe customer ID is being reused with the live secret key; the frontend also intentionally prefers embedded checkout instead of a hosted checkout page.

## Outcome

- Signal: dead_end

## Source Nodes

- Firebase Functions Runtime Config
- 3. Subscriptions & Refunds