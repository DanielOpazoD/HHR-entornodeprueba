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
  withClearedStoredMovedFields,
} from '@/services/storage/clinicalDerivedWriteHygiene';
import { ensureDailyRecordClinicalEpisodeIds } from '@/application/patient-flow/clinicalEpisodeIdPolicy';

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

  it('matches an id stored twice only in its own slot, and a holder without id only its own patient', () => {
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
        R6: patient(undefined, 'local-r6', { rut: '33.333.333-3' }),
      }),
      twice
    );
    expect(bed(written, 'R1').vitalSignsHistory).toEqual(moved('stored-r1').vitalSignsHistory);
    expect('vitalSignsHistory' in bed(written, 'R3')).toBe(false);
    expect(bed(written, 'R5').vitalSignsHistory).toEqual(moved('stored-r5').vitalSignsHistory);
    expect('vitalSignsHistory' in bed(written, 'R6')).toBe(false);
  });

  it('never hands an id-less stored patient’s copy to another patient or a cleared bed', () => {
    const storedY = day(
      { R1: patient(undefined, 'stored-y', { rut: '22.222.222-2' }) },
      { clinicalDerivedLayout: marker }
    );
    const other = adoptStoredClinicalDerivedState(
      day({ R1: patient(undefined, 'local-x', { rut: '33.333.333-3' }) }),
      storedY
    );
    expect(bed(other, 'R1')).not.toHaveProperty('vitalSignsHistory');
    expect(bed(other, 'R1')).not.toHaveProperty('clinicalSyncCheckpoint');
    const cleared = adoptStoredClinicalDerivedState(
      day({ R1: { patientName: '', rut: '' } }),
      storedY
    );
    expect(bed(cleared, 'R1')).toEqual({ patientName: '', rut: '' });
  });

  it('keeps the only copy of an id-less stored patient when the save backfilled a legacy id', () => {
    const identity = { rut: '22.222.222-2', admissionDate: '2026-11-01' };
    const stored = day(
      { R1: patient(undefined, 'stored-y', identity) },
      { clinicalDerivedLayout: marker }
    );
    // Every client save backfills a legacy id from the identity (dailyRecordPersistencePreparation).
    const local = ensureDailyRecordClinicalEpisodeIds(
      day({ R1: patient(undefined, 'local-y', identity) }) as never
    ) as Day;
    expect(bed(local, 'R1').clinicalEpisodeId).toMatch(/^legacy_ep_/);

    const written = adoptStoredClinicalDerivedState(local, stored);
    expect(bed(written, 'R1').vitalSignsHistory).toEqual(moved('stored-y').vitalSignsHistory);
    expect(bed(written, 'R1').clinicalSyncCheckpoint).toEqual(
      moved('stored-y').clinicalSyncCheckpoint
    );
  });

  it('ignores a blocked bed that kept a stale id, so the active episode still matches', () => {
    const stored = day(
      {
        R1: patient('ep_a', 'stored-a'),
        R5: { isBlocked: true, clinicalEpisodeId: 'ep_a' },
      },
      { clinicalDerivedLayout: marker }
    );
    const written = adoptStoredClinicalDerivedState(
      day({
        R2: patient('ep_a', 'local-a'),
        R5: { isBlocked: true, clinicalEpisodeId: 'ep_a', ...moved('local-blocked') },
      }),
      stored
    );
    expect(bed(written, 'R2').vitalSignsHistory).toEqual(moved('stored-a').vitalSignsHistory);
    expect(bed(written, 'R5')).toEqual({ isBlocked: true, clinicalEpisodeId: 'ep_a' });
  });

  it('drops the local meta when the stored split day has none', () => {
    const written = adoptStoredClinicalDerivedState(
      day({}, { meta: { revision: 3 } }),
      day({}, { clinicalDerivedLayout: marker })
    );
    expect(written).not.toHaveProperty('meta');
  });

  it('keeps a stored null marker as the rules see it: present, with the stored meta', () => {
    const written = adoptStoredClinicalDerivedState(local, {
      ...stored,
      clinicalDerivedLayout: null,
    });
    expect(written.clinicalDerivedLayout).toBeNull();
    expect(written.meta).toEqual(stored.meta);
    expect('vitalSignsHistory' in bed(written, 'R1')).toBe(false);
  });
});

// Firestore set-merge semantics: nested maps merge key by key, CLEAR deletes, anything else
// replaces the stored value.
const CLEAR = { clear: 'synthetic-delete-sentinel' };
const applyMerge = (stored: unknown, payload: Holder): Holder => {
  const result: Holder = { ...(stored as Holder) };
  Object.entries(payload).forEach(([key, value]) => {
    if (value === CLEAR) delete result[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const current = result[key];
      result[key] = applyMerge(
        current && typeof current === 'object' && !Array.isArray(current) ? current : {},
        value as Holder
      );
    } else result[key] = value;
  });
  return result;
};

