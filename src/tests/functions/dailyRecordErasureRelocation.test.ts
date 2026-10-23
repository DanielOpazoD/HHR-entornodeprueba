import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { findPatientErasures } from '@/services/repositories/dailyRecordErasureGuard';
import { DataFactory } from '@/tests/factories/DataFactory';

const require = createRequire(import.meta.url);
const { findPatientErasures: serverGuard } =
  require('../../../functions/lib/dailyRecordErasureGuard.js') as {
    findPatientErasures: typeof findPatientErasures;
  };
const patient = (fields: Partial<PatientData> = {}) =>
  DataFactory.createMockPatient('R1', {
    patientName: 'Persona Sintetica',
    rut: '22.222.222-2',
    documentType: 'RUT',
    admissionDate: '2026-07-01',
    admissionTime: '10:00',
    firstSeenDate: undefined,
    clinicalEpisodeId: undefined,
    ...fields,
  });
const record = (beds: DailyRecord['beds']) =>
  DataFactory.createMockDailyRecord('2026-07-03', { beds });
const cases: {
  name: string;
  previous: Partial<PatientData>;
  incoming: Partial<PatientData>;
  allowed: boolean;
}[] = [
  {
    name: 'formatted document, normalized name and same admission',
    previous: {},
    incoming: { rut: '22222222-2', patientName: ' PERSONA  SINTÉTICA ' },
    allowed: true,
  },
  {
    name: 'legacy id hydrated during relocation',
    previous: { clinicalEpisodeId: 'legacy_ep_a' },
    incoming: { clinicalEpisodeId: 'ep_new' },
    allowed: true,
  },
  {
    name: 'remote already hydrated before local relocation',
    previous: { clinicalEpisodeId: 'ep_new' },
    incoming: { clinicalEpisodeId: 'legacy_ep_a' },
    allowed: true,
  },
  {
    name: 'missing id hydrated during relocation',
    previous: {},
    incoming: { clinicalEpisodeId: 'ep_new' },
    allowed: true,
  },
  {
    name: 'stable episode survives corrected demographics',
    previous: { clinicalEpisodeId: 'ep_same' },
    incoming: {
      clinicalEpisodeId: 'ep_same',
      rut: '44.444.444-4',
      patientName: 'Nombre Corregido',
    },
    allowed: true,
  },
  {
    name: 'distinct stable ids with identical demographics',
    previous: { clinicalEpisodeId: 'ep_first' },
    incoming: { clinicalEpisodeId: 'ep_second' },
    allowed: false,
  },
  {
    name: 'same legacy hash does not identify a different person',
    previous: { clinicalEpisodeId: 'legacy_ep_collision' },
    incoming: { clinicalEpisodeId: 'legacy_ep_collision', patientName: 'RN Sintetico' },
    allowed: false,
  },
  {
    name: 'shared document with same admission is not the same person',
    previous: {},
    incoming: { patientName: 'RN Sintetico' },
    allowed: false,
  },
  {
    name: 'passport letters remain significant without episode ids',
    previous: { rut: 'AB123456', documentType: 'Pasaporte' },
    incoming: { rut: 'CD123456', documentType: 'Pasaporte' },
    allowed: false,
  },
  {
    name: 'document types remain distinct with identical numbers',
    previous: { rut: '123456', documentType: 'Pasaporte' },
    incoming: { rut: '123456', documentType: 'RUT' },
    allowed: false,
  },
  {
    name: 'passport and RUT are distinct even without document types',
    previous: { rut: 'AB1234567', documentType: undefined },
    incoming: { rut: '123.456-7', documentType: undefined },
    allowed: false,
  },
  {
    name: 'different admission date without ids',
    previous: {},
    incoming: { admissionDate: '2026-07-02' },
    allowed: false,
  },
  {
    name: 'same-day readmission at another time',
    previous: {},
    incoming: { admissionTime: '12:00' },
    allowed: false,
  },
  {
    name: 'missing admission evidence on one side',
    previous: {},
    incoming: { admissionDate: '' },
    allowed: false,
  },
  {
    name: 'missing admission time on one side',
    previous: {},
    incoming: { admissionTime: undefined },
    allowed: false,
  },
  { name: 'missing document on one side', previous: {}, incoming: { rut: '' }, allowed: false },
  {
    name: 'first seen anchor remains stable',
    previous: { firstSeenDate: '2026-06-30' },
    incoming: { firstSeenDate: '2026-06-30', admissionDate: '2026-07-02' },
    allowed: true,
  },
  {
    name: 'same name with different known admission dates',
    previous: { rut: '' },
    incoming: { rut: '', admissionDate: '2026-07-02' },
    allowed: false,
  },
];

describe.each([
  ['client', findPatientErasures],
  ['server', serverGuard],
] as const)('%s relocation identity', (_name, guard) => {
  it.each(cases)('$name', ({ previous, incoming, allowed }) => {
    const remote = record({ R1: patient(previous) });
    const local = record({ R2: patient({ ...incoming, bedId: 'R2' }) });
    expect(guard(remote, local)).toEqual(
      allowed ? [] : [{ bedId: 'R1', remotePatientName: remote.beds.R1.patientName }]
    );
  });

  it('does not let one remaining legacy occupant represent two remote occupants', () => {
    const remote = record({ R1: patient(), R2: patient({ bedId: 'R2' }) });
    const local = record({ R2: remote.beds.R2 });
    expect(guard(remote, local)).toEqual([{ bedId: 'R1', remotePatientName: 'Persona Sintetica' }]);
  });

  it('rejects ambiguous local destinations', () => {
    const remote = record({ R1: patient() });
    const local = record({ R2: patient({ bedId: 'R2' }), R3: patient({ bedId: 'R3' }) });
    expect(guard(remote, local)).toEqual([{ bedId: 'R1', remotePatientName: 'Persona Sintetica' }]);
  });

  it('allows a newborn to move from its nested crib to an independent bed', () => {
    const mother = patient({ clinicalEpisodeId: 'ep_mother' });
    const newborn = patient({ patientName: 'RN Sintetico', clinicalEpisodeId: 'ep_newborn' });
    const remote = record({ R1: { ...mother, clinicalCrib: newborn } });
    const local = record({ R1: mother, R2: { ...newborn, bedId: 'R2' } });
    expect(guard(remote, local)).toEqual([]);
  });
});
