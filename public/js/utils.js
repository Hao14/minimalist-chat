// js/utils.js
// Small shared helpers used across modules.

// Escape a string for safe insertion into HTML (text or double-quoted attributes).
export const escapeHtml = (s) =>
    (s ?? '').toString().replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

// Normalize a user-supplied URL so it always has a protocol (prevents
// "javascript:" and relative-path surprises by forcing http/https).
export const safeUrl = (u) => {
    u = (u || '').trim();
    if (!u) return '#';
    return /^https?:\/\//i.test(u) ? u : 'https://' + u;
};
