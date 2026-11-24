const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');

const MAX_PDF_BYTES = 6 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BASE64_CHARS = Math.ceil(MAX_SOURCE_IMAGE_BYTES / 3) * 4;
const MAX_IMAGE_DIMENSION = 2200;
const MAX_TOTAL_IMAGE_PIXELS = 42 * 1024 * 1024;
const SUBMIT_TIMEOUT_SECONDS = 120;
const CLEANUP_SAFETY_MS = 30 * 1000;

const optionalString = (value, maxLength) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;

const requireString = (value, fieldName, maxLength) => {
  const normalized = optionalString(value, maxLength);
  if (!normalized) {
    throw new HttpsError('invalid-argument', `${fieldName} es obligatorio.`);
  }
  return normalized;
};

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const readJpegDimensions = buffer => {
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error('invalid JPEG marker');
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) throw new Error('truncated JPEG segment');
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      throw new Error('invalid JPEG segment');
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) throw new Error('invalid JPEG frame');
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    if (marker === 0xda) break;
    offset += segmentLength;
  }
  throw new Error('JPEG dimensions not found');
};

const decodeJpegPages = (values, expectedPageCount) => {
  if (!Array.isArray(values) || values.length !== expectedPageCount) {
    throw new HttpsError(
      'invalid-argument',
      'Las páginas procesadas no coinciden con la cantidad declarada.'
    );
  }
  let totalBytes = 0;
  let totalPixels = 0;
  const pages = values.map(value => {
    const encoded = typeof value === 'string' ? value.trim() : '';
    if (encoded.length > MAX_SOURCE_IMAGE_BASE64_CHARS) {
      throw new HttpsError(
        'invalid-argument',
        `Las páginas deben pesar como máximo ${MAX_SOURCE_IMAGE_BYTES / 1024 / 1024} MB.`
      );
    }
    if (!encoded || encoded.length % 4 !== 0 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) {
      throw new HttpsError('invalid-argument', 'Una página no es JPEG válida.');
    }
    const buffer = Buffer.from(encoded, 'base64');
    totalBytes += buffer.length;
    if (totalBytes > MAX_SOURCE_IMAGE_BYTES) {
      throw new HttpsError(
        'invalid-argument',
        `Las páginas deben pesar como máximo ${MAX_SOURCE_IMAGE_BYTES / 1024 / 1024} MB.`
      );
    }
    if (
      buffer.length < 4 ||
      buffer[0] !== 0xff ||
      buffer[1] !== 0xd8 ||
      buffer[buffer.length - 2] !== 0xff ||
      buffer[buffer.length - 1] !== 0xd9
    ) {
      throw new HttpsError('invalid-argument', 'Una página no es JPEG válida.');
    }
    try {
      const { width, height } = readJpegDimensions(buffer);
      totalPixels += width * height;
      if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        throw new Error('JPEG dimensions exceed scanner limits');
      }
    } catch (_error) {
      throw new HttpsError(
        'invalid-argument',
        `Cada página JPEG debe medir como máximo ${MAX_IMAGE_DIMENSION} px por lado.`
      );
    }
    if (totalPixels > MAX_TOTAL_IMAGE_PIXELS) {
      throw new HttpsError(
        'invalid-argument',
        'El documento supera el límite total de resolución permitido.'
      );
    }
    return buffer;
  });
  if (!totalBytes || totalBytes > MAX_SOURCE_IMAGE_BYTES) {
    throw new HttpsError(
      'invalid-argument',
      `Las páginas deben pesar como máximo ${MAX_SOURCE_IMAGE_BYTES / 1024 / 1024} MB.`
    );
  }
  return pages;
};

