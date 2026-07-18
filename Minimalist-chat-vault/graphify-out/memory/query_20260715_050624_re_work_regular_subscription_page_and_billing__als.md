---
type: "query"
date: "2026-07-15T05:06:24.637560+00:00"
question: "re work regular subscription page and billing, also its not taking me to checkout page there just an error"
contributor: "graphify"
outcome: "dead_end"
---

# Q: re work regular subscription page and billing, also its not taking me to checkout page there just an error

## Answer

Expanded from original query via vocab: [subscriptions, product, tiers, advanced, pro, firebase, functions]. The vault traversal surfaced legacy subscription copy and general Firebase runtime notes, but did not identify the production failure. Live Cloud Functions logs and current source were authoritative: a test-mode Stripe customer ID was being sent with the live key, and the UI intentionally preferred embedded checkout. Mark this graph path as a dead end for this incident.

## Outcome

- Signal: dead_end