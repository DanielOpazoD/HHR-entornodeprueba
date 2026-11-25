import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import type { CensusActionNotification } from '@/features/census/controllers/censusActionNotificationController';
import { useCensusDischargeCommand } from '@/features/census/hooks/useCensusDischargeCommand';

const { mockRecordCriticalClinicalAction } = vi.hoisted(() => ({
  mockRecordCriticalClinicalAction: vi.fn(),
}));

vi.mock('@/services/observability/criticalClinicalActionRecorder', () => ({
  recordCriticalClinicalAction: mockRecordCriticalClinicalAction,
}));

const createRecord = (): DailyRecord => ({
  date: '2026-03-03',
  beds: {
    R1: {
      bedId: 'R1',
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      patientName: 'Paciente Traslado',
      rut: '12.345.678-9',
      age: '50',
      pathology: 'Diagnóstico',
      specialty: Specialty.MEDICINA,
      status: PatientStatus.ESTABLE,
      admissionDate: '2026-03-01',
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
      location: 'R1',
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-03-03T10:00:00.000Z',
  nurses: [],
  activeExtraBeds: [],
});

describe('useCensusDischargeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createHook = (overrides?: { canPerformActions?: boolean; recordId?: string }) => {
    const addDischarge = vi.fn();
    const updateDischarge = vi.fn();
    const setDischargeState = vi.fn();
    const notifyError = vi.fn<(notification: CensusActionNotification) => void>();

    const hook = renderHook(() =>
      useCensusDischargeCommand({
        dischargeStateRef: {
          current: {
            bedId: 'R1',
            isOpen: true,
            status: 'Vivo',
            recordId: overrides?.recordId,
          },
        },
        recordRef: {
          current: createRecord(),
        },
        stabilityRulesRef: {
          current: {
            canPerformActions: overrides?.canPerformActions ?? true,
            canEditField: () => true,
            isDateLocked: false,
            isDayShiftLocked: false,
            isNightShiftLocked: false,
            lockReason: undefined,
          },
        },
        addDischargeRef: { current: addDischarge },
        updateDischargeRef: { current: updateDischarge },
        setDischargeState,
        getCurrentTime: () => '10:15',
        notifyError,
      })
    );

    return {
      ...hook,
      addDischarge,
      updateDischarge,
      setDischargeState,
      notifyError,
    };
  };

  it('executes discharge directly and records critical action telemetry', async () => {
    const { result, addDischarge, setDischargeState } = createHook();

    await act(async () => {
      result.current();
    });

    expect(addDischarge).toHaveBeenCalledTimes(1);
    expect(setDischargeState).toHaveBeenCalledTimes(1);
    expect(mockRecordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'daily_record',
        action: 'census_discharge_created',
        outcome: 'success',
        clinicalDate: '2026-03-03',
        bedId: 'R1',
        patientRut: '12.345.678-9',
      })
    );
  });

  it('updates an existing discharge record when recordId is present', async () => {
    const { result, addDischarge, updateDischarge } = createHook({ recordId: 'DIS-1' });

    await act(async () => {
      result.current({ status: 'Vivo', time: '11:30' });
    });

    expect(addDischarge).not.toHaveBeenCalled();
    expect(updateDischarge).toHaveBeenCalledTimes(1);
  });

  it('notifies error and records failed telemetry when actions are locked', async () => {
    const { result, addDischarge, notifyError } = createHook({ canPerformActions: false });

    await act(async () => {
      result.current();
    });

    expect(addDischarge).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(mockRecordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'census_discharge_created',
        outcome: 'failed',
      })
    );
  });
});
