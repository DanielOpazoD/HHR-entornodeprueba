// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { executeBedManagementAction } from '@/hooks/controllers/bedManagementDispatchController';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createEmptyPatient } from '@/domain/patient/patientFactory';

describe('manual specialty precedence across structural edits', () => {
  const makeRecord = () =>
    DataFactory.createMockDailyRecord('2026-09-23', {
      lastUpdated: '2026-09-23T10:00:00.000Z',
      beds: {
        R1: {
          ...createEmptyPatient('R1'),
          patientName: 'Paciente',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'synthetic-episode',
          specialty: '',
          status: PatientStatus.ESTABLE,
          admissionDate: '2026-09-23',
          isBlocked: false,
          devices: [],
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
    });

  it('does not write structure before a simultaneous manual choice', async () => {
    const record = makeRecord();
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    const result = await executeBedManagementAction({
      currentRecord: record,
      action: {
        type: 'UPDATE_PATIENT_MULTIPLE',
        bedId: 'R1',
        fields: { patientName: 'Cambio', specialty: Specialty.CIRUGIA },
      },
      validation: { processFieldValue: vi.fn((_field, value) => ({ valid: true, value })) },
      bedAudit: {
        auditPatientChange: vi.fn(),
        auditPatientCleared: vi.fn(),
        auditPatientModified: vi.fn(),
        auditPatientMovement: vi.fn(),
      },
      patchRecord,
    });
    expect(result).toBe(false);
    expect(patchRecord).not.toHaveBeenCalled();
  });

  it('saves an ordinary field when a form repeats the unchanged specialty', async () => {
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    const result = await executeBedManagementAction({
      currentRecord: makeRecord(),
      action: {
        type: 'UPDATE_PATIENT_MULTIPLE',
        bedId: 'R1',
        fields: { patientName: 'Cambio', specialty: Specialty.EMPTY },
      },
      validation: { processFieldValue: vi.fn((_field, value) => ({ valid: true, value })) },
      bedAudit: {
        auditPatientChange: vi.fn(),
        auditPatientCleared: vi.fn(),
        auditPatientModified: vi.fn(),
        auditPatientMovement: vi.fn(),
      },
      patchRecord,
    });
    expect(result).toBe(true);
    expect(patchRecord).toHaveBeenCalledOnce();
    expect(patchRecord.mock.calls[0][0]).toHaveProperty('beds.R1.patientName', 'Cambio');
    expect(patchRecord.mock.calls[0][0]).not.toHaveProperty('beds.R1.specialty');
    expect(patchRecord.mock.calls[0][1]?.specialtyIntent).toBeUndefined();
  });
});
