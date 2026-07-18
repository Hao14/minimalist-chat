'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('../node_modules/express');

const repoRoot = path.resolve(__dirname, '..');
const projectId = String(process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'chat-app-356c1').trim();
const envPath = path.join(repoRoot, 'functions', `.env.${projectId}`);
const host = '127.0.0.1';
const port = Math.max(1, Math.min(65535, Number.parseInt(process.env.AI_LIVE_LOAD_BRIDGE_PORT || '5002', 10) || 5002));
const queueWorkerConcurrency = Math.max(1, Math.min(8,
    Number.parseInt(process.env.AI_LIVE_LOAD_QUEUE_WORKER_CONCURRENCY || '1', 10) || 1));
const databaseHost = String(process.env.FIREBASE_DATABASE_EMULATOR_HOST || '').trim();
const queueWorkerRunner = path.join(repoRoot, 'tools', 'ai-live-queue-worker-runner.cjs');

function unquoteEnvValue(rawValue) {
    const value = String(rawValue || '').trim();
    if (value.length < 2) return value;
    const quote = value[0];
    if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote) return value;
    const inner = value.slice(1, -1);
    return quote === '"'
        ? inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        : inner;
}

function loadFunctionsEnvironment() {
    const source = fs.readFileSync(envPath, 'utf8');
    for (const line of source.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match || Object.hasOwn(process.env, match[1])) continue;
        process.env[match[1]] = unquoteEnvValue(match[2]);
    }
}

loadFunctionsEnvironment();

if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(databaseHost)) {
    throw new Error('The live-load bridge requires a local Realtime Database emulator.');
}
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
const firebaseConfig = {
    projectId,
    databaseURL: `http://${databaseHost}/?ns=${projectId}-default-rtdb`,
};
process.env.FIREBASE_CONFIG = JSON.stringify(firebaseConfig);

// Keep large load-test runs readable without changing the production handler's
// behavior. Errors and every other informational message still pass through.
const originalConsoleInfo = console.info.bind(console);
console.info = (...args) => {
    if (args[0] === 'AI request queued') return;
    originalConsoleInfo(...args);
};

const functionsModule = require('../functions/index.js');
const admin = require('../functions/node_modules/firebase-admin');
const gateway = functionsModule.aiGateway;
const queueWorker = functionsModule.aiQueueWorker;

if (typeof gateway !== 'function') {
    throw new Error('The exported aiGateway function is unavailable.');
}
if (typeof queueWorker?.run !== 'function') {
    throw new Error('The exported aiQueueWorker handler is unavailable.');
}

const queueListenerApp = admin.initializeApp(firebaseConfig, 'ai-live-queue-listener');
const wakeRef = admin.database(queueListenerApp).ref('ai_runtime/text_request_queue_v1/wake');
const workerTasks = new Set();
const workerChildren = new Set();
const pendingWakes = [];
let activeWorkers = 0;
let activeGatewayRequests = 0;
let queueDrainPaused = false;
let closing = false;

function runIsolatedQueueWorker(wakeSlot) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [queueWorkerRunner, wakeSlot], {
            cwd: repoRoot,
            env: process.env,
            stdio: ['ignore', 'inherit', 'inherit'],
            windowsHide: true,
        });
        workerChildren.add(child);
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            workerChildren.delete(child);
            if (error) reject(error);
            else resolve();
        };
        child.once('error', finish);
        child.once('exit', (code, signal) => {
            if (code === 0) finish();
            else finish(new Error(`Queue worker exited with ${signal || `code ${code ?? 'unknown'}`}.`));
        });
    });
}

function pumpWorkers() {
    while (
        !closing
        && !queueDrainPaused
        && activeGatewayRequests === 0
        && activeWorkers < queueWorkerConcurrency
        && pendingWakes.length
    ) {
        const snapshot = pendingWakes.shift();
        activeWorkers += 1;
        const task = runIsolatedQueueWorker(snapshot.key)
            .catch((error) => {
                console.error(JSON.stringify({
                    event: 'queue-worker-error',
                    wakeSlot: snapshot.key,
                    error: String(error?.message || error).slice(0, 500),
                }));
            })
            .finally(() => {
                activeWorkers -= 1;
                workerTasks.delete(task);
                pumpWorkers();
            });
        workerTasks.add(task);
    }
}

const onWake = (snapshot) => {
    pendingWakes.push(snapshot);
    pumpWorkers();
};
wakeRef.on('child_added', onWake, (error) => {
    console.error(JSON.stringify({ event: 'queue-listener-error', error: String(error?.message || error).slice(0, 500) }));
});

const app = express();
app.use(express.json({
    limit: '1mb',
    verify(request, _response, buffer) {
        request.rawBody = buffer;
    },
}));
app.post('/__load-test/queue-drain', (request, response) => {
    if (typeof request.body?.paused !== 'boolean') {
        return response.status(400).json({ error: 'paused must be a boolean.' });
    }
    queueDrainPaused = request.body.paused;
    if (!queueDrainPaused) pumpWorkers();
    return response.status(200).json({ ok: true, paused: queueDrainPaused });
});
app.all('/aiGateway', (request, response, next) => {
    activeGatewayRequests += 1;
    Promise.resolve(gateway(request, response))
        .catch(next)
        .finally(() => {
            activeGatewayRequests -= 1;
            pumpWorkers();
        });
});

async function assertQueueTriggerDelivery() {
    const probeRef = admin.database().ref('ai_runtime/text_request_queue_v1/wake/bridge-probe');
    await probeRef.set({ id: `probe-${Date.now()}`, createdAt: Date.now() });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        if (!(await probeRef.once('value')).exists()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The isolated queue-trigger connection did not consume its readiness probe.');
}

const server = app.listen(port, host, async () => {
    try {
        await assertQueueTriggerDelivery();
        console.log(JSON.stringify({
            event: 'gateway-bridge-ready',
            origin: `http://${host}:${port}`,
            queueWorkerConcurrency,
            queueTriggerProbe: 'passed',
            queuedWorkStartsAfterAdmissionDrain: true,
            explicitAdmissionFence: true,
        }));
    } catch (error) {
        console.error(error);
        await close(1);
    }
});

async function close(exitCode = 0) {
    if (closing) return;
    closing = true;
    wakeRef.off('child_added', onWake);
    pendingWakes.length = 0;
    await new Promise((resolve) => server.close(resolve));
    workerChildren.forEach((child) => child.kill());
    await Promise.allSettled([...workerTasks]);
    await Promise.allSettled(admin.apps.map((appInstance) => appInstance.delete()));
    process.exitCode = exitCode;
}

process.on('SIGINT', () => void close(130));
process.on('SIGTERM', () => void close(143));
process.on('uncaughtException', (error) => {
    console.error(error);
    void close(1);
});
process.on('unhandledRejection', (error) => {
    console.error(error);
    void close(1);
});
