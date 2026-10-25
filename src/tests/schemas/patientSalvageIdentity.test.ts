// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import { PATIENT_IDENTITY_FIELDS, type PatientIdentityField } from '@/types/domain/patientIdentity';
import {
  hasStructuralRepairs,
  parseDailyRecordWithDefaultsReport,
  parsePatientDataWithDefaultsReport,
} from '@/schemas/zodSchemas';
import { PatientDataSchema } from '@/schemas/zod/patient';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { validateAndSalvageRecord } from '@/services/repositories/helpers/validationHelper';
import { withStoredIdentity } from '@/shared/census/patientIdentityReview';

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
    expect(patient.identityReview).toBeUndefined();
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

const invalidNonIdentityFields: (keyof PatientData)[] = [
  'isBlocked',
  'blockedReason',
  'bedMode',
  'hasCompanionCrib',
  'age',
  'birthDate',
  'biologicalSex',
  'insurance',
  'admissionOrigin',
  'admissionOriginDetails',
  'origin',
  'isRapanui',
  'pathology',
  'snomedCode',
  'cie10Code',
  'cie10Description',
  'diagnosisComments',
  'treatingPhysicianId',
  'treatingPhysicianName',
  'dismissedTreatingPhysician',
  'specialty',
  'specialtyAssignment',
  'ginecobstetriciaType',
  'secondarySpecialty',
  'status',
  'eloisaManualImportAudit',
  'hasWristband',
  'devices',
  'deviceDetails',
  'surgicalComplication',
  'isUPC',
  'isIsolated',
  'isolationType',
  'isolationMicroorganism',
  'location',
  'cudyr',
  'handoffNote',
  'handoffNoteDayShift',
  'handoffNoteNightShift',
  'medicalHandoffNote',
  'medicalHandoffAudit',
  'medicalHandoffEntries',
  'deliveryRoute',
  'deliveryDate',
  'deliveryCesareanLabor',
  'clinicalEvents',
  'fhir_resource',
  'clinicalSyncCheckpoint',
  'clinicalCarryover',
];

it.each(invalidNonIdentityFields)('repairs only the invalid non-identity field %s', field => {
  const original = { ...passport(), devices: ['CVC'], clinicalEvents: [event('valid')] };
  const raw = { ...original, [field]: field === 'deviceDetails' ? { CVC: { note: 123 } } : 123 };
  expect(PatientDataSchema.safeParse(raw).success).toBe(false);
  const { patient, report } = parsePatientDataWithDefaultsReport(raw, 'R1');
  const expected: Record<string, unknown> = { ...original };
  delete expected[field];
  expect(patient).toMatchObject(expected);
  const defaults: Record<string, unknown> = { ...createEmptyPatient('R1') };
  expect(patient[field]).toEqual(defaults[field]);
  expect(PatientDataSchema.safeParse(patient).success).toBe(true);
  expect(report.usedFallback).toBe(true);
});

const event = (id: string) => ({
  id,
  name: 'EVENTO SINTETICO',
  date: DATE,
  createdAt: `${DATE}T10:00:00Z`,
});
const entry = (id: string) => ({ id, specialty: 'Medicina', note: `NOTA SINTETICA ${id}` });
const lists = () => ({
  ...passport(),
  clinicalEvents: [event('ev-1'), { ...event('ev-2'), name: 7, date: 7 }, event('ev-3')],
  medicalHandoffEntries: [entry('me-1'), entry('me-2'), { ...entry('me-3'), id: 7 }],
  devices: ['CVC', 5, 'VMI', false],
});

describe.each(readers)('per-element salvage through $name', ({ read }) => {
  it('keeps valid list items in order and preserves identity', () => {
    const patient = read(lists());
    expect(patient).toMatchObject(passport());
    expect(patient.clinicalEvents).toEqual([event('ev-1'), event('ev-3')]);
    expect(patient.medicalHandoffEntries).toEqual([entry('me-1'), entry('me-2')]);
    expect(patient.devices).toEqual(['CVC', 'VMI']);
  });
});

