import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  escapeStyleText,
  sanitizeClinicalDocumentSheetClone,
  sanitizeCssValue,
  waitForClinicalDocumentSheetAssets,
} from '@/features/clinical-documents/services/clinicalDocumentPrintSupport';

class MockFileReader {
  result: string | null = null;
  error: Error | null = null;
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;

  readAsDataURL(_blob: Blob) {
    this.result = 'data:image/png;base64,mock';
    this.onload?.();
  }
}

describe('clinicalDocumentPrintSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(['img'], { type: 'image/png' }),
      }))
    );
    vi.stubGlobal('FileReader', MockFileReader);
  });

  it('sanitizes the cloned sheet and inlines fetch-backed assets', async () => {
    const originalSheet = document.createElement('section');
    const originalImage = document.createElement('img');
    originalImage.src = 'https://example.com/patient.png';
    originalSheet.appendChild(originalImage);

    const clone = document.createElement('section');
    clone.innerHTML = `
      <img src="https://example.com/patient.png" />
      <img alt="Logo institucional izquierdo" src="/images/logos/logo_HHR.png" />
      <img alt="Logo institucional derecho" src="/images/logos/logo_SSMO.jpg" />
      <div contenteditable="true">Editable</div>
      <button class="clinical-document-inline-action">Editar</button>
      <button class="clinical-document-section-drag-handle">Drag</button>
      <div class="clinical-document-annex-actions">Acciones anexo</div>
      <button class="clinical-document-print-control">Firma paciente/familiar</button>
      <textarea>Nota</textarea>
    `;
    clone.setAttribute('contenteditable', 'true');

    await sanitizeClinicalDocumentSheetClone(originalSheet, clone);

    expect(clone.getAttribute('contenteditable')).toBeNull();
    expect(clone.querySelector('[contenteditable]')).toBeNull();
    expect(clone.querySelector('.clinical-document-inline-action')).toBeNull();
    expect(clone.querySelector('.clinical-document-section-drag-handle')).toBeNull();
    expect(clone.querySelector('.clinical-document-annex-actions')).toBeNull();
    expect(clone.querySelector('.clinical-document-print-control')).toBeNull();
    expect((clone.querySelector('textarea') as HTMLTextAreaElement).readOnly).toBe(true);
    const images = Array.from(clone.querySelectorAll('img'));
    images.forEach(image => {
      expect((image as HTMLImageElement).src).toContain('data:image/png;base64,mock');
    });
  });

  it('removes empty printable sections from the cloned sheet', async () => {
    const originalSheet = document.createElement('section');
    const clone = document.createElement('section');
    clone.innerHTML = `
      <div class="clinical-document-section-block">
        <h3 class="clinical-document-section-title">Vacía</h3>
        <div class="clinical-document-rich-text-editor"><p><br></p></div>
      </div>
      <div class="clinical-document-section-block">
        <h3 class="clinical-document-section-title">Con contenido</h3>
        <div class="clinical-document-rich-text-editor"><p>Hallazgos clínicos</p></div>
      </div>
    `;

    await sanitizeClinicalDocumentSheetClone(originalSheet, clone);

    const printableSections = clone.querySelectorAll('.clinical-document-section-block');
    expect(printableSections).toHaveLength(1);
    expect(clone.textContent).toContain('Con contenido');
    expect(clone.textContent).not.toContain('Vacía');
  });

  it('waits for image load and font readiness before resolving', async () => {
    vi.useFakeTimers();
    const sheet = document.createElement('section');
    const image = document.createElement('img');
    Object.defineProperty(image, 'complete', { configurable: true, value: false });
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 0 });
    sheet.appendChild(image);

    const ownerDocument = document;
    Object.defineProperty(ownerDocument, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve({} as FontFaceSet) },
    });

    const waiting = waitForClinicalDocumentSheetAssets(sheet, ownerDocument, window);
    image.dispatchEvent(new Event('load'));
    await vi.runAllTimersAsync();
    await waiting;
    vi.useRealTimers();
  });

  it('escapes embedded </style> sequences for style tags', () => {
    // HTML text/attribute escaping is covered by src/tests/utils/htmlEscape.test.ts.
    expect(escapeStyleText('</style><script>')).toBe('<\\/style><script>');
  });

  it('keeps CSS values valid: preserves quotes but strips style-breakout chars', () => {
    // A font-family stack must keep its quotes (HTML-escaping would corrupt it).
    expect(sanitizeCssValue("Inter, 'Segoe UI', Roboto, sans-serif")).toBe(
      "Inter, 'Segoe UI', Roboto, sans-serif"
    );
    // …while characters that could break out of the declaration / <style> are removed.
    expect(sanitizeCssValue('Arial};{<>x')).toBe('Arialx');
  });
});
