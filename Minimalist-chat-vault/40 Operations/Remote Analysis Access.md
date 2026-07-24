---
title: "Remote Analysis Access"
source_kind: markdown
source_path: "docs/remote-analysis-agent.md"
source_sha256: f62ff23ba6707a813aec6aaa4828a705295ad22ea85ea49ce4423dfcb00b4728
imported_on: 2026-07-14
status: active
tags:
  - minimalist-chat
  - operations
  - security
  - analysis
  - remote-access
---

> [!info] Additive import
> Source: `docs/remote-analysis-agent.md` · SHA-256: `f62ff23ba670…`

> [!summary] Remote boundary
> Away from home, the owner can view read-only Minimalist Analysis metadata through Cloudflare Access. A remote page cannot control the Windows desktop, administrator workspaces, protected AI bridge, Ollama, moderation tools, or arbitrary local processes.

# Remote Minimalist Analysis Agent

The remote Analysis path uses a small, read-only Windows agent behind a separate Cloudflare Access application. It does not expose the desktop app, its administrator workspaces, the protected Ollama bridge, or either Ollama port.

```text
Remote Analysis client
  -> system browser sign-in and Cloudflare Access
  -> https://analysis.minimalist.chat
  -> Cloudflare Tunnel
  -> http://127.0.0.1:8791
  -> Minimalist Analysis Agent (read-only metadata)
```

This is intentionally separate from `https://ai.minimalist.chat`. The AI hostname remains the Firebase-to-bridge path and must not receive an interactive Access policy. The Analysis hostname has its own Access application, audience, and exact-owner policy.

## What phase 1 exposes

The agent is limited to operational status and metadata needed by the remote Analysis view: bridge, isolated Ollama, approved model, public tunnel, recovery-task, mode, and bounded request-activity status. It must not return prompts, messages, full email addresses, Firebase Auth exports, exact user IDs, user directories, moderation data, credentials, local paths, process IDs, or arbitrary installed-model names.

The authenticated `GET /v1/ping` response also returns the fixed scheduled-task display name, **Minimalist Chat Remote Analysis Agent**, so the native client can identify the invisible background task without inferring or exposing a local path.

Phase 1 is read-only. Remote AI mode changes, bridge or tunnel controls, model installation, workspace selection, log access, user administration, and moderation remain desktop-only. A failed remote request must never fall back to controlling whichever computer is running the client.

## Local preparation

Publish the self-contained Windows agent:

```powershell
.\tools\ai-analysis-agent\publish.ps1
```

The release executable is written to:

```text
artifacts\windows\ai-analysis-agent\release\MinimalistAIAnalysisAgent.exe
```

Do not copy `.bridge-control` into the release directory or portable ZIP. The publisher deliberately packages only the executable, checksum, and release manifest.

Publishing removes inherited file permissions from the release tree and grants Full Control only to the current Windows user, `SYSTEM`, and the local `Administrators` group. The publisher fails if that ACL cannot be applied and verified. During installation, the verified executable is copied again into the current user's protected LocalAppData tree; the scheduled task never runs the repository artifact directly.

## Create the Cloudflare Access application first

Create the Access application **before** publishing a Tunnel route. That ordering prevents a new public hostname from briefly existing without its intended identity policy.

1. In Cloudflare One, create a **Self-hosted** Access application for the exact hostname `analysis.minimalist.chat`.
2. Add an Allow policy containing only the owner's exact email address. Do not use `Everyone`, a whole email domain, or a broad `Emails ending in` rule.
3. Leave every other identity denied by default. Use the existing identity provider or Cloudflare One-time PIN for that exact email.
4. Record the application's **AUD tag** and the account's Access team domain, such as `https://team.cloudflareaccess.com`. The team URL must use HTTPS and have no trailing slash, port, path, query, or fragment.
5. Where the Tunnel settings offer origin-side Access protection, enable **Protect with Access** for this route. The agent also validates the signed `Cf-Access-Jwt-Assertion`, exact issuer, exact audience, and exact allowed email as defense in depth.

