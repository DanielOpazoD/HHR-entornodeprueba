import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeBedManagementAction } from '@/hooks/controllers/bedManagementDispatchController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import { featureFlags } from '@/services/utils/featureFlags';

describe('manual specialty precedence across structural edits', () => {
  afterEach(() => featureFlags.reset('SPECIALTY_EPISODE_ASSIGNMENT'));

  it('does not write structure before a simultaneous manual choice', async () => {
    featureFlags.enable('SPECIALTY_EPISODE_ASSIGNMENT');
    const record = { date: '2026-09-23', lastUpdated: '2026-09-23T10:00:00.000Z',
      beds: { R1: { bedId: 'R1', patientName: 'Paciente', rut: '11.111.111-1',
        clinicalEpisodeId: 'synthetic-episode', specialty: '',
        status: PatientStatus.ESTABLE, admissionDate: '2026-09-23',
        isBlocked: false, devices: [] } }, discharges: [], transfers: [], cma: [],
    } as unknown as DailyRecord;
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    const result = await executeBedManagementAction({
      currentRecord: record,
      action: { type: 'UPDATE_PATIENT_MULTIPLE', bedId: 'R1',
        fields: { patientName: 'Cambio', specialty: Specialty.CIRUGIA } },
      validation: { processFieldValue: vi.fn((_field, value) => ({ valid: true, value })) },
      bedAudit: { auditPatientChange: vi.fn(), auditCudyrChange: vi.fn(),
        auditCribCudyrChange: vi.fn(), auditPatientCleared: vi.fn(),
        auditPatientModified: vi.fn(), auditPatientMovement: vi.fn() },
      patchRecord,
    });
    expect(result).toBe(false);
    expect(patchRecord).not.toHaveBeenCalled();
  });
});
