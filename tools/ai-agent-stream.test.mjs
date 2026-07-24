import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { consumeOllamaChatStream, parseOllamaStreamLine } = require('../functions/ai-agent-stream.js');

function streamResponse(chunks) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    body: new ReadableStream({
      pull(controller) {
        if (index >= chunks.length) return controller.close();
        controller.enqueue(encoder.encode(chunks[index++]));
      }
    })
  };
}

test('Ollama NDJSON records are parsed without logging prompts', () => {
  assert.deepEqual(parseOllamaStreamLine('{"model":"qwen","message":{"content":"Hi"},"done":false}'), {
    content: 'Hi', done: false, model: 'qwen'
  });
  assert.throws(() => parseOllamaStreamLine('{bad json'), /malformed streaming JSON/i);
  assert.throws(() => parseOllamaStreamLine('{"error":"failed"}'), /stream failed/i);
});

test('queued local token stream yields genuine cumulative partial replies', async () => {
  const partials = [];
  const result = await consumeOllamaChatStream(streamResponse([
    '{"model":"qwen3:4b-instruct","message":{"content":"Hello"},"done":false}\n',
    '{"model":"qwen3:4b-instruct","message":{"content":" world"},"done":false}\n',
    '{"model":"qwen3:4b-instruct","message":{"content":""},"done":true}\n'
  ]), { onPartial: async (partial) => partials.push(partial) });
  assert.equal(result.reply, 'Hello world');
  assert.equal(result.model, 'qwen3:4b-instruct');
  assert.deepEqual(partials, ['Hello', 'Hello world']);
});

test('stream parser handles records split across transport chunks', async () => {
  const result = await consumeOllamaChatStream(streamResponse([
    '{"message":{"content":"split',
    ' record"},"done":false}\n'
  ]));
  assert.equal(result.reply, 'split record');
});
