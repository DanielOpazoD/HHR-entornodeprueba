import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';

const mockFetchSyslabPdfArrayBuffer = vi.fn();
const mockDownloadExtensionBundle = vi.fn();
const mockDownloadBlob = vi.fn();

vi.mock('@/services/laboratory/syslabService', () => ({
  fetchSyslabPdfArrayBuffer: (...args: unknown[]) => mockFetchSyslabPdfArrayBuffer(...args),
}));

vi.mock('@/services/laboratory/syslabExtensionBridge', () => ({
  isSyslabExtensionLink: (link: string) =>
    /^hhr-syslab-extension:\/\/batch\/[0-9a-f-]{36}\/exam\/\d+$/i.test(link),
  downloadSyslabPdfBundleThroughExtension: (...args: unknown[]) =>
    mockDownloadExtensionBundle(...args),
}));

vi.mock('@/services/exporters/exportDownload', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}));

import { downloadCombinedSyslabPdf } from '@/services/laboratory/syslabPdfBundleService';

describe('combined Syslab PDF download', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps opaque reports inside the authenticated extension transport', async () => {
    const links = [
      'hhr-syslab-extension://batch/123e4567-e89b-12d3-a456-426614174000/exam/43091284',
      'hhr-syslab-extension://batch/123e4567-e89b-12d3-a456-426614174000/exam/43091285',
    ];

    await downloadCombinedSyslabPdf(links);

    expect(mockDownloadExtensionBundle).toHaveBeenCalledWith(links);
    expect(mockFetchSyslabPdfArrayBuffer).not.toHaveBeenCalled();
    expect(mockDownloadBlob).not.toHaveBeenCalled();
  });

  it('merges every page from legacy web reports into one downloaded PDF', async () => {
    const first = await PDFDocument.create();
    first.addPage();
    const second = await PDFDocument.create();
    second.addPage();
    second.addPage();
    mockFetchSyslabPdfArrayBuffer
      .mockResolvedValueOnce((await first.save()).buffer)
      .mockResolvedValueOnce((await second.save()).buffer);

    await downloadCombinedSyslabPdf(['https://proxy.test/1', 'https://proxy.test/2']);

    expect(mockDownloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'Examenes_Syslab_seleccionados.pdf'
    );
    const blob = mockDownloadBlob.mock.calls[0][0] as Blob;
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const merged = await PDFDocument.load(buffer);
    expect(merged.getPageCount()).toBe(3);
  });

  it('rejects mixed transports instead of leaking an extension report to the web proxy', async () => {
    await expect(
      downloadCombinedSyslabPdf([
        'hhr-syslab-extension://batch/123e4567-e89b-12d3-a456-426614174000/exam/43091284',
        'https://proxy.test/2',
      ])
    ).rejects.toThrow('orígenes distintos');
    expect(mockFetchSyslabPdfArrayBuffer).not.toHaveBeenCalled();
  });
});
