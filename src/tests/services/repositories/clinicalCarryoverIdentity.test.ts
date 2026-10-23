import { describe, expect, it } from 'vitest';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { canCarryClinicalEvidence } from '@/services/repositories/clinicalCarryoverIdentity';
import type { PatientData } from '@/types/domain/patient';

const source = (): PatientData => ({
  ...createEmptyPatient('R1'),
  patientName: 'PACIENTE SINTETICO',
  rut: '12.345.678-5',
  clinicalEpisodeId: 'synthetic-episode-1',
  admissionDate: '2026-10-17',
  admissionTime: '09:00',
});
const eligible = (from: PatientData, to: PatientData) =>
  canCarryClinicalEvidence(from, to, '2026-10-18', '2026-10-19');

describe('clinical carryover identity boundary', () => {
  it('accepts the same episode across a bed move and document formatting changes', () => {
    const patient = source();
    expect(eligible(patient, { ...patient, bedId: 'R2', rut: '123456785' })).toBe(true);
  });

  it.each([
    { rut: '87654321-5' },
    { clinicalEpisodeId: 'synthetic-readmission' },
    { clinicalEpisodeId: undefined },
    { admissionDate: '2026-10-18' },
    { admissionTime: '12:00' },
    { rut: '' },
  ])('rejects changed or missing ownership even on the same bed: %j', change => {
    const patient = source();
    expect(eligible(patient, { ...patient, ...change })).toBe(false);
  });

  it('does not substitute a matching name for an unknown episode', () => {
    const patient = { ...source(), clinicalEpisodeId: undefined };
    expect(eligible(patient, { ...patient })).toBe(false);
  });

  it.each([
    ['2026-10-18', '2026-10-18'],
    ['2026-10-18', '2026-10-17'],
    ['2026-02-30', '2026-10-19'],
    ['2026-10-18', 'not-a-date'],
    ['2026-10-16', '2026-10-19'],
  ])('rejects backwards, malformed or pre-admission day context %s -> %s', (from, to) => {
    const patient = source();
    expect(canCarryClinicalEvidence(patient, patient, from, to)).toBe(false);
  });

  it('checks a crib independently and never uses the maternal identity', () => {
    const mother = source();
    const crib = { ...source(), rut: '87654321-5', clinicalEpisodeId: 'synthetic-newborn' };
    expect(eligible(mother, crib)).toBe(false);
    expect(eligible(crib, { ...crib, bedId: 'R2' })).toBe(true);
  });
});
