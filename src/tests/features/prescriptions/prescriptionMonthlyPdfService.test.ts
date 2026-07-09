import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/prescriptions/services/prescriptionStorageImageService', () => ({
  resolvePrescriptionImageDownloadUrl: vi.fn(
    async (path: string) =>
      `https://firebasestorage.googleapis.com/v0/b/hhr-pruebas.firebasestorage.app/o/${encodeURIComponent(path)}?alt=media&token=stub`
  ),
}));

import {
  PRESCRIPTION_PDF_IMAGE_QUALITY_PRESETS,
  buildMonthlyPrescriptionPdfFileName,
  collectMonthlyPrescriptionExport,
  exportMonthlyPrescriptionsPdf,
} from '@/features/prescriptions/services/prescriptionMonthlyPdfService';
import { resolvePrescriptionImageDownloadUrl } from '@/features/prescriptions/services/prescriptionStorageImageService';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

const buildRecord = (
  id: string,
  createdAt: string,
  overrides: Partial<PrescriptionRecord> = {}
): PrescriptionRecord => ({
  id,
  hospitalId: 'hhr',
  prescriptionType: 'comun',
  image: {
    storagePath: `prescriptions/hhr/${id}/full.jpg`,
    thumbnailStoragePath: `prescriptions/hhr/${id}/thumb.jpg`,
    byteSize: 200_000,
    width: 1200,
    height: 900,
    contentType: 'image/jpeg',
  },
  uploader: { source: 'qr_pin' },
  createdAt,
  expiresAt: '2026-06-03T10:00:00.000Z',
  ...overrides,
});

