# Contributing to Searvia

Work from this directory as the pnpm/Turborepo root. Do not install dependencies with npm or modify the unrelated parent application's lockfile.

## Before changing code

1. Read [AGENTS.md](./AGENTS.md) and the relevant document under [`docs/`](./docs/).
2. Keep tenant authorization, secret handling, and source provenance explicit.
3. Keep demonstration fixtures isolated from live application paths.
4. Add or update a decision record when an architecture boundary changes.

## Local checks

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use `pnpm format` to apply the repository formatter. Add focused tests for behavior changes; do not disable rules or weaken strict TypeScript to make checks pass.

## Pull requests

Keep changes scoped, describe migrations and operational impact, list commands actually run, and call out any validation that could not run. Never include `.env`, credentials, crawl secrets, customer content, or production exports.
