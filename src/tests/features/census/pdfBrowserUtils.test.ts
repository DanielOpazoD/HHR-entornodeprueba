import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadPdfTemplate,
  openPdfBlobInNewTab,
} from '@/features/census/components/imaging-request/pdfBrowserUtils';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';

vi.mock('@/services/pdf/pdfLibRuntime', () => ({
  loadPdfLibGenerationRuntime: vi.fn(async () => ({
    PDFDocument: {
      load: vi.fn(async (bytes: ArrayBuffer) => ({ loadedBytes: bytes.byteLength })),
    },
    StandardFonts: { Helvetica: 'Helvetica' },
  })),
}));

describe('pdfBrowserUtils', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects non-OK template responses instead of passing HTML error pages to pdf-lib', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        arrayBuffer: vi.fn(),
      }))
    );

    await expect(loadPdfTemplate('/docs/missing.pdf')).rejects.toThrow(
      'No se pudo cargar la plantilla PDF (404).'
    );
  });

  it('aborts a stalled template fetch when the timeout expires', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            capturedSignal = init?.signal ?? undefined;
            capturedSignal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            );
          })
      )
    );

    const pending = loadPdfTemplate('/docs/slow.pdf', 500);
    const rejection = expect(pending).rejects.toThrow('Aborted');
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('revokes generated PDF blob URLs for both new-tab preview and download fallback', async () => {
    vi.useFakeTimers();
    const createUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:imaging-tab')
      .mockReturnValueOnce('blob:imaging-download');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const openSpy = vi
      .spyOn(defaultBrowserWindowRuntime, 'open')
      .mockReturnValueOnce({} as Window)
      .mockReturnValueOnce(null);
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const bytes = new Uint8Array([37, 80, 68, 70]);
    const tabUrl = openPdfBlobInNewTab({ bytes, fileName: 'solicitud.pdf' });
    expect(tabUrl).toBe('blob:imaging-tab');
    expect(revokeUrlSpy).not.toHaveBeenCalled();

    const downloadUrl = openPdfBlobInNewTab({ bytes, fileName: 'solicitud.pdf' });
    expect(downloadUrl).toBe('blob:imaging-download');
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(revokeUrlSpy).toHaveBeenCalledWith('blob:imaging-download');
    expect(revokeUrlSpy).not.toHaveBeenCalledWith('blob:imaging-tab');

    await vi.advanceTimersByTimeAsync(59_000);
    expect(revokeUrlSpy).toHaveBeenCalledWith('blob:imaging-tab');
    expect(createUrlSpy).toHaveBeenCalledTimes(2);
    expect(openSpy).toHaveBeenCalledTimes(2);
  });
});
