import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBedManagement } from '@/hooks/useBedManagement';
import type {
  DailyRecord,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { PatientData } from '@/types/domain/patient';
import type { CudyrScore } from '@/types/domain/cudyr';
import { Specialty, PatientStatus } from '@/types/domain/patientClassification';
import { mockAuditContextValue } from '../setup';

vi.mock('@/services/factories/patientFactory', () => ({
  createEmptyPatient: vi.fn((bedId: string) => ({
    bedId,
    patientName: '',
    rut: '',
    age: '',
    pathology: '',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    admissionDate: '',
    hasWristband: false,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    isBlocked: false,
    bedMode: 'Cama' as const,
    hasCompanionCrib: false,
  })),
  clonePatient: vi.fn((patient: PatientData, newBedId: string) => ({
    ...patient,
    bedId: newBedId,
  })),
}));

vi.mock('@/services/admin/attributionService', () => ({
  getAttributedAuthors: vi.fn(() => 'Test Author'),
}));

describe('useBedManagement CUDYR updates', () => {
  const mockSaveAndUpdate = vi.fn().mockResolvedValue(undefined) as PersistDailyRecord;
  const mockPatchRecord = vi.fn().mockResolvedValue(undefined);

  const runBedAction = async (action: () => void) => {
    await act(async () => {
      action();
      await Promise.resolve();
    });
  };

  const createMockPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
    bedId,
    patientName: 'Test Patient',
    rut: '12.345.678-9',
    age: '45',
    pathology: 'Test Diagnosis',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    admissionDate: '2025-01-01',
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    ...overrides,
  });

  const createMockRecord = (beds: Record<string, PatientData> = {}): DailyRecord => ({
    date: '2025-01-01',
    beds,
    discharges: [],
    transfers: [],
    lastUpdated: '2025-01-01T00:00:00.000Z',
    nurses: [],
    activeExtraBeds: [],
    cma: [],
  });

  const completeCudyr = (overrides: Partial<CudyrScore> = {}): CudyrScore => ({
    changeClothes: 0,
    mobilization: 0,
    feeding: 0,
    elimination: 0,
    psychosocial: 0,
    surveillance: 0,
    vitalSigns: 0,
    fluidBalance: 0,
    oxygenTherapy: 0,
    airway: 0,
    proInterventions: 0,
    skinCare: 0,
    pharmacology: 0,
    invasiveElements: 0,
    ...overrides,
  });

  const batchMetadata = (record: DailyRecord, savedAt: string) => ({
    savedAt,
    savedBy: 'Test Author',
    savedById: 'test-user-123',
    shiftDate: record.date,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('updates the Cudyr field and logs modification', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:15:00.000Z'));
    const patient = createMockPatient('R1');
    const record = createMockRecord({ R1: patient });

    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await runBedAction(() => result.current.updateCudyr('R1', 'changeClothes', 3));

    expect(mockPatchRecord).toHaveBeenCalledWith({
      'beds.R1.cudyr.changeClothes': 3,
      cudyrUpdatedAt: '2026-03-23T10:15:00.000Z',
    });
    expect(mockAuditContextValue.logCudyrModified).toHaveBeenCalledWith(
      'R1',
      'Test Patient',
      patient.rut,
      'changeClothes',
      3,
      0,
      record.date,
      'Test Author'
    );
  });

  it('persists multiple CUDYR field changes in one patch and audits each changed field', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:15:00.000Z'));
    const patient = createMockPatient('R1', {
      cudyr: {
        changeClothes: 0,
        mobilization: 1,
      } as PatientData['cudyr'],
    });
    const record = createMockRecord({ R1: patient });

    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await runBedAction(() =>
      result.current.updateCudyrMultiple('R1', {
        changeClothes: 3,
        mobilization: 2,
      })
    );

    expect(mockPatchRecord).toHaveBeenCalledTimes(1);
    expect(mockPatchRecord).toHaveBeenCalledWith({
      'beds.R1.cudyr.changeClothes': 3,
      'beds.R1.cudyr.mobilization': 2,
      cudyrUpdatedAt: '2026-03-23T10:15:00.000Z',
    });
    expect(mockAuditContextValue.logCudyrModified).toHaveBeenCalledTimes(2);
    expect(mockAuditContextValue.logCudyrModified).toHaveBeenNthCalledWith(
      1,
      'R1',
      'Test Patient',
      patient.rut,
      'changeClothes',
      3,
      0,
      record.date,
      'Test Author'
    );
    expect(mockAuditContextValue.logCudyrModified).toHaveBeenNthCalledWith(
      2,
      'R1',
      'Test Patient',
      patient.rut,
      'mobilization',
      2,
      1,
      record.date,
      'Test Author'
    );
  });

  it('persists CUDYR changes across patients and clinical cribs in one batch patch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:30:00.000Z'));
    const patient = createMockPatient('R1', {
      cudyr: { changeClothes: 0 } as PatientData['cudyr'],
      clinicalCrib: createMockPatient('R1-C', {
        patientName: 'Baby',
        rut: '1-1',
        cudyr: { feeding: 0 } as PatientData['cudyr'],
      }),
    });
    const secondPatient = createMockPatient('R2', {
      patientName: 'Second Patient',
      rut: '2-2',
      cudyr: { mobilization: 0 } as PatientData['cudyr'],
    });
    const record = createMockRecord({ R1: patient, R2: secondPatient });

    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      await result.current.updateCudyrBatch({
        beds: {
          R1: { changeClothes: 2 },
          R2: { mobilization: 3 },
        },
        clinicalCribs: {
          R1: { feeding: 1 },
        },
        metadata: batchMetadata(record, '2026-03-23T10:30:00.000Z'),
      });
    });

    expect(mockPatchRecord).toHaveBeenCalledTimes(1);
    expect(mockPatchRecord).toHaveBeenCalledWith({
      'beds.R1.cudyr.changeClothes': 2,
      'beds.R2.cudyr.mobilization': 3,
      'beds.R1.clinicalCrib.cudyr.feeding': 1,
      cudyrUpdatedAt: '2026-03-23T10:30:00.000Z',
      cudyrUpdatedBy: 'Test Author',
      cudyrUpdatedById: 'test-user-123',
      cudyrShiftDate: record.date,
    });
    expect(mockAuditContextValue.logCudyrModified).toHaveBeenCalledTimes(3);
  });

  it('writes CUDYR batch fields as granular paths to preserve concurrent cell edits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:32:00.000Z'));
    const record = createMockRecord({
      R1: createMockPatient('R1', {
        cudyr: { changeClothes: 0, mobilization: 0 } as PatientData['cudyr'],
      }),
    });

    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      await result.current.updateCudyrBatch({
        beds: {
          R1: { changeClothes: 2, mobilization: 3 },
        },
        metadata: batchMetadata(record, '2026-03-23T10:32:00.000Z'),
      });
    });

    expect(mockPatchRecord).toHaveBeenCalledWith({
      'beds.R1.cudyr.changeClothes': 2,
      'beds.R1.cudyr.mobilization': 3,
      cudyrUpdatedAt: '2026-03-23T10:32:00.000Z',
      cudyrUpdatedBy: 'Test Author',
      cudyrUpdatedById: 'test-user-123',
      cudyrShiftDate: record.date,
    });
  });

  it('persists CUDYR ownership and closure metadata with the night-shift record', async () => {
    const record = createMockRecord({
      R1: createMockPatient('R1', {
        cudyr: { ...completeCudyr(), changeClothes: undefined as never },
      }),
    });
    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      await result.current.updateCudyrBatch({
        beds: { R1: { changeClothes: 2 } },
        metadata: {
          savedAt: '2026-07-17T01:00:00.000Z',
          savedBy: 'Enfermera Noche',
          savedById: 'user_nurse',
          shiftDate: '2025-01-01',
        },
      });
    });

    expect(mockPatchRecord).toHaveBeenCalledWith({
      'beds.R1.cudyr.changeClothes': 2,
      cudyrUpdatedAt: '2026-07-17T01:00:00.000Z',
      cudyrUpdatedBy: 'Enfermera Noche',
      cudyrUpdatedById: 'user_nurse',
      cudyrLocked: true,
      cudyrLockedAt: '2026-07-17T01:00:00.000Z',
      cudyrLockedBy: 'user_nurse',
      cudyrShiftDate: '2025-01-01',
      cudyrCompletedAt: '2026-07-17T01:00:00.000Z',
      cudyrCompletedBy: 'Enfermera Noche',
    });
  });

  it('rejects a CUDYR batch whose shift owner differs from the record receiving scores', async () => {
    const record = createMockRecord({ R1: createMockPatient('R1') });
    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await expect(
      result.current.updateCudyrBatch({
        beds: { R1: { changeClothes: 2 } },
        metadata: {
          savedAt: '2026-07-17T15:00:00.000Z',
          savedBy: 'Enfermera Día',
          savedById: 'user-day',
          shiftDate: '2025-01-02',
        },
      })
    ).resolves.toBe(false);
    expect(mockPatchRecord).not.toHaveBeenCalled();
  });

  it('rejects unattributed batch completion attempts at the mutation boundary', async () => {
    const record = createMockRecord({ R1: createMockPatient('R1') });
    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await expect(
      result.current.updateCudyrBatch({ beds: { R1: { changeClothes: 2 } } } as never)
    ).resolves.toBe(false);
    expect(mockPatchRecord).not.toHaveBeenCalled();
  });

  it('blocks legacy single-cell mutation paths after CUDYR closure', async () => {
    const record = {
      ...createMockRecord({ R1: createMockPatient('R1') }),
      cudyrLocked: true,
    };
    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await runBedAction(() => result.current.updateCudyr('R1', 'changeClothes', 2));
    expect(mockPatchRecord).not.toHaveBeenCalled();
  });

  it('rejects stale nurse CUDYR writes after the record was closed', async () => {
    const record = {
      ...createMockRecord({ R1: createMockPatient('R1') }),
      cudyrLocked: true,
    };
    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await expect(
      result.current.updateCudyrBatch({
        beds: { R1: { changeClothes: 2 } },
        metadata: {
          savedAt: '2026-07-17T01:00:00.000Z',
          savedBy: 'Enfermera Noche',
          savedById: 'user_nurse',
          shiftDate: record.date,
        },
      })
    ).resolves.toBe(false);
    expect(mockPatchRecord).not.toHaveBeenCalled();
  });

  it('creates only changed CUDYR fields when the patient had no previous CUDYR object', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:35:00.000Z'));
    const record = createMockRecord({ R1: createMockPatient('R1') });

    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      await result.current.updateCudyrBatch({
        beds: { R1: { changeClothes: 2, mobilization: 3, vitalSigns: 1 } },
        clinicalCribs: {},
        metadata: batchMetadata(record, '2026-03-23T10:35:00.000Z'),
      });
    });

    expect(mockPatchRecord).toHaveBeenCalledWith({
      'beds.R1.cudyr.changeClothes': 2,
      'beds.R1.cudyr.mobilization': 3,
      'beds.R1.cudyr.vitalSigns': 1,
      cudyrUpdatedAt: '2026-03-23T10:35:00.000Z',
      cudyrUpdatedBy: 'Test Author',
      cudyrUpdatedById: 'test-user-123',
      cudyrShiftDate: record.date,
    });
  });

  it('reports whether CUDYR batch persistence was confirmed', async () => {
    const record = createMockRecord({ R1: createMockPatient('R1') });

    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await expect(
      result.current.updateCudyrBatch({
        beds: { R1: { changeClothes: 2 } },
        clinicalCribs: {},
        metadata: batchMetadata(record, '2025-01-01T01:00:00.000Z'),
      })
    ).resolves.toBe(true);

    mockPatchRecord.mockRejectedValueOnce(new Error('sync failed'));

    await expect(
      result.current.updateCudyrBatch({
        beds: { R1: { mobilization: 3 } },
        clinicalCribs: {},
        metadata: batchMetadata(record, '2025-01-01T01:01:00.000Z'),
      })
    ).resolves.toBe(false);
    expect(mockAuditContextValue.logCudyrModified).toHaveBeenCalledTimes(1);
  });

  it('ignores CUDYR updates for beds without a real patient name', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:20:00.000Z'));
    const patient = createMockPatient('R1', {
      patientName: '   ',
      rut: '',
    });
    const record = createMockRecord({ R1: patient });

    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    act(() => {
      result.current.updateCudyr('R1', 'changeClothes', 3);
    });

    expect(mockPatchRecord).not.toHaveBeenCalled();
    expect(mockAuditContextValue.logDebouncedEvent).not.toHaveBeenCalled();
  });

  it('updates clinical crib CUDYR', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T11:05:00.000Z'));
    const patient = createMockPatient('R1', {
      clinicalCrib: { patientName: 'Baby', rut: '1-1', cudyr: {} } as PatientData,
    });
    const record = createMockRecord({ R1: patient });

    const { result } = renderHook(() =>
      useBedManagement(record, mockSaveAndUpdate, mockPatchRecord)
    );

    await runBedAction(() => result.current.updateClinicalCribCudyr('R1', 'feeding', 2));

    expect(mockPatchRecord).toHaveBeenCalledWith({
      'beds.R1.clinicalCrib.cudyr.feeding': 2,
      cudyrUpdatedAt: '2026-03-23T11:05:00.000Z',
    });
    expect(mockAuditContextValue.logCudyrModified).toHaveBeenCalledWith(
      'R1-crib',
      'Baby',
      '1-1',
      'feeding',
      2,
      0,
      record.date,
      'Test Author'
    );
  });
});
