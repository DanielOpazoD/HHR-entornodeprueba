import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLabViewerPdfDownload } from '@/features/laboratory/hooks/useLabViewerPdfDownload';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';

const mockDownloadCombinedSyslabPdf = vi.fn();
vi.mock('@/services/laboratory/syslabPdfBundleService', () => ({
  downloadCombinedSyslabPdf: (...args: unknown[]) => mockDownloadCombinedSyslabPdf(...args),
}));

const exams: SyslabExamItem[] = [
  {
    id: 'first',
    link: 'https://syslab.test/first',
    date: '06/04/2026',
    time: '13:08:43',
    patientName: 'Paciente',
    origin: 'HHR',
    exams: ['Hemograma'],
  },
  {
    id: 'second',
    link: 'https://syslab.test/second',
    date: '01/03/2026',
    time: '09:00:00',
    patientName: 'Paciente',
    origin: 'HHR',
    exams: ['Creatinina'],
  },
];

describe('useLabViewerPdfDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDownloadCombinedSyslabPdf.mockResolvedValue({
      filename: 'Laboratorio HHR 01-03-2026 a 06-04-2026, Paciente, 14.125.562-2.pdf',
      reportCount: 2,
      pageCount: 4,
    });
  });

  it('downloads every selected report in exam-list order', async () => {
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useLabViewerPdfDownload({
        examList: exams,
        selectedExamIds: new Set(['second', 'first']),
        selectedRut: '14.125.562-2',
        setError,
      })
    );

    await act(() => result.current.downloadSelectedPdfs());

    expect(mockDownloadCombinedSyslabPdf).toHaveBeenCalledWith(
      expect.objectContaining({ exams, rut: '14.125.562-2', onProgress: expect.any(Function) })
    );
    expect(result.current.isDownloadingSelectedPdfs).toBe(false);
    expect(result.current.pdfDownloadStatus).toMatchObject({
      phase: 'success',
      total: 2,
      pageCount: 4,
    });
  });

  it('rejects the whole selection when one report has no link', async () => {
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useLabViewerPdfDownload({
        examList: [exams[0], { ...exams[1], link: '' }],
        selectedExamIds: new Set(['first', 'second']),
        selectedRut: '14.125.562-2',
        setError,
      })
    );

    await act(() => result.current.downloadSelectedPdfs());

    expect(mockDownloadCombinedSyslabPdf).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith(
      expect.stringContaining('Uno de los informes seleccionados no está disponible')
    );
  });

  it('preserves the informative compatibility state returned by an older extension', async () => {
    mockDownloadCombinedSyslabPdf.mockResolvedValueOnce({
      filename: 'Examenes_Syslab_seleccionados.pdf',
      reportCount: 2,
      pageCount: 0,
      legacyExtension: true,
    });
    const { result } = renderHook(() =>
      useLabViewerPdfDownload({
        examList: exams,
        selectedExamIds: new Set(['first', 'second']),
        selectedRut: '14.125.562-2',
        setError: vi.fn(),
      })
    );

    await act(() => result.current.downloadSelectedPdfs());

    expect(result.current.pdfDownloadStatus).toMatchObject({
      phase: 'success',
      legacyExtension: true,
      total: 2,
      pageCount: 0,
    });
  });

  it('ignores a stale failure after cancellation', async () => {
    let rejectDownload: (error: Error) => void = () => undefined;
    mockDownloadCombinedSyslabPdf.mockImplementation(
      () => new Promise<void>((_resolve, reject) => (rejectDownload = reject))
    );
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useLabViewerPdfDownload({
        examList: exams,
        selectedExamIds: new Set(['first']),
        selectedRut: '14.125.562-2',
        setError,
      })
    );

    let pendingDownload: Promise<void>;
    act(() => {
      pendingDownload = result.current.downloadSelectedPdfs();
    });
    act(() => result.current.cancelPdfDownload());
    await act(async () => {
      rejectDownload(new Error('Error anterior.'));
      await pendingDownload!;
    });

    expect(result.current.isDownloadingSelectedPdfs).toBe(false);
    expect(setError).not.toHaveBeenCalledWith('Error anterior.');
  });
});
