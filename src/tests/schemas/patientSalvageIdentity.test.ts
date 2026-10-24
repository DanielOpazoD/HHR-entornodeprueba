// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  hasStructuralRepairs,
  parseDailyRecordWithDefaultsReport,
  parsePatientDataWithDefaultsReport,
} from '@/schemas/zodSchemas';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import type { PatientIdentityField } from '@/types/domain/patientIdentity';

const DATE = '2026-10-24';
const passport = () => ({
  bedId: 'R1',
  patientName: 'PACIENTE SINTETICO P5',
  firstName: 'PACIENTE',
  lastName: 'SINTETICO',
  secondLastName: 'P5',
  rut: 'FAKE-PASSPORT-P5',
  documentType: 'Pasaporte',
  identityStatus: 'official',
  clinicalEpisodeId: 'ep_synthetic_p5',
  admissionDate: '2026-10-23',
  admissionTime: '10:00',
  pathology: 'DIAGNOSTICO SINTETICO',
  cie10Code: 'SYNTHETIC-P5',
  diagnosisComments: 'COMENTARIO SINTETICO',
  medicalHandoffNote: 'NOTA SINTETICA CONSERVAR',
  handoffNoteDayShift: 'NOTA ENFERMERIA SINTETICA',
});
const neighbour = () => ({
  ...passport(),
  bedId: 'R2',
  patientName: 'VECINO SINTETICO',
  rut: '11.111.111-1',
  documentType: 'RUT',
  clinicalEpisodeId: 'ep_synthetic_neighbour',
});
const day = (r1: unknown) => ({
  date: DATE,
  schemaVersion: 1,
  beds: { R1: r1, R2: neighbour() },
});
const readStored = (r1: unknown) => docToRecord(day(r1), DATE);

const strictReaders = [
  {
    name: 'patient parser',
    read: (value: unknown) => parsePatientDataWithDefaultsReport(value, 'R1').patient,
  },
  {
    name: 'daily parser',
    read: (value: unknown) => parseDailyRecordWithDefaultsReport(day(value), DATE).record.beds.R1,
  },
];

// One invalid stored value per identity field, and what a read may show for it: the stored value
// as text when that loses nothing, otherwise nothing. Never a guess.
const unreadableIdentity: Array<[PatientIdentityField, unknown, unknown]> = [
  ['documentType', 'Cedula', undefined],
  ['rut', 12345678, '12345678'],
  ['clinicalEpisodeId', 4321, '4321'],
  ['identityStatus', 'tentative', 'official'],
  ['patientName', 42, '42'],
  ['firstName', { given: 'PACIENTE' }, ''],
  ['lastName', ['SINTETICO'], ''],
  ['secondLastName', 5, '5'],
  ['admissionDate', { seconds: 1, nanoseconds: 0 }, ''],
  ['admissionTime', 930, '930'],
];

describe('a stored patient with one invalid non-identity field', () => {
  it.each([...strictReaders, { name: 'docToRecord', read: (v: unknown) => readStored(v).beds.R1 }])(
    'keeps every valid passport field through the $name',
    ({ read }) => {
      const original = passport();
      const patient = read({ ...original, insurance: 'UNKNOWN_LEGACY_INSURANCE' });

      expect(patient).toMatchObject(original);
      expect(patient.insurance).toBeUndefined();
      expect(patient.identityReview).toBeUndefined();
    }
  );
});

