import { describe, expect, it } from 'vitest';
import {
  buildDailyRecordAuthorityRolloutSummary,
  buildRayenClinicalEnrichmentRolloutSummary,
} from '@/services/admin/functionsTelemetryService';
import type { FunctionsTelemetryEntry } from '@/types/functionsTelemetry';

const makeEntry = (
  id: string,
  context: NonNullable<FunctionsTelemetryEntry['context']>,
  overrides: Partial<FunctionsTelemetryEntry> = {}
): FunctionsTelemetryEntry => ({
  id,
  service: 'dailyRecordWriteAuthority',
  operation: 'saveDailyRecordWithClinicalAuthority',
  durationMs: 20,
  attempt: 1,
  totalAttempts: 1,
  status: 'success',
  timestamp: `2026-05-14T10:0${id}.000Z`,
  context,
  ...overrides,
});

describe('functionsTelemetryService authority rollout summary', () => {
  it('summarizes shadow and enforced authority telemetry without clinical identifiers', () => {
    const entries: FunctionsTelemetryEntry[] = [
      makeEntry('1', {
        mode: 'shadow',
        authorityStatus: 'ok',
        fallbackEpisodeKeys: 0,
        degenerateFallbackEpisodeKeys: 0,
      }),
      makeEntry('2', {
        mode: 'enforced',
        authorityStatus: 'ok',
        fallbackEpisodeKeys: 1,
        degenerateFallbackEpisodeKeys: 0,
      }),
      makeEntry(
        '3',
        {
          mode: 'shadow',
          authorityStatus: 'blocked',
          fallbackEpisodeKeys: 0,
          degenerateFallbackEpisodeKeys: 1,
          violationTypes: 'closed_episode_active_in_bed',
        },
        {
          status: 'failure',
          errorCode: 'failed-precondition',
        }
      ),
      makeEntry(
        '4',
        {
          mode: 'enforced',
          authorityStatus: 'ok',
          fallbackEpisodeKeys: 0,
          degenerateFallbackEpisodeKeys: 0,
        },
        {
          status: 'failure',
          errorCode: 'permission-denied',
        }
      ),
      {
        ...makeEntry('5', { mode: 'shadow' }),
        service: 'otherService',
      },
    ];

    expect(buildDailyRecordAuthorityRolloutSummary(entries)).toEqual({
      total: 4,
      shadowRuns: 2,
      enforcedWrites: 2,
      successCount: 2,
      failureCount: 2,
      blockedCount: 1,
      permissionDeniedCount: 1,
      fallbackEpisodeKeys: 1,
      degenerateFallbackEpisodeKeys: 1,
      lastEntryAt: '2026-05-14T10:04.000Z',
      recommendation: 'investigate',
    });
  });

  it('marks shadow mode as ready for enforced when no failures or degenerate fallbacks appear', () => {
    const entries: FunctionsTelemetryEntry[] = [
      makeEntry('1', {
        mode: 'shadow',
        authorityStatus: 'ok',
        fallbackEpisodeKeys: 1,
        degenerateFallbackEpisodeKeys: 0,
      }),
    ];

    expect(buildDailyRecordAuthorityRolloutSummary(entries).recommendation).toBe(
      'ready_for_enforced'
    );
  });

  it('includes partial patch authority telemetry in the rollout summary', () => {
    const entries: FunctionsTelemetryEntry[] = [
      makeEntry(
        '1',
        {
          mode: 'enforced',
          authorityStatus: 'ok',
          fallbackEpisodeKeys: 0,
          degenerateFallbackEpisodeKeys: 0,
        },
        {
          operation: 'patchDailyRecordWithClinicalAuthority',
        }
      ),
    ];

    expect(buildDailyRecordAuthorityRolloutSummary(entries)).toEqual({
      total: 1,
      shadowRuns: 0,
      enforcedWrites: 1,
      successCount: 1,
      failureCount: 0,
      blockedCount: 0,
      permissionDeniedCount: 0,
      fallbackEpisodeKeys: 0,
      degenerateFallbackEpisodeKeys: 0,
      lastEntryAt: '2026-05-14T10:01.000Z',
      recommendation: 'monitor_enforced',
    });
  });

  it('marks rollout evidence as insufficient when no authority telemetry exists', () => {
    expect(buildDailyRecordAuthorityRolloutSummary([])).toEqual({
      total: 0,
      shadowRuns: 0,
      enforcedWrites: 0,
      successCount: 0,
      failureCount: 0,
      blockedCount: 0,
      permissionDeniedCount: 0,
      fallbackEpisodeKeys: 0,
      degenerateFallbackEpisodeKeys: 0,
      lastEntryAt: undefined,
      recommendation: 'insufficient_data',
    });
  });
});

