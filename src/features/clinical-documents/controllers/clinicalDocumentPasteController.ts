/**
 * clinicalDocumentPasteController
 *
 * Pure logic for classifying and processing clipboard content pasted
 * into the clinical document rich-text editor.
 *
 * Paste content is classified into these categories:
 *  - `image-file`: a bitmap image (screenshot, copied image)
 *  - `image-too-large`: an image that should not be embedded inline
 *  - `html`: rich HTML content (tables, formatted text, inline images)
 *  - `plain-text`: unformatted text fallback
 *
 * The controller returns a descriptor; the hook performs DOM mutations.
 */

import { sanitizePastedHtml } from '@/features/clinical-documents/controllers/clinicalDocumentRichTextController';
import {
  CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES,
  CLINICAL_ATTACHMENT_INLINE_IMAGE_MAX_BYTES,
  resolveClinicalAttachmentFilePolicy,
} from '@/features/clinical-documents/controllers/clinicalAttachmentFilePolicy';
import { escapeHtml } from '@/utils/htmlEscape';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const CLINICAL_DOCUMENT_MAX_INLINE_IMAGE_BYTES = CLINICAL_ATTACHMENT_INLINE_IMAGE_MAX_BYTES;

export type PasteContentKind = 'image-file' | 'image-too-large' | 'html' | 'plain-text' | 'empty';

export interface PasteContentImageFile {
  kind: 'image-file';
  file: File;
  requiresStorage: boolean;
  requiresCompression: boolean;
}

export interface PasteContentImageTooLarge {
  kind: 'image-too-large';
  file: File;
  actualBytes: number;
  maxBytes: number;
  message: string;
}

export interface PasteContentHtml {
  kind: 'html';
  sanitizedHtml: string;
}

export interface PasteContentPlainText {
  kind: 'plain-text';
  text: string;
}

export interface PasteContentEmpty {
  kind: 'empty';
}

export type PasteContentDescriptor =
  | PasteContentImageFile
  | PasteContentImageTooLarge
  | PasteContentHtml
  | PasteContentPlainText
  | PasteContentEmpty;

const formatImageSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.ceil(bytes / 1024)} KB`;
};

export const buildInlineImageTooLargeMessage = (
  actualBytes: number,
  maxBytes = CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES
): string =>
  `La imagen pesa ${formatImageSize(actualBytes)} y supera el limite seguro de ${formatImageSize(
    maxBytes
  )} para procesarla como archivo del episodio. Reduzca la imagen o use un archivo mas liviano.`;

export const resolveInlineImagePasteRejection = (file: File): PasteContentImageTooLarge | null => {
  if (file.size <= CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES) {
    return null;
  }

  return {
    kind: 'image-too-large',
    file,
    actualBytes: file.size,
    maxBytes: CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES,
    message: buildInlineImageTooLargeMessage(file.size),
  };
};

const normalizeClipboardHtml = (html: string): string =>
  html
    .replace(/<!--StartFragment-->|<!--EndFragment-->/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(meta|link)\b[^>]*>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<xml\b[\s\S]*?<\/xml>/gi, '')
    .replace(/<\/?o:p\b[^>]*>/gi, '')
    .replace(/<\/?(?:w|v|o|m):[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();

const looksLikeSoftWrapContinuation = (previousLine: string, currentLine: string): boolean => {
  if (!previousLine || !currentLine) {
    return false;
  }

  if (/[.:;!?)]$/.test(previousLine.trim())) {
    return false;
  }

  if (/^[-*•]\s/.test(currentLine) || /^\d+[.)]\s/.test(currentLine)) {
    return false;
  }

  if (/^[A-ZÁÉÍÓÚÑ0-9\s/-]{4,}:?$/.test(previousLine.trim())) {
    return false;
  }

  return /^[a-záéíóúñ(]/.test(currentLine.trim());
};

const normalizeClipboardPlainText = (text: string): string => {
  const normalizedLines = text
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\t/g, ' ')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim());

  const mergedLines: string[] = [];

  normalizedLines.forEach(line => {
    if (!line) {
      if (mergedLines[mergedLines.length - 1] !== '') {
        mergedLines.push('');
      }
      return;
    }

    const previousLine = mergedLines[mergedLines.length - 1];
    if (previousLine && previousLine !== '' && looksLikeSoftWrapContinuation(previousLine, line)) {
      mergedLines[mergedLines.length - 1] = `${previousLine} ${line}`;
      return;
    }

    mergedLines.push(line);
  });

  return mergedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Inspects a clipboard's `DataTransfer` and returns a descriptor
 * describing what was pasted. The caller decides how to insert the
 * content into the DOM.
 *
 * Priority order:
 *  1. Image files (screenshot, pasted bitmap)
 *  2. HTML content (sanitised)
 *  3. Plain-text fallback
 *  4. Empty (nothing useful)
 */
export const classifyPasteContent = (clipboardData: DataTransfer): PasteContentDescriptor => {
  // 1. Image files
  const imageFile = Array.from(clipboardData.files).find(f => f.type.startsWith('image/'));
  if (imageFile) {
    const rejectedImage = resolveInlineImagePasteRejection(imageFile);
    if (rejectedImage) {
      return rejectedImage;
    }
    const policy = resolveClinicalAttachmentFilePolicy(imageFile, { source: 'pasted-image' });
    return {
      kind: 'image-file',
      file: imageFile,
      requiresStorage: policy.action !== 'inline_image',
      requiresCompression: policy.action === 'compress_image',
    };
  }

  // 2. Rich HTML
  const rawHtml = clipboardData.getData('text/html');
  const plainText = clipboardData.getData('text/plain');

  if (rawHtml) {
    return {
      kind: 'html',
      sanitizedHtml: sanitizePastedHtml(normalizeClipboardHtml(rawHtml)),
    };
  }

  // 3. Plain text
  if (plainText) {
    return { kind: 'plain-text', text: normalizeClipboardPlainText(plainText) };
  }

  return { kind: 'empty' };
};

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

/**
 * Reads a File as a base64 data-URL string.
 * Returns a Promise that resolves with the data URL.
 */
export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader result is not a string'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * Builds the `<img>` HTML snippet to embed a pasted image.
 */
export const buildPastedImageHtml = (dataUrl: string): string =>
  `<img src="${dataUrl}" alt="Imagen pegada" style="max-width:100%">`;

export interface PastedStorageImageHtmlParams {
  attachmentId: string;
  imageUrl: string;
  storagePath: string;
}

export const buildPastedStorageImageHtml = ({
  attachmentId,
  imageUrl,
  storagePath,
}: PastedStorageImageHtmlParams): string =>
  `<img src="${escapeHtml(imageUrl)}" alt="Imagen adjunta" data-clinical-attachment-id="${escapeHtml(
    attachmentId
  )}" data-clinical-document-storage-path="${escapeHtml(storagePath)}" style="max-width:100%">`;
