// @vitest-environment node
/**
 * Client write hygiene on split days (D3 and D9 of DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md):
 * a client never writes moved fields from its local copy, never changes or drops the marker of a
 * stored day and never creates a day with one. Unmarked days must come back untouched.
 * Synthetic data only.
 */
import { describe, expect, it } from 'vitest';
import {
  adoptStoredClinicalDerivedState,
  carriesClinicalDerivedLayout,
  isClinicalDerivedLayoutRegression,
} from '@/services/storage/clinicalDerivedWriteHygiene';

type Holder = Record<string, unknown>;
type Day = Record<string, unknown> & { beds: Record<string, Holder> };

const DATE = '2026-11-02';
const marker = { version: 1, generation: 'gen_synthetic_a' };

const moved = (label: string) => ({
  clinicalSyncCheckpoint: {
    version: 3,
    fingerprintVersion: 1,
    sources: { vitals: { watermark: label } },
  },
  vitalSignsHistory: [
    { recordedDate: DATE, recordedAt: `${DATE}T08:00:00`, heartRate: 80, author: label },
  ],
});

const patient = (
  clinicalEpisodeId: string | undefined,
  label: string,
  extra: Holder = {}
): Holder => ({
  patientName: `Paciente sintético ${label}`,
  rut: '11.111.111-1',
  documentType: 'RUT',
  ...(clinicalEpisodeId ? { clinicalEpisodeId } : {}),
  ...moved(label),
  ...extra,
});

const day = (beds: Record<string, Holder>, extra: Holder = {}): Day => ({
  date: DATE,
  lastUpdated: `${DATE}T10:00:00.000Z`,
  beds,
  ...extra,
});

const bed = (record: Day, bedId: string): Holder => record.beds[bedId];
const crib = (record: Day, bedId: string): Holder => bed(record, bedId).clinicalCrib as Holder;

describe('adoptStoredClinicalDerivedState · unmarked days are a no-op', () => {
  it('returns the very same record when neither side carries a marker', () => {
    const local = day({ R1: patient('ep_a', 'local') }, { meta: { revision: 2 } });
    const stored = day({ R1: patient('ep_a', 'stored') }, { meta: { revision: 9 } });
    expect(adoptStoredClinicalDerivedState(local, stored)).toBe(local);
    expect(adoptStoredClinicalDerivedState(local, undefined)).toBe(local);
  });

  it('strips a local marker when the day does not exist yet (create) and keeps everything else', () => {
    const local = day(
      { R1: patient('ep_a', 'local') },
      { clinicalDerivedLayout: marker, meta: { revision: 4 } }
    );
    const created = adoptStoredClinicalDerivedState(local, undefined);
    expect('clinicalDerivedLayout' in created).toBe(false);
    expect(created).toEqual({ ...day({ R1: patient('ep_a', 'local') }), meta: { revision: 4 } });
    expect(local.clinicalDerivedLayout).toEqual(marker);
  });

  it('never adds a marker to a stored unmarked day; its moved fields stay embedded as today', () => {
    const local = day({ R1: patient('ep_a', 'local') }, { clinicalDerivedLayout: marker });
    const written = adoptStoredClinicalDerivedState(local, day({ R1: patient('ep_a', 'stored') }));
    expect('clinicalDerivedLayout' in written).toBe(false);
    expect(bed(written, 'R1')).toEqual(patient('ep_a', 'local'));
  });

  it('drops a key left as undefined, which sanitizeForFirestore would write as null', () => {
    const local = { ...day({}), clinicalDerivedLayout: undefined };
    expect('clinicalDerivedLayout' in adoptStoredClinicalDerivedState(local, undefined)).toBe(
      false
    );
  });
});

