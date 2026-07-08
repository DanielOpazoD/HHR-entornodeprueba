import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeBedManagementAction } from '@/hooks/controllers/bedManagementDispatchController';
import type {
  BedManagementAuditPort,
  BedManagementValidationPort,
} from '@/hooks/controllers/bedManagementDispatchController';
import type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import { bedManagementDispatchLogger } from '@/hooks/controllers/hookControllerLoggers';

const telemetryMocks = vi.hoisted(() => ({
  recordOperationalTelemetry: vi.fn(),
}));

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: telemetryMocks.recordOperationalTelemetry,
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('applies patch after validation and audit', async () => {
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

    await executeBedManagementAction({
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

  it('audits patient creation when demographics are saved as a multiple update', async () => {
    const record = buildRecord();
    record.beds.R1 = {
      ...record.beds.R1,
      patientName: '',
      rut: '',
      pathology: '',
      age: '',
      admissionDate: '',
    };
    const patchRecord = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const auditPatientChange = vi.fn();
    const action: BedAction = {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        pathology: 'Neumonia',
        rut: '22.222.222-2',
        patientName: 'Paciente Nuevo',
      },
    };
    const validation: BedManagementValidationPort = {
      processFieldValue: vi.fn((_field, value) => ({ valid: true, value })),
    };
    const bedAudit: BedManagementAuditPort = {
      auditPatientChange,
      auditCudyrChange: vi.fn(),
      auditCribCudyrChange: vi.fn(),
      auditPatientCleared: vi.fn(),
      auditPatientModified: vi.fn(),
      auditPatientMovement: vi.fn(),
    };

    await executeBedManagementAction({
      currentRecord: record,
      action,
      validation,
      bedAudit,
      patchRecord,
    });

    expect(auditPatientChange).toHaveBeenNthCalledWith(
      2,
      'R1',
      'patientName',
      expect.objectContaining({
        patientName: '',
        rut: '22.222.222-2',
      }),
      'Paciente Nuevo'
    );
  });

  it('audits diagnosis changes when they are saved as a multiple update', async () => {
    const patchRecord = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const auditPatientChange = vi.fn();
    const action: BedAction = {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        pathology: 'Diagnostico actualizado',
      },
    };
    const validation: BedManagementValidationPort = {
      processFieldValue: vi.fn((_field, value) => ({ valid: true, value })),
    };
    const bedAudit: BedManagementAuditPort = {
      auditPatientChange,
      auditCudyrChange: vi.fn(),
      auditCribCudyrChange: vi.fn(),
      auditPatientCleared: vi.fn(),
      auditPatientModified: vi.fn(),
      auditPatientMovement: vi.fn(),
    };

    const record = buildRecord();
    await executeBedManagementAction({
      currentRecord: record,
      action,
      validation,
      bedAudit,
      patchRecord,
    });

    expect(auditPatientChange).toHaveBeenCalledWith(
      'R1',
      'pathology',
      record.beds.R1,
      'Diagnostico actualizado'
    );
  });

  it('captures asynchronous patch failures from fire-and-forget bed actions', async () => {
    const patchError = new Error('freshness gate blocked');
    const patchRecord = vi.fn<() => Promise<void>>().mockRejectedValueOnce(patchError);
    const warnSpy = vi.spyOn(bedManagementDispatchLogger, 'warn').mockImplementation(() => {});
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
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledWith('Bed management patch failed', patchError);
    expect(telemetryMocks.recordOperationalTelemetry).toHaveBeenCalledWith({
      category: 'daily_record',
      operation: 'daily_record_bed_patch_failed',
      status: 'failed',
      runtimeState: 'blocked',
      date: '2026-03-06',
      issues: ['freshness gate blocked'],
      context: expect.objectContaining({
        module: 'Censo diario',
        action: 'Guardar edad',
        route: '/censo',
        clinicalDate: '2026-03-06',
        bedId: 'R1',
        bedLabel: 'Cama R1',
        fieldKey: 'age',
        fieldLabel: 'Edad',
        patchType: 'UPDATE_PATIENT',
      }),
    });
    warnSpy.mockRestore();
  });

  it('does not emit patient-change audit when the patch is rejected', async () => {
    const patchError = new Error('No se encontró un registro local válido para aplicar el cambio.');
    const patchRecord = vi.fn<() => Promise<void>>().mockRejectedValueOnce(patchError);
    const auditPatientChange = vi.fn();
    const warnSpy = vi.spyOn(bedManagementDispatchLogger, 'warn').mockImplementation(() => {});
    const action: BedAction = {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        pathology: 'Diagnostico no persistido',
      },
    };
    const validation: BedManagementValidationPort = {
      processFieldValue: vi.fn((_field, value) => ({ valid: true, value })),
    };
    const bedAudit: BedManagementAuditPort = {
      auditPatientChange,
      auditCudyrChange: vi.fn(),
      auditCribCudyrChange: vi.fn(),
      auditPatientCleared: vi.fn(),
      auditPatientModified: vi.fn(),
      auditPatientMovement: vi.fn(),
    };

    const result = await executeBedManagementAction({
      currentRecord: buildRecord(),
      action,
      validation,
      bedAudit,
      patchRecord,
    });

    expect(result).toBe(false);
    expect(auditPatientChange).not.toHaveBeenCalled();
    expect(telemetryMocks.recordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'daily_record_bed_patch_failed',
        status: 'failed',
        runtimeState: 'blocked',
      })
    );
    warnSpy.mockRestore();
  });
});
