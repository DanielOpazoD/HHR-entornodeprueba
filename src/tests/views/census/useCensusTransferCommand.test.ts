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
} from '@/constants/clinicalMovementConstants';

const {
  mockGetLatestOpenTransferRequestByBedId,
  mockCreateFinalizedTransferRequestWithResult,
  mockCompleteTransferWithResult,
  mockUseAuth,
  mockRecordCriticalClinicalAction,
} = vi.hoisted(() => ({
  mockGetLatestOpenTransferRequestByBedId: vi.fn(),
  mockCreateFinalizedTransferRequestWithResult: vi.fn(),
  mockCompleteTransferWithResult: vi.fn(),
  mockUseAuth: vi.fn(),
  mockRecordCriticalClinicalAction: vi.fn(),
}));

vi.mock('@/services/transfers/transferService', () => ({
  getLatestOpenTransferRequestByBedId: mockGetLatestOpenTransferRequestByBedId,
  createFinalizedTransferRequestWithResult: mockCreateFinalizedTransferRequestWithResult,
  completeTransferWithResult: mockCompleteTransferWithResult,
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

  it('executes transfer and syncs a finalized transfer request when there is no linked open request', async () => {
    mockGetLatestOpenTransferRequestByBedId.mockResolvedValue(null);
    mockCreateFinalizedTransferRequestWithResult.mockResolvedValue({
      status: 'success',
      data: { id: 'TR-1' },
    });
    const { result, addTransfer, updateTransfer, setTransferState } = createHook();

    await act(async () => {
      result.current({ time: '11:00' });
    });

    expect(addTransfer).toHaveBeenCalledTimes(1);
    expect(updateTransfer).not.toHaveBeenCalled();
    expect(setTransferState).toHaveBeenCalledTimes(1);
    expect(mockCreateFinalizedTransferRequestWithResult).toHaveBeenCalledWith(
      expect.objectContaining({
        bedId: 'R1',
        createdBy: 'doctor@example.com',
        requestDate: '2026-03-03',
        status: 'TRANSFERRED',
      }),
      'doctor@example.com'
    );
    expect(mockGetLatestOpenTransferRequestByBedId).toHaveBeenCalledWith('R1', {
      referenceDate: '2026-03-03',
    });
    expect(mockCompleteTransferWithResult).not.toHaveBeenCalled();
    expect(mockRecordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'daily_record',
        action: 'census_transfer_created',
        outcome: 'success',
        clinicalDate: '2026-03-03',
        bedId: 'R1',
        patientRut: '12.345.678-9',
        userId: 'doctor@example.com',
      })
    );
  });

  it('finalizes the linked transfer request when one already exists for the bed', async () => {
    mockGetLatestOpenTransferRequestByBedId.mockResolvedValue({ id: 'TR-9' });
    mockCompleteTransferWithResult.mockResolvedValue({ status: 'success', data: null });
    const { result, addTransfer, setTransferState } = createHook();

    await act(async () => {
      result.current({ time: '11:00' });
    });

    expect(addTransfer).toHaveBeenCalledTimes(1);
    expect(setTransferState).toHaveBeenCalledTimes(1);
    expect(mockCreateFinalizedTransferRequestWithResult).not.toHaveBeenCalled();
    expect(mockGetLatestOpenTransferRequestByBedId).toHaveBeenCalledWith('R1', {
      referenceDate: '2026-03-03',
    });
    expect(mockCompleteTransferWithResult).toHaveBeenCalledWith('TR-9', 'doctor@example.com');
    expect(mockRecordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'census_transfer_linked_request_finalized',
        outcome: 'success',
        context: expect.objectContaining({ linkedTransferRequestId: 'TR-9' }),
      })
    );
  });

  it('does not sync transfer request when editing an existing transfer record', async () => {
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
    expect(mockGetLatestOpenTransferRequestByBedId).not.toHaveBeenCalled();
    expect(mockCreateFinalizedTransferRequestWithResult).not.toHaveBeenCalled();
  });

  it('notifies warning when transfer sync fails after registering the transfer', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetLatestOpenTransferRequestByBedId.mockRejectedValue(new Error('sync failed'));
    const { result, addTransfer, notifyError } = createHook();

    await act(async () => {
      result.current({ time: '11:00' });
    });

    expect(addTransfer).toHaveBeenCalledTimes(1);
    expect(mockRecordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'census_transfer_created',
        outcome: 'success',
      })
    );
    expect(mockRecordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'census_transfer_management_sync',
        outcome: 'failed',
        issues: ['sync failed'],
      })
    );
    expect(notifyError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Traslado registrado con advertencia',
      })
    );

    errorSpy.mockRestore();
  });

  it('notifies warning when linked transfer finalization is rejected by Firestore', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetLatestOpenTransferRequestByBedId.mockResolvedValue({ id: 'TR-9' });
    mockCompleteTransferWithResult.mockResolvedValue({
      status: 'permission_denied',
      data: null,
      userSafeMessage: 'No se pudo completar el traslado.',
      error: new Error('Missing or insufficient permissions.'),
    });
    const { result, addTransfer, notifyError } = createHook();

    await act(async () => {
      result.current({ time: '11:00' });
    });

    expect(addTransfer).toHaveBeenCalledTimes(1);
    expect(mockRecordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'census_transfer_management_sync',
        outcome: 'failed',
        issues: ['No se pudo completar el traslado.'],
      })
    );
    expect(notifyError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Traslado registrado con advertencia',
      })
    );

    errorSpy.mockRestore();
  });
});
