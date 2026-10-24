import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMedifValues } from '@/features/clinical-library/domain/medifDraft';
import { emptyMedifPreferences } from '@/features/clinical-library/domain/medifPreferences';

const { createPdf, saveAs } = vi.hoisted(() => ({ createPdf: vi.fn(), saveAs: vi.fn() }));
vi.mock('@/features/clinical-library/services/medifPdf', () => ({
  createMedifPdf: createPdf,
  MEDIF_TEMPLATE_URL: '/synthetic-medif.pdf',
}));
vi.mock('file-saver', () => ({ saveAs }));

describe('MEDIF download cancellation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    createPdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
      })
    );
  });

  it('does not load or save an already cancelled export', async () => {
    const { downloadMedifPdf } = await import('@/features/clinical-library/services/medifDownload');
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadMedifPdf(emptyMedifValues(), emptyMedifPreferences(), 'print', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    expect(saveAs).not.toHaveBeenCalled();
  });

  it('cancels one export without cancelling the shared blank template for another', async () => {
    const { downloadMedifPdf } = await import('@/features/clinical-library/services/medifDownload');
    const controller = new AbortController();
    const cancelled = downloadMedifPdf(
      emptyMedifValues(),
      emptyMedifPreferences(),
      'print',
      controller.signal
    );
    controller.abort();
    const current = downloadMedifPdf(emptyMedifValues(), emptyMedifPreferences(), 'editable');
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await current;
    expect(fetch).toHaveBeenCalledOnce();
    expect(createPdf).toHaveBeenCalledOnce();
    expect(saveAs).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), 'MEDIF-editable.pdf');
  });

  it('rejects a cancelled PDF even after its generation succeeds', async () => {
    const { downloadMedifPdf } = await import('@/features/clinical-library/services/medifDownload');
    const controller = new AbortController();
    createPdf.mockImplementationOnce(async () => {
      controller.abort();
      return new Uint8Array([1]);
    });
    await expect(
      downloadMedifPdf(emptyMedifValues(), emptyMedifPreferences(), 'print', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(saveAs).not.toHaveBeenCalled();
  });

  it('can retry loading the blank template after a network error', async () => {
    const { downloadMedifPdf } = await import('@/features/clinical-library/services/medifDownload');
    vi.mocked(fetch).mockRejectedValueOnce(new Error('synthetic offline'));
    await expect(
      downloadMedifPdf(emptyMedifValues(), emptyMedifPreferences(), 'print')
    ).rejects.toThrow();
    await downloadMedifPdf(emptyMedifValues(), emptyMedifPreferences(), 'print');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(saveAs).toHaveBeenCalledOnce();
  });
});
