import { describe, expect, it, vi } from 'vitest';
import {
  buildLegacyClinicalEpisodeId,
  ensureDailyRecordClinicalEpisodeIds,
  resolveClinicalEpisodeIdForAdmission,
} from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('clinicalEpisodeIdPolicy', () => {
  it('preserves an explicit clinicalEpisodeId when admitting a patient', () => {
    const createId = vi.fn(() => 'generated-id');

    expect(
      resolveClinicalEpisodeIdForAdmission({ clinicalEpisodeId: ' ep-existing ' }, createId)
    ).toBe('ep-existing');
    expect(createId).not.toHaveBeenCalled();
  });

  it('generates a new canonical clinicalEpisodeId for a fresh admission', () => {
    expect(resolveClinicalEpisodeIdForAdmission({}, () => 'admission-123')).toBe(
      'ep_admission-123'
    );
  });

  it('builds stable legacy identifiers from the extended episode tuple', () => {
    const morning = buildLegacyClinicalEpisodeId({
      rut: '11.111.111-1',
      admissionDate: '2026-05-13',
      admissionTime: '08:00',
    });
    const afternoon = buildLegacyClinicalEpisodeId({
      rut: '11.111.111-1',
      admissionDate: '2026-05-13',
      admissionTime: '18:00',
    });

    expect(morning).toMatch(/^legacy_ep_/);
    expect(afternoon).toMatch(/^legacy_ep_/);
    expect(morning).not.toBe(afternoon);
  });

  it('backfills active beds and clinical cribs without touching empty beds', () => {
    const record = DataFactory.createMockDailyRecord('2026-05-13');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Activo',
      rut: '11.111.111-1',
      admissionDate: '2026-05-13',
      admissionTime: '08:00',
      clinicalEpisodeId: '',
      clinicalCrib: DataFactory.createMockPatient('R1', {
        patientName: 'RN Activo',
        rut: '22.222.222-2',
        admissionDate: '2026-05-13',
        admissionTime: '09:00',
        clinicalEpisodeId: '',
      }),
    });

    const normalized = ensureDailyRecordClinicalEpisodeIds(record);

    expect(normalized.beds.R1.clinicalEpisodeId).toMatch(/^legacy_ep_/);
    expect(normalized.beds.R1.clinicalCrib?.clinicalEpisodeId).toMatch(/^legacy_ep_/);
    expect(normalized.beds.R2.clinicalEpisodeId).toBeUndefined();
  });
});
