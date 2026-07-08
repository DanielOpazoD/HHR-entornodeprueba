import { describe, expect, it, vi } from 'vitest';

import { runDischargeWithTransferGuard } from '@/features/census/controllers/censusDischargeTransferGuardController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

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

describe('censusDischargeTransferGuardController', () => {
  it('runs discharge directly when there is no bed id or when editing an existing record', async () => {
    const executeDischarge = vi.fn().mockResolvedValue(undefined);

    await runDischargeWithTransferGuard({
      dischargeState: {
        bedId: null,
        recordId: 'd-1',
        isOpen: true,
        status: 'Vivo',
      },
      record: createRecord(),
      executeDischarge,
      runConfirmedMovementAction: vi.fn(),
      getLatestOpenTransferRequestByBedId: vi.fn(),
      warn: vi.fn(),
    });

    expect(executeDischarge).toHaveBeenCalledTimes(1);
  });

  it('runs discharge directly when there is no active transfer', async () => {
    const executeDischarge = vi.fn().mockResolvedValue(undefined);

    await runDischargeWithTransferGuard({
      dischargeState: {
        bedId: 'R1',
        isOpen: true,
        status: 'Vivo',
      },
      record: createRecord(),
      executeDischarge,
      runConfirmedMovementAction: vi.fn(),
      getLatestOpenTransferRequestByBedId: vi.fn().mockResolvedValue(null),
      warn: vi.fn(),
    });

    expect(executeDischarge).toHaveBeenCalledTimes(1);
  });

  it('delegates to confirmed movement flow when an active transfer exists', async () => {
    const runConfirmedMovementAction = vi.fn().mockResolvedValue(undefined);

    await runDischargeWithTransferGuard({
      dischargeState: {
        bedId: 'R1',
        isOpen: true,
        status: 'Vivo',
      },
      record: createRecord(),
      executeDischarge: vi.fn().mockResolvedValue(undefined),
      runConfirmedMovementAction,
      getLatestOpenTransferRequestByBedId: vi.fn().mockResolvedValue({
        id: 'TR-1',
        patientSnapshot: {
          rut: '12.345.678-9',
          name: 'Paciente Traslado',
          admissionDate: '2026-03-01',
        },
      }),
      warn: vi.fn(),
    });

    expect(runConfirmedMovementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        dialog: expect.objectContaining({
          title: 'Traslado en curso',
          confirmText: 'Dar de alta igualmente',
        }),
        errorTitle: 'No se pudo confirmar el alta',
      })
    );
  });

  it('does not warn when the open transfer belongs to an older episode in the same bed', async () => {
    const executeDischarge = vi.fn().mockResolvedValue(undefined);
    const runConfirmedMovementAction = vi.fn().mockResolvedValue(undefined);

    await runDischargeWithTransferGuard({
      dischargeState: {
        bedId: 'R1',
        isOpen: true,
        status: 'Vivo',
      },
      record: createRecord(),
      executeDischarge,
      runConfirmedMovementAction,
      getLatestOpenTransferRequestByBedId: vi.fn().mockResolvedValue({
        id: 'TR-old',
        patientSnapshot: {
          rut: '12.345.678-9',
          name: 'Paciente Traslado',
          admissionDate: '2026-02-25',
        },
      }),
      warn: vi.fn(),
    });

    expect(executeDischarge).toHaveBeenCalledTimes(1);
    expect(runConfirmedMovementAction).not.toHaveBeenCalled();
  });

  it('warns and falls back to discharge when transfer lookup fails', async () => {
    const executeDischarge = vi.fn().mockResolvedValue(undefined);
    const warn = vi.fn();

    await runDischargeWithTransferGuard({
      dischargeState: {
        bedId: 'R1',
        isOpen: true,
        status: 'Vivo',
      },
      record: createRecord(),
      executeDischarge,
      runConfirmedMovementAction: vi.fn(),
      getLatestOpenTransferRequestByBedId: vi.fn().mockRejectedValue(new Error('lookup failed')),
      warn,
    });

    expect(warn).toHaveBeenCalled();
    expect(executeDischarge).toHaveBeenCalledTimes(1);
  });
});
