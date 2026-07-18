const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const OUTPUT_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const VERSIONED_CACHE_CONTROL = 'public,max-age=31536000,immutable';
const MUTABLE_CACHE_CONTROL = 'public,max-age=300,must-revalidate';

function normalizedImageType(file) {
  const declaredType = String(file?.type || '').toLowerCase();
  if (declaredType === 'image/jpg') return 'image/jpeg';
  if (SUPPORTED_IMAGE_TYPES.has(declaredType)) return declaredType;

  const extension = String(file?.name || '').split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return declaredType;
}

function chunkName(bytes, offset) {
  if (offset + 4 > bytes.length) return '';
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function isAnimatedPng(bytes) {
  if (bytes.length < 20) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = chunkName(bytes, offset + 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += 12 + length;
  }

  return false;
}

function isAnimatedWebp(bytes) {
  if (bytes.length < 20 || chunkName(bytes, 0) !== 'RIFF' || chunkName(bytes, 8) !== 'WEBP') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const type = chunkName(bytes, offset);
    const length = view.getUint32(offset + 4, true);
    if (type === 'ANIM' || type === 'ANMF') return true;
    if (type === 'VP8X' && offset + 9 <= bytes.length && (bytes[offset + 8] & 0x02) !== 0) return true;
    offset += 8 + length + (length % 2);
  }

  return false;
}

async function isAnimatedImage(file, type) {
  if (type !== 'image/png' && type !== 'image/webp') return false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return type === 'image/png' ? isAnimatedPng(bytes) : isAnimatedWebp(bytes);
}

async function decodeWithImageElement(file) {
  if (typeof Image !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Image decoding is not available in this browser.');
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;

  try {
    if (typeof image.decode === 'function') {
      await image.decode();
    } else {
      await new Promise((resolve, reject) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', () => reject(new Error('The image could not be decoded.')), { once: true });
      });
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(url),
  };
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Safari and older webviews can reject bitmap options even when they decode the file.
    }
  }

  return decodeWithImageElement(file);
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality });
  if (typeof canvas.toBlob !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function outputFileName(name, type) {
  const extension = OUTPUT_EXTENSIONS[type] || 'img';
  const baseName = String(name || 'image').replace(/\.[^./\\]+$/, '') || 'image';
  return `${baseName}.${extension}`;
}

function fileFromBlob(blob, sourceFile) {
  const name = outputFileName(sourceFile?.name, blob.type);
  if (typeof File === 'function') {
    return new File([blob], name, {
      type: blob.type,
      lastModified: sourceFile?.lastModified || Date.now(),
    });
  }

  return blob;
}

/**
 * Shrinks a still JPEG, PNG, or WebP before upload. Unsupported and animated
 * formats, failed decodes, and encodes that are not smaller return unchanged.
 */
export async function optimizeImageForUpload(file, {
  maxWidth = 1600,
  maxHeight = 1600,
  quality = 0.84,
  minBytesToReencode = 48 * 1024,
} = {}) {
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size <= 0) return file;

  try {
    const sourceType = normalizedImageType(file);
    if (!SUPPORTED_IMAGE_TYPES.has(sourceType) || await isAnimatedImage(file, sourceType)) return file;

    const decoded = await decodeImage(file);
    try {
      if (!decoded.width || !decoded.height) return file;

      const widthLimit = Math.max(1, Number(maxWidth) || decoded.width);
      const heightLimit = Math.max(1, Number(maxHeight) || decoded.height);
      const scale = Math.min(1, widthLimit / decoded.width, heightLimit / decoded.height);
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const resized = width !== decoded.width || height !== decoded.height;
      if (!resized && file.size < minBytesToReencode) return file;

      const outputType = sourceType === 'image/png' ? 'image/webp' : sourceType;
      const canvas = createCanvas(width, height);
      const context = canvas?.getContext?.('2d', { alpha: outputType !== 'image/jpeg' });
      if (!canvas || !context) return file;

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(decoded.source, 0, 0, width, height);

      const normalizedQuality = Math.min(0.95, Math.max(0.55, quality));
      let output = await canvasToBlob(canvas, outputType, normalizedQuality);
      if (resized && output?.size >= file.size && normalizedQuality > 0.6) {
        output = await canvasToBlob(canvas, outputType, Math.max(0.55, normalizedQuality - 0.16));
      }
      if (!output || output.size <= 0 || output.size >= file.size) return file;
      if (!resized && output.size > file.size * 0.98) return file;
      return fileFromBlob(output, file);
    } finally {
      decoded.close();
    }
  } catch {
    return file;
  }
}

export function imageUploadMetadata(file, { versioned = false } = {}) {
  return {
    contentType: String(file?.type || 'application/octet-stream'),
    cacheControl: versioned ? VERSIONED_CACHE_CONTROL : MUTABLE_CACHE_CONTROL,
  };
}
