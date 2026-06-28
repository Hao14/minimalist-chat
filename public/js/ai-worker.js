// js/ai-worker.js
// Runs a local summarization model fully in-browser via transformers.js (no API, no tokens billed).
// The model (~120 MB quantized) downloads from the HF CDN on first use and is cached by the browser
// afterward. Kept in a Web Worker so generation never freezes the UI.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';

env.allowLocalModels = false;      // fetch weights from the Hugging Face CDN
env.useBrowserCache = true;        // cache them after the first download

const MODEL = 'Xenova/distilbart-cnn-6-6'; // distilled BART, decent quality at a mobile-friendly size
let summarizer = null;
let loading = null;

function post(type, payload) { self.postMessage({ type, ...payload }); }

// Load the pipeline once. Try WebGPU (fast) and fall back to WASM (slow but universal).
async function getSummarizer() {
    if (summarizer) return summarizer;
    if (loading) return loading;
    loading = (async () => {
        const progress = (p) => {
            if (p.status === 'progress' && p.file) {
                post('progress', { file: p.file, loaded: p.loaded, total: p.total, pct: p.total ? Math.round((p.loaded / p.total) * 100) : null });
            } else if (p.status) {
                post('status', { status: p.status, file: p.file || '' });
            }
        };
        const haveGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
        // q8 quantization makes distilbart produce gibberish; use full precision on WASM and fp16 on WebGPU.
        try {
            summarizer = await pipeline('summarization', MODEL, { dtype: haveGPU ? 'fp16' : 'fp32', device: haveGPU ? 'webgpu' : 'wasm', progress_callback: progress });
        } catch (e) {
            // WebGPU can be present but unusable; retry on WASM (fp32) before giving up.
            summarizer = await pipeline('summarization', MODEL, { dtype: 'fp32', device: 'wasm', progress_callback: progress });
        }
        return summarizer;
    })();
    return loading;
}

self.onmessage = async (e) => {
    const { type, text, id } = e.data || {};
    if (type !== 'summarize') return;
    try {
        const model = await getSummarizer();
        post('ready', {});
        // distilbart handles ~1024 input tokens; keep the prompt well under that.
        const input = String(text || '').slice(-3500);
        const out = await model(input, { max_new_tokens: 140, min_new_tokens: 30, no_repeat_ngram_size: 3, do_sample: false });
        post('result', { id, summary: (out?.[0]?.summary_text || '').trim() });
    } catch (err) {
        post('error', { id, message: err?.message || String(err) });
    }
};
