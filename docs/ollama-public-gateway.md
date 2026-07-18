# Protected Ollama Public Gateway

The public website must never call raw Ollama directly. The safe path is:

1. Browser signs in with Firebase Auth.
2. Browser calls the Firebase `aiGateway` Function.
3. Firebase enforces auth, room membership, Bananas, abuse checks, and audit logging.
4. Firebase calls a protected Ollama bridge with a bearer token.
5. The bridge forwards only approved Ollama routes to the isolated protected runtime at `http://127.0.0.1:11435`.

## Local Bridge

Run the protected bridge (Ollama no longer needs to be started first):

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\ollama-bridge\start-ollama-bridge.ps1
```

The script prints a generated `OLLAMA_SERVER_TOKEN`. Keep it private.

For this Firebase project, prefer reusing the deployed Secret Manager token so the
bridge and Functions always match:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\ollama-bridge\start-ollama-bridge.ps1 -UseFirebaseSecret -MaxBodyMB 32
```

This mode does not print the token.

The bridge listens on `http://127.0.0.1:8790` and only exposes the approved Ollama API routes `/api/chat`, `/api/generate`, and `/api/tags`, plus its authenticated lifecycle-control routes. It blocks requests without the bearer token and restricts inference to the exact model allowlist. Port 8790 matches this project's configured Cloudflare tunnel and deployed Function URL. The default request body limit is 16 MB so phone screenshots can be sent to vision models without the tunnel dropping the connection.

The bridge owns a dedicated Ollama server on `127.0.0.1:11435` and explicitly uses `%USERPROFILE%\.ollama\models`. It overrides inherited `OLLAMA_HOST` and `OLLAMA_MODELS` values for that child process, fails closed if the managed endpoint points at tray port `11434`, and never starts, stops, or reconfigures the user's tray Ollama app.

By default, an authenticated model request starts the protected Ollama runtime when it is offline. The bridge stops that owned process after 120 idle minutes and sends Ollama the same two-hour `keep_alive` value so loaded models follow the lifecycle policy. Keep the lightweight bridge and a stable HTTPS tunnel running, because a website cannot contact a bridge—or wake a computer—that is fully offline.

Use `-IdleShutdownMinutes 120` to change the idle window, or `-DisableManagedOllama` to restore manual Ollama lifecycle control.

## Approved AI Model Profiles

Website text AI exposes two user-facing profiles:

- **Fast** (default) maps server-side to `qwen3:4b-instruct` for quick summaries and everyday answers.
- **Smart** maps server-side to `qwen3:14b` for stronger answers from an efficient larger model.

The browser persists and sends only `modelProfile: "fast"` or `"smart"`; it never chooses an arbitrary Ollama tag. Firebase owns the exact mapping through `OLLAMA_FAST_MODEL` and `OLLAMA_SMART_MODEL`. A missing profile from an older client defaults to Fast, while an unknown non-empty profile is rejected. Both text profiles use an 8,192-token context with thinking disabled. The gateway never silently substitutes one text profile for the other.

Calendar and photo extraction remain separate and pinned to `OLLAMA_VISION_MODEL` (`qwen2.5vl:7b`). The protected bridge default inference allowlist is exactly `qwen3:4b-instruct,qwen3:14b,qwen2.5vl:7b`.

## Desktop-only AI Control & Analysis

The website no longer ships an administration or Analysis interface. It continues to send approved AI requests through the authenticated `aiGateway`, but it does not expose AI mode controls, bridge health, activity metadata, or administrator analytics in the browser. Those operations now live exclusively in the native Windows application documented below.

The manual modes are:

- **Off** blocks new bridge inference requests and stops only the dedicated protected Ollama process.
- **On** starts the protected Ollama runtime and keeps approved models available until the mode changes.
- **Auto** wakes the protected runtime for approved requests and lets it sleep after the selected idle timeout (120 minutes by default).

The authenticated, administrator-only `aiControl` Firebase Function remains protected for operational compatibility, but the public client no longer publishes its endpoint or calls it. Control state is persisted in `.bridge-control/ai-control.json` so a bridge restart retains the selected mode and timeout.

The bridge and HTTPS tunnel must remain reachable for approved website inference. The desktop control app can wake Ollama, but it cannot wake a fully powered-off computer without separate Wake-on-LAN infrastructure.

## Desktop Control App

The native **Minimalist Analysis** application is published as a self-contained Windows x64 executable:

