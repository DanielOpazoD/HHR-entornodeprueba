import { describe, expect, it } from 'vitest';
import { BEDS } from '@/constants/beds';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildCensusLaboratoryCohort } from '@/features/census/controllers/censusLaboratoryController';

const patient = (bed: string, overrides = {}) =>
  DataFactory.createMockPatient(bed, {
    patientName: 'PACIENTE SINTÉTICO',
    rut: '12.345.678-5',
    admissionDate: '2026-11-01',
    clinicalEpisodeId: 'synthetic-episode',
    ...overrides,
  });
describe('census laboratory cohort', () => {
  it('uses the numeric RUN body, deduplicates an episode, and keeps readmissions separate', () => {
    const cohort = buildCensusLaboratoryCohort(
      BEDS,
      {
        R1: patient('R1'),
        R2: patient('R2'),
        R3: patient('R3', { clinicalEpisodeId: 'new-episode' }),
      },
      '2026-11-07'
    );
    expect(cohort.patients.map(p => [p.rutBody, p.episodeId])).toEqual([
      ['12345678', 'synthetic-episode'],
      ['12345678', 'new-episode'],
    ]);
  });
  it('includes a newborn only with their own RUN and episode, and excludes passports and uncertain admissions', () => {
    const cohort = buildCensusLaboratoryCohort(
      BEDS,
      {
        R1: patient('R1', {
          clinicalCrib: patient('R1', {
            rut: '5.844.865-6',
            clinicalEpisodeId: 'newborn',
            patientName: 'RN SINTÉTICO',
          }),
        }),
        R2: patient('R2', {
          clinicalCrib: patient('R2', {
            rut: '12.345.678-5',
            clinicalEpisodeId: 'unidentified-newborn',
          }),
        }),
        R3: patient('R3', { documentType: 'Pasaporte' }),
        R4: patient('R4', { admissionDate: '' }),
        H1C1: patient('H1C1', { admissionDate: '2026-02-30' }),
      },
      '2026-11-07'
    );
    expect(cohort.patients.map(p => p.rutBody)).toEqual(['12345678', '5844865']);
    expect(cohort.excluded).toBe(4);
    expect(cohort.patients[1].bedLabel).toContain('Cuna');
  });
});
