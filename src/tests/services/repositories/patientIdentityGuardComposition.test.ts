import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { findPatientErasures } from '@/services/repositories/dailyRecordErasureGuard';
import { hasSamePatientEpisodeIdentity } from '@/application/patient-flow/patientEpisodeIdentityPolicy';
import { isSameEpisodeForExplicitCensusPatch } from '@/services/repositories/explicitLocalCensusPatchPolicy';

// One synthetic pair of occupants, judged by the three identity comparators a single write can
// meet: the erasure guard's relocation exemption (client and server mirror), the canonical
// episode comparator behind the admission-date policy, and the stale-edit merge comparator.
// They are intentionally not equivalent; this pins where they diverge.
const require = createRequire(import.meta.url);
const { findPatientErasures: serverFindPatientErasures } =
  require('../../../../functions/lib/dailyRecordErasureGuard.js') as {
    findPatientErasures: typeof findPatientErasures;
  };

type ErasureVerdict = 'relocated' | 'erased';

interface IdentityCase {
  name: string;
  /** Remote occupant of the bed the incoming record leaves empty without a movement. */
  vacated: Partial<PatientData>;
  /** The only occupant of the incoming record, in another bed. */
  present: Partial<PatientData>;
  erasureGuard: ErasureVerdict;
  canonicalEpisode: boolean;
  explicitCensusPatch: boolean;
}

const occupant = (bedId: string, fields: Partial<PatientData>): PatientData =>
  ({
    bedId,
    patientName: 'Paciente Sintetico',
    admissionDate: '2026-07-01',
    admissionTime: '10:00',
    ...fields,
  }) as PatientData;

const record = (beds: Record<string, PatientData>): DailyRecord =>
  ({ date: '2026-07-03', beds, discharges: [], transfers: [], cma: [] }) as unknown as DailyRecord;

const erasureVerdict = (vacated: PatientData, present: PatientData): ErasureVerdict => {
  const remote = record({ R1: vacated });
  const local = record({ R2: present });
  const client = findPatientErasures(remote, local);
  expect(serverFindPatientErasures(remote, local)).toEqual(client);
  return client.length === 0 ? 'relocated' : 'erased';
};

const cases: IdentityCase[] = [
  {
    name: 'same canonical episode moved to another bed',
    vacated: { rut: '22.222.222-2', clinicalEpisodeId: 'ep_mismo' },
    present: { rut: '22222222-2', clinicalEpisodeId: 'ep_mismo' },
    erasureGuard: 'relocated',
    canonicalEpisode: true,
    explicitCensusPatch: true,
  },
  {
    name: 'legacy id rewritten to a canonical id while the patient moves',
    vacated: { rut: '22.222.222-2', clinicalEpisodeId: 'legacy_ep_abc123' },
    present: { rut: '22.222.222-2', clinicalEpisodeId: 'ep_hidratado' },
    erasureGuard: 'relocated',
    canonicalEpisode: false,
    explicitCensusPatch: true,
  },
  {
    name: 'newborn sharing the mother document',
    vacated: {
      patientName: 'RN Sintetico',
      rut: '33.333.333-3',
      clinicalEpisodeId: 'ep_rn',
      admissionDate: '2026-07-02',
      admissionTime: '04:10',
    },
    present: { patientName: 'Madre Sintetica', rut: '33.333.333-3', clinicalEpisodeId: 'ep_madre' },
    erasureGuard: 'erased',
    canonicalEpisode: false,
    explicitCensusPatch: false,
  },
  {
    name: 'shared document without episode ids',
    vacated: { patientName: 'RN Sintetico', rut: '33.333.333-3', admissionDate: '2026-07-02' },
    present: { patientName: 'Madre Sintetica', rut: '33.333.333-3' },
    erasureGuard: 'erased',
    canonicalEpisode: false,
    explicitCensusPatch: false,
  },
  {
    name: 'passport and RUT with the same digits',
    vacated: { patientName: 'Paciente Pasaporte', rut: 'AB1234567', clinicalEpisodeId: 'ep_pas' },
    present: { patientName: 'Paciente RUT', rut: '123.456-7', clinicalEpisodeId: 'ep_rut' },
    erasureGuard: 'erased',
    canonicalEpisode: false,
    explicitCensusPatch: false,
  },
  {
    name: 'two passports differing only in their letter prefix',
    vacated: { patientName: 'Pasaporte Uno', rut: 'AB123456', clinicalEpisodeId: 'ep_uno' },
    present: { patientName: 'Pasaporte Dos', rut: 'CD123456', clinicalEpisodeId: 'ep_dos' },
    erasureGuard: 'erased',
    canonicalEpisode: false,
    explicitCensusPatch: false,
  },
  {
    name: 'readmission with the same document and a new episode',
    vacated: { rut: '22.222.222-2', clinicalEpisodeId: 'ep_anterior', admissionDate: '2026-06-20' },
    present: { rut: '22.222.222-2', clinicalEpisodeId: 'ep_reingreso' },
    erasureGuard: 'erased',
    canonicalEpisode: false,
    explicitCensusPatch: false,
  },
  {
    name: 'different patients with different documents',
    vacated: { patientName: 'Paciente Uno', rut: '22.222.222-2', clinicalEpisodeId: 'ep_uno' },
    present: { patientName: 'Paciente Dos', rut: '44.444.444-4', clinicalEpisodeId: 'ep_dos' },
    erasureGuard: 'erased',
    canonicalEpisode: false,
    explicitCensusPatch: false,
  },
];

describe('patient identity across write guards', () => {
  it.each(cases)('$name', testCase => {
    const vacated = occupant('R1', testCase.vacated);
    const present = occupant('R2', testCase.present);

    expect({
      erasureGuard: erasureVerdict(vacated, present),
      canonicalEpisode: hasSamePatientEpisodeIdentity(vacated, present),
      explicitCensusPatch: isSameEpisodeForExplicitCensusPatch(vacated, present),
    }).toEqual({
      erasureGuard: testCase.erasureGuard,
      canonicalEpisode: testCase.canonicalEpisode,
      explicitCensusPatch: testCase.explicitCensusPatch,
    });
  });

  it('still blocks a dropped newborn whose own document differs from the mother', () => {
    const newborn = occupant('R1', {
      patientName: 'RN Sintetico',
      rut: '55.555.555-5',
      clinicalEpisodeId: 'ep_rn',
    });
    const mother = occupant('R1', { patientName: 'Madre Sintetica', rut: '33.333.333-3' });
    const remote = record({ R1: { ...mother, clinicalCrib: newborn } });
    const local = record({ R1: mother });

    expect(findPatientErasures(remote, local)).toEqual([
      { bedId: 'R1 (cuna RN)', remotePatientName: 'RN Sintetico' },
    ]);
    expect(serverFindPatientErasures(remote, local)).toEqual(findPatientErasures(remote, local));
  });
});
