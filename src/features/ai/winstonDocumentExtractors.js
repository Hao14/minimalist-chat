const MAX_EXTRACTED_CHARS = 60_000;
const MAX_SEGMENTS = 40;
const MAX_PDF_PAGES = 200;
const MAX_DOCX_ENTRIES = 2_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const EXTRACTION_TIMEOUT_MS = 25_000;

function extractionError(message, code = 'WINSTON_DOCUMENT_UNREADABLE') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanExtractedText(value) {
  return String(value || '')
    .split(String.fromCharCode(0)).join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkText(value, maxChars = 3_800) {
  const text = cleanExtractedText(value);
  if (!text) return [];
  const chunks = [];
  let remaining = text;
  while (remaining && chunks.length < MAX_SEGMENTS) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }
    const window = remaining.slice(0, maxChars + 1);
    const boundary = Math.max(
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf(' '),
    );
    const take = boundary >= Math.floor(maxChars * 0.55) ? boundary + 1 : maxChars;
    chunks.push(remaining.slice(0, take).trim());
    remaining = remaining.slice(take).trim();
  }
  return chunks.filter(Boolean);
}

function deadlinePromise(promise, startedAt) {
  const remaining = EXTRACTION_TIMEOUT_MS - (Date.now() - startedAt);
  if (remaining <= 0) return Promise.reject(extractionError('Document extraction timed out.', 'WINSTON_DOCUMENT_TIMEOUT'));
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = globalThis.setTimeout(
        () => reject(extractionError('Document extraction timed out.', 'WINSTON_DOCUMENT_TIMEOUT')),
        remaining,
      );
    }),
  ]).finally(() => globalThis.clearTimeout(timer));
}

function pdfPageText(content) {
  const parts = [];
  (Array.isArray(content?.items) ? content.items : []).forEach((item) => {
    if (typeof item?.str !== 'string') return;
    parts.push(item.str);
    parts.push(item.hasEOL ? '\n' : ' ');
  });
  return cleanExtractedText(parts.join(''));
}

async function extractPdf(bytes) {
  const startedAt = Date.now();
  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  if (!GlobalWorkerOptions.workerSrc) GlobalWorkerOptions.workerSrc = workerModule.default;

  let encrypted = false;
  let document = null;
  const loadingTask = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    isEvalSupported: false,
    stopAtErrors: true,
    useSystemFonts: true,
  });
  loadingTask.onPassword = () => {
    encrypted = true;
    loadingTask.destroy();
  };

  try {
    document = await deadlinePromise(loadingTask.promise, startedAt);
    if (encrypted) throw extractionError('Encrypted PDFs are not supported.', 'WINSTON_PDF_ENCRYPTED');
    if (!Number.isSafeInteger(document.numPages) || document.numPages <= 0) {
      throw extractionError('The PDF does not contain readable pages.');
    }
    if (document.numPages > MAX_PDF_PAGES) {
      throw extractionError(`PDFs are limited to ${MAX_PDF_PAGES} pages per request.`, 'WINSTON_PDF_PAGE_LIMIT');
    }

    const segments = [];
    let usedChars = 0;
    let truncated = false;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (segments.length >= MAX_SEGMENTS || usedChars >= MAX_EXTRACTED_CHARS) {
        truncated = true;
        break;
      }
      const page = await deadlinePromise(document.getPage(pageNumber), startedAt);
      try {
        const content = await deadlinePromise(page.getTextContent({
          disableNormalization: false,
          includeMarkedContent: false,
        }), startedAt);
        const pageChunks = chunkText(pdfPageText(content));
        for (const chunk of pageChunks) {
          if (segments.length >= MAX_SEGMENTS || usedChars >= MAX_EXTRACTED_CHARS) {
            truncated = true;
            break;
          }
          const text = chunk.slice(0, Math.min(4_000, MAX_EXTRACTED_CHARS - usedChars)).trim();
          if (!text) continue;
          segments.push({
            id: `page-${pageNumber}-${segments.length + 1}`,
            text,
            page: pageNumber,
            locator: { page: pageNumber },
          });
          usedChars += text.length;
        }
      } finally {
        page.cleanup?.();
      }
    }
    if (!segments.length) {
      throw extractionError(
        'This PDF has no extractable text. Use an OCR-enabled PDF or attach its pages as images.',
        'WINSTON_PDF_TEXT_REQUIRED',
      );
    }
    return {
      citationUnit: 'page',
      text: segments.map((segment) => segment.text).join('\n\n').slice(0, MAX_EXTRACTED_CHARS),
      segments,
      status: truncated ? 'truncated' : 'ready',
    };
  } catch (error) {
    if (encrypted || error?.name === 'PasswordException') {
      throw extractionError('Encrypted PDFs are not supported.', 'WINSTON_PDF_ENCRYPTED');
    }
    if (error?.code?.startsWith?.('WINSTON_')) throw error;
    throw extractionError('The PDF is corrupt or its text could not be extracted.');
  } finally {
    await document?.destroy?.().catch?.(() => null);
    await loadingTask.destroy?.().catch?.(() => null);
  }
}

