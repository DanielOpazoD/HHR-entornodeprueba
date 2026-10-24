// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { ClinicalDerivedEpisodeDocSchema } from '@/schemas/zod/clinicalDerived';
import { DailyRecordSchema, parseDailyRecordWithDefaultsReport } from '@/schemas/zodSchemas';
import {
  findStaleClinicalDerivedEpisodeIds,
  overlayClinicalDerived,
  readClinicalDerivedLayout,
} from '@/services/storage/clinicalDerivedContract';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';

const DATE = '2026-11-02';
const marker = { version: 1, generation: 'gen_synthetic_a' };
const reading = { recordedDate: DATE, recordedAt: `${DATE}T08:00:00`, heartRate: 80 };
const doc = (fields: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  date: DATE,
  clinicalEpisodeId: 'ep_a',
  layoutGeneration: 'gen_synthetic_a',
  target: 'clinicalCrib',
  bedId: 'R1',
  dayRevision: 4,
  updatedAt: { seconds: 1, nanoseconds: 0 },
  lastMutationId: 'mutation-1',
  ...fields,
});

describe('clinicalDerived episode document schema', () => {
  it('keeps a null moved field as null, so it still wins over the embedded copy', () => {
    const parsed = ClinicalDerivedEpisodeDocSchema.parse(
      doc({ clinicalSyncCheckpoint: null, vitalSignsHistory: null })
    );
    expect(parsed.clinicalSyncCheckpoint).toBeNull();
    expect(parsed.vitalSignsHistory).toBeNull();
    expect('clinicalSyncCheckpoint' in parsed && 'vitalSignsHistory' in parsed).toBe(true);
  });

  it('leaves an absent moved field absent and keeps every reading as written', () => {
    const parsed = ClinicalDerivedEpisodeDocSchema.parse(doc({ vitalSignsHistory: [reading] }));
    expect('clinicalSyncCheckpoint' in parsed).toBe(false);
    expect(parsed.vitalSignsHistory).toEqual([reading]);
  });

  it('reuses the day’s checkpoint schema', () => {
    const parsed = ClinicalDerivedEpisodeDocSchema.parse(
      doc({
        clinicalSyncCheckpoint: {
          version: 3,
          fingerprintVersion: 1,
          sources: { vitals: { watermark: null, packedFacts: ['a|b|c'] } },
        },
      })
    );
    expect(parsed.clinicalSyncCheckpoint).toEqual({
      version: 3,
      fingerprintVersion: 1,
      sources: { vitals: { packedFacts: ['a|b|c'] } },
    });
  });

  it.each([
    ['another schema version', { schemaVersion: 2 }],
    ['no day revision', { dayRevision: undefined }],
    ['a negative day revision', { dayRevision: -1 }],
    ['no generation', { layoutGeneration: '' }],
    ['a malformed date', { date: '02-11-2026' }],
    ['an unknown target', { target: 'cradle' }],
    ['a reading without its day', { vitalSignsHistory: [{ recordedAt: 'x' }] }],
    ['a malformed checkpoint', { clinicalSyncCheckpoint: { version: 'three' } }],
  ])('rejects a document with %s', (_label, fields) => {
    expect(ClinicalDerivedEpisodeDocSchema.safeParse(doc(fields)).success).toBe(false);
  });
});

