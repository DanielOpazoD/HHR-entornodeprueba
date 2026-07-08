import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('PDF runtime loaders', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('clears failed pdf-lib imports so a later call can retry', async () => {
    let importAttempts = 0;
    const firstFailure = new Error('pdf-lib chunk failed');

    vi.doMock('pdf-lib', () => {
      importAttempts += 1;
      if (importAttempts === 1) {
        throw firstFailure;
      }
      return { PDFDocument: { load: vi.fn() } };
    });

    const { loadPdfLibGenerationRuntime } = await import('@/services/pdf/pdfLibRuntime');

    await expect(loadPdfLibGenerationRuntime()).rejects.toThrow();
    await expect(loadPdfLibGenerationRuntime()).resolves.toMatchObject({
      PDFDocument: expect.any(Object),
    });
    expect(importAttempts).toBe(2);
  });

  it('sets the PDF.js worker once inside the cached runtime initialisation', async () => {
    let workerSrcSetCount = 0;
    let assignedWorkerSrc = '';
    const globalWorkerOptions = {
      set workerSrc(value: string) {
        workerSrcSetCount += 1;
        assignedWorkerSrc = value;
      },
      get workerSrc() {
        return assignedWorkerSrc;
      },
    };
    const pdfjsRuntime = {
      GlobalWorkerOptions: globalWorkerOptions,
      getDocument: vi.fn(),
    };

    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => pdfjsRuntime);

    const { loadPdfJsTextRuntime } = await import('@/services/pdf/pdfJsTextRuntime');

    await expect(loadPdfJsTextRuntime()).resolves.toMatchObject(pdfjsRuntime);
    await expect(loadPdfJsTextRuntime()).resolves.toMatchObject(pdfjsRuntime);
    expect(workerSrcSetCount).toBe(1);
    expect(globalWorkerOptions.workerSrc).toContain('pdf.worker');
  });

  it('clears failed PDF.js imports so a later call can retry', async () => {
    let importAttempts = 0;
    const firstFailure = new Error('pdfjs chunk failed');

    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => {
      importAttempts += 1;
      if (importAttempts === 1) {
        throw firstFailure;
      }
      return {
        GlobalWorkerOptions: {},
        getDocument: vi.fn(),
      };
    });

    const { loadPdfJsTextRuntime } = await import('@/services/pdf/pdfJsTextRuntime');

    await expect(loadPdfJsTextRuntime()).rejects.toThrow();
    await expect(loadPdfJsTextRuntime()).resolves.toMatchObject({
      GlobalWorkerOptions: expect.any(Object),
    });
    expect(importAttempts).toBe(2);
  });
});
