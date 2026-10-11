import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLabViewerAnalysis } from '@/features/laboratory/hooks/useLabViewerAnalysis';
import type { SyslabExamDetail, SyslabExamItem } from '@/types/domain/labExamTypes';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  micro: vi.fn(),
  urine: vi.fn(),
  save: vi.fn(),
  copy: vi.fn(),
}));
vi.mock('@/services/laboratory/syslabService', () => ({ fetchSyslabExamDetails: mocks.fetch }));
vi.mock('@/features/laboratory/services/labMicrobiologyPdfService', () => ({
  enrichMicrobiologyDetailsFromPdf: mocks.micro,
}));
vi.mock('@/features/laboratory/services/labUrinePdfService', () => ({
  enrichUrineRatioDetailsFromPdf: mocks.urine,
}));
vi.mock('@/features/laboratory/services/labFirestoreService', () => ({
  saveLabResults: mocks.save,
}));
vi.mock('@/shared/runtime/browserClipboardRuntime', () => ({ writeClipboardText: mocks.copy }));

const exam: SyslabExamItem = {
  id: 'exam-a',
  link: 'https://example.test/exam-a',
  date: '03/10/2026',
  time: '10:00',
  patientName: 'Paciente sintético',
  origin: 'TEST',
  exams: ['HEMOGRAMA'],
};
const details: SyslabExamDetail[] = [
  {
    url: 'https://example.test/exam-a',
    findings: [
      {
        section: 'HEMOGRAMA',
        analysis: 'Hemoglobina',
        result: '14',
        unit: 'g/dL',
        refValue: '12-16',
      },
    ],
  },
];
const response = { success: true, data: details };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const setup = () => {
  const setError = vi.fn();
  return {
    setError,
    ...renderHook(
      ({ rut }) =>
        useLabViewerAnalysis({
          examList: [exam],
          selectedExamIds: new Set([exam.id]),
          selectedRut: rut,
          isLoading: false,
          setError,
        }),
      { initialProps: { rut: 'patient-a' } }
    ),
  };
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue(response);
  mocks.micro.mockImplementation(async value => value);
  mocks.urine.mockImplementation(async value => value);
  mocks.save.mockResolvedValue(undefined);
});

describe('laboratory analysis request ownership', () => {
  it('discards a late response after A → B → A without starting PDF enrichment or saving', async () => {
    const pending = deferred<typeof response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    const view = setup();
    let work!: Promise<void>;
    act(() => {
      work = view.result.current.analyzeSelected();
    });
    view.rerender({ rut: 'patient-b' });
    expect(view.result.current.isAnalyzing).toBe(false);
    view.rerender({ rut: 'patient-a' });
    await act(async () => {
      pending.resolve(response);
      await work;
    });
    expect(view.result.current.analysisData).toBeNull();
    expect(mocks.micro).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(['resetAnalysis', 'closeAnalysis'] as const)(
    'invalidates a pending enrichment on %s',
    async action => {
      const pending = deferred<SyslabExamDetail[]>();
      mocks.micro.mockReturnValueOnce(pending.promise);
      const view = setup();
      let work!: Promise<void>;
      await act(async () => {
        work = view.result.current.analyzeSelected();
      });
      act(() => view.result.current[action]());
      await act(async () => {
        pending.resolve(details);
        await work;
      });
      expect(mocks.urine).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(view.result.current.analysisData).toBeNull();
      expect(view.result.current.isAnalyzing).toBe(false);
    }
  );
  it('does not let an obsolete failure finish or replace a newer analysis', async () => {
    const old = deferred<typeof response>();
    const current = deferred<typeof response>();
    mocks.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = setup();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = view.result.current.analyzeSelected();
    });
    act(() => view.result.current.resetAnalysis());
    act(() => {
      second = view.result.current.analyzeSelected();
    });
    await act(async () => {
      old.reject(new Error('obsolete failure'));
      await first;
    });
    expect(view.result.current.isAnalyzing).toBe(true);
    expect(view.setError).not.toHaveBeenCalledWith('obsolete failure');
    await act(async () => {
      current.resolve(response);
      await second;
    });
    expect(view.result.current.analysisData).not.toBeNull();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith('patient-a', exam.patientName, details, [exam]);
  });
  it('does not copy a summary after the selection has been reset', async () => {
    const pending = deferred<typeof response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    const view = setup();
    let work!: Promise<boolean>;
    act(() => {
      work = view.result.current.copyExamSummary(exam);
    });
    act(() => view.result.current.resetAnalysis());
    await act(async () => {
      pending.resolve(response);
      expect(await work).toBe(false);
    });
    expect(mocks.copy).not.toHaveBeenCalled();
  });
});
