'use strict';

const crypto = require('node:crypto');
const { sanitizeAiImageAttachment } = require('./ai-agent-contracts');

const WINSTON_ATTACHMENT_MAX_COUNT = 6;
const WINSTON_ATTACHMENT_MAX_TOTAL_TEXT_CHARS = 60_000;
const WINSTON_ATTACHMENT_MAX_SEGMENTS = 40;
const WINSTON_AUDIO_MAX_BYTES = 6 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = new Set([
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const AUDIO_MIME_TYPES = new Set([
    'audio/flac',
    'audio/m4a',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'video/mp4',
    'video/webm'
]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;

function attachmentError(message, code, status = 400) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function cleanText(value, limit) {
    const text = String(value || '').trim();
    return text.length > limit ? text.slice(0, limit) : text;
}

function safeName(value, fallback) {
    return cleanText(value || fallback, 120).replace(/[\u0000-\u001f\u007f]/g, '') || fallback;
}

function base64Bytes(value, maxBytes, label) {
    const input = String(value || '').trim();
    if (!input || input.startsWith('data:') || !/^[A-Za-z0-9+/]+={0,2}$/.test(input)) {
        throw attachmentError(`${label} data must be raw base64.`, 'WINSTON_ATTACHMENT_DATA_INVALID');
    }
    const bytes = Buffer.from(input, 'base64');
    if (!bytes.length || bytes.length > maxBytes) {
        throw attachmentError(`${label} must be at most ${maxBytes} bytes.`, 'WINSTON_ATTACHMENT_TOO_LARGE', 413);
    }
    if (bytes.toString('base64').replace(/=+$/, '') !== input.replace(/=+$/, '')) {
        throw attachmentError(`${label} base64 is malformed.`, 'WINSTON_ATTACHMENT_DATA_INVALID');
    }
    return { input, bytes };
}

function attachmentId(value, index, name, mimeType) {
    const supplied = String(value || '').trim();
    if (SAFE_ID.test(supplied)) return supplied;
    return `file_${crypto.createHash('sha256')
        .update(String(index))
        .update('\0')
        .update(name)
        .update('\0')
        .update(mimeType)
        .digest('hex')
        .slice(0, 20)}`;
}

function normalizeSegment(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const text = cleanText(value.text, 4000);
    if (!text) return null;
    const page = Number.isSafeInteger(Number(value.page)) && Number(value.page) > 0
        ? Math.min(10_000, Number(value.page))
        : 0;
    const startMs = Number.isFinite(Number(value.startMs)) && Number(value.startMs) >= 0
        ? Math.min(86_400_000, Math.floor(Number(value.startMs)))
        : -1;
    const endMs = Number.isFinite(Number(value.endMs)) && Number(value.endMs) >= startMs
        ? Math.min(86_400_000, Math.floor(Number(value.endMs)))
        : -1;
    const rowStart = Number.isSafeInteger(Number(value.rowStart)) && Number(value.rowStart) > 0
        ? Math.min(1_000_000, Number(value.rowStart))
        : 0;
    const rowEnd = rowStart && Number.isSafeInteger(Number(value.rowEnd)) && Number(value.rowEnd) >= rowStart
        ? Math.min(1_000_000, Number(value.rowEnd))
        : rowStart;
    const lineStart = Number.isSafeInteger(Number(value.lineStart)) && Number(value.lineStart) > 0
        ? Math.min(1_000_000, Number(value.lineStart))
        : 0;
    const lineEnd = lineStart && Number.isSafeInteger(Number(value.lineEnd)) && Number(value.lineEnd) >= lineStart
        ? Math.min(1_000_000, Number(value.lineEnd))
        : lineStart;
    return {
        text,
        ...(page ? { page } : {}),
        ...(rowStart ? { rowStart, rowEnd } : {}),
        ...(lineStart ? { lineStart, lineEnd } : {}),
        ...(startMs >= 0 ? { startMs } : {}),
        ...(endMs >= 0 ? { endMs } : {})
    };
}

function normalizeDocument(source, index, remainingChars) {
    const mimeType = String(source.mimeType || '').trim().toLowerCase();
    if (!DOCUMENT_MIME_TYPES.has(mimeType)) return null;
    const name = safeName(source.name, 'Winston document');
    const providedSegments = (Array.isArray(source.segments)
        ? source.segments
        : Array.isArray(source.extraction?.segments) ? source.extraction.segments : [])
        .map(normalizeSegment)
        .filter(Boolean)
        .slice(0, WINSTON_ATTACHMENT_MAX_SEGMENTS);
    const rawText = cleanText(source.text, remainingChars);
    const segments = providedSegments.length
        ? providedSegments
        : rawText ? [{ text: rawText }] : [];
    const safeSegments = [];
    let usedChars = 0;
    for (const segment of segments) {
        if (usedChars >= remainingChars) break;
        const text = cleanText(segment.text, remainingChars - usedChars);
        if (!text) continue;
        safeSegments.push({ ...segment, text });
        usedChars += text.length;
    }
    if (!safeSegments.length) {
        throw attachmentError(
            `${name} did not contain readable extracted text.`,
            'WINSTON_ATTACHMENT_TEXT_REQUIRED',
            422
        );
    }
    return {
        id: attachmentId(source.id, index, name, mimeType),
        name,
        mimeType,
        kind: 'document',
        size: Math.max(0, Math.min(16 * 1024 * 1024, Math.floor(Number(source.size) || 0))),
        segments: safeSegments,
        textChars: usedChars
    };
}

function normalizeAudio(source, index) {
    const mimeType = String(source.mimeType || '').trim().toLowerCase();
    if (!AUDIO_MIME_TYPES.has(mimeType)) return null;
    const name = safeName(source.name, 'Winston audio');
    const { input, bytes } = base64Bytes(source.audio || source.data, WINSTON_AUDIO_MAX_BYTES, 'Audio');
    const validSignature = mimeType === 'audio/flac'
        ? bytes.subarray(0, 4).toString('ascii') === 'fLaC'
        : mimeType === 'audio/mpeg'
            ? bytes.subarray(0, 3).toString('ascii') === 'ID3'
                || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
            : mimeType === 'audio/wav'
                ? bytes.subarray(0, 4).toString('ascii') === 'RIFF'
                    && bytes.subarray(8, 12).toString('ascii') === 'WAVE'
                : mimeType === 'audio/ogg'
                    ? bytes.subarray(0, 4).toString('ascii') === 'OggS'
                    : mimeType === 'audio/webm' || mimeType === 'video/webm'
                        ? bytes.length >= 4
                            && bytes[0] === 0x1a && bytes[1] === 0x45
                            && bytes[2] === 0xdf && bytes[3] === 0xa3
                        : mimeType === 'audio/mp4' || mimeType === 'audio/m4a' || mimeType === 'video/mp4'
                            ? bytes.subarray(4, 8).toString('ascii') === 'ftyp'
                            : false;
    if (!validSignature) {
        throw attachmentError(
            'Audio bytes do not match the declared file type.',
            'WINSTON_ATTACHMENT_SIGNATURE_INVALID',
            415
        );
    }
    return {
        id: attachmentId(source.id, index, name, mimeType),
        name,
        mimeType,
        kind: 'audio',
        audio: input,
        size: bytes.length
    };
}

function normalizeImage(source, index) {
    const image = sanitizeAiImageAttachment(source);
    return {
        ...image,
        id: attachmentId(source.id, index, image.name, image.mimeType),
        kind: 'image'
    };
}

function sanitizeWinstonAttachments(values) {
    const sourceValues = Array.isArray(values) ? values : [];
    if (sourceValues.length > WINSTON_ATTACHMENT_MAX_COUNT) {
        throw attachmentError(
            `Winston accepts up to ${WINSTON_ATTACHMENT_MAX_COUNT} files per request.`,
            'WINSTON_ATTACHMENT_COUNT_LIMIT',
            413
        );
    }
    const attachments = [];
    let remainingText = WINSTON_ATTACHMENT_MAX_TOTAL_TEXT_CHARS;
    for (const [index, source] of sourceValues.entries()) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
        const declaredKind = String(source.kind || '').trim().toLowerCase();
        const mimeType = String(source.mimeType || '').trim().toLowerCase();
        let attachment = null;
        if (declaredKind === 'image' || mimeType.startsWith('image/')) attachment = normalizeImage(source, index);
        else if (declaredKind === 'audio' || AUDIO_MIME_TYPES.has(mimeType)) attachment = normalizeAudio(source, index);
        else attachment = normalizeDocument(source, index, remainingText);
        if (!attachment) {
            throw attachmentError('That attachment type is not supported.', 'WINSTON_ATTACHMENT_TYPE_UNSUPPORTED', 415);
        }
        if (attachment.kind === 'document') remainingText -= attachment.textChars;
        attachments.push(attachment);
    }
    const totalBytes = attachments.reduce((sum, attachment) => sum + Math.max(0, attachment.size || 0), 0);
    if (totalBytes > 16 * 1024 * 1024) {
        throw attachmentError('The combined attachment size is too large.', 'WINSTON_ATTACHMENT_TOTAL_TOO_LARGE', 413);
    }
    return attachments;
}

function attachmentSourceLabel(attachment, segment) {
    if (segment?.page) return `${attachment.name}, page ${segment.page}`;
    if (segment?.rowStart) {
        return `${attachment.name}, ${segment.rowEnd > segment.rowStart
            ? `rows ${segment.rowStart}-${segment.rowEnd}`
            : `row ${segment.rowStart}`}`;
    }
    if (segment?.lineStart) {
        return `${attachment.name}, ${segment.lineEnd > segment.lineStart
            ? `lines ${segment.lineStart}-${segment.lineEnd}`
            : `line ${segment.lineStart}`}`;
    }
    if (Number.isFinite(segment?.startMs)) {
        const seconds = Math.floor(segment.startMs / 1000);
        return `${attachment.name}, ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return attachment.name;
}

function buildWinstonAttachmentContext(attachments, {
    roomId = 'global',
    sourceStart = 1,
    maxSources = 20,
    maxContextChars = 60_000
} = {}) {
    const sources = [];
    const lines = [];
    let usedChars = 0;
    for (const attachment of Array.isArray(attachments) ? attachments : []) {
        if (!['document', 'audio'].includes(attachment?.kind)) continue;
        const segments = Array.isArray(attachment.segments) ? attachment.segments : [];
        for (const segment of segments) {
            if (sources.length >= maxSources || usedChars >= maxContextChars) break;
            const id = `S${sourceStart + sources.length}`;
            const label = attachmentSourceLabel(attachment, segment);
            const text = cleanText(segment.text, Math.min(4000, maxContextChars - usedChars));
            if (!text) continue;
            const line = `[${id}] ${label} — ${text}`;
            lines.push(line);
            usedChars += line.length;
            sources.push({
                id,
                type: attachment.kind === 'audio' ? 'audio' : 'file',
                roomId: String(roomId || 'global'),
                channelId: 'general',
                itemId: attachment.id,
                label,
                timestamp: 0,
                excerpt: cleanText(text.replace(/\s+/g, ' '), 360)
            });
        }
    }
    return {
        context: lines.join('\n'),
        sources,
        attachmentCount: (Array.isArray(attachments) ? attachments : []).length,
        textChars: usedChars
    };
}

function publicWinstonAttachmentReceipt(attachments) {
    return (Array.isArray(attachments) ? attachments : []).map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        kind: attachment.kind,
        size: attachment.size || 0,
        segments: Array.isArray(attachment.segments) ? attachment.segments.length : 0
    }));
}

module.exports = {
    AUDIO_MIME_TYPES,
    DOCUMENT_MIME_TYPES,
    WINSTON_ATTACHMENT_MAX_COUNT,
    WINSTON_ATTACHMENT_MAX_SEGMENTS,
    WINSTON_ATTACHMENT_MAX_TOTAL_TEXT_CHARS,
    WINSTON_AUDIO_MAX_BYTES,
    buildWinstonAttachmentContext,
    publicWinstonAttachmentReceipt,
    sanitizeWinstonAttachments
};
