import { describe, expect, it } from 'vitest';
import { buildDailyRecordAuthorityRolloutSummary } from '@/services/admin/functionsTelemetryService';
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