describe('daily record marker', () => {
  const day = (clinicalDerivedLayout: unknown) => ({
    date: DATE,
    beds: {},
    clinicalDerivedLayout,
  });

  it('keeps the marker as stored, including a version or keys this client does not know', () => {
    expect(DailyRecordSchema.parse(day(marker)).clinicalDerivedLayout).toEqual(marker);
    const future = { version: 2, generation: 'gen_b', shards: 2 };
    expect(DailyRecordSchema.parse(day(future)).clinicalDerivedLayout).toEqual(future);
    expect(DailyRecordSchema.parse(day(null)).clinicalDerivedLayout).toBeUndefined();
  });

  it('keeps the marker when a broken bed forces the salvage path', () => {
    const { record, report } = parseDailyRecordWithDefaultsReport(
      {
        ...day(marker),
        beds: { R1: { patientName: 'Paciente Sintético', status: 'ESTADO_INVALIDO' } },
      },
      DATE
    );
    expect(report.salvagedBeds).toEqual(['R1']);
    expect(record.clinicalDerivedLayout).toEqual(marker);
  });

  // Every Firestore read goes through docToRecord: the contract, not the parse, classifies markers.
  it.each([
    ['a future version', { version: 2 }],
    ['a string version', { version: '1', generation: 'gen_synthetic_a' }],
    ['an empty generation', { version: 1, generation: '' }],
    ['a generation that is not a document id', { version: 1, generation: 'a/b' }],
    ['a bare string', 'gen_synthetic_a'],
  ])('keeps %s as stored, so it reads as unsupported, never as unmarked', (_label, layout) => {
    const record = docToRecord({ ...day(layout), meta: { revision: 5 } }, DATE);
    expect(record.clinicalDerivedLayout).toEqual(layout);
    expect((record as unknown as { meta?: unknown }).meta).toEqual({ revision: 5 });
    expect(readClinicalDerivedLayout(record).status).toBe('unsupported');
  });

  it('a salvaged marked day keeps its marker and revision, so its documents are not stale', () => {
    const record = docToRecord(
      {
        ...day(marker),
        meta: { revision: 5 },
        beds: { R1: { patientName: 'Paciente Sintético', status: 'ESTADO_INVALIDO' } },
      },
      DATE
    );
    const current = doc({ clinicalEpisodeId: 'ep_a', dayRevision: 5 });
    expect(record.clinicalDerivedLayout).toEqual(marker);
    expect((record as unknown as { meta?: unknown }).meta).toEqual({ revision: 5 });
    expect(
      findStaleClinicalDerivedEpisodeIds(record, [current as unknown as ClinicalDerivedEpisodeDoc])
    ).toEqual([]);
  });

  // A broken bed goes through buildFallbackPatientData. On a split day its moved fields are found
  // by episode id (overlay and direct writes), so the salvaged bed and crib keep that id.
  const brokenBeds = {
    R1: {
      patientName: 'Paciente Sintético',
      status: 'ESTADO_INVALIDO',
      clinicalEpisodeId: 'ep_a',
      clinicalCrib: { patientName: 'RN Sintético', clinicalEpisodeId: 'ep_rn' },
    },
  };

  it('a salvaged bed and crib keep their episode ids on a split day, so the overlay finds them', () => {
    const { record, report } = parseDailyRecordWithDefaultsReport(
      { ...day(marker), meta: { revision: 5 }, beds: brokenBeds },
      DATE
    );
    expect(report.salvagedBeds).toEqual(['R1']);
    expect(record.beds.R1.clinicalEpisodeId).toBe('ep_a');
    expect(record.beds.R1.clinicalCrib?.clinicalEpisodeId).toBe('ep_rn');

    const current = doc({ vitalSignsHistory: [reading] }) as unknown as ClinicalDerivedEpisodeDoc;
    const overlaid = overlayClinicalDerived(record, [current]);
    expect(overlaid.matchedEpisodeIds).toEqual(['ep_a']);
    expect(overlaid.record.beds.R1.vitalSignsHistory).toEqual([reading]);
  });

  it('keeps patient and crib episode ids when salvaging an unmarked day', () => {
    const { record, report } = parseDailyRecordWithDefaultsReport(
      { date: DATE, beds: brokenBeds },
      DATE
    );
    expect(report.salvagedBeds).toEqual(['R1']);
    expect(record.beds.R1.clinicalEpisodeId).toBe('ep_a');
    expect(record.beds.R1.clinicalCrib?.clinicalEpisodeId).toBe('ep_rn');
  });
});
