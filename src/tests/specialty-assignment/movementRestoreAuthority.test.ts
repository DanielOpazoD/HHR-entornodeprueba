import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { movementRestoreRecord } = require('../../../functions/lib/movementRestoreSources.js');
const {
  protectSpecialtyDecisions,
} = require('../../../functions/lib/specialtyDecisionContract.js');
const {
  preserveRayenClinicalFields,
} = require('../../../functions/lib/dailyRecordClinicalFieldPreservation.js');
const source = {
  patientName: 'Paciente sintético',
  rut: 'A12345',
  clinicalEpisodeId: 'episode-one',
  admissionDate: '2026-10-17',
  admissionTime: '12:00',
  specialty: 'Cirugía',
  specialtyAssignment: {
    schemaVersion: 3,
    episodeId: 'episode-one',
    decisionId: 'decision-one',
    source: 'manual',
    recordDate: '2026-10-18',
    actorUid: 'synthetic',
    decidedAt: '2026-10-18T12:00:00Z',
  },
  vitalSigns: { systolic: 120 },
  cudyr: { category: 'C2' },
  neonatalMaternalRut: '123',
};
const fixture = (list: 'discharges' | 'transfers' | 'cma' = 'discharges', nested = false) => {
  const movement = {
    movementDate: '2026-10-18',
    time: '12:00',
    id: 'movement-one',
    bedId: 'R1',
    isNested: nested,
    originalData: structuredClone(source),
  };
  const remote = {
    beds: { R1: nested ? { patientName: 'Madre', rut: '123', clinicalEpisodeId: 'mother' } : {} },
    discharges: [] as (typeof movement)[],
    transfers: [] as (typeof movement)[],
    cma: [] as (typeof movement)[],
  };
  const candidate = {
    beds: {
      R1: nested
        ? { ...remote.beds.R1, clinicalCrib: structuredClone(source) }
        : structuredClone(source),
    },
    discharges: [] as (typeof movement & { deletedAt: string })[],
    transfers: [] as (typeof movement & { deletedAt: string })[],
    cma: [] as (typeof movement & { deletedAt: string })[],
  };
  remote[list] = [movement];
  candidate[list] = [{ ...structuredClone(movement), deletedAt: '2026-10-18T13:00:00Z' }];
  if (nested) {
    const priorMother = {
      ...movement,
      id: 'mother-exit',
      isNested: false,
      originalData: { ...source, patientName: 'Madre', rut: '123', clinicalEpisodeId: 'mother' },
      deletedAt: '2026-10-18T12:30:00Z',
    };
    remote[list].push(priorMother);
    candidate[list].push(priorMother);
  }
  return { remote, candidate };
};
describe('authoritative movement restoration', () => {
  it.each(['discharges', 'transfers', 'cma'] as const)(
    'recovers stored specialty and clinical fields for %s',
    list => {
      const { remote, candidate } = fixture(list);
      expect(protectSpecialtyDecisions({ remoteRecord: remote, candidate })).toEqual([]);
      const preserved = preserveRayenClinicalFields({
        remoteRecord: remote,
        incomingRecord: candidate,
      });
      expect(preserved.beds.R1).toEqual(source);
    }
  );
  it.each(['discharges', 'transfers', 'cma'] as const)(
    'keeps the crib and mother separate for %s',
    list => {
      const { remote, candidate } = fixture(list, true);
      const preserved = preserveRayenClinicalFields({
        remoteRecord: remote,
        incomingRecord: candidate,
      });
      expect(preserved.beds.R1.clinicalCrib).toEqual(source);
      expect(preserved.beds.R1.clinicalEpisodeId).toBe('mother');
    }
  );
  it.each([
    'unconsumed',
    'modified-snapshot',
    'wrong-episode',
    'wrong-identity',
    'already-deleted',
    'occupied',
    'duplicate',
  ])('rejects %s as a restoration source', kind => {
    const { remote, candidate } = fixture();
    if (kind === 'unconsumed') candidate.discharges[0].deletedAt = '';
    if (kind === 'modified-snapshot') candidate.discharges[0].originalData.specialty = 'Otro';
    if (kind === 'wrong-episode') Object.assign(candidate.beds.R1, { clinicalEpisodeId: 'other' });
    if (kind === 'wrong-identity') Object.assign(candidate.beds.R1, { rut: 'other' });
    if (kind === 'already-deleted') Object.assign(remote.discharges[0], { deletedAt: 'yesterday' });
    if (kind === 'occupied') Object.assign(remote.beds.R1, { patientName: 'Another patient' });
    if (kind === 'duplicate') remote.discharges.push({ ...remote.discharges[0] });
    expect(movementRestoreRecord(remote, candidate).beds).toEqual({});
  });
  it('does not trust changed specialty metadata or scalar in the restored patient', () => {
    for (const change of [
      { specialty: 'Otro' },
      { specialtyAssignment: { ...source.specialtyAssignment, actorUid: 'forged' } },
    ]) {
      const { remote, candidate } = fixture();
      Object.assign(candidate.beds.R1, change);
      expect(() => protectSpecialtyDecisions({ remoteRecord: remote, candidate })).toThrow();
    }
  });
  it('restores clinical values from the remote snapshot, never client alterations', () => {
    const { remote, candidate } = fixture();
    Object.assign(candidate.beds.R1, { vitalSigns: { systolic: 999 } });
    const result = preserveRayenClinicalFields({ remoteRecord: remote, incomingRecord: candidate });
    expect(result.beds.R1.vitalSigns).toEqual(source.vitalSigns);
  });
});

it('rejects a crib restored beneath a different mother or without a verifiable maternal episode', () => {
  for (const kind of ['replacement', 'missing-link']) {
    const { remote, candidate } = fixture('discharges', true);
    if (kind === 'replacement')
      Object.assign(candidate.beds.R1, { clinicalEpisodeId: 'other-mother' });
    else remote.discharges = remote.discharges.filter(m => m.isNested);
    expect(() => movementRestoreRecord(remote, candidate)).toThrow(/madre original/);
  }
});

it.each([{ neonatalMaternalRut: 'other' }, { neonatalMaternalRut: '' }, { bedMode: 'Cama' }])(
  'rejects changes to the original crib snapshot: %j',
  change => {
    const { remote, candidate } = fixture('discharges', true);
    Object.assign(Reflect.get(candidate.beds.R1, 'clinicalCrib'), change);
    expect(() => movementRestoreRecord(remote, candidate)).toThrow(/datos originales/);
  }
);

it.each([{ bedId: 'R2' }, { isNested: true }, { movementDate: '2026-10-19' }, { time: '23:59' }])(
  'rejects rewritten movement metadata: %j',
  change => {
    const { remote, candidate } = fixture();
    Object.assign(candidate.discharges[0], change);
    expect(movementRestoreRecord(remote, candidate).beds).toEqual({});
  }
);

it('rejects nonclinical snapshot changes on a primary bed', () => {
  for (const change of [
    { patientName: ` ${source.patientName} ` },
    { neonatalMaternalRut: 'changed' },
  ]) {
    const { remote, candidate } = fixture();
    Object.assign(candidate.beds.R1, change);
    expect(() => movementRestoreRecord(remote, candidate)).toThrow(/datos originales/);
  }
});
