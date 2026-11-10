import { describe, expect, it } from 'vitest';
import { reconcileClinicalCribs } from '@/features/rayen-import/domain/reconcileClinicalCribs';
import {
  pendingClinicalCribDischargeIdentities,
  withClinicalCribDefaults,
} from '@/features/rayen-import/domain/clinicalCribPlacementPolicy';
import { createEmptyCensusImportDiff } from '@/features/rayen-import/domain/censusImportDiffFactory';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import type { RayenEncounter } from '@/features/rayen-import/contracts/rayenSnapshot';
import type {
  DailyRecord,
  PatientData,
} from '@/features/rayen-import/contracts/rayenDomainContracts';

const reference = new Date('2026-07-08T20:00:00-06:00');
const encounter: RayenEncounter = {
  encounterId: 'NEW',
  run: 'AB123456',
  firstGivenName: 'RN sintético',
  firstFamilyName: '',
  birthDate: '2026-07-08',
  service: 'Pediatría',
  room: 'Cunas',
  bed: 'CH5C1',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Control',
  clinicalCribParentBedId: 'H5C1',
};
const patient = (
  rut: string,
  documentType: PatientData['documentType'] = 'Pasaporte',
  episode = 'OLD-A'
): PatientData => ({
  ...rayenToPatientData(encounter, reference).patient,
  bedId: 'H5C1',
  rut,
  documentType,
  clinicalEpisodeId: episode,
  patientName: 'RN sintético',
  handoffNote: `Nota ${episode}`,
  pathology: 'Anterior',
});
const record = (a: PatientData, b?: PatientData, targetOccupied = true): DailyRecord => {
  const mother = rayenToPatientData(
    {
      ...encounter,
      encounterId: 'MOTHER',
      run: '144700554',
      birthDate: '1980-01-01',
      firstGivenName: 'Madre sintética',
      room: 'H5',
      bed: 'C1',
    },
    reference
  ).patient;
  return {
    date: '2026-07-08',
    beds: {
      H5C1: { ...mother, ...(targetOccupied ? { clinicalCrib: a } : {}) },
      ...(b ? { H5C2: { ...mother, bedId: 'H5C2', clinicalCrib: b } } : {}),
      ...(!targetOccupied ? { H5C3: { ...mother, bedId: 'H5C3', clinicalCrib: a } } : {}),
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
    activeExtraBeds: [],
  };
};
const candidate = (incoming: PatientData, source: RayenEncounter = encounter) => ({
  encounter: source,
  mapped: { ...rayenToPatientData(source, reference), bedId: 'H5C1', patient: incoming },
});
const reconcile = (
  current: DailyRecord,
  incoming: PatientData,
  source = encounter,
  usesMaternalRun = false,
  pending: ReadonlySet<string> = new Set()
) => {
  const diff = createEmptyCensusImportDiff(false);
  reconcileClinicalCribs(
    current,
    [{ ...candidate(incoming, source), usesMaternalRun }],
    diff,
    new Set(['H5C1']),
    pending
  );
  return diff;
};

describe('clinical crib document fallback', () => {
  it('updates A, retaining its local note, when two passports share digits and A has a new episode', () => {
    const a = patient('AB123456');
    const b = patient('CD123456', 'Pasaporte', 'OLD-B');
    const diff = reconcile(record(a, b), { ...a, clinicalEpisodeId: 'NEW', pathology: 'Nuevo' });
    expect(diff.conflicts).toEqual([]);
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0]).toMatchObject({
      bedId: 'H5C1',
      changes: [
        {
          field: 'clinicalCrib',
          from: a,
          to: {
            rut: 'AB123456',
            clinicalEpisodeId: 'NEW',
            handoffNote: 'Nota OLD-A',
            pathology: 'Nuevo',
          },
        },
      ],
    });
  });

  it.each(['123456-K', '12.345.6-K', '123456'])(
    'does not match passport AB123456 to RUN %s',
    run => {
      const diff = reconcile(record(patient(run, 'RUT')), patient('AB123456', 'Pasaporte', 'NEW'));
      expect(diff.updates).toEqual([]);
      expect(diff.conflicts[0]?.reason).toContain('ya está ocupada');
    }
  );

  it('does not match the same literal number with a different document type', () => {
    const diff = reconcile(record(patient('123456', 'Pasaporte')), patient('123456', 'RUT', 'NEW'));
    expect(diff.updates).toEqual([]);
    expect(diff.conflicts[0]?.reason).toContain('ya está ocupada');
  });

  it('preserves exact passport punctuation and case', () => {
    for (const different of ['AB-123456', 'ab123456']) {
      const diff = reconcile(record(patient(different)), patient('AB123456', 'Pasaporte', 'NEW'));
      expect(diff.updates).toEqual([]);
      expect(diff.conflicts[0]?.reason).toContain('ya está ocupada');
    }
  });

  it('matches a formatted RUN in a new episode', () => {
    const a = patient('22.222.222-2', 'RUT');
    const source = { ...encounter, run: '222222222' };
    const diff = reconcile(record(a), patient(source.run, 'RUT', 'NEW'), source);
    expect(diff.conflicts).toEqual([]);
    expect(diff.updates[0]?.changes[0]?.to).toMatchObject({ clinicalEpisodeId: 'NEW' });
  });

  it('keeps episode priority even when the document fallback would point to B', () => {
    const a = patient('AB123456', 'Pasaporte', 'NEW');
    const b = patient('CD123456', 'Pasaporte', 'OTHER');
    const diff = reconcile(record(a, b), { ...a, rut: b.rut, pathology: 'Nuevo' });
    expect(diff.conflicts).toEqual([]);
    expect(diff.updates[0]?.changes[0]?.from).toEqual(a);
  });

  it('keeps a documentless RN matched by episode and preserves its local identity', () => {
    const a = patient('', 'RUT', 'NEW');
    const diff = reconcile(record(a), { ...a, pathology: 'Nuevo' }, { ...encounter, run: '' });
    expect(diff.conflicts).toEqual([]);
    expect(diff.updates[0]?.changes[0]?.to).toMatchObject({ rut: '', handoffNote: 'Nota NEW' });
  });

  it('does not use a maternal RUN as document fallback', () => {
    const a = patient('22.222.222-2', 'RUT');
    const diff = reconcile(
      record(a),
      patient(a.rut, 'RUT', 'NEW'),
      { ...encounter, run: a.rut },
      true
    );
    expect(diff.updates).toEqual([]);
    expect(diff.conflicts[0]?.reason).toContain('ya está ocupada');
  });

  it('does not clear a stored passport when the source maternal RUN shares its digits', () => {
    const a = patient('AB123456', 'Pasaporte', 'NEW');
    const diff = reconcile(
      record(a),
      { ...a, rut: '', pathology: 'Nuevo' },
      { ...encounter, run: '123456' },
      true
    );
    expect(diff.conflicts).toEqual([]);
    expect(diff.updates[0]?.changes[0]?.to).toMatchObject({
      rut: 'AB123456',
      documentType: 'Pasaporte',
    });
  });

  it.each(['Pasaporte', 'RUT'] as const)(
    'still recognises a %s document repeated in two cribs as the crib already associated',
    type => {
      const run = type === 'Pasaporte' ? 'AB123456' : '222222222';
      const a = patient(run, type);
      const b = patient(run, type, 'OLD-B');
      const diff = reconcile(record(a, b), patient(run, type, 'NEW'), { ...encounter, run });
      expect(diff.conflicts[0]?.reason).toContain('ya está asociada a H5C2');
    }
  );

  it('does not suppress an unchanged episode-less passport crib for another pending passport', () => {
    const source = { ...encounter, encounterId: '' };
    const a = withClinicalCribDefaults(rayenToPatientData(source, reference).patient);
    const pending = pendingClinicalCribDischargeIdentities([
      candidate(patient('CD123456', 'Pasaporte', ''), source),
    ]);
    const diff = reconcile(record(a), a, source, false, pending);
    expect(diff.updates).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
    const samePending = pendingClinicalCribDischargeIdentities([candidate(a, source)]);
    expect(reconcile(record(a), a, source, false, samePending).unchangedCount).toBe(0);
  });
});
