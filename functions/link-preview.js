'use strict';

const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');

const LINK_PREVIEW_MAX_URL_LENGTH = 2048;
const LINK_PREVIEW_MAX_HTML_BYTES = 256 * 1024;
const LINK_PREVIEW_TIMEOUT_MS = 5_000;
const LINK_PREVIEW_MAX_REDIRECTS = 2;
const LINK_PREVIEW_CACHE_TTL_MS = 15 * 60 * 1000;
const LINK_PREVIEW_CACHE_LIMIT = 400;

const NON_GLOBAL_LINK_ADDRESSES = new net.BlockList();
[
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
].forEach(([network, prefix]) => NON_GLOBAL_LINK_ADDRESSES.addSubnet(network, prefix, 'ipv4'));
[
    ['2001:0::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
].forEach(([network, prefix]) => NON_GLOBAL_LINK_ADDRESSES.addSubnet(network, prefix, 'ipv6'));

const previewCache = new Map();

function linkPreviewError(message, code, status = 400) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function isPrivateLinkPreviewAddress(address = '') {
    const value = String(address || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    const family = net.isIP(value);
    if (family === 4) return NON_GLOBAL_LINK_ADDRESSES.check(value, 'ipv4');
    if (family !== 6) return true;

    const firstHextet = Number.parseInt(value.split(':')[0] || '0', 16);
    if (!Number.isInteger(firstHextet) || firstHextet < 0x2000 || firstHextet > 0x3fff) return true;
    return NON_GLOBAL_LINK_ADDRESSES.check(value, 'ipv6');
}

async function resolveLinkPreviewTarget(rawUrl, { lookup = dns.lookup } = {}) {
    const candidate = String(rawUrl || '').trim();
    if (!candidate || candidate.length > LINK_PREVIEW_MAX_URL_LENGTH) {
        throw linkPreviewError('Invalid preview URL.', 'invalid_url');
    }

    let parsed;
    try {
        parsed = new URL(candidate);
    } catch {
        throw linkPreviewError('Invalid preview URL.', 'invalid_url');
    }

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
        throw linkPreviewError('Preview URLs must use HTTPS without credentials or custom ports.', 'unsafe_target');
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
        !hostname
        || hostname === 'localhost'
        || hostname === 'metadata.google.internal'
        || hostname.endsWith('.localhost')
        || hostname.endsWith('.local')
        || hostname.endsWith('.internal')
        || hostname.endsWith('.home.arpa')
    ) {
        throw linkPreviewError('Preview URL host is not allowed.', 'unsafe_target');
    }

    if (isPrivateLinkPreviewAddress(hostname)) {
        throw linkPreviewError('Preview URL cannot target a private network address.', 'unsafe_target');
    }

    let records;
    try {
        const literalFamily = net.isIP(hostname);
        records = literalFamily
            ? [{ address: hostname, family: literalFamily }]
            : await lookup(hostname, { all: true, verbatim: true });
    } catch (cause) {
        const error = linkPreviewError('Preview URL host could not be resolved.', 'dns_failed');
        error.cause = cause;
        throw error;
    }

    if (!records.length || records.some((record) => isPrivateLinkPreviewAddress(record.address))) {
        throw linkPreviewError('Preview URL resolved to a private network address.', 'unsafe_target');
    }

    const selected = records.find((record) => record.family === 4) || records[0];
    return {
        url: parsed.toString(),
        hostname,
        address: selected.address,
        family: selected.family,
    };
}

function decodeHtmlEntities(value = '') {
    const named = {
        amp: '&', apos: "'", gt: '>', hellip: '…', lt: '<', nbsp: ' ', quot: '"',
    };
    return String(value || '')
        .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Math.min(Number(code) || 0, 0x10ffff)))
        .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Math.min(Number.parseInt(code, 16) || 0, 0x10ffff)))
        .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function cleanPreviewText(value = '', maxLength = 280) {
    return decodeHtmlEntities(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function metaAttributes(tag = '') {
    const attributes = {};
    const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    for (const match of tag.matchAll(pattern)) {
        attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    return attributes;
}

function extractLinkPreviewMetadata(html = '', finalUrl = '') {
    const parsed = new URL(finalUrl);
    const metadata = new Map();
    for (const tag of String(html || '').match(/<meta\b[^>]*>/gi) || []) {
        const attributes = metaAttributes(tag);
        const key = String(attributes.property || attributes.name || '').toLowerCase();
        if (key && attributes.content && !metadata.has(key)) metadata.set(key, attributes.content);
    }

    const titleMatch = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const domain = parsed.hostname.replace(/^www\./i, '').slice(0, 120);
    const title = cleanPreviewText(
        metadata.get('og:title') || metadata.get('twitter:title') || titleMatch?.[1] || domain,
        180,
    ) || domain;
    const description = cleanPreviewText(
        metadata.get('og:description') || metadata.get('twitter:description') || metadata.get('description') || '',
        280,
    );

    return {
        url: parsed.toString(),
        domain,
        title,
        description,
    };
}

function requestLinkPreviewDocument(target, timeoutMs = LINK_PREVIEW_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(target.url);
        let settled = false;
        let request;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback(value);
        };
        const timer = setTimeout(() => {
            const error = linkPreviewError('Preview request timed out.', 'timeout', 504);
            error.name = 'AbortError';
            request?.destroy(error);
        }, timeoutMs);

        request = https.request(parsed, {
            method: 'GET',
            headers: {
                Accept: 'text/html,application/xhtml+xml;q=0.9',
                Connection: 'close',
                'User-Agent': 'Minimalist.chat Link Preview/1.0',
            },
            rejectUnauthorized: true,
            servername: net.isIP(target.hostname) ? undefined : target.hostname,
            lookup: (_hostname, lookupOptions, callback) => {
                if (lookupOptions?.all) {
                    callback(null, [{ address: target.address, family: target.family }]);
                    return;
                }
                callback(null, target.address, target.family);
            },
        }, (response) => {
            const status = Number(response.statusCode || 0);
            const location = String(response.headers.location || '');
            if (status >= 300 && status < 400) {
                response.destroy();
                finish(resolve, { status, location, contentType: '', html: '' });
                return;
            }
            if (status < 200 || status >= 300) {
                response.destroy();
                finish(reject, linkPreviewError(`Preview target returned ${status || 'an error'}.`, 'receiver_error', 502));
                return;
            }

            const contentType = String(response.headers['content-type'] || '').toLowerCase();
            if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
                response.destroy();
                finish(reject, linkPreviewError('Preview target did not return HTML.', 'unsupported_content', 415));
                return;
            }

            const chunks = [];
            let bytes = 0;
            response.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > LINK_PREVIEW_MAX_HTML_BYTES) {
                    response.destroy(linkPreviewError('Preview document is too large.', 'response_too_large', 413));
                    return;
                }
                chunks.push(chunk);
            });
            response.once('end', () => finish(resolve, {
                status,
                location: '',
                contentType,
                html: Buffer.concat(chunks).toString('utf8'),
            }));
            response.once('error', (error) => finish(reject, error));
        });
        request.once('error', (error) => finish(reject, error));
        request.end();
    });
}

