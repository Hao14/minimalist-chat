---
title: Minimalist Analysis Desktop App Review 2026-07-13
status: current
reviewed_on: 2026-07-13
tags:
  - minimalist-chat
  - audit
  - windows
  - analytics
  - ollama
---

# Minimalist Analysis Desktop App Review — 2026-07-13

## Scope

Reviewed, redesigned, tested, and packaged the private Windows operations app in `tools/ai-analysis-app`. Canonical implementation sources are:

- `tools/ai-analysis-app/Program.cs`
- `tools/ai-analysis-app/ModernAnalysisForm.cs`
- `tools/ai-analysis-app/AppleUi.cs`
- `tools/ai-analysis-app/Logic/AnalysisAppLogic.cs`
- `tools/ai-analysis-app/MinimalistAIAnalysis.csproj`
- `tools/ai-analysis-app/publish.ps1`
- `tools/ai-analysis-app/verify-release.ps1`
- `tools/ai-analysis-app.tests/AnalysisAppLogicTests.cs`
- `tools/ai-analysis-app/design/PORCELAIN-SPEC.md`

## Current product shape

- Native .NET 10 WinForms app with the Porcelain visual system: cool neutral canvas, true-white elevated surfaces, restrained system blue, semantic status dots, large page-owned titles, and a compact floating bottom dock.
- Five operational views: Overview, Users, AI Control, Health, and Console.
- DPI-aware Compact, Standard, and Wide layouts. Cards stack, KPI bands reflow, action rows wrap, chrome tightens on short windows, and very-wide content stays centered instead of stretching indefinitely. The supported minimum window is `900 × 640`.
- Firebase account, presence, membership, and 30-day growth analytics plus a searchable protected directory that automatically resolves each Auth UID to its user label. The directory shows only user label, exact UID, membership class, and presence; messages, prompts, and payment details are not shown.
- Protected bridge status, public tunnel status, aggregate Fast/Smart/Vision model health, 24-hour activity, and recovery actions. The app targets only the bridge-owned Ollama runtime on `127.0.0.1:11435` and its default user model store, independently of tray Ollama on `11434`.
- Manual AI Off, On, and Auto modes. Auto wakes for approved requests and sleeps after the selected timeout; the default is two hours.
- Exact-tag install/repair workflows for approved Fast (`qwen3:4b-instruct`), Smart (`qwen3:14b`), and Vision (`qwen2.5vl:7b`) models, with independent controls, progress, cancellation, and post-install verification. Model health reports “Not checked” while protected Ollama is asleep or Off instead of falsely reporting models missing.
- Single-surface guarded moderation console with command history and built-in help. Read tools cover aggregate moderation state, banned/muted lists, exact user rooms, room status/members/logs, and user status. Mutations cover ban/unban, mute/unmute, timed or permanent room mute, room unmute, kick, exact-scope message deletion, and account deletion. Safe aliases resolve only to canonical allowlisted commands.
- Movable portable executable with saved workspace selection when repository auto-discovery is unavailable.

## Reliability and security changes

- Local bridge health refreshes independently of slower Firebase analytics; the UI distinguishes live platform data from local-only data.
- Timed-out or cancelled child processes are terminated as a process tree.
- Firebase Auth exports use an app-owned temporary directory, stale exports are cleaned, and every raw export is deleted in a `finally` path after minimal parsing. Only the normalized label, exact UID, membership/presence flags, and account creation time survive in the app snapshot.
- User labels are resolved from the public directory, private profile, Auth display name, short ID, and finally an email local-part. Untrusted control whitespace and bidirectional formatting are collapsed before display.
- Failed Firebase refreshes retain the last successful user snapshot with a stale-data warning instead of blanking the directory.
- Sensitive log lines are filtered before display.
- Permanent room mute writes the boolean format expected by the website.
- Model installation accepts only the three canonical exact tags and rejects aliases, arbitrary tags, and injection-shaped values.
- Account and moderation targets use constrained Firebase identifier validation and preserve the protected administrator guard.
- A central typed parser validates exact command shape, identifiers, duration bounds, `CONFIRM`, uppercase `DELETE`, and case-sensitive repeated IDs before confirmation or dispatch. The Console never converts user input into a shell command.
- User, room, membership, mute, and message records are preflighted before mutation. Invalid targets cannot create ghost RTDB branches or report no-op success; protected-admin messages and messages without a valid author UID fail closed.
- Account deletion is refused while the target owns rooms. Post-Auth cleanup reports every failed path and every unexpected cleanup exception as a partial deletion instead of printing full success.
- Closing during a Firebase Auth export now cancels the export process tree and waits for the `finally` cleanup before the form exits. Early-close release QA leaves zero raw Auth export files and zero export child processes.

