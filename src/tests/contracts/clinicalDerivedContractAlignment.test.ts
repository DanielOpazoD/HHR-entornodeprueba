/**
 * Alignment of the clinicalDerived contract twins (phase 1a). The server writes and reads episode
 * documents with functions/lib/clinicalDerivedContract.js and the client overlays them with
 * src/services/storage/clinicalDerivedContract.ts: if the two disagree on which document counts or
 * which field wins, a client shows (or rebuilds from) a different day than the server verified.
 * Every case below runs through BOTH copies. Synthetic data only.
 */
import { createRequire } from 'node:module';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as client from '@/services/storage/clinicalDerivedContract';
import { RAYEN_BATCH_ONLY_CLINICAL_FIELDS } from '@/services/storage/dailyRecordAuthorityContract';
import type {
  ClinicalDerivedEpisodeDoc,
  ClinicalDerivedTarget,
} from '@/types/domain/clinicalDerived';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const require = createRequire(import.meta.url);
const server = require('../../../functions/lib/clinicalDerivedContract.js');

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_a';
const marker = { version: 1, generation: GENERATION };

type Holder = Record<string, unknown>;
type Beds = Record<string, Holder>;

const vitals = (label: string) => [
  { recordedDate: DATE, recordedAt: `${DATE}T08:00:00`, heartRate: 80, author: label },
];
const checkpoint = (watermark: string) => ({
  version: 3,
  fingerprintVersion: 1,
  sources: { vitals: { watermark } },
});
const embedded = (label: string) => ({
  clinicalSyncCheckpoint: checkpoint(`embedded-${label}`),
  vitalSignsHistory: vitals(`embedded-${label}`),
});

const patient = (clinicalEpisodeId: string, extra: Holder = {}): Holder => ({
  patientName: `Paciente ${clinicalEpisodeId}`,
  rut: '11.111.111-1',
  documentType: 'RUT',
  clinicalEpisodeId,
  ...embedded(clinicalEpisodeId),
  ...extra,
});

const day = (beds: Beds, extra: Holder = {}): DailyRecord =>
  ({
    date: DATE,
    lastUpdated: `${DATE}T10:00:00.000Z`,
    meta: { revision: 5 },
    clinicalDerivedLayout: marker,
    beds,
    ...extra,
  }) as unknown as DailyRecord;

const episodeDoc = (clinicalEpisodeId: string, fields: Holder, overrides: Holder = {}) =>
  ({
    schemaVersion: 1,
    date: DATE,
    clinicalEpisodeId,
    layoutGeneration: GENERATION,
    target: 'bed',
    bedId: 'R1',
    dayRevision: 5,
    ...fields,
    ...overrides,
  }) as unknown as ClinicalDerivedEpisodeDoc;

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

/** Runs the overlay through both twins on frozen inputs and requires identical answers. */
const overlayBoth = (record: DailyRecord, docs: ClinicalDerivedEpisodeDoc[]) => {
  const before = structuredClone({ record, docs });
  deepFreeze(record);
  deepFreeze(docs);
  const fromClient = client.overlayClinicalDerived(record, docs);
  const fromServer = server.overlayClinicalDerived(record, docs);
  expect(fromServer).toEqual(fromClient);
  expect({ record, docs }).toEqual(before);
  return fromClient;
};

const holderOf = (record: DailyRecord, bedId: string, crib = false): Holder => {
  const bed = (record.beds as unknown as Beds)[bedId];
  return crib ? (bed.clinicalCrib as Holder) : bed;
};