async function fetchSafeLinkPreview(rawUrl, options = {}) {
    const now = Number(options.now || Date.now());
    const initial = await resolveLinkPreviewTarget(rawUrl, options);
    const cached = previewCache.get(initial.url);
    if (cached && now - cached.cachedAt < LINK_PREVIEW_CACHE_TTL_MS) return cached.preview;

    let target = initial;
    for (let redirects = 0; redirects <= LINK_PREVIEW_MAX_REDIRECTS; redirects += 1) {
        const response = await (options.request || requestLinkPreviewDocument)(target);
        if (response.status >= 300 && response.status < 400) {
            if (!response.location || redirects === LINK_PREVIEW_MAX_REDIRECTS) {
                throw linkPreviewError('Preview target redirected too many times.', 'redirect_blocked', 400);
            }
            const nextUrl = new URL(response.location, target.url).toString();
            target = await resolveLinkPreviewTarget(nextUrl, options);
            continue;
        }

        const preview = extractLinkPreviewMetadata(response.html, target.url);
        previewCache.set(initial.url, { preview, cachedAt: now });
        if (previewCache.size > LINK_PREVIEW_CACHE_LIMIT) previewCache.delete(previewCache.keys().next().value);
        return preview;
    }
    throw linkPreviewError('Preview target redirected too many times.', 'redirect_blocked', 400);
}

module.exports = {
    extractLinkPreviewMetadata,
    fetchSafeLinkPreview,
    isPrivateLinkPreviewAddress,
    resolveLinkPreviewTarget,
};
