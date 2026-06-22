// js/ai.js
// Room AI panel. Two layers:
//   1. Instant, deterministic, $0: quick stats + extractive (TextRank-lite) summary + open action items.
//   2. Optional local LLM (transformers.js in a Web Worker) for an abstractive summary — no API tokens.
import { db } from './firebase-core.js?v=30';
import { ref, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { escapeHtml } from './utils.js?v=30';

const $ = (id) => document.getElementById(id);
let aiRoomId = null;
let aiContext = null;     // last gathered context for the active room
let worker = null;
let modelReady = false;

const STOP = new Set(('a an the and or but if then is are was were be been being to of in on at for with as by from this that these those it its i you he she we they me him her them my your our their not no yes do does did have has had will would can could should just so about into out up down over under again more most some any all').split(' '));

/* ---------- Context gathering (read-once snapshots) ---------- */
async function gatherContext(roomId) {
    const msgsPath = roomId === 'global' ? 'messages' : `rooms_data/${roomId}/messages`;
    const [mSnap, tSnap, dSnap, eSnap] = await Promise.all([
        get(ref(db, msgsPath)).catch(() => null),
        get(ref(db, `room_tasks/${roomId}`)).catch(() => null),
        get(ref(db, `room_docs/${roomId}`)).catch(() => null),
        get(ref(db, `rooms_meta/${roomId}/events`)).catch(() => null),
    ]);
    const messages = Object.values(mSnap?.val() || {})
        .filter(m => m && m.text)
        .map(m => ({ name: m.name || 'Someone', text: String(m.text), at: m.timestamp || 0 }))
        .sort((a, b) => a.at - b.at);
    const tasks = Object.values(tSnap?.val() || {}).filter(Boolean);
    const docs = Object.values(dSnap?.val() || {}).filter(Boolean);
    const events = Object.values(eSnap?.val() || {}).filter(Boolean);
    return { messages, tasks, docs, events };
}

/* ---------- Deterministic stats ---------- */
function quickStats(ctx) {
    const bits = [];
    if (ctx.messages.length) {
        const counts = {};
        ctx.messages.forEach(m => { counts[m.name] = (counts[m.name] || 0) + 1; });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        bits.push(`${ctx.messages.length} messages`);
        bits.push(`${Object.keys(counts).length} participants`);
        if (top) bits.push(`most active: ${top[0]}`);
    }
    if (ctx.tasks.length) {
        const done = ctx.tasks.filter(t => t.done).length;
        bits.push(`${ctx.tasks.length} tasks (${done} done)`);
    }
    if (ctx.docs.length) bits.push(`${ctx.docs.length} docs`);
    const upcoming = ctx.events.filter(e => e.date && e.date >= new Date().toISOString().slice(0, 10)).length;
    if (upcoming) bits.push(`${upcoming} upcoming events`);
    return bits;
}

/* ---------- Extractive summary (TextRank-lite, instant) ---------- */
function buildTranscript(ctx) {
    return ctx.messages.slice(-120).map(m => `${m.name}: ${m.text}`).join('\n');
}
function extractiveSummary(ctx, n = 4) {
    const text = ctx.messages.slice(-120).map(m => m.text).join(' ');
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 25);
    if (sentences.length <= n) return sentences;
    const freq = {};
    sentences.forEach(s => s.toLowerCase().match(/[a-z']+/g)?.forEach(w => { if (!STOP.has(w) && w.length > 2) freq[w] = (freq[w] || 0) + 1; }));
    const scored = sentences.map((s, i) => {
        const words = s.toLowerCase().match(/[a-z']+/g) || [];
        const score = words.reduce((a, w) => a + (freq[w] || 0), 0) / (words.length || 1);
        return { s, i, score };
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map(x => x.s);
}

function openActionItems(ctx) {
    // Tasks are already structured, so action items are exact (no guessing).
    return ctx.tasks.filter(t => !t.done && t.text).slice(0, 8)
        .map(t => ({ text: t.text, owner: t.byName || 'Owner not specified' }));
}

/* ---------- Rendering ---------- */
function renderBase(ctx) {
    const stats = quickStats(ctx);
    const summary = extractiveSummary(ctx);
    const actions = openActionItems(ctx);
    const out = $('ai-output');
    if (!out) return;
    const empty = !ctx.messages.length && !ctx.tasks.length && !ctx.docs.length && !ctx.events.length;
    const statsCard = `
        <div class="ai-card">
            <div class="ai-card-h">Quick stats</div>
            <div class="ai-stats">${stats.map(s => `<span class="ai-chip">${escapeHtml(s)}</span>`).join('') || '—'}</div>
        </div>`;

    // Primary: Groq-backed assistant (chat + quick actions) when an endpoint is configured.
    if (window.AI_CHAT_ENDPOINT) {
        out.innerHTML = statsCard + `
            <div class="ai-card ai-ai-card">
                <div class="ai-card-h">Workspace AI <span class="ai-tag">Groq · cloud</span></div>
                <div class="ai-quick-actions">
                    <button class="ai-qa" data-q="Summarize this room. Use sections: Summary, Key Decisions, Open Questions, Next Steps.">Summarize</button>
                    <button class="ai-qa" data-q="Extract all action items. For each: owner — task — due date or priority. Use 'Owner not specified' if unknown.">Extract tasks</button>
                    <button class="ai-qa" data-q="What are the recurring topics and themes here? List the top topics with a short note on each.">Analyze patterns</button>
                    <button class="ai-qa" data-q="Summarize the upcoming events and deadlines.">Events</button>
                </div>
                <div id="ai-thread" class="ai-thread"></div>
                <form id="ai-chat-form" class="ai-chat-form">
                    <input id="ai-chat-input" type="text" placeholder="Ask anything about this room…" autocomplete="off">
                    <button type="submit" class="ai-btn ai-send" id="ai-send-btn" title="Send"><i class="ph-bold ph-paper-plane-tilt"></i></button>
                </form>
            </div>`;
        wireChat(ctx);
        return;
    }

    // Fallback (no endpoint configured): extractive summary + on-device model, fully offline.
    if (empty) { out.innerHTML = statsCard + `<div class="ai-empty">Nothing to summarize in this room yet.</div>`; return; }
    out.innerHTML = statsCard + `
        <div class="ai-card">
            <div class="ai-card-h">Summary <span class="ai-tag">extractive · instant</span></div>
            ${summary.length ? `<ul class="ai-list">${summary.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : '<div class="ai-empty">Not enough text to summarize.</div>'}
        </div>
        ${actions.length ? `<div class="ai-card">
            <div class="ai-card-h">Open action items</div>
            <ul class="ai-list">${actions.map(a => `<li>${escapeHtml(a.text)} <span class="ai-owner">— ${escapeHtml(a.owner)}</span></li>`).join('')}</ul>
        </div>` : ''}
        <div class="ai-card ai-ai-card">
            <div class="ai-card-h">AI summary <span class="ai-tag">local model · on-device</span></div>
            <div id="ai-llm-body"><button id="ai-generate-btn" class="ai-btn"><i class="ph-bold ph-cpu"></i> Generate AI summary</button>
            <div class="ai-note">First run downloads a model to your device (~250&nbsp;MB), then it's cached for next time. Runs entirely on-device — no data leaves your browser, no API cost. Slower on phones without WebGPU.</div></div>
        </div>`;
    $('ai-generate-btn')?.addEventListener('click', () => generateLLM(ctx));
}

/* ---------- Groq chat path ---------- */
let chatHistory = [];
let chatBusy = false;

function buildContextString(ctx) {
    const lines = [];
    if (ctx.messages.length) lines.push('Recent messages:\n' + ctx.messages.slice(-60).map(m => `${m.name}: ${m.text}`).join('\n'));
    if (ctx.tasks.length) lines.push('Tasks:\n' + ctx.tasks.map(t => `- [${t.done ? 'done' : 'open'}] ${t.text}${t.byName ? ' (by ' + t.byName + ')' : ''}`).join('\n'));
    if (ctx.events.length) lines.push('Events:\n' + ctx.events.map(e => `- ${(e.date || '')} ${(e.time || '')} ${(e.title || '')}`.trim()).join('\n'));
    if (ctx.docs.length) lines.push('Documents: ' + ctx.docs.map(d => d.title || 'Untitled').join(', '));
    return lines.join('\n\n');
}

// Tiny markdown so model replies (bullets/bold/headings) read cleanly without a full MD lib.
function mdLite(s) {
    let h = escapeHtml(s);
    h = h.replace(/^\s*#{1,4}\s*(.+)$/gm, '<strong>$1</strong>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/^\s*[-*•]\s+(.+)$/gm, '• $1');
    return h.replace(/\n/g, '<br>');
}

function renderThread() {
    const t = $('ai-thread');
    if (!t) return;
    t.innerHTML = chatHistory.map(m =>
        `<div class="ai-bubble ai-bubble-${m.role}">${m.role === 'assistant' ? mdLite(m.content) : escapeHtml(m.content)}</div>`
    ).join('') + (chatBusy ? `<div class="ai-bubble ai-bubble-assistant ai-typing"><span></span><span></span><span></span></div>` : '');
    t.scrollTop = t.scrollHeight;
}

async function sendPrompt(text, ctx) {
    text = (text || '').trim();
    if (!text || chatBusy) return;
    chatHistory.push({ role: 'user', content: text });
    chatBusy = true;
    renderThread();
    try {
        const r = await fetch(window.AI_CHAT_ENDPOINT, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: buildContextString(ctx), messages: chatHistory })
        });
        const data = await r.json().catch(() => ({}));
        chatBusy = false;
        chatHistory.push({ role: 'assistant', content: r.ok ? (data.reply || '(no response)') : (data.error || `Request failed (${r.status}).`) });
    } catch (e) {
        chatBusy = false;
        chatHistory.push({ role: 'assistant', content: 'Could not reach the AI service: ' + e.message });
    }
    renderThread();
}

function wireChat(ctx) {
    chatHistory = [];
    renderThread();
    const form = $('ai-chat-form'), input = $('ai-chat-input');
    form?.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; sendPrompt(v, ctx); });
    document.querySelectorAll('.ai-qa').forEach(b => b.addEventListener('click', () => sendPrompt(b.dataset.q, ctx)));
}

function setLLMBody(html) { const b = $('ai-llm-body'); if (b) b.innerHTML = html; }

/* ---------- Local LLM path ---------- */
function generateLLM(ctx) {
    const transcript = buildTranscript(ctx);
    if (!transcript.trim()) return setLLMBody(`<div class="ai-empty">No conversation text to summarize.</div>`);
    setLLMBody(`<div class="ai-progress"><div class="ai-spinner"></div><span id="ai-prog-text">${modelReady ? 'Summarizing…' : 'Loading model…'}</span></div><div class="ai-bar hidden" id="ai-bar"><div id="ai-bar-fill"></div></div>`);
    try {
        if (!worker) {
            worker = new Worker('js/ai-worker.js?v=30', { type: 'module' });
            worker.onmessage = onWorkerMessage;
            worker.onerror = (e) => setLLMBody(`<div class="ai-empty">Couldn't start the local model: ${escapeHtml(e.message || 'unknown error')}.<br>The instant summary above still works.</div>`);
        }
        worker.postMessage({ type: 'summarize', text: transcript, id: Date.now() });
    } catch (e) {
        setLLMBody(`<div class="ai-empty">Local AI isn't available on this browser: ${escapeHtml(e.message)}.<br>The instant summary above still works.</div>`);
    }
}

function onWorkerMessage(e) {
    const d = e.data || {};
    if (d.type === 'progress') {
        const bar = $('ai-bar'), fill = $('ai-bar-fill'), txt = $('ai-prog-text');
        if (bar && d.pct != null) { bar.classList.remove('hidden'); fill.style.width = d.pct + '%'; }
        if (txt) txt.textContent = `Downloading model… ${d.pct != null ? d.pct + '%' : ''}`;
    } else if (d.type === 'ready') {
        modelReady = true;
        const txt = $('ai-prog-text'); if (txt) txt.textContent = 'Summarizing…';
        const bar = $('ai-bar'); if (bar) bar.classList.add('hidden');
    } else if (d.type === 'result') {
        setLLMBody(`<div class="ai-llm-result">${escapeHtml(d.summary || '(no summary produced)')}</div>
            <button id="ai-regen-btn" class="ai-btn ai-btn-ghost"><i class="ph-bold ph-arrows-clockwise"></i> Regenerate</button>`);
        $('ai-regen-btn')?.addEventListener('click', () => generateLLM(aiContext));
    } else if (d.type === 'error') {
        setLLMBody(`<div class="ai-empty">Local model failed: ${escapeHtml(d.message)}.<br>The instant summary above still works.</div>`);
    }
}

/* ---------- Entry point (wired into the room tab loader) ---------- */
let aiWired = false;
window.loadRoomAI = async function () {
    if (!window.currentUser) return;
    if (!aiWired) { aiWired = true; $('ai-refresh-btn')?.addEventListener('click', () => window.loadRoomAI()); }
    const roomId = window.activeRoomId;
    const out = $('ai-output');
    if (out) out.innerHTML = `<div class="ai-progress"><div class="ai-spinner"></div><span>Reading room…</span></div>`;
    try {
        const ctx = await gatherContext(roomId);
        if (roomId !== window.activeRoomId) return; // switched rooms while loading
        aiRoomId = roomId;
        aiContext = ctx;
        renderBase(ctx);
    } catch (e) {
        if (out) out.innerHTML = `<div class="ai-empty">Couldn't load room data: ${escapeHtml(e.message)}</div>`;
    }
};
