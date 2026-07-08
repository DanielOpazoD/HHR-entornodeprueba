/**
 * Tests for the clinical document paste controller.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPastedImageHtml,
  buildPastedStorageImageHtml,
  classifyPasteContent,
  CLINICAL_DOCUMENT_MAX_INLINE_IMAGE_BYTES,
  readFileAsDataUrl,
} from '@/features/clinical-documents/controllers/clinicalDocumentPasteController';
import { CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES } from '@/features/clinical-documents/controllers/clinicalAttachmentFilePolicy';

// ---------------------------------------------------------------------------
// Helpers to build a mock DataTransfer
// ---------------------------------------------------------------------------

const buildMockDataTransfer = ({
  files = [] as File[],
  htmlData = '',
  textData = '',
} = {}): DataTransfer =>
  ({
    files,
    getData: (type: string) => {
      if (type === 'text/html') return htmlData;
      if (type === 'text/plain') return textData;
      return '';
    },
  }) as unknown as DataTransfer;

// ---------------------------------------------------------------------------
// classifyPasteContent
// ---------------------------------------------------------------------------

describe('classifyPasteContent', () => {
  it('returns image-file when an image file is present', () => {
    const file = new File(['blob'], 'shot.png', { type: 'image/png' });
    const dt = buildMockDataTransfer({ files: [file] });

    const result = classifyPasteContent(dt);

    expect(result.kind).toBe('image-file');
    if (result.kind === 'image-file') {
      expect(result.file).toBe(file);
    }
  });

  it('prioritises image files over HTML content', () => {
    const file = new File(['blob'], 'photo.jpg', { type: 'image/jpeg' });
    const dt = buildMockDataTransfer({
      files: [file],
      htmlData: '<b>bold</b>',
      textData: 'bold',
    });

    expect(classifyPasteContent(dt).kind).toBe('image-file');
  });

  it('marks images above the inline limit for Storage upload', () => {
    const oversizedPayload = new Uint8Array(CLINICAL_DOCUMENT_MAX_INLINE_IMAGE_BYTES + 1);
    const file = new File([oversizedPayload], 'large.png', { type: 'image/png' });
    const dt = buildMockDataTransfer({
      files: [file],
      htmlData: '<b>fallback</b>',
      textData: 'fallback',
    });

    const result = classifyPasteContent(dt);

    expect(result.kind).toBe('image-file');
    if (result.kind === 'image-file') {
      expect(result.file).toBe(file);
      expect(result.requiresStorage).toBe(true);
      expect(result.requiresCompression).toBe(false);
    }
  });

  it('rejects images beyond the compressible browser limit', () => {
    const file = new File(
      [new Uint8Array(CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES + 1)],
      'huge.png',
      { type: 'image/png' }
    );
    const dt = buildMockDataTransfer({ files: [file] });

    const result = classifyPasteContent(dt);

    expect(result.kind).toBe('image-too-large');
    if (result.kind === 'image-too-large') {
      expect(result.file).toBe(file);
      expect(result.message).toContain('supera el limite seguro');
    }
  });

  it('returns html with sanitised content when HTML is present', () => {
    const dt = buildMockDataTransfer({
      htmlData: '<b style="color:red">bold</b>',
      textData: 'bold',
    });

    const result = classifyPasteContent(dt);

    expect(result.kind).toBe('html');
    if (result.kind === 'html') {
      // Style should have been stripped by sanitizePastedHtml
      expect(result.sanitizedHtml).toContain('<b');
      expect(result.sanitizedHtml).not.toContain('color:red');
    }
  });

  it('strips background-color highlights coming from external sources but keeps text color', () => {
    const dt = buildMockDataTransfer({
      htmlData: '<span style="color: red; background-color: yellow">Texto resaltado</span>',
      textData: 'Texto resaltado',
    });

    const result = classifyPasteContent(dt);

    expect(result.kind).toBe('html');
    if (result.kind === 'html') {
      expect(result.sanitizedHtml).toContain('Texto resaltado');
      expect(result.sanitizedHtml).toContain('color: red');
      expect(result.sanitizedHtml).not.toContain('background-color');
      expect(result.sanitizedHtml).not.toContain('yellow');
    }
  });

  it('strips Word and Outlook clipboard wrappers before sanitising HTML', () => {
    const dt = buildMockDataTransfer({
      htmlData: '<!--StartFragment--><p class="MsoNormal">Informe<o:p></o:p></p><!--EndFragment-->',
      textData: 'Informe',
    });

    const result = classifyPasteContent(dt);

    expect(result.kind).toBe('html');
    if (result.kind === 'html') {
      expect(result.sanitizedHtml).toContain('Informe');
      expect(result.sanitizedHtml).not.toContain('StartFragment');
      expect(result.sanitizedHtml).not.toContain('MsoNormal');
      expect(result.sanitizedHtml).not.toContain('o:p');
    }
  });

  it('returns plain-text when only text is available', () => {
    const dt = buildMockDataTransfer({ textData: 'hello world' });

    const result = classifyPasteContent(dt);

    expect(result.kind).toBe('plain-text');
    if (result.kind === 'plain-text') {
      expect(result.text).toBe('hello world');
    }
  });

  it('normalises pasted plain text from PDF or email soft wraps', () => {
    const dt = buildMockDataTransfer({
      textData:
        'Hallazgos radiológicos\ndescritos en detalle.\n\nCONCLUSIÓN:\nSin derrame pleural.',
    });

    const result = classifyPasteContent(dt);

    expect(result.kind).toBe('plain-text');
    if (result.kind === 'plain-text') {
      expect(result.text).toBe(
        'Hallazgos radiológicos descritos en detalle.\n\nCONCLUSIÓN:\nSin derrame pleural.'
      );
    }
  });

  it('collapses noisy blank lines from Syslab or MMRAD plain text pastes', () => {
    const dt = buildMockDataTransfer({
      textData: 'Cultivo corriente\n\n\nBacilos Gram (-)\n\n\nResistente',
    });

    const result = classifyPasteContent(dt);

    expect(result.kind).toBe('plain-text');
    if (result.kind === 'plain-text') {
      expect(result.text).toBe('Cultivo corriente\n\nBacilos Gram (-)\n\nResistente');
    }
  });

  it('returns empty when nothing useful is in the clipboard', () => {
    const dt = buildMockDataTransfer();
    expect(classifyPasteContent(dt).kind).toBe('empty');
  });

  it('ignores non-image files', () => {
    const pdf = new File(['data'], 'doc.pdf', { type: 'application/pdf' });
    const dt = buildMockDataTransfer({
      files: [pdf],
      textData: 'fallback',
    });

    expect(classifyPasteContent(dt).kind).toBe('plain-text');
  });
});

// ---------------------------------------------------------------------------
// buildPastedImageHtml
// ---------------------------------------------------------------------------

describe('buildPastedImageHtml', () => {
  it('builds an img tag with the data URL', () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    const html = buildPastedImageHtml(dataUrl);

    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('alt="Imagen pegada"');
    expect(html).toContain('max-width:100%');
  });
});

describe('buildPastedStorageImageHtml', () => {
  it('builds a Storage-backed image tag with attachment metadata', () => {
    const html = buildPastedStorageImageHtml({
      attachmentId: 'att_1',
      imageUrl: 'https://storage.test/image.jpg?token=abc&alt=media',
      storagePath: 'clinical-attachments/hhr/rut/episode/att_1/image.jpg',
    });

    expect(html).toContain('src="https://storage.test/image.jpg?token=abc&amp;alt=media"');
    expect(html).toContain('data-clinical-attachment-id="att_1"');
    expect(html).toContain(
      'data-clinical-document-storage-path="clinical-attachments/hhr/rut/episode/att_1/image.jpg"'
    );
    expect(html).toContain('alt="Imagen adjunta"');
  });
});

// ---------------------------------------------------------------------------
// readFileAsDataUrl
// ---------------------------------------------------------------------------

describe('readFileAsDataUrl', () => {
  it('resolves with a data URL string', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const file = new File([blob], 'test.txt', { type: 'text/plain' });

    const result = await readFileAsDataUrl(file);

    expect(result).toMatch(/^data:text\/plain;base64,/);
  });
});
