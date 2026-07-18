'use strict';

const wakeSlot = String(process.argv[2] || '').trim();
if (!/^(?:\d{2}|retry|bridge-probe)$/.test(wakeSlot)) {
    throw new Error('A valid queue wake slot is required.');
}

const functionsModule = require('../functions/index.js');
const admin = require('../functions/node_modules/firebase-admin');
const queueWorker = functionsModule.aiQueueWorker;

if (typeof queueWorker?.run !== 'function') {
    throw new Error('The exported aiQueueWorker handler is unavailable.');
}

async function main() {
    const snapshot = await admin.database()
        .ref(`ai_runtime/text_request_queue_v1/wake/${wakeSlot}`)
        .once('value');
    if (snapshot.exists()) {
        await queueWorker.run(snapshot, { params: { wakeSlot } });
    }
    await Promise.allSettled(admin.apps.map((appInstance) => appInstance.delete()));
}

main().catch(async (error) => {
    console.error(error);
    await Promise.allSettled(admin.apps.map((appInstance) => appInstance.delete()));
    process.exitCode = 1;
});
