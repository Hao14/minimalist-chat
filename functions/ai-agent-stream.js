'use strict';

const AI_STREAM_REPLY_MAX_CHARS = 16000;
const AI_STREAM_LINE_MAX_CHARS = 1024 * 1024;

function streamError(message, code = 'AI_STREAM_INVALID_RESPONSE') {
    const error = new Error(message);
    error.status = 502;
    error.code = code;
    error.noExternalFallback = true;
    return error;
}

function parseOllamaStreamLine(line) {
    const text = String(line || '').trim();
    if (!text) return null;
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw streamError('The protected AI bridge returned malformed streaming JSON.');
    }
    if (data?.error) throw streamError(`The protected AI bridge stream failed: ${String(data.error).slice(0, 180)}`, 'AI_STREAM_UPSTREAM_ERROR');
    return {
        content: String(data?.message?.content || ''),
        done: data?.done === true,
        model: String(data?.model || '')
    };
}

async function consumeOllamaChatStream(response, { onPartial, maxChars = AI_STREAM_REPLY_MAX_CHARS } = {}) {
    if (!response?.body || typeof response.body.getReader !== 'function') {
        throw streamError('The protected AI bridge did not return a readable stream.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const safeLimit = Math.max(1000, Math.min(AI_STREAM_REPLY_MAX_CHARS, Math.floor(Number(maxChars) || AI_STREAM_REPLY_MAX_CHARS)));
    let buffer = '';
    let reply = '';
    let model = '';
    let sawRecord = false;

    const consumeLine = async (line) => {
        const record = parseOllamaStreamLine(line);
        if (!record) return;
        sawRecord = true;
        if (record.model) model = record.model;
        if (record.content) {
            if (reply.length + record.content.length > safeLimit) {
                throw streamError('The protected AI bridge stream exceeded the reply limit.', 'AI_STREAM_REPLY_TOO_LARGE');
            }
            reply += record.content;
            if (typeof onPartial === 'function') await onPartial(reply);
        }
    };

    try {
        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            if (buffer.length > AI_STREAM_LINE_MAX_CHARS && !buffer.includes('\n')) {
                throw streamError('The protected AI bridge stream contained an oversized record.');
            }
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';
            for (const line of lines) await consumeLine(line);
            if (done) break;
        }
        if (buffer.trim()) await consumeLine(buffer);
        if (!sawRecord || !reply.trim()) {
            throw streamError('The protected AI bridge returned an empty streamed response.');
        }
        return { reply: reply.trim(), model };
    } catch (error) {
        await reader.cancel().catch(() => null);
        throw error;
    }
}

module.exports = {
    AI_STREAM_REPLY_MAX_CHARS,
    consumeOllamaChatStream,
    parseOllamaStreamLine
};