describe('withClearedStoredMovedFields · merge: true ends as a full set would', () => {
  const stored = day(
    {
      R1: patient('ep_a', 'stored-a', { clinicalSyncCheckpoint: undefined }),
      R2: { ...patient('ep_mother', 'stored-mother'), clinicalCrib: patient('ep_nb', 'stored-nb') },
      R3: patient('ep_c', 'stored-c'),
      R7: patient('ep_gone', 'stored-gone'),
    },
    { clinicalDerivedLayout: marker, meta: { revision: 7 } }
  );
  const local = day(
    {
      R1: patient('ep_a', 'local-a'),
      R2: { ...patient('ep_mother', 'local-mother'), clinicalCrib: patient('ep_nb2', 'local-nb2') },
      // ep_c moved to R4; a new episode took R3 and the stored R7 patient left.
      R3: patient('ep_new', 'local-new'),
      R4: patient('ep_c', 'local-c'),
      R7: { patientName: '', rut: '' },
    },
    { meta: { revision: 3 } }
  );

  it('removes what another episode left in the slot and keeps each episode’s stored copy', () => {
    const payload = adoptStoredClinicalDerivedState(local, stored);
    const merged = applyMerge(
      stored,
      withClearedStoredMovedFields(payload, stored, () => CLEAR)
    ) as Day;

    expect(bed(merged, 'R3')).not.toHaveProperty('vitalSignsHistory');
    expect(bed(merged, 'R3')).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(bed(merged, 'R7')).not.toHaveProperty('vitalSignsHistory');
    expect(crib(merged, 'R2')).not.toHaveProperty('vitalSignsHistory');
    expect(bed(merged, 'R4').vitalSignsHistory).toEqual(moved('stored-c').vitalSignsHistory);
    expect(bed(merged, 'R2').vitalSignsHistory).toEqual(moved('stored-mother').vitalSignsHistory);
    // Split episode: its document holds the data; nothing embedded stays nothing.
    expect(bed(merged, 'R1').vitalSignsHistory).toEqual(moved('stored-a').vitalSignsHistory);
    expect(bed(merged, 'R1').clinicalSyncCheckpoint).toBeUndefined();
    // Every holder ends with exactly the moved fields of the adopted payload.
    Object.keys(local.beds).forEach(bedId => {
      ['clinicalSyncCheckpoint', 'vitalSignsHistory'].forEach(field => {
        expect(bed(merged, bedId)[field]).toEqual(bed(payload, bedId)[field]);
      });
    });
  });

  it('returns the very same payload on an unmarked or missing stored day, or with nothing to clear', () => {
    const payload = { ...local } as Holder;
    const clear = () => CLEAR;
    expect(withClearedStoredMovedFields(payload, day(stored.beds), clear)).toBe(payload);
    expect(withClearedStoredMovedFields(payload, undefined, clear)).toBe(payload);
    const adopted = adoptStoredClinicalDerivedState(day({ R3: patient('ep_c', 'x') }), stored);
    expect(withClearedStoredMovedFields(adopted, stored, clear)).toBe(adopted);
  });
});

describe('isClinicalDerivedLayoutRegression', () => {
  const localSplit = day(
    {},
    { clinicalDerivedLayout: marker, lastUpdated: `${DATE}T12:00:00.000Z` }
  );
  const otherGeneration = { clinicalDerivedLayout: { version: 1, generation: 'gen_synthetic_b' } };

  it.each([
    ['an older copy without marker', `${DATE}T11:00:00.000Z`, {}, true],
    ['a copy of the same version without marker', `${DATE}T12:00:00.000Z`, {}, true],
    ['an unreadable timestamp', 'not-a-date', {}, true],
    ['an older copy from another generation', `${DATE}T11:00:00.000Z`, otherGeneration, true],
    ['a strictly newer copy without marker', `${DATE}T13:00:00.000Z`, {}, false],
    [
      'a strictly newer copy from another generation',
      `${DATE}T13:00:00.000Z`,
      otherGeneration,
      false,
    ],
  ])('over a local split day, %s → %s', (_label, lastUpdated, extra, expected) => {
    expect(isClinicalDerivedLayoutRegression(localSplit, day({}, { lastUpdated, ...extra }))).toBe(
      expected
    );
  });

  it('never blocks when the local day is unmarked, missing, or the copy keeps its marker', () => {
    const older = day({}, { lastUpdated: `${DATE}T01:00:00.000Z` });
    expect(isClinicalDerivedLayoutRegression(day({}), older)).toBe(false);
    expect(isClinicalDerivedLayoutRegression(null, older)).toBe(false);
    expect(
      isClinicalDerivedLayoutRegression(localSplit, { ...older, clinicalDerivedLayout: marker })
    ).toBe(false);
  });

  it('counts a null marker as present, like the rules', () => {
    expect(carriesClinicalDerivedLayout({ clinicalDerivedLayout: null })).toBe(true);
    expect(carriesClinicalDerivedLayout({ clinicalDerivedLayout: marker })).toBe(true);
    expect(carriesClinicalDerivedLayout({ clinicalDerivedLayout: undefined })).toBe(false);
    expect(carriesClinicalDerivedLayout({})).toBe(false);
  });
});
