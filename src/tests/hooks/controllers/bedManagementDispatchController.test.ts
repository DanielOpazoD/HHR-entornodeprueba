import { describe, expect, it, vi } from 'vitest';
import { executeBedManagementAction } from '@/hooks/controllers/bedManagementDispatchController';
import type {
  BedManagementAuditPort,
  BedManagementValidationPort,
} from '@/hooks/controllers/bedManagementDispatchController';
import type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const buildRecord = (): DailyRecord => ({
  date: '2026-03-06',
  beds: {
    R1: {
      bedId: 'R1',
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      patientName: 'Paciente',
      rut: '11.111.111-1',
      age: '20',
      pathology: 'Patologia',
      specialty: Specialty.MEDICINA,
      status: PatientStatus.ESTABLE,
      admissionDate: '2026-03-06',
      hasWristband: false,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-03-06T10:00:00.000Z',
  activeExtraBeds: [],
});

describe('bedManagementDispatchController', () => {
  it('stops dispatch when validation fails', () => {
    const patchRecord = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const action: BedAction = {
      type: 'UPDATE_PATIENT',
      bedId: 'R1',
      field: 'admissionDate',
      value: '2099-01-01',
    };
    const validation: BedManagementValidationPort = {
      processFieldValue: vi
        .fn()
        .mockReturnValue({ valid: false, value: '2099-01-01', error: 'invalid' }),
    };
    const bedAudit: BedManagementAuditPort = {
      auditPatientChange: vi.fn(),
      auditCudyrChange: vi.fn(),
      auditCribCudyrChange: vi.fn(),
      auditPatientCleared: vi.fn(),
      auditPatientModified: vi.fn(),
      auditPatientMovement: vi.fn(),
    };

    executeBedManagementAction({
      currentRecord: buildRecord(),
      action,
      validation,
      bedAudit,
      patchRecord,
    });

    expect(patchRecord).not.toHaveBeenCalled();
  });

  it('applies patch after validation and audit', () => {
    const patchRecord = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const auditPatientChange = vi.fn();
    const action: BedAction = {
      type: 'UPDATE_PATIENT',
      bedId: 'R1',
      field: 'age',
      value: '21',
    };
    const validation: BedManagementValidationPort = {
      processFieldValue: vi.fn().mockReturnValue({ valid: true, value: '21' }),
    };
    const bedAudit: BedManagementAuditPort = {
      auditPatientChange,
      auditCudyrChange: vi.fn(),
      auditCribCudyrChange: vi.fn(),
      auditPatientCleared: vi.fn(),
      auditPatientModified: vi.fn(),
      auditPatientMovement: vi.fn(),
    };

    executeBedManagementAction({
      currentRecord: buildRecord(),
      action,
      validation,
      bedAudit,
      patchRecord,
    });

    expect(auditPatientChange).toHaveBeenCalled();
    expect(patchRecord).toHaveBeenCalledWith({
      'beds.R1.age': '21',
    });
  });
});
