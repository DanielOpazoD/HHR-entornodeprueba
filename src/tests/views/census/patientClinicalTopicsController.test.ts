import { describe, expect, it } from 'vitest';

import { resolvePatientClinicalTopics } from '@/features/census/controllers/patientClinicalTopicsController';
import { DataFactory } from '@/tests/factories/DataFactory';

const patient = (overrides: Parameters<typeof DataFactory.createMockPatient>[1]) =>
  DataFactory.createMockPatient('R2', {
    patientName: 'Paciente de prueba',
    rut: '12.345.678-5',
    clinicalEpisodeId: '141336',
    ...overrides,
  });

describe('resolvePatientClinicalTopics', () => {
  it('offers every topic to a synced patient with a valid RUT', () => {
    expect(resolvePatientClinicalTopics(patient({}))).toEqual({
      clinicalPanel: true,
      laboratory: true,
      imaging: true,
      clinicalExplorer: true,
    });
  });

  it('offers nothing without a patient or a name', () => {
    const none = {
      clinicalPanel: false,
      laboratory: false,
      imaging: false,
      clinicalExplorer: false,
    };
    expect(resolvePatientClinicalTopics(undefined)).toEqual(none);
    expect(resolvePatientClinicalTopics(patient({ patientName: '  ' }))).toEqual(none);
  });

  it('keeps imaging but not the episode topics before an Eloísa sync', () => {
    expect(resolvePatientClinicalTopics(patient({ clinicalEpisodeId: '' }))).toEqual({
      clinicalPanel: false,
      laboratory: false,
      imaging: true,
      clinicalExplorer: false,
    });
  });

  it('never searches Syslab or MMRAD with a passport', () => {
    expect(
      resolvePatientClinicalTopics(patient({ rut: 'AB123456', documentType: 'Pasaporte' }))
    ).toEqual({ clinicalPanel: true, laboratory: false, imaging: false, clinicalExplorer: false });
  });

  it('leaves MMRAD and the integrated view out for a RUT with a wrong check digit', () => {
    expect(resolvePatientClinicalTopics(patient({ rut: '12.345.678-4' }))).toEqual({
      clinicalPanel: true,
      laboratory: true,
      imaging: false,
      clinicalExplorer: false,
    });
  });

  it('treats a dash as no RUT', () => {
    expect(resolvePatientClinicalTopics(patient({ rut: '-' })).laboratory).toBe(false);
  });
});
