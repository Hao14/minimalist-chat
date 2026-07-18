# Searvia security policy

Report suspected vulnerabilities privately through the repository's private security-reporting channel or directly to the designated Searvia security owner. Do not open a public issue containing exploit details, credentials, customer data, or vulnerable targets.

The M0 foundation is pre-release software. Only the current mainline is eligible for security fixes; no public support window is promised yet.

Security-sensitive changes must follow [`docs/SECURITY.md`](./docs/SECURITY.md). In particular:

- never log tokens, cookies, authorization headers, crawl credentials, or unredacted errors;
- require server-side tenant authorization for every protected resource;
- treat crawled content and URLs as hostile input;
- keep secrets server-only and validate production configuration at startup;
- do not claim an integration result when its provider is unavailable.

If a secret is committed, revoke it immediately before removing it from history. Rotation is the remediation; deletion alone is not.
