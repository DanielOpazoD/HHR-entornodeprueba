import { describe, expect, it, vi } from 'vitest';
import {
  executeBedManagementAction,
  type BedManagementAuditPort,
  type BedManagementValidationPort,
} from '@/hooks/controllers/bedManagementDispatchController';
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

describe('bedManagementDispatchController clinical crib commands', () => {
  it('creates a clinical crib only after remote authority confirms it', async () => {
    const patchRecord = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const validation: BedManagementValidationPort = {
      processFieldValue: vi.fn((_field, value) => ({ valid: true, value })),
    };
    const bedAudit: BedManagementAuditPort = {
      auditPatientChange: vi.fn(),
      auditCudyrChange: vi.fn(),
      auditCribCudyrChange: vi.fn(),
      auditPatientCleared: vi.fn(),
      auditPatientModified: vi.fn(),
      auditPatientMovement: vi.fn(),
    };

    await executeBedManagementAction({
      currentRecord: buildRecord(),
      action: { type: 'CREATE_CLINICAL_CRIB', bedId: 'R1' },
      validation,
      bedAudit,
      patchRecord,
    });

    expect(patchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        'beds.R1.clinicalCrib': expect.objectContaining({ patientName: 'RN de Paciente' }),
      }),
      {
        consistency: 'remote_confirmed',
        optimisticRemoteConfirmed: true,
        clinicalCribCreate: {
          bedId: 'R1',
          confirmedLastUpdated: '2026-03-06T10:00:00.000Z',
          confirmedParent: expect.objectContaining({
            patientName: 'Paciente',
            rut: '11.111.111-1',
          }),
        },
      }
    );
  });
});
