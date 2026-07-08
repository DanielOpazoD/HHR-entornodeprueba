import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import type { CensusActionNotification } from '@/features/census/controllers/censusActionNotificationController';
import { useCensusDischargeCommand } from '@/features/census/hooks/useCensusDischargeCommand';

const { mockGetLatestOpenTransferRequestByBedId, mockRecordCriticalClinicalAction } = vi.hoisted(
  () => ({
    mockGetLatestOpenTransferRequestByBedId: vi.fn(),
    mockRecordCriticalClinicalAction: vi.fn(),
  })
);

vi.mock('@/services/transfers/transferService', () => ({
  getLatestOpenTransferRequestByBedId: mockGetLatestOpenTransferRequestByBedId,
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

  const createHook = () => {
    const addDischarge = vi.fn();
    const updateDischarge = vi.fn();
    const confirm = vi.fn();
    const setDischargeState = vi.fn();
    const notifyError = vi.fn<(notification: CensusActionNotification) => void>();

    const hook = renderHook(() =>
      useCensusDischargeCommand({
        dischargeStateRef: {
          current: {
            bedId: 'R1',
            isOpen: true,
            status: 'Vivo',
          },
        },
        recordRef: {
          current: createRecord(),
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
        addDischargeRef: { current: addDischarge },
        updateDischargeRef: { current: updateDischarge },
        confirmRef: { current: confirm },
        setDischargeState,
        getCurrentTime: () => '10:15',
        notifyError,
      })
    );

    return {
      ...hook,
      addDischarge,
      updateDischarge,
      confirm,
      setDischargeState,
      notifyError,
    };
  };

  it('executes discharge without confirmation when there is no active transfer', async () => {
    mockGetLatestOpenTransferRequestByBedId.mockResolvedValue(null);
    const { result, addDischarge, confirm } = createHook();

    await act(async () => {
      result.current();
    });

    expect(mockGetLatestOpenTransferRequestByBedId).toHaveBeenCalledWith('R1');
    expect(confirm).not.toHaveBeenCalled();
    expect(addDischarge).toHaveBeenCalledTimes(1);
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

  it('asks for confirmation and executes discharge when active transfer is confirmed', async () => {
    mockGetLatestOpenTransferRequestByBedId.mockResolvedValue({
      id: 'TR-1',
      status: 'REQUESTED',
      patientSnapshot: {
        rut: '12.345.678-9',
        name: 'Paciente Traslado',
        admissionDate: '2026-03-01',
      },
    });
    const { result, addDischarge, confirm } = createHook();
    confirm.mockResolvedValue(true);

    await act(async () => {
      result.current();
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Traslado en curso',
        confirmText: 'Dar de alta igualmente',
        cancelText: 'Cancelar',
      })
    );
    expect(confirm.mock.calls[0]?.[0]?.message).toContain('usar el botón "Trasladar"');
    expect(addDischarge).toHaveBeenCalledTimes(1);
  });

  it('asks for confirmation and aborts discharge when user cancels', async () => {
    mockGetLatestOpenTransferRequestByBedId.mockResolvedValue({
      id: 'TR-1',
      status: 'REQUESTED',
      patientSnapshot: {
        rut: '12.345.678-9',
        name: 'Paciente Traslado',
        admissionDate: '2026-03-01',
      },
    });
    const { result, addDischarge, confirm } = createHook();
    confirm.mockResolvedValue(false);

    await act(async () => {
      result.current();
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(addDischarge).not.toHaveBeenCalled();
  });

  it('falls back to normal discharge when transfer lookup fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGetLatestOpenTransferRequestByBedId.mockRejectedValue(new Error('lookup failed'));
    const { result, addDischarge, confirm } = createHook();

    await act(async () => {
      result.current();
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(addDischarge).toHaveBeenCalledTimes(1);
    expect(mockRecordCriticalClinicalAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'census_discharge_created',
        outcome: 'success',
        bedId: 'R1',
      })
    );
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
