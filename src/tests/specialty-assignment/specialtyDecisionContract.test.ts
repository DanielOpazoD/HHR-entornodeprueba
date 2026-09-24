import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  protectSpecialtyDecisions,
  SpecialtyDecisionError,
  parseSpecialtyIntent,
} = require('../../../functions/lib/specialtyDecisionContract.js');

const patient = (episodeId = 'episode-one', specialty = '', specialtyAssignment?: object) => ({
  clinicalEpisodeId: episodeId,
  specialty,
  ...(specialtyAssignment ? { specialtyAssignment } : {}),
});
const record = (bed: object, crib?: object) => ({
  date: '2026-09-23',
  beds: { R1: { ...bed, ...(crib ? { clinicalCrib: crib } : {}) } },
});
const meta = {
  schemaVersion: 3,
  episodeId: 'episode-one',
  decisionId: 'old',
  source: 'manual',
  recordDate: '2026-09-23',
  actorUid: 'synthetic-user',
  decidedAt: '2026-09-23T00:00:00.000Z',
};
const apply = (remoteRecord: object, candidate: object, options: Record<string, unknown> = {}) =>
  protectSpecialtyDecisions({
    remoteRecord,
    candidate: { date: '2026-09-23', ...candidate },
    actorUid: 'synthetic-user',
    mutationId: 'new-mutation',
    now: '2026-09-23T01:00:00.000Z',
    ...options,
  });