const makeClinicalBatchEntry = (
  id: string,
  timestamp: string,
  context: NonNullable<FunctionsTelemetryEntry['context']>,
  overrides: Partial<FunctionsTelemetryEntry> = {}
): FunctionsTelemetryEntry => ({
  id,
  service: 'rayenClinicalEnrichment',
  operation: 'applyRayenClinicalEnrichmentBatch',
  durationMs: 40,
  attempt: 1,
  totalAttempts: 1,
  status: 'success',
  timestamp,
  context,
  ...overrides,
});

describe('functionsTelemetryService clinical enrichment rollout summary', () => {
  it('requires matched shadow evidence across an operational time span', () => {
    const entries = [0, 3, 6, 9].map(hours =>
      makeClinicalBatchEntry(
        String(hours),
        `2026-07-29T${String(8 + hours).padStart(2, '0')}:00:00.000Z`,
        { mode: 'shadow', resultParity: 'matched', authorityStatus: 'ok' }
      )
    );

    expect(buildRayenClinicalEnrichmentRolloutSummary(entries)).toEqual({
      parityContractVersion: 1,
      total: 4,
      shadowRuns: 4,
      enforcedWrites: 0,
      matchedShadowRuns: 4,
      mismatchedShadowRuns: 0,
      unavailableShadowRuns: 0,
      failureCount: 0,
      blockedCount: 0,
      permissionDeniedCount: 0,
      evidenceHours: 9,
      firstEntryAt: '2026-07-29T08:00:00.000Z',
      lastEntryAt: '2026-07-29T17:00:00.000Z',
      cleanWindowRuns: 4,
      cleanMatchedShadowRuns: 4,
      cleanEnforcedWrites: 0,
      cleanEvidenceHours: 9,
      lastBlockingSignalAt: undefined,
      recommendation: 'ready_for_enforced',
    });
  });

  it('restarts rollout evidence when a newer parity contract appears', () => {
    const entries = [
      makeClinicalBatchEntry('legacy', '2026-07-29T07:00:00.000Z', {
        mode: 'shadow',
        resultParity: 'mismatch',
        authorityStatus: 'ok',
      }),
      ...[0, 3, 6, 9].map(hours =>
        makeClinicalBatchEntry(
          `v2-${hours}`,
          `2026-07-29T${String(8 + hours).padStart(2, '0')}:00:00.000Z`,
          {
            mode: 'shadow',
            resultParity: 'matched',
            authorityStatus: 'ok',
            parityContractVersion: 2,
          }
        )
      ),
    ];

    expect(buildRayenClinicalEnrichmentRolloutSummary(entries)).toMatchObject({
      parityContractVersion: 2,
      total: 4,
      matchedShadowRuns: 4,
      mismatchedShadowRuns: 0,
      evidenceHours: 9,
      recommendation: 'ready_for_enforced',
    });
  });

  it('blocks promotion on mismatch, failure or missing parity evidence', () => {
    const entries = [
      makeClinicalBatchEntry('1', '2026-07-29T08:00:00.000Z', {
        mode: 'shadow',
        resultParity: 'matched',
        authorityStatus: 'ok',
      }),
      makeClinicalBatchEntry('2', '2026-07-29T17:00:00.000Z', {
        mode: 'shadow',
        resultParity: 'mismatch',
        authorityStatus: 'ok',
      }),
      makeClinicalBatchEntry(
        '3',
        '2026-07-29T18:00:00.000Z',
        { mode: 'shadow', authorityStatus: 'blocked' },
        { status: 'failure', errorCode: 'failed-precondition' }
      ),
    ];

    expect(buildRayenClinicalEnrichmentRolloutSummary(entries)).toMatchObject({
      matchedShadowRuns: 1,
      mismatchedShadowRuns: 1,
      unavailableShadowRuns: 1,
      failureCount: 1,
      blockedCount: 1,
      cleanWindowRuns: 0,
      recommendation: 'investigate',
    });
  });

  it('uses a consecutive clean window without erasing earlier mismatches', () => {
    const entries = [
      makeClinicalBatchEntry('mismatch', '2026-07-29T07:00:00.000Z', {
        mode: 'shadow',
        resultParity: 'mismatch',
        authorityStatus: 'ok',
      }),
      ...[0, 3, 6, 9].map(hours =>
        makeClinicalBatchEntry(
          `clean-${hours}`,
          `2026-07-29T${String(8 + hours).padStart(2, '0')}:00:00.000Z`,
          { mode: 'shadow', resultParity: 'matched', authorityStatus: 'idempotent' }
        )
      ),
    ];

    expect(buildRayenClinicalEnrichmentRolloutSummary(entries)).toMatchObject({
      total: 5,
      matchedShadowRuns: 4,
      mismatchedShadowRuns: 1,
      cleanWindowRuns: 4,
      cleanMatchedShadowRuns: 4,
      cleanEvidenceHours: 9,
      lastBlockingSignalAt: '2026-07-29T07:00:00.000Z',
      recommendation: 'ready_for_enforced',
    });
  });

  it.each([
    ['mismatch', 'success', undefined, { resultParity: 'mismatch', authorityStatus: 'ok' }],
    ['failure', 'failure', undefined, { resultParity: 'matched', authorityStatus: 'ok' }],
    ['timeout', 'timeout', undefined, { resultParity: 'matched', authorityStatus: 'ok' }],
    [
      'blocked',
      'failure',
      'failed-precondition',
      { resultParity: 'matched', authorityStatus: 'blocked' },
    ],
    [
      'permission denied',
      'failure',
      'permission-denied',
      { resultParity: 'matched', authorityStatus: 'ok' },
    ],
  ] as const)(
    'restarts the clean window after a latest %s signal',
    (_label, status, errorCode, context) => {
      const entries = [0, 3, 6, 9].map(hours =>
        makeClinicalBatchEntry(
          `clean-${hours}`,
          `2026-07-29T${String(8 + hours).padStart(2, '0')}:00:00.000Z`,
          { mode: 'shadow', resultParity: 'matched', authorityStatus: 'ok' }
        )
      );
      entries.push(
        makeClinicalBatchEntry(
          'blocker',
          '2026-07-29T18:00:00.000Z',
          { mode: 'shadow', ...context },
          { status, ...(errorCode ? { errorCode } : {}) }
        )
      );

      expect(buildRayenClinicalEnrichmentRolloutSummary(entries)).toMatchObject({
        cleanWindowRuns: 0,
        cleanMatchedShadowRuns: 0,
        cleanEvidenceHours: 0,
        lastBlockingSignalAt: '2026-07-29T18:00:00.000Z',
        recommendation: 'investigate',
      });
    }
  );

  it('requires the full clean count after a blocking signal', () => {
    const entries = [
      makeClinicalBatchEntry('mismatch', '2026-07-29T07:00:00.000Z', {
        mode: 'shadow',
        resultParity: 'mismatch',
        authorityStatus: 'ok',
      }),
      ...[0, 4, 9].map(hours =>
        makeClinicalBatchEntry(
          `clean-${hours}`,
          `2026-07-29T${String(8 + hours).padStart(2, '0')}:00:00.000Z`,
          { mode: 'shadow', resultParity: 'matched', authorityStatus: 'ok' }
        )
      ),
    ];

    expect(buildRayenClinicalEnrichmentRolloutSummary(entries)).toMatchObject({
      cleanWindowRuns: 3,
      cleanMatchedShadowRuns: 3,
      cleanEvidenceHours: 9,
      recommendation: 'insufficient_data',
    });
  });

  it('keeps enforced mode in monitoring when no blocking evidence exists', () => {
    const entry = makeClinicalBatchEntry('1', '2026-07-29T08:00:00.000Z', {
      mode: 'enforced',
      resultParity: 'matched',
      authorityStatus: 'ok',
    });

    expect(buildRayenClinicalEnrichmentRolloutSummary([entry]).recommendation).toBe(
      'monitor_enforced'
    );
  });
});