const buildImageOnlyPdf = async pageBuffers => {
  try {
    // Scanner PDF generation is optional. Keep pdf-lib out of the process
    // startup graph so unrelated callables do not pay its initialization cost.
    const { PDFDocument } = require('pdf-lib');
    const pdf = await PDFDocument.create();
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 17;
    for (const pageBuffer of pageBuffers) {
      const image = await pdf.embedJpg(pageBuffer.toString('base64'));
      const scale = Math.min(
        (pageWidth - margin * 2) / image.width,
        (pageHeight - margin * 2) / image.height
      );
      const width = image.width * scale;
      const height = image.height * scale;
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, {
        x: (pageWidth - width) / 2,
        y: (pageHeight - height) / 2,
        width,
        height,
      });
    }
    const result = Buffer.from(await pdf.save());
    if (!result.length || result.length > MAX_PDF_BYTES) {
      throw new Error('generated PDF exceeds the queue limit');
    }
    return result;
  } catch (_error) {
    throw new HttpsError(
      'invalid-argument',
      'No se pudo construir un PDF seguro con las páginas recibidas.'
    );
  }
};

const resolveSubmissionIdentity = value => {
  const key = requireString(value, 'La clave de envío', 128);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) {
    throw new HttpsError('invalid-argument', 'La clave de envío no es válida.');
  }
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { id: `scan_${hash.slice(0, 32)}`, hash };
};

const resolveCleanupNotBefore = (record, nowMs = Date.now()) => {
  const uploadStartedAtMs = new Date(record.uploadStartedAt || record.createdAt || 0).getTime();
  if (!Number.isFinite(uploadStartedAtMs) || uploadStartedAtMs <= 0) {
    return new Date(nowMs + SUBMIT_TIMEOUT_SECONDS * 1000 + CLEANUP_SAFETY_MS).toISOString();
  }
  return new Date(
    uploadStartedAtMs + SUBMIT_TIMEOUT_SECONDS * 1000 + CLEANUP_SAFETY_MS
  ).toISOString();
};

const createSubmissionPayloadHash = ({
  requestDate,
  sourceDate,
  patientOptionKey,
  patientRut,
  pageCount,
  pageBuffers,
}) => {
  const digest = crypto.createHash('sha256').update(
    JSON.stringify({
      requestDate,
      sourceDate,
      patientOptionKey,
      patientRut,
      pageCount,
    })
  );
  for (const pageBuffer of pageBuffers) digest.update(pageBuffer);
  return digest.digest('hex');
};

const requireMatchingSubmissionPayload = (record, submissionPayloadHash) => {
  if (record?.submissionPayloadHash === submissionPayloadHash) return;
  throw new HttpsError(
    'already-exists',
    'La clave de envío ya corresponde a otro documento o paciente. Inicia un nuevo escaneo.'
  );
};

const resolvePdfDownloadUrl = async (storage, storagePath) => {
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);
  const emulatorHost = optionalString(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 255);
  if (process.env.FUNCTIONS_EMULATOR === 'true' || emulatorHost) {
    const effectiveHost = emulatorHost || '127.0.0.1:9199';
    const normalizedHost = effectiveHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const [metadata = {}] = await file.getMetadata();
    let downloadCapability = optionalString(metadata.metadata?.firebaseStorageDownloadTokens, 128);
    if (!downloadCapability) {
      downloadCapability = crypto.randomUUID();
      await file.setMetadata({
        metadata: {
          ...(metadata.metadata || {}),
          firebaseStorageDownloadTokens: downloadCapability,
        },
      });
    }
    return `http://${normalizedHost}/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(
      storagePath
    )}?alt=media&token=${encodeURIComponent(downloadCapability)}`;
  }
  if (typeof file.getSignedUrl !== 'function') return null;
  try {
    const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
    return url;
  } catch (_error) {
    console.warn('[document-scanner] failed to create temporary download URL');
    return null;
  }
};

module.exports = {
  SUBMIT_TIMEOUT_SECONDS,
  buildImageOnlyPdf,
  createSubmissionPayloadHash,
  decodeJpegPages,
  optionalString,
  requireMatchingSubmissionPayload,
  requireString,
  resolveCleanupNotBefore,
  resolvePdfDownloadUrl,
  resolveSubmissionIdentity,
};
