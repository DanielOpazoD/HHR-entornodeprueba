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
  beforeEach(() => vi.clearAllMocks());

  it('downloads every selected report in exam-list order', async () => {
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useLabViewerPdfDownload({
        examList: exams,
        selectedExamIds: new Set(['second', 'first']),
        setError,
      })
    );

    await act(() => result.current.downloadSelectedPdfs());

    expect(mockDownloadCombinedSyslabPdf).toHaveBeenCalledWith([
      'https://syslab.test/first',
      'https://syslab.test/second',
    ]);
    expect(result.current.isDownloadingSelectedPdfs).toBe(false);
  });

  it('rejects the whole selection when one report has no link', async () => {
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useLabViewerPdfDownload({
        examList: [exams[0], { ...exams[1], link: '' }],
        selectedExamIds: new Set(['first', 'second']),
        setError,
      })
    );

    await act(() => result.current.downloadSelectedPdfs());

    expect(mockDownloadCombinedSyslabPdf).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith(
      expect.stringContaining('Uno de los informes seleccionados no está disponible')
    );
  });

  it('ignores a stale failure after cancellation', async () => {
    let rejectDownload: (error: Error) => void = () => undefined;
    mockDownloadCombinedSyslabPdf.mockImplementation(
      () => new Promise<void>((_resolve, reject) => (rejectDownload = reject))
    );
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useLabViewerPdfDownload({ examList: exams, selectedExamIds: new Set(['first']), setError })
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
