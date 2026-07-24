## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After code-only changes, `graphify update .` keeps AST relationships current without semantic-model cost. After Markdown or image changes, use the installed Graphify skill's semantic `--update` flow; the v0.9.12 shell update command is code-only.

## gbrain

GBrain skills are scaffolded under `skills/`. Read `skills/_AGENT_README.md` before routing to them, then read the matched `SKILL.md` in full before acting.

The database is configured and verified in the local profile documented in `90 Memory/GBrain Setup.md`.

- While MCP is connected, use its source-scoped GBrain tools for natural-language retrieval, exact terms, pages, and code navigation; do not start a competing CLI process against PGLite.
- During an intentional CLI-only window, use `node tools/gbrain/gbrain-authority-query.mjs --query "..." --source default --json` for deterministic authority-aware candidate ordering. It must not run while MCP owns PGLite.
- Use the explicit-only `minimalist-chat-code` source for symbol definitions, callers, callees, language filters, and code walks; do not federate it into ordinary note retrieval.
- Use GBrain graph and backlink tools for relationships, with source attribution from the returned pages.
- Keep Markdown in this vault as the durable source of truth, then use `tools/gbrain/Invoke-GBrainMaintenance.ps1`. Preview with `-DryRun`; the coordinator validates and temporarily disconnects the exact MCP owner, verifies a retained backup through an isolated restore/query drill, runs refresh and Evaluation V2, applies deterministic Graphify enrichment, and restores MCP registration in `finally`.
- Local Ollama embeddings and source-scoped hybrid query are explicitly approved and active. Do not use autopilot, dream-cycle, remediation, chat/judge synthesis, or new external integrations without a separate explicit opt-in.
- The 50-case project retrieval gate, including nDCG, categories, negative checks, and source scope, must pass before changing embedding, search-mode, authority-ranking, or reranker settings. The installed Jina reranker is experimental and must remain disabled until it improves that gate.
- Use Graphify for broad cross-note synthesis and architecture questions.
- Never store credentials, tokens, or private keys in vault notes or graph output.
