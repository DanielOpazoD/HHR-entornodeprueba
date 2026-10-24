// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  hasStructuralRepairs,
  parseDailyRecordWithDefaultsReport,
  parsePatientDataWithDefaultsReport,
} from '@/schemas/zodSchemas';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';

const DATE = '2026-10-24';
const passport = () => ({
  bedId: 'R1',
  patientName: 'PACIENTE SINTETICO P5',
  firstName: 'PACIENTE',
  lastName: 'SINTETICO',
  secondLastName: 'P5',
  rut: 'FAKE-PASSPORT-P5',
  documentType: 'Pasaporte',
  clinicalEpisodeId: 'ep_synthetic_p5',
  admissionDate: '2026-10-23',
  admissionTime: '10:00',
  pathology: 'DIAGNOSTICO SINTETICO',
  cie10Code: 'SYNTHETIC-P5',
  diagnosisComments: 'COMENTARIO SINTETICO',
  medicalHandoffNote: 'NOTA SINTETICA CONSERVAR',
  handoffNoteDayShift: 'NOTA ENFERMERIA SINTETICA',
});
const day = (patient: unknown) => ({ date: DATE, schemaVersion: 1, beds: { R1: patient } });

const readers = [
  {
    name: 'patient parser',
    read: (value: unknown) => parsePatientDataWithDefaultsReport(value, 'R1').patient,
  },
  {
    name: 'daily parser',
    read: (value: unknown) => parseDailyRecordWithDefaultsReport(day(value), DATE).record.beds.R1,
  },
  { name: 'docToRecord', read: (value: unknown) => docToRecord(day(value), DATE).beds.R1 },
];

describe.each(readers)('patient salvage through $name', ({ read }) => {
  it('preserves every valid passport field when only insurance is invalid', () => {
    const original = passport();
    const patient = read({ ...original, insurance: 'UNKNOWN_LEGACY_INSURANCE' });

    expect(patient).toMatchObject(original);
    expect(patient.insurance).toBeUndefined();
  });

  it.each([
    ['documentType', 'UNKNOWN_DOCUMENT'],
    ['rut', 123],
    ['clinicalEpisodeId', 123],
  ])('requires explicit identity repair for invalid %s', (field, value) => {
    expect(() => read({ ...passport(), [field]: value })).toThrow(
      expect.objectContaining({
        code: 'patient_identity_repair_required',
        bedId: 'R1',
        fields: [field],
      })
    );
  });

  it('salvages a clinical crib independently without changing either identity', () => {
    const child = {
      ...passport(),
      rut: 'FAKE-PASSPORT-P5-CHILD',
      clinicalEpisodeId: 'ep_synthetic_p5_child',
      patientName: 'RN SINTETICO P5',
      firstName: 'RN',
      bedMode: 'Cuna',
    };
    const patient = read({
      ...passport(),
      clinicalCrib: { ...child, insurance: 'UNKNOWN_LEGACY_INSURANCE' },
    });

    expect(patient).toMatchObject(passport());
    expect(patient.clinicalCrib).toMatchObject(child);
    expect(patient.clinicalCrib?.insurance).toBeUndefined();
  });
});

it('retains the structural repair reports for unrelated invalid fields', () => {
  const raw = { ...passport(), insurance: 'UNKNOWN_LEGACY_INSURANCE' };
  const patient = parsePatientDataWithDefaultsReport(raw, 'R1');
  const daily = parseDailyRecordWithDefaultsReport(day(raw), DATE);

  expect(patient.report.usedFallback).toBe(true);
  expect(daily.report.salvagedBeds).toEqual(['R1']);
  expect(hasStructuralRepairs(patient.report)).toBe(true);
  expect(hasStructuralRepairs(daily.report)).toBe(true);
});