describe('prescriptionMonthlyPdfService', () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    document.head.innerHTML = '<title>HHR</title>';
    document.body.innerHTML = '<main id="app-root">App</main>';
    URL.createObjectURL = vi.fn(() => 'blob:optimized-prescription');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    vi.restoreAllMocks();
  });

  it('exports the PDF image-quality presets from a single shared contract', () => {
    expect(PRESCRIPTION_PDF_IMAGE_QUALITY_PRESETS).toEqual({
      medium: null,
      reduced: { width: 980, quality: 66 },
      compact: { width: 760, quality: 58 },
      low: { width: 560, quality: 50 },
    });
  });

  it('collects every prescription in the selected month from day one to the last available day', () => {
    const exportScope = collectMonthlyPrescriptionExport(
      [
        buildRecord('abril', '2026-04-30T23:30:00.000Z'),
        buildRecord('mayo-tarde', '2026-05-20T16:00:00.000Z'),
        buildRecord('mayo-temprano', '2026-05-01T08:00:00.000Z'),
        buildRecord('junio', '2026-06-01T08:00:00.000Z'),
      ],
      '2026-05-06'
    );

    expect(exportScope.startIso).toBe('2026-05-01');
    expect(exportScope.endIso).toBe('2026-05-20');
    expect(exportScope.records.map(record => record.id)).toEqual(['mayo-temprano', 'mayo-tarde']);
  });

  it('uses a stable clinical file name with the exported date range', () => {
    expect(
      buildMonthlyPrescriptionPdfFileName({
        startIso: '2026-05-01',
        endIso: '2026-05-20',
      })
    ).toBe('recetas-hospitalizados-2026-05-01-a-2026-05-20.pdf');
  });

  it('prints a monthly document with image tags instead of fetching Storage bytes', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    const resultPromise = exportMonthlyPrescriptionsPdf({
      records: [buildRecord('rx-1', '2026-05-01T08:00:00.000Z')],
      selectedDateIso: '2026-05-06',
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#prescription-monthly-print-root img')).toHaveLength(1);
    });

    const image = document.querySelector('#prescription-monthly-print-root img');
    image?.dispatchEvent(new Event('load'));

    const result = await resultPromise;
    await vi.advanceTimersByTimeAsync(150);

    expect(resolvePrescriptionImageDownloadUrl).toHaveBeenCalledWith(
      'prescriptions/hhr/rx-1/full.jpg'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(printSpy).toHaveBeenCalled();
    expect(image).toHaveAttribute(
      'src',
      'https://firebasestorage.googleapis.com/v0/b/hhr-pruebas.firebasestorage.app/o/prescriptions%2Fhhr%2Frx-1%2Ffull.jpg?alt=media&token=stub'
    );
    expect(document.querySelector('.prescription-monthly-meta')?.textContent).toContain(
      '01-05-2026 a 01-05-2026'
    );
    expect(
      document.querySelector('.prescription-monthly-card-meta:nth-of-type(2)')?.textContent
    ).toContain('01-05-2026');
    expect(document.title).toBe('recetas-hospitalizados-2026-05-01-a-2026-05-01.pdf');
    expect(result).toEqual({
      exportedCount: 1,
      fileName: 'recetas-hospitalizados-2026-05-01-a-2026-05-01.pdf',
      optimizationFallbackCount: 0,
    });

    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('prescription-monthly-print-root')).toBeNull();
    expect(document.title).toBe('HHR');
    vi.useRealTimers();
  });

  it('groups multiple prescriptions per page and applies grayscale print mode', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(new Blob(['optimized'], { type: 'image/jpeg' }), {
          headers: { 'X-Prescription-Image-Optimization': 'optimized' },
        })
    );
    const records = Array.from({ length: 5 }, (_, index) =>
      buildRecord(`rx-${index + 1}`, `2026-05-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`)
    );

    const resultPromise = exportMonthlyPrescriptionsPdf({
      records,
      selectedDateIso: '2026-05-06',
      options: {
        prescriptionsPerPage: 4,
        colorMode: 'grayscale',
        imageQuality: 'compact',
      },
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#prescription-monthly-print-root img')).toHaveLength(5);
    });

    document
      .querySelectorAll('#prescription-monthly-print-root img')
      .forEach(image => image.dispatchEvent(new Event('load')));

    const result = await resultPromise;
    await vi.advanceTimersByTimeAsync(150);

    expect(document.querySelectorAll('.prescription-monthly-page')).toHaveLength(2);
    expect(document.querySelectorAll('.prescription-monthly-card')).toHaveLength(5);
    expect(document.getElementById('prescription-monthly-print-root')).toHaveAttribute(
      'data-color-mode',
      'grayscale'
    );
    expect(document.getElementById('prescription-monthly-print-root')).toHaveAttribute(
      'data-prescriptions-per-page',
      '4'
    );
    expect(document.getElementById('prescription-monthly-print-root')).toHaveAttribute(
      'data-image-quality',
      'compact'
    );
    const firstImageSrc = document
      .querySelector('#prescription-monthly-print-root img')
      ?.getAttribute('src');
    expect(firstImageSrc).toBe('blob:optimized-prescription');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('w=760'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('q=58'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    const styleText = document.getElementById('prescription-monthly-print-style')?.textContent;
    expect(styleText).toContain('left: -10000px');
    expect(styleText).toContain('opacity: 0');
    expect(styleText).toContain('-webkit-filter: grayscale(1) contrast(1.12)');
    expect(styleText).toContain('height: 100%');
    expect(styleText).toContain('data-image-quality="compact"');
    expect(result.exportedCount).toBe(5);
    expect(result.optimizationFallbackCount).toBe(0);
    vi.useRealTimers();
  });

  it('limits optimized image proxy requests so large months do not fan out all at once', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    const pendingResponses: Array<() => void> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>(resolve => {
          pendingResponses.push(() =>
            resolve(
              new Response(new Blob(['optimized'], { type: 'image/jpeg' }), {
                headers: { 'X-Prescription-Image-Optimization': 'optimized' },
              })
            )
          );
        })
    );
    const records = Array.from({ length: 9 }, (_, index) =>
      buildRecord(`rx-batch-${index + 1}`, '2026-05-01T08:00:00.000Z')
    );

    const resultPromise = exportMonthlyPrescriptionsPdf({
      records,
      selectedDateIso: '2026-05-06',
      options: { imageQuality: 'compact' },
    });

    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(4));
    pendingResponses.splice(0).forEach(resolve => resolve());
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(8));
    pendingResponses.splice(0).forEach(resolve => resolve());
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(9));
    pendingResponses.splice(0).forEach(resolve => resolve());

    await vi.waitFor(() => {
      expect(document.querySelectorAll('#prescription-monthly-print-root img')).toHaveLength(9);
    });
    document
      .querySelectorAll('#prescription-monthly-print-root img')
      .forEach(image => image.dispatchEvent(new Event('load')));
    const result = await resultPromise;

    expect(result.optimizationFallbackCount).toBe(0);
  });

  it('passes an abort signal to optimized image requests and falls back when the proxy times out', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init && 'signal' in init ? init.signal : undefined;
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );

    const resultPromise = exportMonthlyPrescriptionsPdf({
      records: [buildRecord('rx-timeout', '2026-05-01T08:00:00.000Z')],
      selectedDateIso: '2026-05-06',
      options: { imageQuality: 'compact' },
    });

    await vi.waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/.netlify/functions/prescription-image-proxy'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#prescription-monthly-print-root img')).toHaveLength(1);
    });

    const image = document.querySelector('#prescription-monthly-print-root img');
    image?.dispatchEvent(new Event('load'));
    const result = await resultPromise;

    expect(result.optimizationFallbackCount).toBe(1);
    expect(image).toHaveAttribute(
      'src',
      'https://firebasestorage.googleapis.com/v0/b/hhr-pruebas.firebasestorage.app/o/prescriptions%2Fhhr%2Frx-timeout%2Ffull.jpg?alt=media&token=stub'
    );
    vi.useRealTimers();
  });

  it('uses a readable low-quality transform from the full image instead of the tiny thumbnail', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(new Blob(['optimized'], { type: 'image/jpeg' }), {
          headers: { 'X-Prescription-Image-Optimization': 'optimized' },
        })
    );

    const resultPromise = exportMonthlyPrescriptionsPdf({
      records: [buildRecord('rx-low', '2026-05-01T08:00:00.000Z')],
      selectedDateIso: '2026-05-06',
      options: { imageQuality: 'low' },
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#prescription-monthly-print-root img')).toHaveLength(1);
    });

    document
      .querySelectorAll('#prescription-monthly-print-root img')
      .forEach(image => image.dispatchEvent(new Event('load')));

    await resultPromise;
    await vi.advanceTimersByTimeAsync(150);

    expect(resolvePrescriptionImageDownloadUrl).toHaveBeenCalledWith(
      'prescriptions/hhr/rx-low/full.jpg'
    );
    const lowImageSrc = document
      .querySelector('#prescription-monthly-print-root img')
      ?.getAttribute('src');
    expect(lowImageSrc).toBe('blob:optimized-prescription');
    expect(document.getElementById('prescription-monthly-print-root')).toHaveAttribute(
      'data-image-quality',
      'low'
    );
    vi.useRealTimers();
  });

  it('reports when optimized image generation falls back to the original image', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['original'], { type: 'image/jpeg' }), {
        headers: { 'X-Prescription-Image-Optimization': 'fallback' },
      })
    );

    const resultPromise = exportMonthlyPrescriptionsPdf({
      records: [buildRecord('rx-fallback', '2026-05-01T08:00:00.000Z')],
      selectedDateIso: '2026-05-06',
      options: { imageQuality: 'compact' },
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll('#prescription-monthly-print-root img')).toHaveLength(1);
    });

    document
      .querySelectorAll('#prescription-monthly-print-root img')
      .forEach(image => image.dispatchEvent(new Event('load')));

    const result = await resultPromise;
    await vi.advanceTimersByTimeAsync(150);

    expect(result.optimizationFallbackCount).toBe(1);
    const objectUrlInput = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob | undefined;
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(objectUrlInput?.size).toBeGreaterThan(0);
    window.dispatchEvent(new Event('afterprint'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:optimized-prescription');
    vi.useRealTimers();
  });

  it('uses distinct real image-transform presets for reduced and compact quality', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'print').mockImplementation(() => {});

    const runExport = async (imageQuality: 'reduced' | 'compact') => {
      vi.mocked(globalThis.fetch).mockClear();
      document.getElementById('prescription-monthly-print-root')?.remove();
      document.getElementById('prescription-monthly-print-style')?.remove();
      const resultPromise = exportMonthlyPrescriptionsPdf({
        records: [buildRecord(`rx-${imageQuality}`, '2026-05-01T08:00:00.000Z')],
        selectedDateIso: '2026-05-06',
        options: { imageQuality },
      });
      await vi.waitFor(() => {
        expect(document.querySelectorAll('#prescription-monthly-print-root img')).toHaveLength(1);
      });
      const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0]?.toString() ?? '';
      document
        .querySelectorAll('#prescription-monthly-print-root img')
        .forEach(image => image.dispatchEvent(new Event('load')));
      await resultPromise;
      return calledUrl;
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(new Blob(['optimized'], { type: 'image/jpeg' }), {
          headers: { 'X-Prescription-Image-Optimization': 'optimized' },
        })
    );
    const reducedSrc = await runExport('reduced');
    const compactSrc = await runExport('compact');

    expect(reducedSrc).toContain('w=980');
    expect(reducedSrc).toContain('q=66');
    expect(compactSrc).toContain('w=760');
    expect(compactSrc).toContain('q=58');
    expect(reducedSrc).not.toBe(compactSrc);
    vi.useRealTimers();
  });
});
