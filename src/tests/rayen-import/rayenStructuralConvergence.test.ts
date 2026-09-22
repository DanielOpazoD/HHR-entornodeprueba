import { describe, expect, it } from 'vitest';
import {
  collectSafeClinicalEpisodeIds,
  consumeRayenStructuralReviewTiming,
  startRayenStructuralReviewTiming,
  type RayenStructuralReplan,
} from '@/features/rayen-import/hooks/rayenStructuralConvergence';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';

const plan = {
  runId: 'run-1',
  requestId: 'request-1',
  selectedDate: '2026-08-25',
  clinicalDay: '2026-08-25',
  replan: async () => ({}) as never,
} satisfies RayenStructuralReplan;

describe('Rayen structural review timing', () => {
  it('consumes each human review interval once and can restart after replanning', () => {
    const first = startRayenStructuralReviewTiming(plan, () => 1_000);
    const consumedFirst = consumeRayenStructuralReviewTiming(first, () => 1_650);

    expect(consumedFirst.durationMs).toBe(650);
    expect(consumedFirst.plan).not.toHaveProperty('reviewStartedAtMs');
    expect(
      consumeRayenStructuralReviewTiming(consumedFirst.plan, () => 2_000).durationMs
    ).toBeNull();

    const replanned = startRayenStructuralReviewTiming(consumedFirst.plan, () => 2_100);
    expect(consumeRayenStructuralReviewTiming(replanned, () => 2_400).durationMs).toBe(300);
  });

  it('returns each safe episode once when duplicate local projections reference it', () => {
    const record = {
      beds: {
        H1C1: {
          clinicalEpisodeId: 'episode-safe',
          clinicalCrib: { clinicalEpisodeId: 'episode-safe' },
        },
        H2C1: { clinicalEpisodeId: 'episode-safe' },
      },
    } as unknown as DailyRecord;

    expect(collectSafeClinicalEpisodeIds(record, [])).toEqual(['episode-safe']);
  });

  it('isolates a numeric passport conflict without blocking a same-looking RUT', () => {
    const record = {
      beds: {
        H1C1: {
          rut: '123456785',
          documentType: 'RUT',
          clinicalEpisodeId: 'episode-rut-safe',
        },
        H2C1: {
          rut: '123456785',
          documentType: 'Pasaporte',
          clinicalEpisodeId: 'episode-passport-blocked',
          clinicalCrib: {
            rut: '123456785',
            documentType: 'Pasaporte',
            clinicalEpisodeId: 'episode-crib-blocked',
          },
        },
      },
    } as unknown as DailyRecord;

    expect(
      collectSafeClinicalEpisodeIds(record, [
        {
          bedId: null,
          rut: '123456785',
          documentType: 'Pasaporte',
          scope: 'report-row-subject',
          reason: 'Identidad de pasaporte pendiente.',
        },
      ])
    ).toEqual(['episode-rut-safe']);
  });

  it('keeps an untyped report identity conflict conservative', () => {
    const record = {
      beds: {
        H1C1: {
          rut: '123456785',
          documentType: 'RUT',
          clinicalEpisodeId: 'episode-rut',
        },
        H2C1: {
          rut: '123456785',
          documentType: 'Pasaporte',
          clinicalEpisodeId: 'episode-passport',
        },
      },
    } as unknown as DailyRecord;

    expect(
      collectSafeClinicalEpisodeIds(record, [
        {
          bedId: null,
          rut: '123456785',
          scope: 'report-row-subject',
          reason: 'Tipo documental desconocido.',
        },
      ])
    ).toEqual([]);
  });
});