it('counts dropped elements once each and includes the clinical crib', () => {
  const raw = {
    ...lists(),
    clinicalCrib: { ...lists(), rut: 'FAKE-CHILD', clinicalEpisodeId: 'ep_child' },
  };
  const single = parsePatientDataWithDefaultsReport(raw, 'R1');
  const daily = parseDailyRecordWithDefaultsReport(day(raw), DATE);
  expect(single.report).toMatchObject({ usedFallback: true, droppedListItems: 8 });
  expect(daily.report).toMatchObject({ salvagedBeds: ['R1'], droppedPatientListItems: 8 });
  expect(single.patient.clinicalCrib).toMatchObject({
    rut: 'FAKE-CHILD',
    clinicalEpisodeId: 'ep_child',
    devices: ['CVC', 'VMI'],
  });
  expect(hasStructuralRepairs(single.report)).toBe(true);
  expect(hasStructuralRepairs(daily.report)).toBe(true);
});

it('reports zero drops for clean lists and keeps schema normalization', () => {
  const raw = { ...passport(), clinicalEvents: [{ ...event('normalized'), note: null }] };
  const single = parsePatientDataWithDefaultsReport(raw, 'R1');
  const daily = parseDailyRecordWithDefaultsReport(day(raw), DATE);
  expect(single.report).toMatchObject({ usedFallback: false, droppedListItems: 0 });
  expect(daily.report).toMatchObject({ salvagedBeds: [], droppedPatientListItems: 0 });
  expect(single.patient.clinicalEvents).toHaveLength(1);
  expect(single.patient.clinicalEvents?.[0]?.note).toBeUndefined();
});

/** A write of a day validates it: what it cannot read it refuses, instead of storing it. */
const writeDay = (value: unknown) => validateAndSalvageRecord(day(value) as never, DATE);
const neighbour = () => ({
  ...passport(),
  bedId: 'R2',
  patientName: 'VECINO SINTETICO',
  rut: '11.111.111-1',
  documentType: 'RUT',
  clinicalEpisodeId: 'ep_synthetic_neighbour',
});
const readStored = (r1: unknown) =>
  docToRecord({ ...day(r1), beds: { R1: r1, R2: neighbour() } }, DATE);

// One invalid stored value per identity field, and what a read shows for it: nothing, never a
// guess or a conversion. A missing status is inferred by the schema as for any patient.
const unreadableIdentity: Array<[PatientIdentityField, unknown, unknown]> = [
  ['documentType', 'Cedula', undefined],
  ['rut', 12345678, ''],
  ['clinicalEpisodeId', 4321, undefined],
  ['identityStatus', 'tentative', 'official'],
  ['patientName', 42, ''],
  ['firstName', { given: 'PACIENTE' }, ''],
  ['lastName', ['SINTETICO'], ''],
  ['secondLastName', 5, ''],
  ['admissionDate', { seconds: 1, nanoseconds: 0 }, ''],
  ['admissionTime', 930, ''],
];

/** Every identity field of a patient, as it holds it. */
const identityOf = (patient: object) =>
  Object.fromEntries(
    PATIENT_IDENTITY_FIELDS.map(field => [field, (patient as Record<string, unknown>)[field]])
  );

