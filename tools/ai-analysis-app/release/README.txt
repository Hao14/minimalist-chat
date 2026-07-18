MINIMALIST ANALYSIS FOR WINDOWS
===============================

Release profile
---------------
- Platform: Windows x64
- Distribution: self-contained, single-file application
- Installation: none; run MinimalistAIAnalysis.exe

Workspace selection
-------------------
Minimalist Analysis works with one local Minimalist Chat workspace. It detects
the workspace automatically when the executable lives inside it. The portable
app can also live anywhere: open Health, choose "Choose workspace", and select
the Minimalist Chat folder. That choice is saved for future launches.

Protected Ollama health, approved-model installation, bridge control, platform
analytics, and moderation require the workspace's protected local tooling.

Remote desktop mode
-------------------
The header data-source selector starts on "This PC" every time the app opens.
On another Windows computer, choose "Remote desktop" and complete Cloudflare
Access sign-in in the system browser. The client discovers Managed OAuth from
https://analysis.minimalist.chat, dynamically registers as a public native
client, and uses Authorization Code with PKCE plus a 127.0.0.1 loopback
callback. It contains no client secret and does not store the owner's email or
the Access application AUD.

The desktop being monitored must be powered on, awake, online, signed in to
Windows, and running both the Minimalist Chat Remote Analysis Agent and its
Cloudflare Tunnel connector. The Access application must have Managed OAuth
and dynamic loopback clients enabled. The configured default Access team is
https://hotsauce.cloudflareaccess.com. Router port forwarding and SSH are not
used by this mode.

For a separate authorized deployment, the two non-secret endpoints can be
overridden before launch with MINIMALIST_ANALYSIS_REMOTE_ORIGIN and
MINIMALIST_ANALYSIS_ACCESS_TEAM_DOMAIN. Both values must be bare HTTPS origins;
the team value must remain a cloudflareaccess.com hostname. These variables do
not accept or store an owner email, AUD, OAuth token, or Tunnel credential.

Remote mode reads only /v1/ping and /v1/snapshot. Users, Firebase administrator
analytics, moderation, local logs, workspace paths, AI mode changes, model
installation, bridge control, and tunnel control are disabled. A remote error
stays remote and never falls back to localhost on the computer running the
client. Switch the selector back to "This PC" explicitly for local controls.
Health shows the agent under its exact hidden Windows task name,
"Minimalist Chat Remote Analysis Agent," separately from the existing
"Minimalist Chat Public Gateway Recovery" tunnel-recovery task.

The OAuth refresh session is encrypted for the current Windows user with DPAPI
in Local AppData; access tokens remain in memory. No OAuth token is written to
settings.json. Select "Sign out" in Remote mode to remove the encrypted saved
session. A browser sign-in is required again when the Cloudflare grant expires
or Access policy denies the refresh.

Approved AI models
------------------
The app manages three exact protected-runtime tags: Fast
(`qwen3:4b-instruct`), Smart (`qwen3:14b`), and Vision (`qwen2.5vl:7b`). Each
has an independent install/repair action with progress, cancellation, and
post-install verification. When protected Ollama is asleep or Off, model
health reports "Not checked" instead of incorrectly reporting "Missing."

Website AI routing
------------------
The AI Control workspace also shows the website's 90-lease provider catalog:
10 protected-Ollama leases for Fast and Smart, 40 Cloudflare Workers AI leases
using `@cf/qwen/qwen3-30b-a3b-fp8`, and 40 Groq leases using
`openai/gpt-oss-20b`. These hosted models are read-only routing metadata. They
cannot be installed, passed to the protected bridge, or added to its exact
three-model local allowlist. The displayed values are the defaults bundled with
this release; live provider readiness and server environment overrides remain
owned by the authenticated website gateway.

Responsive interface
--------------------
The five workspaces automatically reflow for compact, standard, and wide
windows. The supported minimum is 900 x 640. Compact windows stack charts and
cards, keep page content vertically scrollable, and wrap action controls while
the header and bottom navigation remain fixed.

Porcelain interface
-------------------
The desktop app uses the Porcelain visual system: a calm neutral canvas,
high-contrast white surfaces, a compact floating bottom dock, native keyboard
focus cues, DPI-aware typography and icons, and restrained system color. The
five workspaces are Overview, Users, AI Control, Health, and Console. Keyboard
shortcuts Ctrl+1 through Ctrl+5 open them directly.

The AI request activity chart shows the exact rolling-hour request count plus
known success and error totals when you hover it. Keyboard users can focus the
chart and move between hours with the Left and Right arrow keys. Health includes
one state-aware Turn tunnel on/off control; tunnel startup is refused unless the
protected bridge is healthy on its isolated loopback endpoint.

Protected user directory
------------------------
The Users screen automatically joins Firebase Auth, the public user directory,
private profile fallbacks, presence, and subscription status by exact UID. It
shows only the resolved user label, Firebase UID, membership class, and online
state. Email addresses, phone numbers, payment details, password data, messages,
and prompts are not displayed or logged. The temporary Auth export is deleted
immediately after each refresh.

Guarded moderation console
--------------------------
The Console is one responsive terminal surface with command history, Copy,
Clear, keyboard focus, and built-in help. Type "moderation-help" to see the
current allowlist. Read-only tools include moderation-summary, banned and muted
lists, exact user-room lookup, room status, room members, and recent room logs.

Account controls include ban/unban, global mute/unmute, timed or permanent room
mute, room unmute, room kick, exact-scope message deletion, and permanent
account deletion. Common aliases such as whois, bans, mutes, timeout, untimeout,
and remove-message resolve only to their documented allowlisted command.

The Console never executes arbitrary shell input. It validates exact Firebase
identifiers, duration bounds, command shape, and typed confirmation before a
mutation. Mutations also require a second confirmation dialog with No selected
by default. DELETE operations require uppercase DELETE plus a case-sensitive
repeat of the exact ID. The protected administrator cannot be targeted, rooms
and members are verified before writes, messages without a valid author fail
closed, and account deletion is refused until owned rooms are transferred or
deleted. Partial cleanup is reported explicitly rather than shown as success.

Security and local requirements
-------------------------------
This package contains no embedded credentials, Firebase secrets, bridge tokens,
or user data. Protected access is resolved at runtime through the selected
workspace's existing local tooling and configuration. The protected Ollama
runtime uses 127.0.0.1:11435 and the default user model store, independently of
the user's tray Ollama app on 11434.

Integrity
---------
MinimalistAIAnalysis.exe.sha256 contains the SHA256 checksum for the executable.
You can verify it in PowerShell with:

  Get-FileHash .\MinimalistAIAnalysis.exe -Algorithm SHA256

Unsigned build
--------------
This release is not code-signed. Windows may show a SmartScreen or unknown
publisher warning. Verify the checksum and release source before running it.
