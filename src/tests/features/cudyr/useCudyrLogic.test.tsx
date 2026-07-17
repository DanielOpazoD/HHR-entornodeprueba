import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCudyrLogic } from '@/features/cudyr/hooks/useCudyrLogic';
import { mockAuditContextValue, mockAuthContextValue } from '../../setup';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const cudyrMocks = vi.hoisted(() => ({
  dailyRecordData: { record: null as DailyRecord | null },
  notifications: {
    success: vi.fn(),
    error: vi.fn(),
  },
  actions: {
    updateCudyr: vi.fn(),
    updateCudyrMultiple: vi.fn(),
    updateCudyrBatch: vi.fn(),
    updateClinicalCribCudyr: vi.fn(),
    updateClinicalCribCudyrMultiple: vi.fn(),
  },
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => cudyrMocks.dailyRecordData,
}));

vi.mock('@/context/useDailyRecordScopedActions', () => ({
  useDailyRecordCudyrActions: () => cudyrMocks.actions,
}));

vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    success: cudyrMocks.notifications.success,
    error: cudyrMocks.notifications.error,
    warning: vi.fn(),
    info: vi.fn(),
    notify: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

vi.mock('@/services/admin/attributionService', () => ({
  getAttributedAuthors: vi.fn(() => 'Test Author'),
}));

const createPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
  bedId,
  patientName: 'Paciente CUDYR',
  rut: '11.111.111-1',
  age: '50',
  pathology: 'Diagnóstico',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-03-01',
  admissionTime: '08:00',
  hasWristband: true,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  cudyr: {
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
  },
  ...overrides,
});

const createRecord = (): DailyRecord => ({
  date: '2026-03-23',
  beds: {
    R1: createPatient('R1', {
      cudyr: { ...createPatient('R1').cudyr!, changeClothes: undefined as never },
    }),
    R2: createPatient('R2', {
      patientName: 'Segundo Paciente',
      rut: '22.222.222-2',
      cudyr: { ...createPatient('R2').cudyr!, mobilization: undefined as never },
    }),
  },
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  activeExtraBeds: [],
  lastUpdated: '2026-03-23T00:00:00.000Z',
});