describe('a stored patient with one unreadable identity field', () => {
  it.each(unreadableIdentity)('a write refuses %s instead of storing it', (field, invalid) => {
    expect(() => writeDay({ ...passport(), [field]: invalid })).toThrow(
      expect.objectContaining({
        code: 'patient_identity_repair_required',
        bedId: 'R1',
        message: 'Identidad de la cama R1 por revisar.',
      })
    );
  });

  it.each(unreadableIdentity)('every reader shows %s under review', (field, invalid) => {
    readers.forEach(({ read }) => {
      const patient = read({ ...passport(), [field]: invalid });
      const { identityReview, ...shown } = patient;

      expect(identityReview).toEqual({
        bedId: 'R1',
        slot: 'bed',
        fields: [field],
        shown: identityOf(shown),
        stored: { [field]: invalid },
      });
    });
  });

  it.each(unreadableIdentity)(
    'a read keeps the day and the bed, and puts %s under review',
    (field, invalid, shown) => {
      const record = readStored({ ...passport(), [field]: invalid });
      const { [field]: _unreadable, ...untouched } = passport() as Record<string, unknown>;

      expect(record.beds.R1).toMatchObject(untouched);
      expect(record.beds.R1[field]).toEqual(shown);
      expect(record.beds.R1.documentType).not.toBe('RUT');
      expect(record.beds.R1.identityReview).toEqual({
        bedId: 'R1',
        slot: 'bed',
        fields: [field],
        shown: identityOf(record.beds.R1),
        stored: { [field]: invalid },
      });
      expect(record.beds.R2).toMatchObject(neighbour());
      expect(record.beds.R2.identityReview).toBeUndefined();
    }
  );

  it('reviews the newborn alone: the mother keeps her identity and no review', () => {
    const newborn = {
      ...passport(),
      rut: 'FAKE-PASSPORT-P5-RN',
      clinicalEpisodeId: 'ep_synthetic_p5_rn',
      patientName: 'RN SINTETICO P5',
      bedMode: 'Cuna',
    };
    const mother = { ...passport(), clinicalCrib: { ...newborn, documentType: 'Cedula' } };

    const record = readStored(mother);
    const { documentType: _unreadable, ...newbornUntouched } = newborn;

    expect(record.beds.R1).toMatchObject(passport());
    expect(record.beds.R1.identityReview).toBeUndefined();
    expect(record.beds.R1.clinicalCrib).toMatchObject(newbornUntouched);
    expect(record.beds.R1.clinicalCrib?.documentType).toBeUndefined();
    expect(record.beds.R1.clinicalCrib?.identityReview).toEqual({
      bedId: 'R1',
      slot: 'clinicalCrib',
      fields: ['documentType'],
      shown: identityOf(record.beds.R1.clinicalCrib!),
      stored: { documentType: 'Cedula' },
    });
    expect(() => writeDay(mother)).toThrow(
      expect.objectContaining({
        bedId: 'R1',
        message: 'Identidad de la cuna RN de la cama R1 por revisar.',
      })
    );
  });

  it('reports the review through the day salvage channel', () => {
    const { record, report } = parseDailyRecordWithDefaultsReport(
      day({ ...passport(), documentType: 'Cedula' }),
      DATE
    );

    expect(record.beds.R1.identityReview?.fields).toEqual(['documentType']);
    expect(report.salvagedBeds).toEqual(['R1']);
    expect(hasStructuralRepairs(report)).toBe(true);
  });

  const nullable: Array<[PatientIdentityField, unknown]> = [
    ['patientName', null],
    ['secondLastName', null],
    ['rut', ['FAKE-RUT', null]],
  ];

  it.each(nullable)(
    'keeps %s exactly as stored, before the legacy normalization',
    (field, value) => {
      const record = readStored({ ...passport(), documentType: 'Cedula', [field]: value });

      expect(record.beds.R1.identityReview?.stored).toEqual(
        expect.objectContaining({ documentType: 'Cedula', [field]: value })
      );
      expect(withStoredIdentity(record).beds.R1[field]).toEqual(value);
    }
  );

  it('normalizes a null name as before when nothing else is unreadable', () => {
    const record = readStored({ ...passport(), patientName: null });

    expect(record.beds.R1.identityReview).toBeUndefined();
    expect(record.beds.R1.patientName).toBe('');
  });

  it('ignores a review stored in Firestore: only a read decides one', () => {
    const stored = {
      ...passport(),
      identityReview: { bedId: 'R1', slot: 'bed', fields: ['documentType'] },
    };

    expect(readStored(stored).beds.R1.identityReview).toBeUndefined();
  });
});

it('keeps the bed key, UPC policy and empty-patient field defaults', () => {
  const repair = (bedId: string) =>
    parsePatientDataWithDefaultsReport(
      {
        ...passport(),
        bedId: 'OTHER',
        insurance: 'UNKNOWN',
        biologicalSex: 'UNKNOWN',
        status: 'UNKNOWN',
        isUPC: true,
      },
      bedId
    ).patient;
  expect(repair('R1')).toMatchObject({
    bedId: 'R1',
    isUPC: true,
    biologicalSex: 'Indeterminado',
    status: '',
  });
  expect(repair('H1C1')).toMatchObject({ bedId: 'H1C1', isUPC: false });
});

it('uses main empty-patient defaults for absent fields in a repaired patient', () => {
  const { patient } = parsePatientDataWithDefaultsReport({ insurance: 'UNKNOWN' }, 'NEO1');
  expect(patient).toMatchObject({ ...createEmptyPatient('NEO1'), identityStatus: 'official' });
});

it('drops all invalid list elements without discarding other fields', () => {
  const { patient, report } = parsePatientDataWithDefaultsReport(
    { ...passport(), devices: [1, 2], clinicalEvents: [{ id: 7 }] },
    'R1'
  );
  expect(patient).toMatchObject({ ...passport(), devices: [], clinicalEvents: [] });
  expect(report.droppedListItems).toBe(3);
});
