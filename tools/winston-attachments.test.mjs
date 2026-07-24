import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildWinstonAttachmentContext,
  sanitizeWinstonAttachments,
} = require('../functions/ai-winston-attachments.js');

test('document attachments retain bounded page, row, line, and timestamp evidence', () => {
  const attachments = sanitizeWinstonAttachments([
    {
      id: 'document-1',
      name: 'launch.csv',
      mimeType: 'text/csv',
      kind: 'document',
      size: 120,
      segments: [
        { text: 'Owner,Date\nAvery,2026-08-01', rowStart: 1, rowEnd: 2 },
        { text: 'Approved', page: 3 },
      ],
    },
  ]);
  const context = buildWinstonAttachmentContext(attachments, { roomId: 'global' });
  assert.equal(attachments.length, 1);
  assert.equal(context.sources.length, 2);
  assert.match(context.sources[0].label, /rows 1-2/);
  assert.match(context.sources[1].label, /page 3/);
  assert.match(context.context, /\[S1\]/);
});

test('audio is magic-byte validated and raw binary never appears in citations', () => {
  const wav = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('WAVEfmt ', 'ascii'),
    Buffer.alloc(24),
  ]).toString('base64');
  const attachments = sanitizeWinstonAttachments([{
    id: 'audio-1',
    name: 'meeting.wav',
    mimeType: 'audio/wav',
    kind: 'audio',
    data: wav,
  }]);
  assert.equal(attachments[0].kind, 'audio');
  assert.throws(
    () => sanitizeWinstonAttachments([{
      name: 'fake.wav',
      mimeType: 'audio/wav',
      kind: 'audio',
      data: Buffer.from('not audio').toString('base64'),
    }]),
    /do not match/,
  );
  assert.equal(buildWinstonAttachmentContext(attachments).sources.length, 0);
});

test('attachment limits fail closed instead of silently dropping files', () => {
  assert.throws(
    () => sanitizeWinstonAttachments(Array.from({ length: 7 }, (_, index) => ({
      name: `${index}.txt`,
      mimeType: 'text/plain',
      text: 'safe',
    }))),
    /up to 6 files/,
  );
  assert.throws(
    () => sanitizeWinstonAttachments([{
      name: 'empty.pdf',
      mimeType: 'application/pdf',
    }]),
    /readable extracted text/,
  );
});
