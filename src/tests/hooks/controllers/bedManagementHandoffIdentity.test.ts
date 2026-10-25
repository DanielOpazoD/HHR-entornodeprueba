import { describe, expect, it, vi } from 'vitest';
import { executeBedManagementAction } from '@/hooks/controllers/bedManagementDispatchController';
import { DataFactory } from '@/tests/factories/DataFactory';
const buildRecord = () =>
  DataFactory.createMockDailyRecord('2026-10-24', {
    beds: { R1: DataFactory.createMockPatient('R1') },
  });
describe('bed management handoff identity', () => {
  it('passes the patient captured while typing to the patch even if the bed action resolves on a replacement', async () => {
    const current = buildRecord();
    const original = {
      ...current.beds.R1,
      patientName: 'Paciente A Sintético',
      rut: '99.999.999-9',
      clinicalEpisodeId: 'ep-A',
    };
    current.beds.R1 = {
      ...original,
      patientName: 'Paciente B Sintético',
      clinicalEpisodeId: 'ep-B',
    };
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    await executeBedManagementAction({
      currentRecord: current,
      action: {
        type: 'UPDATE_PATIENT_MULTIPLE',
        bedId: 'R1',
        fields: { medicalHandoffNote: 'Texto para A' },
        expectedHandoffPatient: original,
      },
      validation: { processFieldValue: (_field, value) => ({ valid: true, value }) },
      bedAudit: {
        auditPatientChange: vi.fn(),
        auditCudyrChange: vi.fn(),
        auditCribCudyrChange: vi.fn(),
        auditPatientCleared: vi.fn(),
        auditPatientModified: vi.fn(),
        auditPatientMovement: vi.fn(),
      },
      patchRecord,
    });
    expect(patchRecord).toHaveBeenCalledWith(
      { 'beds.R1.medicalHandoffNote': 'Texto para A' },
      {
        specialistHandoffTargets: [
          expect.objectContaining({
            patientName: 'Paciente A Sintético',
            clinicalEpisodeId: 'ep-A',
          }),
        ],
      }
    );
  });
});
