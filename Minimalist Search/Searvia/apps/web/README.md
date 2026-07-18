# Searvia web

The Next.js frontend for Searvia contains the public marketing site, authenticated organization/project routes, real crawl controls and progress polling, plus the isolated deterministic `/demo` design fixture.

All fixture figures are visibly labeled **Demo data**. Features that require live credentials, licensed providers, crawler infrastructure, or account services remain unavailable rather than being simulated as live.

Run commands from the Searvia repository root with pnpm:

```powershell
pnpm dev:web
pnpm exec turbo run lint --filter=@searvia/web
pnpm exec turbo run typecheck --filter=@searvia/web
pnpm exec turbo run test --filter=@searvia/web
pnpm exec turbo run build --filter=@searvia/web
```

Turbo builds internal workspace dependencies before development and verification tasks.

Open `http://localhost:3000`; the liveness endpoint is `/api/health`.

The application is no longer a static export: authentication and crawl routes require the standalone server runtime and managed PostgreSQL/Redis dependencies. `searvia.online` is the intended canonical origin, but production hosting and DNS changes remain a reviewed deployment task.

See the repository-level [`README.md`](../../README.md), [`docs/PRODUCT_SPEC.md`](../../docs/PRODUCT_SPEC.md), and [`design/SEARVIA_DESIGN_SPEC.md`](../../design/SEARVIA_DESIGN_SPEC.md) for scope and design guidance.