describe('useCudyrLogic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cudyrMocks.dailyRecordData.record = createRecord();
    cudyrMocks.actions.updateCudyrBatch.mockResolvedValue(true);
    (mockAuthContextValue as { role: string }).role = 'admin';
  });

  it('keeps pending CUDYR draft when batch persistence is not confirmed', async () => {
    cudyrMocks.actions.updateCudyrBatch.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useCudyrLogic(false));

    act(() => {
      result.current.handleScoreChange('R1', 'changeClothes', 2);
    });

    await act(async () => {
      await result.current.saveCudyrChanges();
    });

    expect(cudyrMocks.actions.updateCudyrBatch).toHaveBeenCalledTimes(1);
    expect(result.current.pendingCudyrChangeCount).toBe(1);
    expect(cudyrMocks.notifications.error).toHaveBeenCalledWith(
      'CUDYR pendiente',
      'No se pudo confirmar el guardado. Tus cambios siguen pendientes para reintentar.'
    );
    expect(mockAuditContextValue.logEvent).not.toHaveBeenCalledWith(
      'CUDYR_BATCH_SAVED',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('clears pending draft and writes an explicit batch audit after confirmed CUDYR save', async () => {
    const { result } = renderHook(() => useCudyrLogic(false));

    act(() => {
      result.current.handleScoreChange('R1', 'changeClothes', 2);
      result.current.handleScoreChange('R2', 'mobilization', 3);
    });

    await act(async () => {
      await result.current.saveCudyrChanges();
    });

    expect(result.current.pendingCudyrChangeCount).toBe(0);
    expect(cudyrMocks.notifications.success).toHaveBeenCalledWith(
      'CUDYR completado',
      'CUDYR del turno noche 2026-03-23 guardado y cerrado para edición.'
    );
    expect(mockAuditContextValue.logEvent).toHaveBeenCalledWith(
      'CUDYR_BATCH_SAVED',
      'dailyRecord',
      '2026-03-23',
      expect.objectContaining({
        fieldCount: 2,
        patientCount: 2,
        bedIds: ['R1', 'R2'],
      }),
      undefined,
      '2026-03-23',
      'Test Author'
    );
  });

  it('keeps an explicit zero CUDYR score as a pending value when the cell was empty', async () => {
    cudyrMocks.dailyRecordData.record = {
      ...createRecord(),
      beds: {
        R1: createPatient('R1', { cudyr: undefined }),
      },
    };
    const { result } = renderHook(() => useCudyrLogic(false));

    act(() => {
      result.current.handleScoreChange('R1', 'changeClothes', 0);
    });

    expect(result.current.pendingCudyrChangeCount).toBe(1);
    expect(result.current.record?.beds.R1?.cudyr?.changeClothes).toBe(0);

    await act(async () => {
      await result.current.saveCudyrChanges();
    });

    expect(cudyrMocks.actions.updateCudyrBatch).toHaveBeenCalledWith({
      beds: { R1: { changeClothes: 0 } },
      clinicalCribs: {},
      metadata: expect.objectContaining({
        savedBy: 'Test Author',
        savedById: 'test-user-123',
        shiftDate: '2026-03-23',
      }),
    });
  });

  it('keeps delayed synchronization bound to the night-shift record date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 17, 10, 30));
    cudyrMocks.dailyRecordData.record = {
      ...createRecord(),
      date: '2026-07-16',
    };
    const { result } = renderHook(() => useCudyrLogic(false));

    act(() => {
      result.current.handleScoreChange('R1', 'changeClothes', 2);
    });
    await act(async () => {
      await result.current.saveCudyrChanges();
    });

    expect(cudyrMocks.actions.updateCudyrBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          savedAt: new Date(2026, 6, 17, 10, 30).toISOString(),
          shiftDate: '2026-07-16',
        }),
      })
    );
    vi.useRealTimers();
  });

  it('keeps a completed CUDYR read-only for nurses', () => {
    (mockAuthContextValue as { role: string }).role = 'nurse_hospital';
    cudyrMocks.dailyRecordData.record = {
      ...createRecord(),
      beds: {
        R1: createPatient('R1'),
        R2: createPatient('R2', {
          patientName: 'Segundo Paciente',
          rut: '22.222.222-2',
        }),
      },
    };
    const { result } = renderHook(() => useCudyrLogic(false));

    expect(result.current.isCompletionLocked).toBe(true);
    act(() => {
      result.current.handleScoreChange('R1', 'changeClothes', 3);
    });
    expect(result.current.pendingCudyrChangeCount).toBe(0);
  });

  it('notifies before discarding a draft completed from another tab', () => {
    const { result, rerender } = renderHook(() => useCudyrLogic(false));

    act(() => {
      result.current.handleScoreChange('R1', 'changeClothes', 2);
    });
    expect(result.current.pendingCudyrChangeCount).toBe(1);

    cudyrMocks.dailyRecordData.record = {
      ...cudyrMocks.dailyRecordData.record!,
      cudyrLocked: true,
    };
    rerender();

    expect(result.current.pendingCudyrChangeCount).toBe(0);
    expect(cudyrMocks.notifications.error).toHaveBeenCalledWith(
      'Cambios CUDYR descartados',
      'Otro profesional completó este CUDYR. Tus cambios pendientes no fueron aplicados.'
    );
  });

  it('protects the page unload flow while CUDYR changes are pending', () => {
    const { result, unmount } = renderHook(() => useCudyrLogic(false));

    act(() => {
      result.current.handleScoreChange('R1', 'changeClothes', 2);
    });

    const event = new Event('beforeunload', { cancelable: true });
    const allowed = window.dispatchEvent(event);

    expect(allowed).toBe(false);
    expect(event.defaultPrevented).toBe(true);

    unmount();
  });
});
