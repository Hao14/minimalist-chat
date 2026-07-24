import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { normalizeAiSources, openAiSourceContext } from '../src/features/ai/aiAgentUi.js';
import {
  getWinstonKnowledgeIndexStatus,
  syncWinstonKnowledgeIndex,
} from '../src/features/ai/winstonServices.js';
import {
  applyWinstonPlanCommand,
  buildWinstonAdvancedRequestFields,
  buildWinstonPlanCommandPayload,
  createWinstonPlan,
  loadLocalWinstonPlans,
  normalizeWinstonContextSelection,
  normalizeWinstonPlan,
  prepareWinstonAttachment,
  prepareWinstonAttachments,
  resolveWinstonAttachmentType,
  saveLocalWinstonPlans,
  serializeWinstonAttachments,
  winstonContextSelectionPreview,
} from '../src/features/ai/winstonAdvancedServices.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function fakeFile(name, type, value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
  return {
    name,
    type,
    size: bytes.byteLength,
    lastModified: 1,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function simplePdf(text = 'Hello Winston') {
  const safeText = String(text).replace(/[()\\]/g, (character) => `\\${character}`);
  const stream = `BT /F1 14 Tf 72 720 Td (${safeText}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

test('context selection is explicit, bounded, and date-safe', () => {
  const selection = normalizeWinstonContextSelection({
    roomIds: [...Array.from({ length: 10 }, (_, index) => `room-${index}`), '../bad'],
    documentIds: Array.from({ length: 20 }, (_, index) => `doc-${index}`),
    personIds: Array.from({ length: 20 }, (_, index) => `person-${index}`),
    dateRange: { from: '2026-08-01', to: '2026-08-31' },
    includeCurrentRoom: false,
    includeMemories: false,
    includeFullHistory: true,
  });
  assert.equal(selection.roomIds.length, 8);
  assert.equal(selection.documentIds.length, 12);
  assert.equal(selection.personIds.length, 12);
  assert.deepEqual(selection.dateRange, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(selection.includeCurrentRoom, false);
  assert.equal(selection.includeMemories, false);
  assert.equal(selection.includeFullHistory, true);

  assert.equal(normalizeWinstonContextSelection({
    dateRange: { from: '2026-09-02', to: '2026-09-01' },
  }).dateRange, null);
});

test('context preview resolves labels without leaking unselected options', () => {
  const preview = winstonContextSelectionPreview({
    roomIds: ['room-a'],
    documentIds: ['doc-a'],
    personIds: ['person-a'],
    includeCurrentRoom: true,
    includeMemories: false,
  }, {
    rooms: [{ id: 'room-a', name: 'Launch room' }, { id: 'room-b', name: 'Private room' }],
    documents: [{ id: 'doc-a', title: 'Launch brief' }],
    people: [{ id: 'person-a', displayName: 'Avery' }],
  });
  assert.deepEqual(preview.map((entry) => entry.label), [
    'Current room',
    'Launch room',
    'Launch brief',
    'Avery',
  ]);
  assert.equal(preview.some((entry) => entry.label === 'Private room'), false);
});

test('knowledge index sync resumes the server cursor and reports bounded progress', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const bodies = [];
  const progress = [];
  globalThis.window = {
    currentUser: { uid: 'index-user', getIdToken: async () => 'token' },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (body.action === 'knowledge-index-status') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          indexed: 23,
          activeSyncId: '',
          lastCompletedSync: { id: 'sync-old', roomIds: ['room-a'], completedAt: 500 },
        }),
      };
    }
    return {
      ok: true,
      status: body.syncId ? 200 : 202,
      json: async () => body.syncId
        ? { syncId: 'sync-1', status: 'completed', complete: true, processed: 12, upserted: 4, indexed: 23 }
        : { syncId: 'sync-1', status: 'running', complete: false, processed: 6, upserted: 2, progress: 0.5 },
    };
  };
  try {
    const result = await syncWinstonKnowledgeIndex({
      config: { gatewayEndpoint: 'https://gateway.example.test' },
      selectedRoomIds: ['room-a', 'room-a'],
      onProgress: (entry) => progress.push(entry),
    });
    assert.equal(result.complete, true);
    assert.equal(progress.length, 2);
    assert.deepEqual(bodies.slice(0, 2), [
      { action: 'knowledge-index-sync', selectedRoomIds: ['room-a'] },
      { action: 'knowledge-index-sync', selectedRoomIds: ['room-a'], syncId: 'sync-1' },
    ]);
    const status = await getWinstonKnowledgeIndexStatus({
      config: { gatewayEndpoint: 'https://gateway.example.test' },
    });
    assert.equal(status.indexed, 23);
    assert.equal(status.lastCompletedSync.id, 'sync-old');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test('plan shapes and storage stay bounded', () => {
  const plan = normalizeWinstonPlan({
    id: 'plan-1',
    title: 'Launch',
    steps: Array.from({ length: 20 }, (_, index) => ({
      id: `step-${index}`,
      title: `Step ${index}`,
      status: 'awaiting_confirmation',
    })),
  });
  assert.equal(plan.steps.length, 12);

  const storage = memoryStorage();
  saveLocalWinstonPlans(Array.from({ length: 20 }, (_, index) => ({
    ...plan,
    id: `plan-${index}`,
    updatedAt: index,
  })), storage);
  assert.equal(loadLocalWinstonPlans(storage).length, 12);
});

test('descriptive plan steps can complete and reopen, typed actions cannot claim undo', () => {
  const descriptive = createWinstonPlan({
    title: 'Prepare launch',
    steps: [{ id: 'draft', title: 'Draft the note' }],
  });
  const completed = applyWinstonPlanCommand(descriptive, {
    stepId: 'draft',
    command: 'complete-step',
  });
  assert.equal(completed.steps[0].status, 'completed');
  assert.equal(completed.steps[0].canUndo, true);
  const reopened = applyWinstonPlanCommand(completed, { stepId: 'draft', command: 'undo' });
  assert.equal(reopened.steps[0].status, 'pending');

  const typed = normalizeWinstonPlan({
    id: 'typed-plan',
    title: 'Create event',
    steps: [{
      id: 'event-step',
      title: 'Create the event',
      requiresConfirmation: true,
      status: 'awaiting_confirmation',
      canUndo: true,
    }],
  });
  assert.equal(applyWinstonPlanCommand(typed, {
    stepId: 'event-step',
    command: 'complete-step',
  }).steps[0].status, 'awaiting_confirmation');
  assert.equal(applyWinstonPlanCommand({
    ...typed,
    steps: [{ ...typed.steps[0], status: 'completed', canUndo: true }],
  }, {
    stepId: 'event-step',
    command: 'undo',
  }).steps[0].status, 'completed');
});

test('plan command payload uses the server allowlist', () => {
  assert.deepEqual(buildWinstonPlanCommandPayload('plan-1', 'step-1', 'confirm-step'), {
    action: 'plan-command',
    planId: 'plan-1',
    stepId: 'step-1',
    command: 'confirm-step',
  });
  assert.throws(
    () => buildWinstonPlanCommandPayload('plan-1', 'step-1', 'delete-everything'),
    /invalid/i,
  );
});

test('local text and CSV attachments carry bounded text with line or row citations', async () => {
  const text = await prepareWinstonAttachment(fakeFile(
    'notes.md',
    'text/markdown',
    '# Launch\nOwner: Avery\nDue Friday',
  ));
  assert.equal(text.kind, 'text');
  assert.equal(text.citationUnit, 'line');
  assert.equal(text.extraction.status, 'ready');
  assert.deepEqual(text.extraction.segments[0].locator, { lineStart: 1, lineEnd: 3 });

  const csv = await prepareWinstonAttachment(fakeFile(
    'owners.csv',
    'text/csv',
    'name,note\nAvery,"first line\nsecond line"\nSam,review',
  ));
  assert.equal(csv.citationUnit, 'row');
  assert.deepEqual(csv.extraction.segments[0].locator, { rowStart: 1, rowEnd: 3 });
  const outbound = serializeWinstonAttachments([text, csv]);
  assert.equal(outbound.every((attachment) => attachment.text && !attachment.data && !attachment.document), true);
});

test('PDF and audio payloads are explicitly typed and signature checked', async () => {
  const pdf = await prepareWinstonAttachment(fakeFile(
    'brief.pdf',
    'application/pdf',
    simplePdf('Launch review is Friday'),
  ));
  assert.equal(pdf.kind, 'document');
  assert.equal(pdf.citationUnit, 'page');
  assert.match(pdf.text, /Launch review is Friday/);
  assert.equal(pdf.extraction.segments[0].page, 1);
  assert.equal(Object.hasOwn(pdf, 'document'), false);
  assert.equal(Object.hasOwn(pdf, 'data'), false);

  const audio = await prepareWinstonAttachment(fakeFile(
    'meeting.mp3',
    'audio/mpeg',
    new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]),
  ));
  assert.equal(audio.kind, 'audio');
  assert.equal(audio.citationUnit, 'timestamp');
  assert.ok(audio.data);

  await assert.rejects(
    prepareWinstonAttachment(fakeFile('fake.pdf', 'application/pdf', 'not a pdf')),
    /does not match/i,
  );
});

test('DOCX extraction is local, bounded, and never forwards archive bytes', async () => {
  const bytes = new Uint8Array(await readFile(new URL(
    '../node_modules/mammoth/test/test-data/single-paragraph.docx',
    import.meta.url,
  )));
  const docx = await prepareWinstonAttachment(fakeFile(
    'single-paragraph.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes,
  ));
  assert.equal(docx.kind, 'document');
  assert.equal(docx.citationUnit, 'line');
  assert.ok(docx.text.length > 0);
  assert.equal(docx.extraction.status, 'ready');
  assert.equal(Object.hasOwn(docx, 'document'), false);
  assert.equal(Object.hasOwn(docx, 'data'), false);
  const [outbound] = serializeWinstonAttachments([docx]);
  assert.equal(outbound.text, docx.text);
  assert.equal(Object.hasOwn(outbound, 'document'), false);
});

test('attachment type resolution accepts known empty MIME extensions but rejects mismatches', () => {
  assert.equal(resolveWinstonAttachmentType({ name: 'readme.md', type: '' }).mimeType, 'text/markdown');
  assert.equal(resolveWinstonAttachmentType({ name: 'payload.exe', type: 'application/octet-stream' }), null);
  assert.equal(resolveWinstonAttachmentType({ name: 'photo.png', type: 'application/pdf' }).mimeType, 'application/pdf');
});

test('attachment batches reject count overflow before reading files', async () => {
  const files = Array.from({ length: 7 }, (_, index) => fakeFile(`note-${index}.txt`, 'text/plain', 'hello'));
  await assert.rejects(prepareWinstonAttachments(files), /up to 6 files/i);
});

test('advanced request fields keep singular image compatibility without duplicating other raw files', () => {
  const image = {
    id: 'image-1',
    name: 'photo.png',
    mimeType: 'image/png',
    kind: 'image',
    size: 4,
    image: 'iVBORw==',
    citationUnit: 'image',
    extraction: { status: 'ready', segments: [] },
  };
  const imageRequest = buildWinstonAdvancedRequestFields({
    attachments: [image],
    contextSelection: { includeCurrentRoom: false, includeMemories: false },
  });
  assert.equal(imageRequest.attachments.length, 1);
  assert.deepEqual(imageRequest.attachment, {
    name: 'photo.png',
    mimeType: 'image/png',
    image: 'iVBORw==',
  });

  const textRequest = buildWinstonAdvancedRequestFields({
    attachments: [{
      id: 'text-1',
      name: 'notes.txt',
      mimeType: 'text/plain',
      kind: 'text',
      size: 5,
      text: 'hello',
      citationUnit: 'line',
      extraction: { status: 'ready', segments: [] },
    }],
  });
  assert.equal(Object.hasOwn(textRequest, 'attachment'), false);
  assert.equal(Object.hasOwn(textRequest.attachments[0], 'data'), false);
});

test('file and audio citations keep bounded locators and remain inline', () => {
  const [file, audio] = normalizeAiSources([
    {
      id: 'F1',
      type: 'file',
      attachmentId: 'attachment-1',
      label: 'Brief',
      locator: { page: 4 },
    },
    {
      id: 'A1',
      type: 'audio',
      attachmentId: 'attachment-2',
      label: 'Meeting',
      locator: { startSeconds: 125, endSeconds: 140 },
    },
  ]);
  assert.deepEqual(file.locator, { page: 4 });
  assert.deepEqual(audio.locator, { startSeconds: 125, endSeconds: 140 });

  const outcome = openAiSourceContext(file, {
    dispatchEvent() { return true; },
    CustomEvent: class CustomEvent {
      constructor(type, options) { this.type = type; this.detail = options.detail; }
    },
  }, {});
  assert.deepEqual(outcome, { opened: true, exact: false });
});