describe('a stored patient with one unreadable identity field', () => {
  it.each(unreadableIdentity)(
    'imports and writes refuse %s instead of guessing it',
    (field, invalid) => {
      strictReaders.forEach(({ read }) => {
        expect(() => read({ ...passport(), [field]: invalid })).toThrow(
          expect.objectContaining({
            code: 'patient_identity_repair_required',
            bedId: 'R1',
            slot: 'bed',
            fields: [field],
          })
        );
      });
    }
  );

  it.each(unreadableIdentity)(
    'a read keeps the day and the bed, and puts %s under review',
    (field, invalid, shown) => {
      const record = readStored({ ...passport(), [field]: invalid });
      const { [field]: _unreadable, ...untouched } = passport();

      expect(record.beds.R1).toMatchObject(untouched);
      expect(record.beds.R1[field]).toEqual(shown);
      expect(record.beds.R1.documentType).not.toBe('RUT');
      expect(record.beds.R1.identityReview).toEqual({ bedId: 'R1', slot: 'bed', fields: [field] });
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
    });
    expect(() => parseDailyRecordWithDefaultsReport(day(mother), DATE)).toThrow(
      expect.objectContaining({ bedId: 'R1', slot: 'clinicalCrib', fields: ['documentType'] })
    );
  });

  it('reports the review through the day salvage channel', () => {
    const { report } = parseDailyRecordWithDefaultsReport(
      day({ ...passport(), documentType: 'Cedula' }),
      DATE,
      { unreadableIdentity: 'quarantine' }
    );

    expect(report.salvagedBeds).toEqual(['R1']);
    expect(hasStructuralRepairs(report)).toBe(true);
  });

  it('ignores a review stored in Firestore: only a read decides one', () => {
    const stored = {
      ...passport(),
      identityReview: { bedId: 'R1', slot: 'bed', fields: ['documentType'] },
    };

    expect(readStored(stored).beds.R1.identityReview).toBeUndefined();
  });
});

describe('lists inside a salvaged patient', () => {
  const event = (id: string) => ({
    id,
    name: 'Cultivo',
    date: '2026-10-23',
    createdAt: '2026-10-23T10:00:00.000Z',
  });
  const entry = (id: string) => ({ id, specialty: 'Medicina', note: `NOTA ${id}` });
  const listPatient = () => ({
    ...passport(),
    clinicalEvents: [event('ev-1'), { ...event('ev-2'), name: 7 }, event('ev-3')],
    medicalHandoffEntries: [entry('me-1'), entry('me-2'), { ...entry('me-3'), id: null }],
    devices: ['CVC', 5, 'VMI'],
  });

  it('keeps every valid entry and counts the dropped ones', () => {
    const { record, report } = parseDailyRecordWithDefaultsReport(day(listPatient()), DATE);

    expect(record.beds.R1.clinicalEvents.map(item => item.id)).toEqual(['ev-1', 'ev-3']);
    expect(record.beds.R1.medicalHandoffEntries?.map(item => item.id)).toEqual(['me-1', 'me-2']);
    expect(record.beds.R1.devices).toEqual(['CVC', 'VMI']);
    expect(record.beds.R1).toMatchObject(passport());
    expect(report.droppedPatientListItems).toBe(3);
    expect(hasStructuralRepairs(report)).toBe(true);
  });

  it('counts the drops of a single patient salvage too', () => {
    expect(parsePatientDataWithDefaultsReport(listPatient(), 'R1').report.droppedListItems).toBe(3);
  });
});

describe('what a salvaged bed keeps from before', () => {
  const salvage = (bedId: string, patient: Record<string, unknown>) =>
    parseDailyRecordWithDefaultsReport(
      { date: DATE, beds: { [bedId]: { ...patient, insurance: 'UNKNOWN_LEGACY_INSURANCE' } } },
      DATE
    ).record.beds[bedId];

  it('places the patient by its bed key, not by a stored bedId', () => {
    expect(salvage('R1', { ...passport(), bedId: 'H6C2' }).bedId).toBe('R1');
  });

  it('re-resolves UPC from the bed: only UPC beds keep it', () => {
    expect(salvage('R1', { ...passport(), isUPC: true }).isUPC).toBe(true);
    expect(salvage('H1C1', { ...passport(), bedId: 'H1C1', isUPC: true }).isUPC).toBe(false);
  });

  it('repairs an invalid non-identity field with the empty-patient value, not with nothing', () => {
    const patient = salvage('R1', {
      ...passport(),
      biologicalSex: 'DESCONOCIDO',
      status: 'ESTADO_INVALIDO',
      bedMode: 'Litera',
    });

    expect(patient).toMatchObject({ biologicalSex: 'Indeterminado', status: '', bedMode: 'Cama' });
    expect(patient).toMatchObject(passport());
  });
});