## Verification

- Design direction was produced through an authenticated Claude CLI Fable 5 `ultracode`/maximum-effort read-only review, reconciled against repository invariants, then implemented and verified locally. Source-of-truth wide and compact concept images plus the canonical Porcelain specification live under `tools/ai-analysis-app/design`.
- Release build: succeeded with zero warnings and zero errors.
- Automated tests: 307 passed, zero failed, zero skipped, including Compact/Standard/Wide boundaries, canonical model allowlist/order, sleeping/not-checked model state, protected-runtime isolation, command and alias classification, central moderation parsing, duration limits, injection-shaped suffixes, case-sensitive destructive confirmation, exact Firebase message paths, null-token fail-closed behavior, and help-copy coverage.
- Windows desktop QA: launched the application at compact (`900 × 640`), standard (`1200 × 820`), and wide (`1320 × 820` to `1360 × 860`-class) sizes. Exercised all five views, page scrolling, stacked cards, 2 × 2 compact KPIs, dynamic KPI dividers, user search and UID tools, wrapped Fast/Smart/Vision controls, aggregate approved-model health, health actions, Console help/history, bottom navigation, Ctrl+1–Ctrl+5 shortcuts, and keyboard focus. The Console pass removed the nested terminal slab, corrected custom-button backdrop wedges, aligned the fixed-height category row, verified scrolling help without horizontal overflow, and completed a live read-only `moderation-summary` against Firebase.
- Accessibility and visual review added visible inactive-tab focus, default actions and selected states for custom controls, high-contrast-aware chart/chrome behavior, flat no-gradient charts, font fallback, and a labeled user-growth Y axis.
- Live-data QA also covered the automatic user/UID join, case-insensitive search, selected UID copy with inline feedback, and isolated protected AI/bridge/tunnel/model status. Runtime verification confirmed Fast and Smart through the bearer-protected bridge, an 8,192-token Smart context fully resident on GPU, and unchanged tray Ollama state.
- The final standalone EXE was launched from the release directory, opened the Console, rendered the expanded help, and completed a normal and early-close smoke test. Automated release verification passed for executable bytes/hash, checksum, manifest, unsigned Authenticode state, exact ZIP contents, Desktop shortcut target/work directory, zero running app processes, and zero temporary Auth exports.
- Destructive moderation mutations were intentionally not executed during QA. The multi-gigabyte approved-model downloads were completed during setup; exact manifests for Fast, Smart, and Vision were verified in the isolated model store.

## Distribution

`tools/ai-analysis-app/publish.ps1` produces a self-contained Windows x64 single-file executable, SHA-256 checksum, JSON release manifest, portable ZIP, README, and optional desktop shortcut under `artifacts/windows/ai-analysis/release`. It now invokes `verify-release.ps1` before reporting success.

Verified release: 51,867,866 bytes; SHA-256 `ddca7c83a3e3eb695cc8f8813c4899fac010ee0fe99e371ba5d11c7ad787e55c`; built `2026-07-14T02:46:18.9829905Z`.

The current build is unsigned. Windows may show an unknown-publisher or SmartScreen warning until a trusted code-signing certificate is configured. The app is portable rather than an installed/MSIX product and still requires the local Minimalist Chat workspace plus its protected bridge/Firebase tooling for privileged operations.

Related: [[40 Operations/Protected Ollama Public Gateway|Protected Ollama Public Gateway]], [[90 Memory/Project Memory|Project Memory]].
