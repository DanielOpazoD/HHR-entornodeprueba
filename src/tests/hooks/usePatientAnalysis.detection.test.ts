import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePatientAnalysis } from '@/features/admin/hooks/usePatientAnalysis';
import {
  defaultDailyRecordAnalysisPort,
  defaultDailyRecordReadPort,
  defaultDailyRecordWritePort,
} from '@/application/ports/dailyRecordPort';
import { defaultPatientMasterWritePort } from '@/application/ports/patientMasterPort';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: {
    getAvailableDates: vi.fn(),
    getForDate: vi.fn(),
  },
  defaultDailyRecordWritePort: {
    updatePartial: vi.fn(),
  },
  defaultDailyRecordAnalysisPort: {
    getAvailableDates: vi.fn(),
    getForDate: vi.fn(),
    updatePartial: vi.fn(),
  },
}));

vi.mock('@/application/ports/patientMasterPort', () => ({
  defaultPatientMasterWritePort: {
    bulkUpsertPatients: vi.fn(),
  },
}));

vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: vi.fn().mockReturnValue('test@test.com'),
}));

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('usePatientAnalysis — detection & event tracking', () => {
  const asRepoRecord = <T>(value: T) =>
    value as unknown as Awaited<ReturnType<typeof defaultDailyRecordReadPort.getForDate>>;

  const dailyRecordAnalysisPort = vi.mocked(defaultDailyRecordAnalysisPort);
  const dailyRecordReadPort = vi.mocked(defaultDailyRecordReadPort);
  // referenced so the mock handle is created even if this file doesn't assert on it
  void vi.mocked(defaultDailyRecordWritePort);
  void vi.mocked(defaultPatientMasterWritePort);

  beforeEach(() => {
    vi.clearAllMocks();
    dailyRecordAnalysisPort.getAvailableDates.mockImplementation(
      dailyRecordReadPort.getAvailableDates
    );
    dailyRecordAnalysisPort.getForDate.mockImplementation(dailyRecordReadPort.getForDate);
  });

  it('should run analysis and detect patients', async () => {
    const mockDates = ['2025-01-01'];
    const mockRecord = {
      date: '2025-01-01',
      beds: {
        'Bed-1': {
          rut: '11.111.111-1',
          patientName: 'John Doe',
          admissionDate: '2025-01-01',
        },
      },
    };

    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate.mockResolvedValue(asRepoRecord(mockRecord));

    const { result } = renderHook(() => usePatientAnalysis());

    await act(async () => {
      await result.current.runAnalysis();
    });

    expect(result.current.analysis).not.toBeNull();
    expect(result.current.analysis?.uniquePatients).toBe(1);
    expect(result.current.analysis?.validPatients[0].fullName).toBe('John Doe');
  });

  it('marks an existing analysis as stale when the daily record store changes', async () => {
    const mockDates = ['2025-01-01'];
    const mockRecord = {
      date: '2025-01-01',
      beds: {
        'Bed-1': {
          rut: '11.111.111-1',
          patientName: 'John Doe',
        },
      },
    };

    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate.mockResolvedValue(asRepoRecord(mockRecord));

    const { result } = renderHook(() => usePatientAnalysis());

    await act(async () => {
      await result.current.runAnalysis();
    });

    expect(result.current.isStale).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: ['2025-01-01'] },
        })
      );
    });

    expect(result.current.analysis).not.toBeNull();
    expect(result.current.isStale).toBe(true);
  });

  it('clears the stale flag after analysis is rerun successfully', async () => {
    dailyRecordReadPort.getAvailableDates
      .mockResolvedValueOnce(['2025-01-01'])
      .mockResolvedValueOnce(['2025-01-01', '2025-01-02']);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(
        asRepoRecord({
          date: '2025-01-01',
          beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe' } },
        })
      )
      .mockResolvedValueOnce(
        asRepoRecord({
          date: '2025-01-01',
          beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe' } },
        })
      )
      .mockResolvedValueOnce(
        asRepoRecord({
          date: '2025-01-02',
          beds: { B1: { rut: '22.222.222-2', patientName: 'Jane Roe' } },
        })
      );

    const { result } = renderHook(() => usePatientAnalysis());

    await act(async () => {
      await result.current.runAnalysis();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: ['2025-01-02'] },
        })
      );
    });

    expect(result.current.isStale).toBe(true);

    await act(async () => {
      await result.current.runAnalysis();
    });

    expect(result.current.isStale).toBe(false);
    expect(result.current.analysis?.uniquePatients).toBe(2);
  });

  it('keeps analysis stale when the store changes during an in-flight rerun', async () => {
    const initialRecord = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe' } },
    };
    const deferredDates = createDeferred<string[]>();

    dailyRecordReadPort.getAvailableDates
      .mockResolvedValueOnce(['2025-01-01'])
      .mockImplementationOnce(() => deferredDates.promise);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(asRepoRecord(initialRecord))
      .mockResolvedValueOnce(asRepoRecord(initialRecord));

    const { result } = renderHook(() => usePatientAnalysis());

    await act(async () => {
      await result.current.runAnalysis();
    });

    expect(result.current.isStale).toBe(false);

    let rerunPromise: Promise<void> | undefined;
    act(() => {
      rerunPromise = result.current.runAnalysis();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: ['2025-01-02'] },
        })
      );
    });

    await act(async () => {
      deferredDates.resolve(['2025-01-01']);
      await rerunPromise;
    });

    expect(result.current.analysis).not.toBeNull();
    expect(result.current.isStale).toBe(true);
  });

  it('marks analysis stale when the store changes during an in-flight analysis rerun', async () => {
    let resolveDates: ((dates: string[]) => void) | null = null;
    const pendingDates = new Promise<string[]>(resolve => {
      resolveDates = resolve;
    });

    dailyRecordReadPort.getAvailableDates
      .mockResolvedValueOnce(['2025-01-01'])
      .mockReturnValueOnce(pendingDates);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(
        asRepoRecord({
          date: '2025-01-01',
          beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe' } },
        })
      )
      .mockResolvedValueOnce(
        asRepoRecord({
          date: '2025-01-01',
          beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe' } },
        })
      );

    const { result } = renderHook(() => usePatientAnalysis());

    await act(async () => {
      await result.current.runAnalysis();
    });

    let rerunPromise: Promise<void> | undefined;
    act(() => {
      rerunPromise = result.current.runAnalysis();
    });

    expect(result.current.isAnalyzing).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: ['2025-01-01'] },
        })
      );
    });

    if (!resolveDates || !rerunPromise) {
      throw new Error('Expected deferred rerun to be initialized');
    }

    const finishPendingDates = resolveDates as (dates: string[]) => void;
    finishPendingDates(['2025-01-01']);

    await act(async () => {
      await rerunPromise;
    });

    expect(result.current.analysis).not.toBeNull();
    expect(result.current.isStale).toBe(true);
  });

  it('should detect name conflicts', async () => {
    const mockDates = ['2025-01-01', '2025-01-02'];
    const record1 = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe' } },
    };
    const record2 = {
      date: '2025-01-02',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Smith' } },
    };

    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(asRepoRecord(record1))
      .mockResolvedValueOnce(asRepoRecord(record2));

    const { result } = renderHook(() => usePatientAnalysis());

    await act(async () => {
      await result.current.runAnalysis();
    });

    expect(result.current.analysis?.conflicts).toHaveLength(1);
    expect(result.current.analysis?.conflicts[0].options).toContain('John Doe');
    expect(result.current.analysis?.conflicts[0].options).toContain('John Smith');
  });

  it('should track admissions and ongoing events', async () => {
    const mockDates = ['2025-01-01', '2025-01-02'];
    const record1 = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe', admissionDate: '2025-01-01' } },
    };
    const record2 = {
      date: '2025-01-02',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe', admissionDate: '2025-01-01' } },
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(asRepoRecord(record1))
      .mockResolvedValueOnce(asRepoRecord(record2));

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });

    const patient = result.current.analysis?.validPatients[0];
    // Should have 1 admission record, not 2 (second is an extension)
    const admissions = patient?.hospitalizations?.filter(h => h.type === 'Ingreso');
    expect(admissions).toHaveLength(1);
  });

  it('should track explicit discharges', async () => {
    const mockDates = ['2025-01-01'];
    const record1 = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe' } },
      discharges: [{ rut: '11.111.111-1', bedName: 'B1', diagnosis: 'Done', status: 'Alta' }],
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate.mockResolvedValue(asRepoRecord(record1));

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });

    const patient = result.current.analysis?.validPatients[0];
    const egresos = patient?.hospitalizations?.filter(h => h.type === 'Egreso');
    expect(egresos).toHaveLength(1);
  });

  it('should track silent discharges', async () => {
    const mockDates = ['2025-01-01', '2025-01-02'];
    const record1 = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe' } },
    };
    const record2 = {
      date: '2025-01-02',
      beds: {}, // Patient gone without explicit discharge
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(asRepoRecord(record1))
      .mockResolvedValueOnce(asRepoRecord(record2));

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });

    const patient = result.current.analysis?.validPatients[0];
    const autoEgresos = patient?.hospitalizations?.filter(h => h.type === 'Egreso');
    expect(autoEgresos).toHaveLength(1);
    expect(autoEgresos?.[0].id).toContain('egreso-auto');
  });

  it('should track transfers', async () => {
    const mockDates = ['2025-01-01'];
    const record = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe' } },
      transfers: [
        { rut: '11.111.111-1', bedName: 'B1', diagnosis: 'Heart', receivingCenter: 'Other Clinic' },
      ],
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate.mockResolvedValue(asRepoRecord(record));

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });

    const patient = result.current.analysis?.validPatients[0];
    const traslados = patient?.hospitalizations?.filter(h => h.type === 'Traslado');
    expect(traslados).toHaveLength(1);
    expect(traslados?.[0].receivingCenter).toBe('Other Clinic');
  });

  it('should track death events', async () => {
    const mockDates = ['2025-01-01'];
    const record = {
      date: '2025-01-01',
      beds: { B1: { rut: '11.111.111-1', patientName: 'John Doe' } },
      discharges: [
        { rut: '11.111.111-1', bedName: 'B1', status: 'Fallecido', diagnosis: 'Sepsis' },
      ],
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate.mockResolvedValue(asRepoRecord(record));

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });

    const patient = result.current.analysis?.validPatients[0];
    expect(patient?.vitalStatus).toBe('Fallecido');
    const deathEvent = patient?.hospitalizations?.filter(h => h.type === 'Fallecimiento');
    expect(deathEvent).toHaveLength(1);
  });

  it('should handle demographic mismatches during analysis', async () => {
    const mockDates = ['2025-01-01', '2025-01-02'];
    const record1 = {
      date: '2025-01-01',
      beds: {
        B1: {
          rut: '11.111.111-1',
          patientName: 'John',
          birthDate: '1990-01-01',
          biologicalSex: 'Masculino',
          isRapanui: false,
        },
      },
    };
    const record2 = {
      date: '2025-01-02',
      beds: {
        B1: {
          rut: '11.111.111-1',
          patientName: 'John',
          birthDate: '1991-01-01', // mismatch
          biologicalSex: 'Femenino', // mismatch
          isRapanui: true, // mismatch
        },
      },
    };
    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(asRepoRecord(record1))
      .mockResolvedValueOnce(asRepoRecord(record2));

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });

    expect(result.current.analysis?.uniquePatients).toBe(1);
  });

  it('should detect name conflicts across 3+ variations/days', async () => {
    const mockDates = ['2025-01-01', '2025-01-02', '2025-01-03'];
    const records = [
      { date: '2025-01-01', beds: { B1: { rut: '11.111.111-1', patientName: 'N1' } } },
      { date: '2025-01-02', beds: { B1: { rut: '11.111.111-1', patientName: 'N2' } } },
      { date: '2025-01-03', beds: { B1: { rut: '11.111.111-1', patientName: 'N3' } } },
    ];

    dailyRecordReadPort.getAvailableDates.mockResolvedValue(mockDates);
    dailyRecordReadPort.getForDate
      .mockResolvedValueOnce(asRepoRecord(records[0]))
      .mockResolvedValueOnce(asRepoRecord(records[1]))
      .mockResolvedValueOnce(asRepoRecord(records[2]));

    const { result } = renderHook(() => usePatientAnalysis());
    await act(async () => {
      await result.current.runAnalysis();
    });

    expect(result.current.analysis?.conflicts[0].options).toHaveLength(3);
    expect(result.current.analysis?.conflicts[0].records).toHaveLength(2); // First record is base, next 2 are conflicts
  });
});
