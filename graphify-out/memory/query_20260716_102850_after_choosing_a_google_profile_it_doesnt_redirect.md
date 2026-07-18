---
type: "query"
date: "2026-07-16T10:28:50.849334+00:00"
question: "after choosing a google profile it doesnt redirect me back to the app there just a blank white screen"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Native client sign-in", "Mobile-First Optimization Plan"]
---

# Q: after choosing a google profile it doesnt redirect me back to the app there just a blank white screen

## Answer

Expanded graph vocabulary pointed to auth, browser, Firebase, Google, mobile, profile, session, and sign-in. Live and local evidence showed the mobile web/PWA path was using a popup callback; losing the opener can strand Firebase's intentionally blank /__/auth/handler page. The fix selects Firebase same-tab redirect on mobile/PWA, bounds getRedirectResult and profile hydration so boot cannot hang, and preserves the desktop GIS path. Firebase reserved auth helpers are healthy and the service worker bypasses /__/auth. Capacitor native remains a separate integration risk because its WebView origin and return flow differ from mobile web.

## Outcome

- Signal: useful

## Source Nodes

- Native client sign-in
- Mobile-First Optimization Plan