import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import type { CensusActionNotification } from '@/features/census/controllers/censusActionNotificationController';
import { useCensusTransferCommand } from '@/features/census/hooks/useCensusTransferCommand';
import {
  DEFAULT_EVACUATION_METHOD,
  DEFAULT_RECEIVING_CENTER,
  DEFAULT_TRANSFER_ESCORT,
  RECEIVING_CENTER_OTHER,
} from '@/constants/clinicalMovementConstants';

const { mockUseAuth, mockRecordCriticalClinicalAction } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockRecordCriticalClinicalAction: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: mockUseAuth,
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

describe('useCensusTransferCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      currentUser: {
        email: 'doctor@example.com',
      },
    });
  });

  const createHook = (transferStateOverride?: Record<string, unknown>) => {
    const addTransfer = vi.fn();
    const updateTransfer = vi.fn();
    const setTransferState = vi.fn();
    const notifyError = vi.fn<(notification: CensusActionNotification) => void>();

    const hook = renderHook(() =>
      useCensusTransferCommand({
        transferStateRef: {
          current: {
            bedId: 'R1',
            isOpen: true,
            evacuationMethod: DEFAULT_EVACUATION_METHOD,
            evacuationMethodOther: '',
            receivingCenter: DEFAULT_RECEIVING_CENTER,
            receivingCenterOther: '',
            transferEscort: DEFAULT_TRANSFER_ESCORT,
            ...transferStateOverride,
          },
        },
        stabilityRulesRef: {
          current: {
            canPerformActions: true,
            canEditField: () => true,
            isDateLocked: false,
            isDayShiftLocked: false,
            isNightShiftLocked: false,
            lockReason: undefined,
          },
        },
        addTransferRef: { current: addTransfer },
        updateTransferRef: { current: updateTransfer },
        recordRef: { current: createRecord() },
        setTransferState,
        getCurrentTime: () => '10:15',
        notifyError,
      })
    );

    return { ...hook, addTransfer, updateTransfer, setTransferState, notifyError };
  };

  it('executes transfer directly in census and records telemetry with destination hospital', async () => {
    const { result, addTransfer, updateTransfer, setTransferState, notifyError } = createHook({
      receivingCenter: RECEIVING_CENTER_OTHER,
      receivingCenterOther: 'Hospital Clínico',
    });

    await act(async () => {
      result.current({ time: '11:00' });
    });

    expect(addTransfer).toHaveBeenCalledTimes(1);
    expect(updateTransfer).not.toHaveBeenCalled();
    expect(setTransferState).toHaveBeenCalledTimes(1);
    expect(notifyError).not.toHaveBeenCalled();
    expect(mockRecordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'daily_record',
        action: 'census_transfer_created',
        outcome: 'success',
        clinicalDate: '2026-03-03',
        bedId: 'R1',
        patientRut: '12.345.678-9',
        userId: 'doctor@example.com',
        context: expect.objectContaining({ destinationHospital: 'Hospital Clínico' }),
      })
    );
  });

  it('updates an existing transfer record when editing', async () => {
    const { result, addTransfer, updateTransfer } = createHook({
      recordId: 'TR-EXISTING',
      diagnosis: 'Diagnóstico previo',
    });

    await act(async () => {
      result.current({ time: '11:00', diagnosis: 'Diagnóstico actualizado' });
    });

    expect(addTransfer).not.toHaveBeenCalled();
    expect(updateTransfer).toHaveBeenCalledTimes(1);
    expect(updateTransfer).toHaveBeenCalledWith(
      'TR-EXISTING',
      expect.objectContaining({
        time: '11:00',
        diagnosis: 'Diagnóstico actualizado',
      })
    );
  });

  it('notifies error and records failed telemetry when transfer validation fails', async () => {
    const { result, addTransfer, notifyError } = createHook({ bedId: null });

    await act(async () => {
      result.current({ time: '11:00' });
    });

    expect(addTransfer).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(mockRecordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'census_transfer_created',
        outcome: 'failed',
      })
    );
  });
});