function findZipEnd(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (
      bytes[offset] === 0x50
      && bytes[offset + 1] === 0x4b
      && bytes[offset + 2] === 0x05
      && bytes[offset + 3] === 0x06
    ) return offset;
  }
  return -1;
}

function validateDocxArchive(bytes) {
  const endOffset = findZipEnd(bytes);
  if (endOffset < 0) throw extractionError('The DOCX archive is corrupt.', 'WINSTON_DOCX_ARCHIVE_INVALID');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (!entries || entries > MAX_DOCX_ENTRIES || centralOffset + centralSize > bytes.length) {
    throw extractionError('The DOCX archive is too large or corrupt.', 'WINSTON_DOCX_ARCHIVE_INVALID');
  }

  let offset = centralOffset;
  let uncompressedTotal = 0;
  let hasDocumentXml = false;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw extractionError('The DOCX archive directory is corrupt.', 'WINSTON_DOCX_ARCHIVE_INVALID');
    }
    const flags = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if ((flags & 0x1) !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw extractionError('Encrypted or ZIP64 DOCX files are not supported.', 'WINSTON_DOCX_ENCRYPTED');
    }
    if (
      uncompressedSize > MAX_DOCX_UNCOMPRESSED_BYTES
      || (compressedSize > 0 && uncompressedSize / compressedSize > 180)
    ) {
      throw extractionError('The DOCX archive expands beyond the safe limit.', 'WINSTON_DOCX_EXPANSION_LIMIT');
    }
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw extractionError('The DOCX archive expands beyond the safe limit.', 'WINSTON_DOCX_EXPANSION_LIMIT');
    }
    const nameStart = offset + 46;
    const name = new TextDecoder('utf-8').decode(bytes.subarray(nameStart, nameStart + nameLength));
    if (name === 'word/document.xml') hasDocumentXml = true;
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  if (!hasDocumentXml) throw extractionError('The DOCX file is missing its document body.', 'WINSTON_DOCX_DOCUMENT_MISSING');
}

function docxSegments(text) {
  const lines = cleanExtractedText(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const segments = [];
  let usedChars = 0;
  for (let index = 0; index < lines.length && segments.length < MAX_SEGMENTS; index += 12) {
    const end = Math.min(lines.length, index + 12);
    const excerpt = lines.slice(index, end).join('\n').slice(0, Math.min(4_000, MAX_EXTRACTED_CHARS - usedChars)).trim();
    if (!excerpt) continue;
    segments.push({
      id: `lines-${index + 1}-${end}`,
      text: excerpt,
      lineStart: index + 1,
      lineEnd: end,
      locator: { lineStart: index + 1, lineEnd: end },
    });
    usedChars += excerpt.length;
    if (usedChars >= MAX_EXTRACTED_CHARS) break;
  }
  return {
    lines,
    segments,
    usedChars,
    truncated: segments.length >= MAX_SEGMENTS || usedChars >= MAX_EXTRACTED_CHARS,
  };
}

async function extractDocx(bytes) {
  validateDocxArchive(bytes);
  const mammothModule = await import('mammoth/mammoth.browser.min.js');
  const mammoth = mammothModule.default || mammothModule;
  let result;
  try {
    result = await deadlinePromise(
      mammoth.extractRawText({
        arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }),
      Date.now(),
    );
  } catch (error) {
    throw extractionError(
      error?.message?.toLowerCase?.().includes('encrypted')
        ? 'Encrypted DOCX files are not supported.'
        : 'The DOCX is corrupt or its text could not be extracted.',
      error?.message?.toLowerCase?.().includes('encrypted') ? 'WINSTON_DOCX_ENCRYPTED' : 'WINSTON_DOCX_UNREADABLE',
    );
  }
  if (result?.messages?.some((message) => message?.type === 'error')) {
    throw extractionError('The DOCX contains extraction errors.', 'WINSTON_DOCX_UNREADABLE');
  }
  const extracted = docxSegments(result?.value);
  if (!extracted.segments.length) {
    throw extractionError('The DOCX does not contain readable text.', 'WINSTON_DOCX_TEXT_REQUIRED');
  }
  return {
    citationUnit: 'line',
    text: extracted.segments.map((segment) => segment.text).join('\n\n').slice(0, MAX_EXTRACTED_CHARS),
    segments: extracted.segments,
    status: extracted.truncated ? 'truncated' : 'ready',
  };
}

export async function extractWinstonDocumentText(bytesValue, mimeType) {
  const bytes = bytesValue instanceof Uint8Array ? bytesValue : new Uint8Array(bytesValue || 0);
  if (!bytes.length) throw extractionError('The document is empty.');
  if (mimeType === 'application/pdf') return extractPdf(bytes);
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocx(bytes);
  }
  throw extractionError('That document type does not have a local extractor.', 'WINSTON_DOCUMENT_TYPE_UNSUPPORTED');
}
