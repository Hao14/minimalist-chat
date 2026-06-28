# Protected Ollama Public Gateway

The public website must never call raw Ollama directly. The safe path is:

1. Browser signs in with Firebase Auth.
2. Browser calls the Firebase `aiGateway` Function.
3. Firebase enforces auth, room membership, Bananas, abuse checks, and audit logging.
4. Firebase calls a protected Ollama bridge with a bearer token.
5. The bridge forwards only approved Ollama routes to `http://127.0.0.1:11434`.

## Local Bridge

Start Ollama first, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\ollama-bridge\start-ollama-bridge.ps1
```

The script prints a generated `OLLAMA_SERVER_TOKEN`. Keep it private.

The bridge listens on `http://127.0.0.1:8787` and only exposes `/api/chat`, `/api/generate`, and `/api/tags`. It blocks requests without the bearer token and can restrict models with `OLLAMA_BRIDGE_MODEL_ALLOWLIST`. The default request body limit is 16 MB so phone screenshots can be sent to vision models without the tunnel dropping the connection.

## Public HTTPS Tunnel

Put an HTTPS tunnel in front of the bridge, not in front of raw Ollama. Cloudflare Tunnel, Tailscale Funnel, or another authenticated reverse proxy can point to:

```text
http://127.0.0.1:8787
```

Do not publish `http://127.0.0.1:11434`.

## Firebase Functions Runtime Config

Copy the example env file:

```powershell
Copy-Item .\functions\.env.example .\functions\.env.chat-app-356c1
```

Edit `functions/.env.chat-app-356c1`:

```dotenv
OLLAMA_SERVER_URL=https://your-protected-bridge-url.example.com
OLLAMA_MODEL=llama3.1:latest
OLLAMA_SERVER_TOKEN=the-token-printed-by-start-ollama-bridge
AI_ALLOW_GROQ_FALLBACK=false
```

For long-lived production secrets, move `OLLAMA_SERVER_TOKEN` to Google Secret Manager and bind it in the relevant Function `runWith({ secrets: [...] })` entries. The project-specific env file is fine for getting the protected bridge running, and it is ignored by git.

Deploy Functions with Node 22:

```powershell
$env:PATH = "$PWD\.deploy-tools\node-v22.23.1-win-x64;$env:PATH"
node -v
npx firebase-tools deploy --only functions --project chat-app-356c1
```

Firebase loads environment variables from `functions/.env` and project-specific `functions/.env.<project-or-alias>` files at deploy time. Keep those files out of git.

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
