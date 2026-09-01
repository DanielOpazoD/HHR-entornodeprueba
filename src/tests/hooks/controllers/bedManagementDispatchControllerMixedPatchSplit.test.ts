import { describe, expect, it, vi } from 'vitest';
import { executeBedManagementAction } from '@/hooks/controllers/bedManagementDispatchController';
import type {
  BedManagementAuditPort,
  BedManagementValidationPort,
} from '@/hooks/controllers/bedManagementDispatchController';
import type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
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

describe('bedManagementDispatchController · split de patches mezclados', () => {
  it('splits a mixed clinical/structural multi-field update into two sequential commands', async () => {
    const patchRecord = vi.fn<(patch: Record<string, unknown>) => Promise<void>>();
    patchRecord.mockResolvedValue(undefined);
    const action: BedAction = {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        admissionDate: '2026-03-06',
        admissionTime: '14:00',
        pathology: 'Neumonía adquirida en la comunidad',
        status: PatientStatus.ESTABLE,
      },
    };
    const validation: BedManagementValidationPort = {
      processFieldValue: vi.fn((field, value) => ({ valid: true, value })),
    };
    const bedAudit: BedManagementAuditPort = {
      auditPatientChange: vi.fn(),
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

    expect(result).toBe(true);
    // Con separación enforced el patch mezclado sería rechazado por la
    // autoridad; el despacho lo divide: estructural primero, clínico después.
    // El diff (Fase 2) poda los reenvíos idénticos del fixture (admissionDate
    // y status no cambian), así que cada mitad queda mínima.
    expect(patchRecord).toHaveBeenCalledTimes(2);
    const [structuralPatch] = patchRecord.mock.calls[0];
    const [clinicalPatch] = patchRecord.mock.calls[1];
    expect(Object.keys(structuralPatch)).toEqual(['beds.R1.admissionTime']);
    expect(Object.keys(clinicalPatch)).toEqual(['beds.R1.pathology']);
  });

  it('la clasificación UPC viaja en UN solo comando clínico con su bedTypeOverrides', async () => {
    // Verificado en vivo (31-08): el split dejaba bedTypeOverrides huérfano en
    // la mitad estructural y el servidor la rechazaba («bed type override must
    // accompany a UPC patch») — la clasificación quedaba a medias.
    const patchRecord = vi.fn<(patch: Record<string, unknown>) => Promise<void>>();
    patchRecord.mockResolvedValue(undefined);
    const action: BedAction = {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        isUPC: true,
        upcChecklist: {
          uciCriteria: ['uci_vmi'],
          utiCriteria: [],
          classification: 'UPC_UCI',
          evaluatedAt: '2026-03-06T00:00:00Z',
        },
      },
    };
    const validation: BedManagementValidationPort = {
      processFieldValue: vi.fn((field, value) => ({ valid: true, value })),
    };
    const bedAudit: BedManagementAuditPort = {
      auditPatientChange: vi.fn(),
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

    expect(result).toBe(true);
    expect(patchRecord).toHaveBeenCalledTimes(1);
    const [patch] = patchRecord.mock.calls[0];
    expect(Object.keys(patch)).toEqual(
      expect.arrayContaining(['beds.R1.upcChecklist', 'beds.R1.isUPC', 'bedTypeOverrides.R1'])
    );
  });

  it('un guardado sin cambios reales no escribe ni audita y retorna true', async () => {
    const patchRecord = vi.fn<(patch: Record<string, unknown>) => Promise<void>>();
    patchRecord.mockResolvedValue(undefined);
    const record = buildRecord();
    const action: BedAction = {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        patientName: record.beds.R1.patientName,
        rut: record.beds.R1.rut,
        pathology: record.beds.R1.pathology,
        status: record.beds.R1.status,
      },
    };
    const validation: BedManagementValidationPort = {
      processFieldValue: vi.fn((field, value) => ({ valid: true, value })),
    };
    const auditPatientChange = vi.fn();
    const bedAudit: BedManagementAuditPort = {
      auditPatientChange,
      auditCudyrChange: vi.fn(),
      auditCribCudyrChange: vi.fn(),
      auditPatientCleared: vi.fn(),
      auditPatientModified: vi.fn(),
      auditPatientMovement: vi.fn(),
    };

    const result = await executeBedManagementAction({
      currentRecord: record,
      action,
      validation,
      bedAudit,
      patchRecord,
    });

    expect(result).toBe(true);
    expect(patchRecord).not.toHaveBeenCalled();
    expect(auditPatientChange).not.toHaveBeenCalled();
  });

  it('keeps a purely clinical multi-field update as a single command', async () => {
    const patchRecord = vi.fn<(patch: Record<string, unknown>) => Promise<void>>();
    patchRecord.mockResolvedValue(undefined);
    const action: BedAction = {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        pathology: 'Bronquitis aguda',
        specialty: Specialty.MEDICINA,
      },
    };
    const validation: BedManagementValidationPort = {
      processFieldValue: vi.fn((field, value) => ({ valid: true, value })),
    };
    const bedAudit: BedManagementAuditPort = {
      auditPatientChange: vi.fn(),
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

    expect(result).toBe(true);
    expect(patchRecord).toHaveBeenCalledTimes(1);
  });
});
