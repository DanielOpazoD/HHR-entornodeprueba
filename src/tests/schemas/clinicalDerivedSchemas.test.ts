// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { ClinicalDerivedEpisodeDocSchema } from '@/schemas/zod/clinicalDerived';
import { DailyRecordSchema, parseDailyRecordWithDefaultsReport } from '@/schemas/zodSchemas';

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
});
