import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const env = globalThis.process?.env || {};
const PORT = Number(env.PORT || 3000);
const HOST = env.HOST || '127.0.0.1';
const configuredOrigins = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const allowedOrigins = new Set([
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    ...configuredOrigins,
]);
const loopbackHost = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(HOST);

function isAllowedOrigin(origin) {
    if (!origin) return loopbackHost;
    try {
        const url = new URL(origin);
        if (/^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(url.hostname)) return true;
        return allowedOrigins.has(url.origin);
    } catch {
        return false;
    }
}

const io = new Server(server, {
    cors: {
        origin(origin, callback) {
            callback(isAllowedOrigin(origin) ? null : new Error('Socket origin is not allowed.'), isAllowedOrigin(origin));
        },
        methods: ['GET', 'POST'],
    },
});

// Serve Vite's production output. Run `npm run build` first.
const webRoot = path.join(__dirname, 'dist');
const notFoundFile = path.join(webRoot, '404.html');
const browserRoutePatterns = [
    /^\/join\/[^/]+\/?$/,
    /^\/vault\/share\/[^/]+\/?$/,
];

function isGetOrHeadRequest(request) {
    return ['GET', 'HEAD'].includes(request.method);
}

function isDocumentRequest(request) {
    return isGetOrHeadRequest(request) && !path.extname(request.path);
}

app.disable('x-powered-by');
app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});
app.use(express.static(webRoot, { redirect: false }));

app.use((request, response, next) => {
    if (!isDocumentRequest(request)) return next();

    const trimmedPath = request.path.replace(/^\/+|\/+$/g, '');
    if (!trimmedPath) return next();

    const candidateFiles = [
        path.resolve(webRoot, `${trimmedPath}.html`),
        path.resolve(webRoot, trimmedPath, 'index.html'),
    ].filter((filePath) => filePath.startsWith(webRoot));

    const prerenderedFile = candidateFiles.find((filePath) => fs.existsSync(filePath));
    if (prerenderedFile) {
        response.sendFile(prerenderedFile);
        return;
    }

    next();
});

// Only dynamic BrowserRouter entry points boot from index.html. Static and
// prerendered routes are served above; every other path must remain a real 404.
app.use((request, response, next) => {
    if (!isGetOrHeadRequest(request)
        || !browserRoutePatterns.some((pattern) => pattern.test(request.path))) return next();
    response.sendFile(path.join(webRoot, 'index.html'));
});

app.use((request, response, next) => {
    if (!isDocumentRequest(request)) return next();

    response.status(404).sendFile(notFoundFile, (error) => {
        if (!error || response.headersSent) return;
        response.status(404).type('text/plain').send('Not Found');
    });
});

// Handle real-time chat connections
io.on('connection', (socket) => {
    if (!isAllowedOrigin(socket.handshake.headers.origin)) {
        socket.disconnect(true);
        return;
    }

    console.log('A user connected');

    socket.on('chat message', (msg) => {
        // Broadcast the message to everyone
        io.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

server.listen(PORT, HOST, () => {
    console.log(`Server is running locally at http://${HOST}:${PORT}`);
});
