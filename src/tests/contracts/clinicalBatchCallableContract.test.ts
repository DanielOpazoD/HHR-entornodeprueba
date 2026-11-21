/**
 * The clinical batch callable (`applyRayenClinicalEnrichmentBatch`) has its limits on both sides:
 * the app splits a synchronization into batches it sizes itself, and the server rejects a batch
 * over its limits without a retry. Each side pinned only its own numbers, so a batch could be
 * valid for the app and rejected by the server (the server measured its parsed targets, up to
 * 65 bytes more per patient than what it received). These cases run the app's real payload
 * builder against the server's real parser, so both sides must draw each line at the same place.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import';
import type { RayenClinicalEnrichmentBatchPayload } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';
import { prepareClinicalEnrichmentBatchPayload } from '@/features/rayen-import/hooks/clinicalEnrichmentBatchPayload';
import { CUDYR_DOCUMENTARY_SOURCE } from '@/domain/evaluationScales/documentaryCudyr';
import { asStoredDailyRecordShape } from '@/tests/factories/DataFactory';

const require = createRequire(import.meta.url);
const {
  parseClinicalEnrichmentPayload,
} = require('../../../functions/lib/rayenClinicalEnrichmentPolicy.js');

const record = asStoredDailyRecordShape({
  date: '2026-07-28',
  lastUpdated: '2026-07-28T10:00:00.000Z',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  meta: { revision: 7 },
});

/** One patient per bed, each with a clinical field and its checkpoint, as a real run sends. */
const operations = (
  targets: number,
  padding: number,
  { crib = false, evaluationScores }: { crib?: boolean; evaluationScores?: unknown } = {}
): ClinicalFillPatchOperation[] =>
  Array.from({ length: targets }, (_, index) => {
    const bedId = `B${index}`;
    const prefix = `beds.${bedId}${crib ? '.clinicalCrib' : ''}`;
    return {
      target: {
        censusDate: record.date,
        bedId,
        clinicalEpisodeId: `synthetic-episode-${index}`,
        ...(crib ? { clinicalCrib: true as const } : {}),
      },
      patch: {
        [`${prefix}.vitalSigns`]: { note: index === 0 ? 'x'.repeat(padding) : '' },
        [`${prefix}.clinicalSyncCheckpoint`]: { version: 1 },
        ...(evaluationScores ? { [`${prefix}.evaluationScores`]: evaluationScores } : {}),
      } as ClinicalFillPatchOperation['patch'],
      clinicalFieldCount: evaluationScores ? 2 : 1,
    };
  });

const prepare = (targets: number, padding: number, options?: Parameters<typeof operations>[2]) =>
  prepareClinicalEnrichmentBatchPayload({
    record,
    runId: 'synthetic-run',
    mutationId: 'synthetic-mutation',
    operations: operations(targets, padding, options),
  }).payload;

/** The largest padding the app still sends as one batch. */
const largestPadding = (targets: number, options?: Parameters<typeof operations>[2]) => {
  let low = 0;
  let high = 600_000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (prepare(targets, middle, options)) low = middle;
    else high = middle - 1;
  }
  return low;
};

const serverAccepts = (payload: RayenClinicalEnrichmentBatchPayload | null) => {
  if (!payload) throw new Error('The app did not build this batch.');
  try {
    parseClinicalEnrichmentPayload(payload);
    return true;
  } catch {
    return false;
  }
};

/** The same batch with one more byte of clinical data than the app allows. */
const oneByteOver = (payload: RayenClinicalEnrichmentBatchPayload) => {
  const copy = structuredClone(payload);
  const vitalSigns = copy.patches[0].fields.vitalSigns as { note: string };
  vitalSigns.note += 'x';
  return copy;
};

describe('clinical batch callable · app and server draw the same limits', () => {
  it.each([
    ['patients', 32, {}],
    ['patients', 1, {}],
    ['newborn cribs', 32, { crib: true }],
  ] as const)(
    'the largest batch of %s the app sends (%i) is accepted by the server',
    (_, targets, options) => {
      const padding = largestPadding(targets, options);
      const largest = prepare(targets, padding, options)!;
      expect(largest.patches).toHaveLength(targets);
      expect(largest.checkpoints).toHaveLength(targets);

      expect(serverAccepts(largest)).toBe(true);
      // One byte more: the app splits it and the server would refuse it, at the same byte.
      expect(prepare(targets, padding + 1, options)).toBeNull();
      expect(serverAccepts(oneByteOver(largest))).toBe(false);
    }
  );

  it('the server accepts as many patients per batch as the app sends, and no more', () => {
    expect(serverAccepts(prepare(32, 0))).toBe(true);
    expect(prepare(33, 0)).toBeNull();
    const overTargets = structuredClone(prepare(32, 0)!);
    overTargets.patches.push({ ...overTargets.patches[0], bedId: 'B32' });
    expect(serverAccepts(overTargets)).toBe(false);
  });

  it('the server accepts every field contract version the app sends', () => {
    const documentary = prepare(1, 0, {
      evaluationScores: { cudyr: { source: CUDYR_DOCUMENTARY_SOURCE } },
    })!;
    expect(prepare(1, 0)!.fieldContractVersion).toBe(2);
    expect(documentary.fieldContractVersion).toBe(3);
    expect(parseClinicalEnrichmentPayload(prepare(1, 0)).fieldContractVersion).toBe(2);
    expect(parseClinicalEnrichmentPayload(documentary).fieldContractVersion).toBe(3);
  });
});