describe('specialty decision authority', () => {
  it('requires an exact explicit episode-bound intent and protects an intentional empty value', () => {
    const remote = record(patient());
    const next = record(patient());
    const intent = parseSpecialtyIntent({
      kind: 'manual',
      bedId: 'R1',
      target: 'bed',
      episodeId: 'episode-one',
      value: '',
      expectedDecisionId: null,
    });
    const events = apply(remote, next, { intent, patch: { 'beds.R1.specialty': '' } });
    expect(events).toHaveLength(1);
    expect((next.beds.R1 as Record<string, unknown>).specialtyAssignment).toMatchObject({
      source: 'manual',
      decisionId: 'new-mutation',
    });
    expect(apply(next, record(patient()), {})).toEqual([]);
  });

  it('rejects clinical or structural changes bundled with an AI acceptance', () => {
    const intent = parseSpecialtyIntent({
      kind: 'accept_ai',
      bedId: 'R1',
      target: 'bed',
      episodeId: 'episode-one',
      value: 'Cirugía',
      expectedDecisionId: null,
      requestId: 'synthetic-request-123',
    });
    const remote = record({ ...patient(), diagnosisCie10: 'A00' });
    const next = record({ ...patient('episode-one', 'Cirugía'), diagnosisCie10: 'B00' });
    expect(() =>
      apply(remote, next, {
        intent,
        aiDecision: { requestId: 'synthetic-request-123' },
        patch: { 'beds.R1.specialty': 'Cirugía', 'beds.R1.diagnosisCie10': 'B00' },
      })
    ).toThrow(/only change/);
    expect((next.beds.R1 as Record<string, unknown>).specialtyAssignment).toBeUndefined();
  });

  it('does not allow a copied record or Rayen patch to change a manual or legacy specialty', () => {
    expect(() =>
      apply(
        record(patient('episode-one', 'Cirugía', meta)),
        record(patient('episode-one', 'Pediatría', meta))
      )
    ).toThrow(SpecialtyDecisionError);
    expect(() =>
      apply(record(patient('episode-one', 'Cirugía')), record(patient('episode-one', 'Pediatría')))
    ).toThrow(SpecialtyDecisionError);
    const next = record(patient('episode-one', 'Cirugía'));
    apply(record(patient('episode-one', 'Cirugía', meta)), next);
    expect((next.beds.R1 as Record<string, unknown>).specialtyAssignment).toEqual(meta);
    expect(() =>
      apply(
        record(patient('episode-one', 'Cirugía', meta)),
        record(patient('episode-one', 'Pediatría')),
        { guardScalarChanges: false }
      )
    ).toThrow(/explicit intent/i);
  });

  it('rejects stale decisions, forged metadata and a moved or replaced occupant', () => {
    const intent = parseSpecialtyIntent({
      kind: 'manual',
      bedId: 'R1',
      target: 'bed',
      episodeId: 'episode-one',
      value: 'Cirugía',
      expectedDecisionId: null,
    });
    expect(() =>
      apply(record(patient('episode-one', '', meta)), record(patient('episode-one', 'Cirugía')), {
        intent,
        patch: { 'beds.R1.specialty': 'Cirugía' },
      })
    ).toThrow(/decision changed/i);
    expect(() => apply(record(patient()), record(patient('episode-one', '', meta)))).toThrow(
      /server-owned/i
    );
    expect(() =>
      apply(record(patient('episode-two')), record(patient('episode-one', 'Cirugía')), {
        intent,
        patch: { 'beds.R1.specialty': 'Cirugía' },
      })
    ).toThrow(/episode changed/i);
  });

  it('keeps mother and crib separate', () => {
    const remote = record(patient(), patient('crib-one'));
    const next = record(patient(), patient('crib-one', 'Pediatría'));
    const intent = parseSpecialtyIntent({
      kind: 'manual',
      bedId: 'R1',
      target: 'clinicalCrib',
      episodeId: 'crib-one',
      value: 'Pediatría',
      expectedDecisionId: null,
    });
    const events = apply(remote, next, {
      intent,
      patch: { 'beds.R1.clinicalCrib.specialty': 'Pediatría' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].target).toBe('clinicalCrib');
    expect((next.beds.R1 as Record<string, unknown>).specialtyAssignment).toBeUndefined();
    expect(
      (next.beds.R1.clinicalCrib as Record<string, unknown>).specialtyAssignment
    ).toMatchObject({ source: 'manual' });
  });

  it('copies confirmed provenance to the next day only from the previous authoritative day', () => {
    const previous = record(patient('episode-one', 'Cirugía', meta));
    const next = record(patient('episode-one', 'Cirugía', meta));
    expect(apply({}, next, { priorRecord: previous })).toEqual([]);
    expect(() => apply({}, record(patient('episode-one', 'Cirugía', meta)))).toThrow(
      /confirmed episode/i
    );
  });

  it('keeps the exact prior episode specialty when Eloísa suggests another value on first import', () => {
    const previous = record(patient('episode-one', 'Cirugía', meta));
    const imported = {
      date: '2026-09-24',
      beds: {
        R2: patient('episode-one', 'Med Interna'),
        R3: patient('new-episode', 'Pediatría'),
      },
    };
    apply({ date: '2026-09-24', beds: {} }, imported, { priorRecord: previous });
    expect(imported.beds.R2.specialty).toBe('Cirugía');
    expect((imported.beds.R2 as Record<string, unknown>).specialtyAssignment).toEqual(meta);
    expect(imported.beds.R3.specialty).toBe('');
    expect((imported.beds.R3 as Record<string, unknown>).specialtyAssignment).toBeUndefined();
  });

  it('still rejects a changed confirmed specialty on an ordinary current-day update', () => {
    const remote = record(patient('episode-one', 'Cirugía', meta));
    expect(() => apply(remote, record(patient('episode-one', 'Med Interna')))).toThrow(
      /explicit intent|Confirmed specialty changed/i
    );
    expect(() => apply(remote, record(patient('episode-one', 'Med Interna', meta)))).toThrow(
      /explicit intent|confirmed episode/i
    );
    const moved = { date: '2026-09-23', beds: { R2: patient('episode-one', 'Med Interna') } };
    expect(() => apply(remote, moved)).toThrow(/Confirmed specialty changed/i);
  });

  it('does not accept forged provenance for a replacement episode on first import', () => {
    const previous = record(patient('episode-one', 'Cirugía', meta));
    const forged = {
      date: '2026-09-24',
      beds: {
        R1: patient('new-episode', 'Cirugía', meta),
      },
    };
    expect(() =>
      apply({ date: '2026-09-24', beds: {} }, forged, { priorRecord: previous })
    ).toThrow(/confirmed episode/i);
  });

  it('keeps provenance when a confirmed episode moves to another bed', () => {
    const remote = {
      beds: { R1: patient('episode-one', 'Cirugía', meta), R2: patient('episode-two') },
    };
    const next = {
      beds: { R1: patient('episode-two'), R2: patient('episode-one', 'Cirugía', meta) },
    };
    expect(apply(remote, next)).toEqual([]);
    expect(next.beds.R2.specialtyAssignment).toEqual(meta);
  });

  it('starts a new admission pending even when an old snapshot supplies a specialty', () => {
    const remote = record(patient('old-episode', 'Cirugía', meta));
    const next = record(patient('new-episode', 'Pediatría'));
    expect(apply(remote, next)).toEqual([]);
    expect((next.beds.R1 as Record<string, unknown>).specialty).toBe('');
    expect((next.beds.R1 as Record<string, unknown>).specialtyAssignment).toBeUndefined();
  });

  it('does not inherit yesterday’s specialty when the imported episode ID is absent', () => {
    const previous = record({ ...patient('', 'Cirugía'), patientName: 'Paciente anterior' });
    const next = record({ ...patient('', 'Med Interna'), patientName: 'Paciente nuevo' });
    expect(apply({ beds: {} }, next, { priorRecord: previous })).toEqual([]);
    expect((next.beds.R1 as Record<string, unknown>).specialty).toBe('');
    expect((next.beds.R1 as Record<string, unknown>).specialtyAssignment).toBeUndefined();
  });

  it('rejects an occupied legacy snapshot that drops a protected episode, but permits an empty bed', () => {
    const remote = record({ ...patient('episode-one', 'Cirugía', meta), patientName: 'Sintético' });
    expect(() =>
      apply(remote, record({ ...patient('', 'Pediatría'), patientName: 'Sintético' }))
    ).toThrow(/replacement episode/i);
    expect(apply(remote, record({ ...patient(''), patientName: '', rut: '' }))).toEqual([]);
  });

  it('preserves a legacy specialty without episode on an unrelated edit for the same admission', () => {
    const occupant = {
      ...patient('', 'Cirugía'),
      patientName: 'Paciente Sintético',
      rut: '11.111.111-1',
      admissionDate: '2026-09-20',
      admissionTime: '08:00',
    };
    const remote = record(occupant);
    const next = record({ ...occupant, specialty: '', age: '42' });
    expect(apply(remote, next, { patch: { 'beds.R1.age': '42' } })).toEqual([]);
    expect((next.beds.R1 as Record<string, unknown>).specialty).toBe('Cirugía');

    const identified = record({ ...occupant, clinicalEpisodeId: 'episode-new', specialty: '' });
    expect(apply(remote, identified)).toEqual([]);
    expect((identified.beds.R1 as Record<string, unknown>).specialty).toBe('Cirugía');
  });

  it('fails closed for ambiguous legacy replacement and does not carry specialty to a new admission', () => {
    const occupant = {
      ...patient('', 'Cirugía'),
      patientName: 'Paciente Sintético',
      rut: '11.111.111-1',
      admissionDate: '2026-09-20',
      admissionTime: '08:00',
    };
    const remote = record(occupant);
    expect(() =>
      apply(
        remote,
        record({ ...occupant, patientName: 'Otro Paciente', rut: '22.222.222-2', specialty: '' })
      )
    ).toThrow(/replacement episode/i);
    expect(() =>
      apply(remote, record({ ...occupant, specialty: 'Pediatría' }), {
        patch: { 'beds.R1.specialty': 'Pediatría' },
      })
    ).toThrow(/explicit intent/i);

    const replacement = record({
      ...occupant,
      patientName: 'Otro Paciente',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'other-episode',
      specialty: 'Pediatría',
    });
    expect(apply(remote, replacement)).toEqual([]);
    expect((replacement.beds.R1 as Record<string, unknown>).specialty).toBe('');
  });

  it('leaves legacy scalar editing unchanged while episode mode is disabled', () => {
    const occupant = {
      ...patient('', 'Cirugía'),
      patientName: 'Paciente Sintético',
      admissionDate: '2026-09-20',
    };
    const next = record({ ...occupant, specialty: 'Pediatría' });
    expect(apply(record(occupant), next, { guardScalarChanges: false })).toEqual([]);
    expect((next.beds.R1 as Record<string, unknown>).specialty).toBe('Pediatría');
  });

  it('rejects a duplicate manual decision through the server authority', () => {
    const remote = record(patient('episode-one', 'Cirugía', meta));
    const intent = parseSpecialtyIntent({
      kind: 'manual',
      bedId: 'R1',
      target: 'bed',
      episodeId: 'episode-one',
      value: 'Cirugía',
      expectedDecisionId: 'old',
    });
    expect(() =>
      apply(remote, record(patient('episode-one', 'Cirugía')), {
        intent,
        patch: { 'beds.R1.specialty': 'Cirugía' },
      })
    ).toThrow(/already manually confirmed/i);
  });
});