```text
artifacts\windows\ai-analysis\release\MinimalistAIAnalysis.exe
```

It uses the **Porcelain** desktop visual system: a cool neutral canvas, high-contrast white surfaces, a compact floating bottom dock, restrained system color, DPI-aware icons and typography, and visible keyboard focus. The dock opens dedicated **Overview**, **Users**, **AI Control**, **Health**, and **Console** workspaces without a sidebar or web-style navigation menu. The app provides Off, On, and Auto controls, the Auto idle timeout, protected Ollama/bridge/tunnel health, aggregate Fast/Smart/Vision model status, separate allowlisted install/repair actions, a 24-hour local request chart with hover and keyboard time/count/outcome details, recent metadata-only activity, bridge start/restart/stop actions, one state-aware tunnel On/Off control, and log access. The dashboard reads exact Firebase Auth account count, live RTDB presence, active/trialing Stripe memberships mirrored onto user profiles by the verified webhook, 30-day account growth, and paid conversion. The protected Users workspace also joins Auth identities, `/user_directory`, private profile fallbacks, presence, and subscriptions by exact UID into a searchable directory with a safe Copy UID action. It flags an active Stripe subscription whose price is not mapped to a paid application tier so billing configuration drift is visible instead of silently undercounted.

The native UI responds to the current logical client size rather than assuming one desktop resolution. Compact windows below 1120 logical pixels stack analytics cards and use a 2 × 2 KPI band; Standard windows from 1120 through 1279 pixels and Wide windows at 1280 pixels or above use progressively roomier multi-column layouts. Windows shorter than 760 logical pixels reduce non-content chrome while each page remains vertically scrollable. The supported minimum is `900 × 640`, required identity columns retain minimum widths, action groups wrap, and page content is capped near 1440 logical pixels on very wide displays.

The Console accepts a fixed allowlist of local administration commands. System commands include `help`, `status`, `refresh`, bridge start/restart/stop, AI `on`/`off`/`auto`, filtered logs, and clear. Read-only moderation tools cover aggregate moderation state, banned/muted lists, exact user-room lookup, room status, room members, recent room logs, and exact-UID status. Mutations cover global ban/unban and mute/unmute, timed or permanent room mutes, room unmute, room kicks, exact-scope message deletion, and permanent account deletion. Common aliases resolve only to their documented allowlisted command. Type `moderation-help` in the app for exact syntax.

Moderation mutations require both an exact confirmation word in the command and a second confirmation dialog with No selected by default; permanent deletion additionally requires the UID to be typed twice. The protected administrator UID cannot be targeted. Users, rooms, memberships, mutes, and messages are preflighted before writes; invalid targets cannot create ghost data, messages without a valid author fail closed, and partial cleanup is reported explicitly. Account deletion removes the Firebase Auth identity through the authenticated Identity Toolkit administrator API and cleans primary profile, presence, room membership, notification-token, private-data, AI-usage, friend, and inbox references. The Console never executes arbitrary shell input. Its `logs` command reads only recent local log lines, removes lines that may contain credentials, and never displays prompts or user content.

The Overview remains aggregate-only. The protected Users workspace intentionally renders only a normalized user label, exact Firebase UID, membership class, and presence state; the label can use an email local-part only as a final fallback when no profile name or short ID exists. Full email addresses, phone numbers, password hashes or salts, payment details, messages, prompts, and other user content are never rendered or logged. The raw Firebase Auth export is parsed in memory and deleted in a `finally` path immediately after each refresh. Local AI activity contains only timestamp, feature, model, duration, and success/error; prompts and user content are not stored.

The EXE retrieves the bridge credential and administrator analytics at runtime through the existing authenticated Firebase project tooling. The secret is not embedded in the executable or shown in the interface. Firebase CLI must be signed in to an account with access to `chat-app-356c1`; if that access is unavailable, the AI controls continue to report their own health and the user analytics section fails closed with an explanatory warning. Keep the EXE inside the repository's `artifacts` tree so it can locate the protected bridge scripts without colliding with Vite's disposable `dist` output.

Rebuild it and optionally recreate the Desktop shortcut with:

```powershell
.\tools\ai-analysis-app\publish.ps1 -CreateDesktopShortcut
```

Publishing now runs `tools\ai-analysis-app\verify-release.ps1` automatically. The verifier checks the executable size and SHA-256, manifest metadata, Authenticode status, the exact four portable ZIP entries, and—when requested—the Desktop shortcut target and working directory. It can also be rerun independently:

```powershell
.\tools\ai-analysis-app\verify-release.ps1 -VerifyDesktopShortcut
```

Use the Windows desktop shortcut named **Minimalist Ollama Bridge** to turn the local bridge and Cloudflare tunnel on or off.

The shortcut opens the controller UI without an extra console window. For manual use from the repo, run:

```powershell
.\tools\ollama-bridge\BridgeControl.cmd
```

The control app can:

- show Ollama, bridge, tunnel, and configured Function URL status
- start Ollama
- start, stop, or restart the protected bridge
- start or stop the Cloudflare tunnel
- open bridge logs from `.bridge-control`

The bridge start button uses the Firebase Secret Manager token via `-UseFirebaseSecret`, so the token is not printed in the app logs.

## Public HTTPS Tunnel

Production uses one remotely managed, named Cloudflare Tunnel with a fixed public hostname. The complete route is:

```text
Firebase Functions
  -> https://ai.minimalist.chat
  -> Cloudflare named tunnel
  -> Windows service: Cloudflared
  -> http://127.0.0.1:8790
  -> protected Ollama: http://127.0.0.1:11435
```

The only configured origin service is:

```text
http://127.0.0.1:8790
```

Do not publish either raw Ollama endpoint: tray `http://127.0.0.1:11434` or protected `http://127.0.0.1:11435`. Do not add router port forwarding or a Windows Firewall rule that exposes these loopback services. A random `trycloudflare.com` Quick Tunnel is acceptable for temporary development only; it is not the production fallback.

### One-time named-tunnel setup

The current production route is `https://ai.minimalist.chat` to `http://127.0.0.1:8790`. To rebuild it later:

1. In the Cloudflare dashboard, open **Networking > Tunnels** and create or select the remotely managed Minimalist AI tunnel.
2. Add a **Published application** route with hostname `ai.minimalist.chat`, service type `HTTP`, and service URL `http://127.0.0.1:8790`.
3. Under the tunnel's connector setup, choose Windows x64 and copy the service-install command. Run that command once from an elevated terminal on this PC. Never save the connector token in this repository, an env file, a script, a screenshot, or a log.
4. From an elevated PowerShell window in the repository, install the guarded recovery task:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\ollama-bridge\install-public-tunnel-recovery.ps1
   ```

5. Use Minimalist Analysis or the controller action to turn the tunnel on. The recovery task starts `Cloudflared` only after the exact protected bridge is healthy.

Cloudflare's service installer initially creates the Windows service. The project recovery installer deliberately changes its startup type to **Manual**. Do not change it back to Automatic: the scheduled reconciler, rather than an unconditional boot-time service start, enforces the protected dependency order.

### Persistent on/off and automatic recovery

Tunnel intent is stored locally in `.bridge-control/public-tunnel.json` as `desiredOn`. Missing, unreadable, or invalid state fails closed to Off.

- **Start tunnel** first requires the fixed non-TryCloudflare HTTPS URL and the exact healthy bridge at `127.0.0.1:8790`, whose upstream must be `127.0.0.1:11435`. It then records `desiredOn: true` and triggers reconciliation.
- **Stop tunnel** records `desiredOn: false` before triggering reconciliation. The reconciler then stops only the `Cloudflared` service. Off remains Off after logout or reboot.
- The scheduled reconciler is named **Minimalist Chat Public Gateway Recovery**. It runs invisibly for the current interactive user at logon and once per minute with highest available privileges, `StartWhenAvailable`, and `IgnoreNew`. Its task action is `wscript.exe //B //NoLogo PublicTunnelRecovery.Hidden.vbs`; the launcher invokes the same reconciliation without a flashing PowerShell console and forwards the exit code. When intent is On, it repairs or starts the protected bridge, waits for the exact health contract, and then starts `Cloudflared`. When intent is Off, it keeps the service stopped.
- `stop-bridge` first turns tunnel intent Off, so the watchdog cannot republish a stopped bridge. `restart-bridge` preserves the existing tunnel intent and republishes only after bridge health returns.
- The `Cloudflared` service remains Manual in both states; Start never changes it to Automatic and Stop never changes it to Disabled.

The PC still has to be powered on, awake, signed in, and online. The recovery task cannot wake a sleeping or powered-off computer without separately configured Wake-on-LAN infrastructure.