describe('adoptStoredClinicalDerivedState · a pre-split local copy over a split stored day', () => {
  const stored = day(
    {
      // ep_a was split: its document holds the data, the day keeps nothing.
      R1: patient('ep_a', 'stored-a', {
        clinicalSyncCheckpoint: undefined,
        vitalSignsHistory: undefined,
      }),
      // ep_b is not split yet: its embedded copy is the only one.
      R2: {
        ...patient('ep_mother', 'stored-mother'),
        clinicalCrib: patient('ep_newborn', 'stored-newborn'),
      },
      R3: patient('ep_c', 'stored-c'),
    },
    { clinicalDerivedLayout: marker, meta: { revision: 7, lastMutationId: 'server-mutation' } }
  );
  const local = day(
    {
      R1: patient('ep_a', 'local-a'),
      R2: {
        ...patient('ep_mother', 'local-mother', { documentType: 'Pasaporte', rut: 'AB1234567' }),
        clinicalCrib: patient('ep_newborn', 'local-newborn'),
      },
      // ep_c moved from R3 (stored) to R4 (local); R3 now holds a new episode.
      R3: patient('ep_new', 'local-new'),
      R4: patient('ep_c', 'local-c'),
    },
    { meta: { revision: 3 } }
  );

  it('writes no local moved field and carries the stored marker and meta', () => {
    const written = adoptStoredClinicalDerivedState(local, stored);
    expect(written.clinicalDerivedLayout).toEqual(marker);
    expect(written.meta).toEqual({ revision: 7, lastMutationId: 'server-mutation' });
    // Every moved-field value left in the day comes from the stored copy.
    const movedValues = Object.values(written.beds)
      .flatMap(holder => [holder, holder.clinicalCrib as Holder | undefined])
      .filter((holder): holder is Holder => Boolean(holder))
      .flatMap(holder => [holder.clinicalSyncCheckpoint, holder.vitalSignsHistory])
      .filter(value => value !== undefined);
    expect(movedValues).toHaveLength(6);
    movedValues.forEach(value => expect(JSON.stringify(value)).toMatch(/"stored-/));
  });

  it('takes each episode’s moved fields from the stored day, wherever it sits', () => {
    const written = adoptStoredClinicalDerivedState(local, stored);
    // Split episode: nothing embedded stays nothing (the document wins on read).
    expect('vitalSignsHistory' in bed(written, 'R1')).toBe(false);
    expect('clinicalSyncCheckpoint' in bed(written, 'R1')).toBe(false);
    // Mother and newborn are distinct episodes; each keeps its own stored embedded copy.
    expect(bed(written, 'R2').vitalSignsHistory).toEqual(moved('stored-mother').vitalSignsHistory);
    expect(crib(written, 'R2').clinicalSyncCheckpoint).toEqual(
      moved('stored-newborn').clinicalSyncCheckpoint
    );
    // Matched by episode, not by bed: the moved episode brings its copy, the new one has none.
    expect(bed(written, 'R4').vitalSignsHistory).toEqual(moved('stored-c').vitalSignsHistory);
    expect('vitalSignsHistory' in bed(written, 'R3')).toBe(false);
  });

  it('leaves identity and every other local field alone (a passport stays a passport)', () => {
    const written = adoptStoredClinicalDerivedState(local, stored);
    expect(bed(written, 'R2')).toMatchObject({
      patientName: 'Paciente sintético local-mother',
      documentType: 'Pasaporte',
      rut: 'AB1234567',
      clinicalEpisodeId: 'ep_mother',
    });
    expect(written.lastUpdated).toBe(local.lastUpdated);
  });

  it('never mutates its inputs and never shares stored objects with the result', () => {
    const before = structuredClone({ local, stored });
    const written = adoptStoredClinicalDerivedState(local, stored);
    expect({ local, stored }).toEqual(before);
    (bed(written, 'R2').vitalSignsHistory as unknown[]).push('changed');
    (written.meta as Holder).revision = 99;
    expect({ local, stored }).toEqual(before);
  });

  it('treats a marker it does not understand as split and copies it verbatim', () => {
    const future = { version: 2, generation: 'gen_b', shards: 2 };
    const written = adoptStoredClinicalDerivedState(local, {
      ...stored,
      clinicalDerivedLayout: future,
    });
    expect(written.clinicalDerivedLayout).toEqual(future);
    expect('vitalSignsHistory' in bed(written, 'R1')).toBe(false);
  });

  it('matches an id stored twice only in its own slot, and a holder without id only an id-less slot', () => {
    const twice = day(
      {
        R1: patient('ep_dup', 'stored-r1'),
        R2: patient('ep_dup', 'stored-r2'),
        R5: patient(undefined, 'stored-r5'),
      },
      { clinicalDerivedLayout: marker }
    );
    const written = adoptStoredClinicalDerivedState(
      day({
        R1: patient('ep_dup', 'local-r1'),
        R3: patient('ep_dup', 'local-r3'),
        R5: patient(undefined, 'local-r5'),
        R6: patient(undefined, 'local-r6'),
      }),
      twice
    );
    expect(bed(written, 'R1').vitalSignsHistory).toEqual(moved('stored-r1').vitalSignsHistory);
    expect('vitalSignsHistory' in bed(written, 'R3')).toBe(false);
    expect(bed(written, 'R5').vitalSignsHistory).toEqual(moved('stored-r5').vitalSignsHistory);
    expect('vitalSignsHistory' in bed(written, 'R6')).toBe(false);
  });
});

describe('isClinicalDerivedLayoutRegression', () => {
  const localSplit = day(
    {},
    { clinicalDerivedLayout: marker, lastUpdated: `${DATE}T12:00:00.000Z` }
  );

  it.each([
    ['an older copy without marker', `${DATE}T11:00:00.000Z`, true],
    ['a copy of the same version without marker', `${DATE}T12:00:00.000Z`, true],
    ['an unreadable timestamp', 'not-a-date', true],
    ['a strictly newer copy without marker', `${DATE}T13:00:00.000Z`, false],
  ])('over a local split day, %s → %s', (_label, lastUpdated, expected) => {
    expect(isClinicalDerivedLayoutRegression(localSplit, day({}, { lastUpdated }))).toBe(expected);
  });

  it('never blocks when the local day is unmarked, missing, or the copy keeps its marker', () => {
    const older = day({}, { lastUpdated: `${DATE}T01:00:00.000Z` });
    expect(isClinicalDerivedLayoutRegression(day({}), older)).toBe(false);
    expect(isClinicalDerivedLayoutRegression(null, older)).toBe(false);
    expect(
      isClinicalDerivedLayoutRegression(localSplit, { ...older, clinicalDerivedLayout: marker })
    ).toBe(false);
  });

  it('reads a null marker as no marker', () => {
    expect(carriesClinicalDerivedLayout({ clinicalDerivedLayout: null })).toBe(false);
    expect(carriesClinicalDerivedLayout({ clinicalDerivedLayout: marker })).toBe(true);
  });
});