describe('clinicalDerived contract · alignment between the server and client twins', () => {
  it('share constants: collection, moved fields, marker, schema and client version floor', () => {
    expect([...client.CLINICAL_DERIVED_MOVED_FIELDS]).toEqual([
      ...server.CLINICAL_DERIVED_MOVED_FIELDS,
    ]);
    expect([...client.CLINICAL_DERIVED_TARGETS]).toEqual([...server.CLINICAL_DERIVED_TARGETS]);
    expect({
      collection: client.CLINICAL_DERIVED_COLLECTION,
      layoutField: client.CLINICAL_DERIVED_LAYOUT_FIELD,
      layoutVersion: client.CLINICAL_DERIVED_LAYOUT_VERSION,
      docSchemaVersion: client.CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
      versionField: client.CLIENT_RUNTIME_CONTRACT_VERSION_FIELD,
      minClientVersion: client.CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION,
    }).toEqual({
      collection: server.CLINICAL_DERIVED_COLLECTION,
      layoutField: server.CLINICAL_DERIVED_LAYOUT_FIELD,
      layoutVersion: server.CLINICAL_DERIVED_LAYOUT_VERSION,
      docSchemaVersion: server.CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
      versionField: server.CLIENT_RUNTIME_CONTRACT_VERSION_FIELD,
      minClientVersion: server.CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION,
    });
    expect([...client.CLINICAL_DERIVED_MOVED_FIELDS]).toEqual([
      'clinicalSyncCheckpoint',
      'vitalSignsHistory',
    ]);
    expect(client.CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION).toBe(3);
    // Only fields the batch alone writes may move; devices and manual fields stay in the day.
    const batchOnly = new Set<string>(RAYEN_BATCH_ONLY_CLINICAL_FIELDS);
    expect(client.CLINICAL_DERIVED_MOVED_FIELDS.every(field => batchOnly.has(field))).toBe(true);
    // The domain types spell the same constants.
    expectTypeOf<ClinicalDerivedTarget>().toEqualTypeOf<
      (typeof client.CLINICAL_DERIVED_TARGETS)[number]
    >();
    expectTypeOf<ClinicalDerivedEpisodeDoc['schemaVersion']>().toEqualTypeOf<
      typeof client.CLINICAL_DERIVED_DOC_SCHEMA_VERSION
    >();
  });

  it('agree on which episode ids and generations can be document ids', () => {
    const cases: Array<[unknown, boolean]> = [
      ['ep_3f9a-77', true],
      ['legacy_ep_abc123', true],
      ['a'.repeat(120), true],
      ['a'.repeat(121), false],
      ['', false],
      ['ep/1', false],
      ['ep.1', false],
      ['.', false],
      ['..', false],
      ['__x__', false],
      ['__proto__', false],
      [' ep_1', false],
      [12345, false],
      [null, false],
    ];
    for (const [value, expected] of cases) {
      expect({ value, client: client.isClinicalDerivedDocId(value) }).toEqual({
        value,
        client: expected,
      });
      expect({ value, server: server.isClinicalDerivedDocId(value) }).toEqual({
        value,
        server: expected,
      });
    }
  });

  it('agree on the marker state and on building a marker', () => {
    const cases: Array<[unknown, string]> = [
      [undefined, 'unmarked'],
      [null, 'unmarked'],
      [marker, 'marked'],
      [{ version: 2, generation: GENERATION }, 'unsupported'],
      [{ version: 1, generation: '' }, 'unsupported'],
      [{ version: 1, generation: 'a/b' }, 'unsupported'],
      ['gen', 'unsupported'],
    ];
    for (const [value, status] of cases) {
      const record = { date: DATE, beds: {}, clinicalDerivedLayout: value };
      expect(client.readClinicalDerivedLayout(record)).toEqual(
        server.readClinicalDerivedLayout(record)
      );
      expect(client.readClinicalDerivedLayout(record).status).toBe(status);
    }
    expect(client.buildClinicalDerivedLayout('gen_b')).toEqual(
      server.buildClinicalDerivedLayout('gen_b')
    );
    expect(() => client.buildClinicalDerivedLayout('__gen__')).toThrow();
    expect(() => server.buildClinicalDerivedLayout('__gen__')).toThrow();
  });

  it('agree on the client version fence', () => {
    for (const [value, expected] of [
      [3, true],
      [4, true],
      [2, false],
      ['3', false],
      [3.5, false],
      [undefined, false],
    ] as Array<[unknown, boolean]>) {
      expect(client.meetsClinicalDerivedClientVersion(value)).toBe(expected);
      expect(server.meetsClinicalDerivedClientVersion(value)).toBe(expected);
    }
  });

  it('a present document field wins even when null; an absent one keeps the embedded copy', () => {
    const record = day({ R1: patient('ep_a'), R2: patient('ep_b') });
    const result = overlayBoth(record, [
      episodeDoc('ep_a', { clinicalSyncCheckpoint: null, vitalSignsHistory: vitals('doc-a') }),
      episodeDoc('ep_b', { vitalSignsHistory: vitals('doc-b') }, { bedId: 'R2' }),
    ]);
    expect(result.matchedEpisodeIds).toEqual(['ep_a', 'ep_b']);
    const bedA = holderOf(result.record, 'R1');
    expect('clinicalSyncCheckpoint' in bedA).toBe(false);
    expect(bedA.vitalSignsHistory).toEqual(vitals('doc-a'));
    const bedB = holderOf(result.record, 'R2');
    expect(bedB.clinicalSyncCheckpoint).toEqual(checkpoint('embedded-ep_b'));
    expect(bedB.vitalSignsHistory).toEqual(vitals('doc-b'));
    // A null history empties the field too.
    const emptied = overlayBoth(day({ R1: patient('ep_a') }), [
      episodeDoc('ep_a', { clinicalSyncCheckpoint: checkpoint('doc'), vitalSignsHistory: null }),
    ]);
    expect('vitalSignsHistory' in holderOf(emptied.record, 'R1')).toBe(false);
    expect(holderOf(emptied.record, 'R1').clinicalSyncCheckpoint).toEqual(checkpoint('doc'));
  });

  it('ignores documents of another generation (a deleted day), date or schema version', () => {
    const record = day({ R1: patient('ep_a') });
    for (const overrides of [
      { layoutGeneration: 'gen_deleted_day' },
      { date: '2026-11-01' },
      { schemaVersion: 2 },
    ]) {
      const result = overlayBoth(record, [
        episodeDoc('ep_a', { clinicalSyncCheckpoint: null, vitalSignsHistory: null }, overrides),
      ]);
      expect(result.matchedEpisodeIds).toEqual([]);
      expect(result.record).toBe(record);
    }
    // A day and a document that both lack a date do not match each other.
    const undated = day({ R1: patient('ep_a') }, { date: undefined });
    const docs = [episodeDoc('ep_a', { vitalSignsHistory: null }, { date: undefined })];
    expect(overlayBoth(undated, docs).matchedEpisodeIds).toEqual([]);
    expect(client.findStaleClinicalDerivedEpisodeIds(undated, docs)).toEqual([]);
    expect(server.findStaleClinicalDerivedEpisodeIds(undated, docs)).toEqual([]);
  });

  it('copies plain data but shares instances (a Timestamp or Date) instead of flattening them', () => {
    class SyntheticTimestamp {
      constructor(readonly seconds: number) {}
      toMillis() {
        return this.seconds * 1000;
      }
    }
    const at = new SyntheticTimestamp(1);
    const when = new Date(Date.UTC(2026, 10, 2, 8));
    const result = overlayBoth(day({ R1: patient('ep_a') }), [
      episodeDoc('ep_a', {
        clinicalSyncCheckpoint: { ...checkpoint('doc'), observedAt: at },
        vitalSignsHistory: [{ ...vitals('doc')[0], takenAt: when }],
      }),
    ]);
    const bed = holderOf(result.record, 'R1') as {
      clinicalSyncCheckpoint: { observedAt: SyntheticTimestamp };
      vitalSignsHistory: Array<{ takenAt: Date }>;
    };
    expect(bed.clinicalSyncCheckpoint.observedAt).toBe(at);
    expect(bed.clinicalSyncCheckpoint.observedAt.toMillis()).toBe(1000);
    expect(bed.vitalSignsHistory[0].takenAt).toBe(when);
  });

  it('matches a holder id with stray spaces to its trimmed document id', () => {
    const record = day({ R1: patient(' ep_a ') });
    const result = overlayBoth(record, [episodeDoc('ep_a', { vitalSignsHistory: vitals('doc') })]);
    expect(result.matchedEpisodeIds).toEqual(['ep_a']);
    expect(holderOf(result.record, 'R1').vitalSignsHistory).toEqual(vitals('doc'));
  });

  it('never overlays an unmarked day or a marker it does not understand', () => {
    const docs = [episodeDoc('ep_a', { vitalSignsHistory: null })];
    for (const layout of [undefined, { version: 2, generation: GENERATION }]) {
      const record = day({ R1: patient('ep_a') }, { clinicalDerivedLayout: layout });
      const result = overlayBoth(record, docs);
      expect(result.record).toBe(record);
      expect(result.matchedEpisodeIds).toEqual([]);
    }
  });

  it('follows a newborn moved from the mother’s crib to its own bed by episode id', () => {
    const record = day({
      R1: patient('ep_mother'),
      R7: patient('ep_newborn', { bedMode: 'Cuna' }),
    });
    const result = overlayBoth(record, [
      episodeDoc(
        'ep_newborn',
        { vitalSignsHistory: vitals('doc-newborn') },
        { target: 'clinicalCrib', bedId: 'R1' }
      ),
    ]);
    expect(result.matchedEpisodeIds).toEqual(['ep_newborn']);
    expect(holderOf(result.record, 'R7').vitalSignsHistory).toEqual(vitals('doc-newborn'));
    expect(holderOf(result.record, 'R1').vitalSignsHistory).toEqual(vitals('embedded-ep_mother'));
  });

  it('keeps mother and newborn as separate episodes in the same bed', () => {
    const record = day({
      R1: patient('ep_mother', { clinicalCrib: patient('ep_newborn', { bedMode: 'Cuna' }) }),
    });
    const result = overlayBoth(record, [
      episodeDoc('ep_mother', { vitalSignsHistory: vitals('doc-mother') }),
      episodeDoc(
        'ep_newborn',
        { vitalSignsHistory: vitals('doc-newborn'), clinicalSyncCheckpoint: null },
        { target: 'clinicalCrib' }
      ),
    ]);
    expect(result.matchedEpisodeIds).toEqual(['ep_mother', 'ep_newborn']);
    const mother = holderOf(result.record, 'R1');
    const newborn = holderOf(result.record, 'R1', true);
    expect(mother.vitalSignsHistory).toEqual(vitals('doc-mother'));
    expect(mother.clinicalSyncCheckpoint).toEqual(checkpoint('embedded-ep_mother'));
    expect(newborn.vitalSignsHistory).toEqual(vitals('doc-newborn'));
    expect('clinicalSyncCheckpoint' in newborn).toBe(false);
  });

  it('does not overlay an id active twice and reports it, while other episodes still overlay', () => {
    const record = day({
      R1: patient('ep_dup'),
      R2: patient('ep_dup'),
      R3: patient('ep_ok'),
    });
    const result = overlayBoth(record, [
      episodeDoc('ep_dup', { vitalSignsHistory: null }),
      episodeDoc('ep_ok', { vitalSignsHistory: null }, { bedId: 'R3' }),
    ]);
    expect(result.skippedDuplicateEpisodeIds).toEqual(['ep_dup']);
    expect(result.matchedEpisodeIds).toEqual(['ep_ok']);
    expect(holderOf(result.record, 'R1').vitalSignsHistory).toEqual(vitals('embedded-ep_dup'));
    expect(holderOf(result.record, 'R2').vitalSignsHistory).toEqual(vitals('embedded-ep_dup'));
    expect('vitalSignsHistory' in holderOf(result.record, 'R3')).toBe(false);
    // A duplicate without a document has nothing to skip.
    expect(overlayBoth(record, []).skippedDuplicateEpisodeIds).toEqual([]);
  });

  it('touches only the moved fields: a passport stays a passport and meta is untouched', () => {
    const mother = patient('ep_passport', {
      rut: 'AB1234567',
      documentType: 'Pasaporte',
      vitalSigns: { heartRate: 88 },
      evaluationScores: { braden: 18 },
    });
    const record = day({ R1: mother });
    const result = overlayBoth(record, [
      episodeDoc('ep_passport', { clinicalSyncCheckpoint: null, vitalSignsHistory: null }),
    ]);
    const { clinicalSyncCheckpoint, vitalSignsHistory, ...untouched } = mother;
    expect(clinicalSyncCheckpoint && vitalSignsHistory).toBeTruthy();
    expect(holderOf(result.record, 'R1')).toEqual(untouched);
    expect(holderOf(result.record, 'R1').documentType).toBe('Pasaporte');
    expect(holderOf(result.record, 'R1').rut).toBe('AB1234567');
    const { beds: _beds, ...dayRest } = record as unknown as Holder;
    const { beds: _overlaidBeds, ...overlaidRest } = result.record as unknown as Holder;
    expect(overlaidRest).toEqual(dayRest);
  });

  it('leaves blocked holders and ids that cannot be document ids embedded', () => {
    const record = day({
      R1: patient('ep.dotted'),
      R2: patient('__x__'),
      R3: patient('ep_blocked', { isBlocked: true }),
    });
    const result = overlayBoth(record, [
      episodeDoc('ep_blocked', { vitalSignsHistory: null }, { bedId: 'R3' }),
    ]);
    expect(result.matchedEpisodeIds).toEqual([]);
    expect(result.record).toBe(record);
  });

  it('agree on a stale day: a current document written by a later day revision', () => {
    const record = day({ R1: patient('ep_a'), R2: patient('ep_b') });
    const cases: Array<[ClinicalDerivedEpisodeDoc[], string[]]> = [
      [[episodeDoc('ep_a', {}, { dayRevision: 5 })], []],
      [[episodeDoc('ep_a', {}, { dayRevision: 4 })], []],
      [[episodeDoc('ep_a', {}, { dayRevision: 6 }), episodeDoc('ep_b', {})], ['ep_a']],
      // Leftovers of another generation never make the day stale.
      [[episodeDoc('ep_a', {}, { dayRevision: 9, layoutGeneration: 'gen_old' })], []],
      // A document of an episode no longer in the day still proves the day read lags.
      [[episodeDoc('ep_gone', {}, { dayRevision: 6 })], ['ep_gone']],
    ];
    for (const [docs, stale] of cases) {
      expect(client.findStaleClinicalDerivedEpisodeIds(record, docs)).toEqual(stale);
      expect(server.findStaleClinicalDerivedEpisodeIds(record, docs)).toEqual(stale);
    }
    const withoutMeta = day({ R1: patient('ep_a') }, { meta: undefined });
    const ahead = [episodeDoc('ep_a', {}, { dayRevision: 1 })];
    expect(client.findStaleClinicalDerivedEpisodeIds(withoutMeta, ahead)).toEqual(['ep_a']);
    expect(server.findStaleClinicalDerivedEpisodeIds(withoutMeta, ahead)).toEqual(['ep_a']);
  });

  it('agree on the active episodes a day exposes to the writer', () => {
    const record = day({
      R1: patient('ep_mother', { clinicalCrib: patient('ep_newborn') }),
      R2: patient('ep_dup'),
      R3: patient('ep_dup'),
      R4: { patientName: '', clinicalEpisodeId: '' },
    });
    const expected = {
      episodes: [
        { bedId: 'R1', target: 'bed', clinicalEpisodeId: 'ep_mother' },
        { bedId: 'R1', target: 'clinicalCrib', clinicalEpisodeId: 'ep_newborn' },
      ],
      duplicateEpisodeIds: ['ep_dup'],
    };
    expect(client.collectClinicalDerivedEpisodes(record)).toEqual(expected);
    expect(server.collectClinicalDerivedEpisodes(record)).toEqual(expected);
  });
});