Cloudflare references: [self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/), [one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/), and [validating Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Configure the desktop agent

Write the local configuration using the exact Access values:

```powershell
.\tools\ai-analysis-agent\configure-remote-analysis-agent.ps1 `
  -TeamDomain 'https://team.cloudflareaccess.com' `
  -ApplicationAudience 'PASTE_THE_ACCESS_APPLICATION_AUD_TAG' `
  -AllowedEmail 'owner@example.com'
```

This creates the local file `%LOCALAPPDATA%\Minimalist.chat\AnalysisAgent\remote-analysis-agent.json` with exactly four fields:

```json
{
  "schemaVersion": 1,
  "teamDomain": "https://team.cloudflareaccess.com",
  "applicationAudience": "PASTE_THE_ACCESS_APPLICATION_AUD_TAG",
  "allowedEmail": "owner@example.com"
}
```

The file contains no Cloudflare connector token, session token, OAuth refresh token, Firebase credential, bridge bearer token, or service token. Do not commit it anyway: the owner email and deployment identity are machine-specific.

The configurator atomically writes the file outside the repository, removes inherited access, and grants Full Control only to the current Windows user, `SYSTEM`, and local `Administrators`. The installer rechecks and reapplies this contract before registering the task. If an older `.bridge-control\remote-analysis-agent.json` exists and the new LocalAppData file does not, the installer validates and migrates it automatically. Do not move the configuration or installed executable to a shared or network-writable directory.

## Add the separate Tunnel route

After the Access application and exact-email policy exist, add a Published application route to the existing remotely managed Tunnel:

```text
Hostname: analysis.minimalist.chat
Service:  HTTP
URL:      http://127.0.0.1:8791
```

Using the existing connector is acceptable; the public hostname, Access application, Access audience, and local origin remain separate. Never change this route to `127.0.0.1:8790`, `127.0.0.1:11434`, or `127.0.0.1:11435`. Do not create router port forwarding or an inbound Windows Firewall rule for port 8791.

## Install invisible logon startup

Install the per-user task after publishing and configuring the agent:

```powershell
.\tools\ai-analysis-agent\install-remote-analysis-agent.ps1
```

The fixed task name is **Minimalist Chat Remote Analysis Agent**. It starts `%LOCALAPPDATA%\Minimalist.chat\AnalysisAgent\MinimalistAIAnalysisAgent.exe` directly with fixed `--workspace <repository> --config <protected-local-file>` arguments, runs with the current user's interactive token at Limited privilege, binds only `127.0.0.1:8791`, ignores duplicate launches, and retries a failed process three times at one-minute intervals.

The task is hidden and the executable is a Windows `WinExe`; PowerShell is not part of the task action. The setup `.ps1` files run only when invoked manually, so normal sign-in and automatic recovery should not flash PowerShell windows.

Before task registration, the installer verifies the strict ACL on the release, creates the protected LocalAppData directory, migrates or verifies the configuration there, copies and SHA-256 verifies the installed executable, and then protects the whole installed tree. A failure stops installation; it never registers a task that points into the broadly writable repository hierarchy.

To install without starting it immediately:

```powershell
.\tools\ai-analysis-agent\install-remote-analysis-agent.ps1 -NoStart
```

## Restart and sign-in behavior

After a PC restart, the task starts only when the configured Windows user signs in. It does not run at the lock screen and does not store a Windows password. Remote Analysis becomes available after all of these are true:

- the PC is powered on, awake, online, and the user has signed in;
- the **Minimalist Chat Remote Analysis Agent** task is running;
- the existing Cloudflared connector is connected;
- the `analysis.minimalist.chat` route and Access policy are healthy; and
- the remote user completes the approved Access sign-in.

The task cannot wake a sleeping or powered-off PC. Add Wake-on-LAN separately if remote wake is required; do not weaken the Access policy or expose a port as a substitute.

## Native client sign-in

The Windows Analysis client now supports this path directly. Copy and extract the portable package on any trusted Windows x64 computer:

```text
artifacts\windows\ai-analysis\release\MinimalistAIAnalysis-1.0.0-win-x64-portable.zip
```

Run `MinimalistAIAnalysis.exe`, choose **Remote desktop** in the header, and complete Cloudflare Access sign-in in the system browser. The client always starts in **This PC** mode, so it never silently connects to the remote desktop. Remote mode is read-only: the Users, Console, workspace, log, AI-mode, model-installation, bridge, and tunnel controls stay disabled.

The client uses Cloudflare Access **Managed OAuth**, dynamic client registration, Authorization Code with PKCE S256, and an ephemeral `127.0.0.1` callback. It contains no client secret, owner email, or Access AUD. Access tokens stay in memory; the refresh session is DPAPI-encrypted for the current Windows user in LocalAppData and is removed by **Sign out**.

The current Access application uses `https://hotsauce.cloudflareaccess.com`, permits managed OAuth and `127.0.0.1` loopback clients, rejects `localhost` callback aliases, issues 15-minute access tokens, and uses a two-week grant duration. Managed OAuth is currently documented as Beta, so recheck Cloudflare's current requirements before rebuilding this configuration. See [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/).

This works from a different network because the client reaches `https://analysis.minimalist.chat` through Cloudflare; it does not connect to the home's public IP. SSH, VPN, an inbound Windows Firewall rule, and router port forwarding are not required. Port `11112` is not part of this design and any router forward for it should be removed.

The portable build is unsigned, so a new computer may show a SmartScreen or unknown-publisher warning. Verify `MinimalistAIAnalysis.exe` against `MinimalistAIAnalysis.exe.sha256` from the same package before running it.

## Verify the local task and public boundary

Inspect the installed task without exposing configuration values:

```powershell
$task = Get-ScheduledTask -TaskName 'Minimalist Chat Remote Analysis Agent'
$task | Select-Object TaskName, State
$task.Actions | Select-Object Execute, Arguments, WorkingDirectory
$task.Principal | Select-Object UserId, LogonType, RunLevel
$task.Settings | Select-Object Hidden, RestartCount, RestartInterval, MultipleInstances
Get-ScheduledTaskInfo -TaskName 'Minimalist Chat Remote Analysis Agent' |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
```

The action must be `%LOCALAPPDATA%\Minimalist.chat\AnalysisAgent\MinimalistAIAnalysisAgent.exe`, never the repository artifact, `powershell.exe`, `pwsh.exe`, `cmd.exe`, or an arbitrary script. Its arguments must name the repository workspace and the protected LocalAppData configuration. `RunLevel` must be `Limited` and `Hidden` must be `True`.

Verify that the agent is loopback-only:

```powershell
Get-NetTCPConnection -LocalPort 8791 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

`LocalAddress` must be `127.0.0.1`. An unauthenticated local or public API request must not return an Analysis snapshot. The public hostname should first require the approved Cloudflare Access identity; a different email must be denied.

Verify the local file boundary without printing the configuration contents:

```powershell
$agentDirectory = Join-Path $env:LOCALAPPDATA 'Minimalist.chat\AnalysisAgent'
$paths = @(
  $agentDirectory,
  (Join-Path $agentDirectory 'remote-analysis-agent.json'),
  (Join-Path $agentDirectory 'MinimalistAIAnalysisAgent.exe'),
  '.\artifacts\windows\ai-analysis-agent\release'
)

foreach ($path in $paths) {
  $acl = Get-Acl -LiteralPath $path
  [pscustomobject]@{
    Path = (Resolve-Path -LiteralPath $path).Path
    InheritanceDisabled = $acl.AreAccessRulesProtected
    Owner = $acl.Owner
    Principals = @($acl.Access | ForEach-Object IdentityReference) -join '; '
  }
}
```

`InheritanceDisabled` must be `True`. The only principals must resolve to the current Windows user, `NT AUTHORITY\SYSTEM`, and `BUILTIN\Administrators`; there must be no `Everyone`, `BUILTIN\Users`, or other broad write rule.

## Updating and removing the agent

Stop or uninstall the task before replacing a running executable, then republish and reinstall:

```powershell
.\tools\ai-analysis-agent\install-remote-analysis-agent.ps1 -Uninstall
.\tools\ai-analysis-agent\publish.ps1
.\tools\ai-analysis-agent\install-remote-analysis-agent.ps1
```

Permanent removal should be done in this order:

1. Delete the `analysis.minimalist.chat` Tunnel route so no public request can reach the origin.
2. Delete or disable the separate Access application.
3. Run `install-remote-analysis-agent.ps1 -Uninstall`.
4. Delete `%LOCALAPPDATA%\Minimalist.chat\AnalysisAgent` only if the protected configuration and installed executable are no longer needed. An obsolete `.bridge-control\remote-analysis-agent.json` may also be deleted after migration is verified.
5. Delete the repository agent release directory only after the task and process are stopped.

Removing this Analysis route must not change the `ai.minimalist.chat` route, the Firebase gateway configuration, the protected bridge token, or either local Ollama runtime.

## Security boundaries

- The agent listens only on fixed loopback `127.0.0.1:8791`; Cloudflared is the only public transport.
- Cloudflare Access allows one exact owner identity, and the agent independently verifies the signed assertion, issuer, application audience, and allowed email.
- The remote surface is read-only and metadata-only. Desktop administrator controls remain local.
- The Analysis agent never receives or reuses `OLLAMA_SERVER_TOKEN`, the Cloudflare Tunnel connector token, Firebase administrator credentials, or a Cloudflare service token.
- The local Access configuration and scheduled-task executable use protected NTFS ACLs limited to the current Windows user, `SYSTEM`, and local `Administrators`.
- No credential belongs in a URL, query string, command line, config file, repository, screenshot, or log.
- SSH is not required for this path. If enabled later as break-glass access, treat it as a separate, broader administrative channel with key-based authentication and its own hardening.
- Access protects requests that traverse Cloudflare; it does not make an untrusted or compromised Windows session safe. Keep the desktop account and remote client device patched, locked, and encrypted.
