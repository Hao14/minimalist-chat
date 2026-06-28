const http = require('node:http');

const PORT = Number(process.env.BRIDGE_PORT || 8787);
const UPSTREAM = String(process.env.OLLAMA_UPSTREAM || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const TOKEN = String(process.env.OLLAMA_BRIDGE_TOKEN || '').trim();
const MAX_BODY_BYTES = Number(process.env.OLLAMA_BRIDGE_MAX_BODY_BYTES || 16 * 1024 * 1024);
const MODEL_ALLOWLIST = new Set(
  String(process.env.OLLAMA_BRIDGE_MODEL_ALLOWLIST || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
);

if (!TOKEN) {
  console.error('Missing OLLAMA_BRIDGE_TOKEN. Refusing to expose the Ollama bridge.');
  process.exit(1);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      req.resume();
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(Object.assign(new Error(`Request too large. Maximum bridge body is ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB.`), { status: 413 }));
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', fail);
  });
}

function hasValidAuth(req) {
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

function validatePayload(pathname, body) {
  if (!body.length || !MODEL_ALLOWLIST.size) return;
  if (pathname !== '/api/chat' && pathname !== '/api/generate') return;

  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    const error = new Error('Bridge only accepts valid JSON payloads.');
    error.status = 400;
    throw error;
  }

  const model = String(payload.model || '').trim();
  if (!MODEL_ALLOWLIST.has(model)) {
    const error = new Error(`Model "${model || 'unknown'}" is not allowed on this bridge.`);
    error.status = 403;
    throw error;
  }
}

async function proxyToOllama(req, res, pathname, body) {
  const upstreamResponse = await fetch(`${UPSTREAM}${pathname}`, {
    method: req.method,
    headers: {
      'Content-Type': req.headers['content-type'] || 'application/json',
      Accept: req.headers.accept || 'application/json',
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });

  const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
  res.writeHead(upstreamResponse.status, {
    'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(responseBody);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/health') {
      return sendJson(res, 200, { ok: true, upstream: UPSTREAM, modelsRestricted: MODEL_ALLOWLIST.size > 0 });
    }

    if (!hasValidAuth(req)) {
      return sendJson(res, 401, { error: 'Missing or invalid bridge token.' });
    }

    if (!['/api/chat', '/api/generate', '/api/tags'].includes(pathname)) {
      return sendJson(res, 404, { error: 'This bridge only exposes approved Ollama API routes.' });
    }

    if (pathname === '/api/tags' && req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Use GET for /api/tags.' });
    }

    if (pathname !== '/api/tags' && req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Use POST for model requests.' });
    }

    const body = await readBody(req);
    validatePayload(pathname, body);
    await proxyToOllama(req, res, pathname, body);
  } catch (error) {
    const status = Number(error.status || 502);
    sendJson(res, status, { error: error.message || 'Ollama bridge failed.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Protected Ollama bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`Forwarding to ${UPSTREAM}`);
  if (MODEL_ALLOWLIST.size) console.log(`Allowed models: ${Array.from(MODEL_ALLOWLIST).join(', ')}`);
});