For manual control from PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\ollama-bridge\BridgeControl.ps1 -Action start-tunnel
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\ollama-bridge\BridgeControl.ps1 -Action stop-tunnel
```

Prefer these guarded actions over calling `Start-Service` directly because they preserve intent and enforce bridge health.

### Verification

Run the local controller self-test and inspect the service without printing either token:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\ollama-bridge\BridgeControl.ps1 -SelfTest
Get-Service -Name Cloudflared | Select-Object Name, Status, StartType
Get-ScheduledTask -TaskName 'Minimalist Chat Public Gateway Recovery' |
  Select-Object TaskName, State
```

Then verify both sides of the route:

```powershell
$local = Invoke-WebRequest 'http://127.0.0.1:8790/health' -UseBasicParsing
$public = Invoke-WebRequest 'https://ai.minimalist.chat/health' -UseBasicParsing
$localBody = $local.Content | ConvertFrom-Json
$publicBody = $public.Content | ConvertFrom-Json

$local.StatusCode
$local.Headers['X-Minimalist-Ollama-Bridge']
$localBody
$public.StatusCode
$public.Headers['X-Minimalist-Ollama-Bridge']
$publicBody
```

Both responses must be HTTP 200, include `X-Minimalist-Ollama-Bridge: 1`, return `ok: true`, and report upstream `http://127.0.0.1:11435`. Cloudflare's **Healthy** tunnel status proves only that the connector reaches Cloudflare; it does not prove that the connector can reach the local bridge. Finish verification with one signed-in Fast request through the website so the full Firebase-to-bridge path is exercised.

### Recovery

Diagnose in dependency order:

1. Run `BridgeControl.ps1 -SelfTest`.
2. Test local `http://127.0.0.1:8790/health`. If it fails or reports another upstream, restart the protected bridge before touching the tunnel.
3. Confirm `Cloudflared` exists and remains Manual. Use **Start tunnel** to restore desired On state and trigger the reconciler.
4. Test `https://ai.minimalist.chat/health`. Cloudflare error 1033 means no healthy connector is attached; HTTP 502 usually means the connector is running but cannot reach `127.0.0.1:8790`.
5. If both health checks pass but website AI fails, verify the deployed `OLLAMA_SERVER_URL` and the separate `OLLAMA_SERVER_TOKEN` Secret Manager binding. Do not replace the fixed hostname with a Quick Tunnel URL.

If the Windows service is missing, open the existing tunnel in Cloudflare, choose **Add a replica**, reinstall its Windows connector, rerun `install-public-tunnel-recovery.ps1`, and turn the tunnel on. Do not create a second production tunnel unless the existing tunnel is intentionally being replaced.

### Connector-token rotation

The Cloudflare connector token is not the Minimalist bridge bearer token. Rotating it does not change `OLLAMA_SERVER_URL` or `OLLAMA_SERVER_TOKEN` and does not require a Firebase deploy.

1. Schedule a short maintenance window because this PC is the only connector.
2. Turn the tunnel Off through Minimalist Analysis or `BridgeControl.ps1 -Action stop-tunnel`.
3. In **Networking > Tunnels**, select the existing tunnel and choose **Rotate token**. Then choose **Add a replica** and copy the new Windows install command.
4. From an elevated terminal, uninstall the old `Cloudflared` service and run the new dashboard-provided install command. Do not paste the token into repository files or support messages.
5. Rerun `install-public-tunnel-recovery.ps1`, turn the tunnel On, and repeat local, public, and signed-in verification.

After rotation, the old token cannot create new connections, although an existing connector can remain connected until restarted. If the token may have been exposed, rotate it immediately and use Cloudflare's connection cleanup to force-disconnect existing replicas before installing the replacement.

### Uninstall

For a permanent removal:

1. Turn the tunnel Off so `desiredOn: false` is recorded before removing anything.
2. From an elevated PowerShell window, persist Off state, stop the service, and unregister the recovery task:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\ollama-bridge\install-public-tunnel-recovery.ps1 -Uninstall
   ```

3. Uninstall the `Cloudflared` Windows service from an elevated terminal with `cloudflared.exe service uninstall`.
4. Delete the `ai.minimalist.chat` published route and DNS record. Delete the named tunnel only if it will not be reused.
5. Remove `OLLAMA_SERVER_URL` from the ignored project Functions env and deploy Functions so the gateway fails closed instead of retaining a dead origin.
6. Leave `OLLAMA_SERVER_TOKEN` in Secret Manager unless the protected bridge itself is also being retired.

The controller must report the service as not installed after removal and must never silently launch a Quick Tunnel as a replacement.

### Security and later maintenance

- Treat the Cloudflare connector token as a secret that authorizes a connector to this tunnel. Treat `OLLAMA_SERVER_TOKEN` as a different secret that authorizes Firebase requests to the bridge. Never substitute one for the other.
- Keep `OLLAMA_SERVER_TOKEN` in Google Secret Manager. Neither token belongs in `functions/.env.chat-app-356c1`; only the fixed public URL and non-secret runtime settings belong there.
- The public hostname is expected to be discoverable. Protection comes from the authenticated Firebase gateway, bridge bearer token, exact route allowlist, model allowlist, and fail-closed health checks—not from hiding the hostname.
- Do not enable a Cloudflare Access policy on this hostname unless Firebase Functions is first updated to send Access service-token headers stored in Secret Manager. Enabling Access without that change blocks the current server-to-server path.
- Update `cloudflared` during a maintenance window from an elevated terminal. Turn the tunnel Off first, run `cloudflared update`, then turn it On and repeat verification. Keep the named tunnel and hostname unchanged.
- Changing the hostname or origin route requires updating Cloudflare, `OLLAMA_SERVER_URL`, and redeploying Functions. Routine service restarts, PC reboots, recovery-task runs, and connector-token rotations do not.

Current Cloudflare references: [tunnel setup](https://developers.cloudflare.com/tunnel/setup/), [tunnel-token rotation](https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/), [service operation](https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/), and [troubleshooting](https://developers.cloudflare.com/tunnel/troubleshooting/).

## Firebase Functions Runtime Config

Copy the example env file:

```powershell
Copy-Item .\functions\.env.example .\functions\.env.chat-app-356c1
```

Edit `functions/.env.chat-app-356c1`:

```dotenv
OLLAMA_SERVER_URL=https://ai.minimalist.chat
OLLAMA_FAST_MODEL=qwen3:4b-instruct
OLLAMA_SMART_MODEL=qwen3:14b
OLLAMA_VISION_MODEL=qwen2.5vl:7b
AI_ALLOW_GROQ_FALLBACK=false
```

The actual `functions/.env.chat-app-356c1` file is ignored by git. `OLLAMA_SERVER_URL` is the fixed named-tunnel hostname, not a Quick Tunnel URL. Store `OLLAMA_SERVER_TOKEN` only in Google Secret Manager; the relevant Functions already bind that secret through `runWith({ secrets: [...] })`. The Cloudflare connector token never belongs in Firebase configuration.

Deploy Functions with Node 22:

```powershell
.\tools\firebase-node22.ps1 deploy --only functions --project chat-app-356c1
```

Firebase loads environment variables from `functions/.env` and project-specific `functions/.env.<project-or-alias>` files at deploy time. Keep those files out of git. Deploy Functions once after changing the fixed hostname. Normal tunnel restarts and connector-token rotation keep the hostname and require no deploy.

### Optional 10 / 40 / 40 text-AI overflow router

The text gateway has an opt-in distributed capacity router. Active requests fill
these fixed tiers: slots 1–10 use the protected local PC through Ollama, slots
11–50 use Cloudflare Workers AI, and slots 51–90 use Groq. Request 91 and every
later overflow request is accepted into a durable FIFO queue. Capacity alone does
not expire a waiting request: it remains queued until it is processed, explicitly
cancelled by its owner, or permanently failed. It remains charged once while
queued and starts automatically as leases are released; cancelled or permanently
failed work is refunded.

Private payloads and worker claims live under the Admin-only `ai_runtime` path.
The initial gateway response is HTTP 202 with an opaque job ID and queue position;
it does not hold the original HTTP connection open while the job waits. The
browser instead subscribes to the authenticated owner's sanitized
`ai_queue_status/{uid}/{jobId}` mirror for status and completion, with
authenticated `queue-status` polling as recovery. Other users cannot read that
status or result. A fenced background worker processes one claimed job per lease;
a one-minute sweeper repairs missing queue pointers, interrupted claims, terminal
capacity releases, and delayed retry wakes.
Terminal status and result records may be retained for up to 24 hours before
cleanup. New text requests join behind an existing pending head instead of
intentionally bypassing older work.

Admission is bounded without evicting accepted work: at most 10,000 routed
requests may be unfinished globally and at most 1,000 may belong to one account.
Those limits are deliberately above the 500-request stress target. Each accepted
request holds one token-fenced reservation from pre-charge admission through
direct execution, queueing, retries, and its terminal transition. Crash recovery
releases the reservation exactly once; a stale release token cannot remove a
newer request's reservation. Banana charge receipts use the same deterministic
job identity and retain a `charged` or `refunded` tombstone, preventing a quota
window rollover or recovery retry from double-charging or replaying refunded work.

This section describes the repository implementation and required configuration;
it does not assert that the router, queue, Functions, or database rules are
currently deployed. Verify the target Firebase environment after an explicit
deployment before treating this as live capacity.

Keep the feature disabled until all three providers are configured:

```dotenv
AI_MULTI_PROVIDER_ROUTING=true
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_AI_MODEL=@cf/qwen/qwen3-30b-a3b-fp8
GROQ_CHAT_MODEL=openai/gpt-oss-20b
```

Store `CLOUDFLARE_AI_API_TOKEN`, `GROQ_API_KEY`, and `OLLAMA_SERVER_TOKEN` in
Google Secret Manager. The Workers AI API token is separate from the
`cloudflared` tunnel connector token. The gateway validates all provider
configuration before admission or charging. If configuration is later removed,
already queued work fails terminally and is refunded rather than waiting forever.
A transient provider failure is retried with bounded exponential backoff on a
different eligible provider; the FIFO head is never bypassed during that delay.
Responses and audit records include the provider and model that completed the
request. The router state contains only random lease IDs,
provider names, and expiry timestamps under an Admin-only Realtime Database
path. Queue records never contain auth tokens, provider secrets, or expanded room
context; authorization and room context are reloaded immediately before queued
inference.

Minimalist Analysis mirrors this website routing catalog as read-only metadata:
10 protected-Ollama leases for the Fast and Smart tags, 40 Cloudflare Workers AI
leases using the server default `@cf/qwen/qwen3-30b-a3b-fp8`, and 40 Groq leases
using the server default `openai/gpt-oss-20b`. The two hosted model IDs are
display-only in Analysis. They are never passed to Ollama, added to the bridge
allowlist, or offered as install actions. The card documents the defaults built
into that app release; live provider readiness and environment overrides remain
server-owned and are reported by the authenticated website gateway.

Cloud overflow changes where request content is processed. Room context and,
for the personal agent, saved instructions and memory can be sent to Cloudflare
or Groq. The UI discloses this before sending and labels every completed answer
with its actual provider. Keep the router disabled if that processing policy is
not acceptable for the deployment.

The Groq model remains configurable because hosted model IDs change over time.
The default follows Groq's current replacement for the retiring
`llama-3.1-8b-instant`; check [Groq model deprecations](https://console.groq.com/docs/deprecations/)
before each production rollout.

Cloudflare Workers AI currently provides a 10,000-neuron daily free allocation,
so the 40 Cloudflare slots are a concurrency cap rather than a guarantee that
every request remains free. See [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/),
[REST configuration](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/),
and the [Qwen3 model](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/).
Groq's free-plan request and token limits can likewise reject work before all
40 application slots are occupied when prompts are large; verify the current
[Groq rate limits](https://console.groq.com/docs/rate-limits) for the selected model.

The no-cost RTDB emulator stress harness submits 550 attempts (500 unique jobs
plus 50 idempotent duplicates) through two contending Admin clients, verifies the
first active wave is exactly 10 local / 40 Cloudflare / 40 Groq, recovers 12
interrupted claims, drains all 500 jobs, and finishes with zero outstanding
capacity reservations. It does not call any AI provider and is a sustained
queue-contention test, not 500 simultaneous network sockets.

## Enable Public Gateway Mode

Once the Function has a working `OLLAMA_SERVER_URL`, switch `public/config.js`:

```js
window.AI_PROVIDER = 'gateway';
window.MINIMALIST_FLAGS.aiGateway = true;
window.MINIMALIST_FLAGS.aiServerProfile = true;
```

Then rebuild and deploy Hosting:

```powershell
npm test
npx firebase-tools deploy --only hosting --project chat-app-356c1
```

If `OLLAMA_SERVER_URL` is missing, the public AI gateway now fails closed with a clear configuration error instead of silently falling back to Groq.
