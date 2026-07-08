import { describe, expect, it } from 'vitest';
import {
  describeDailyRecordBootstrapPhase,
  isDailyRecordBootstrapPending,
  resolveCensusEmptyStateDiagnostic,
  resolveCensusEmptyStatePolicy,
  resolveDailyRecordBootstrapPhase,
  shouldRecordCensusEmptyStateDiagnostic,
  shouldAttemptTodayEmptyRecovery,
} from '@/hooks/controllers/dailyRecordBootstrapController';

describe('dailyRecordBootstrapController', () => {
  it('classifies bootstrap phases with a single policy', () => {
    expect(
      resolveDailyRecordBootstrapPhase({
        remoteSyncStatus: 'bootstrapping',
        record: null,
        runtime: null,
        gracePeriodExpired: false,
      })
    ).toBe('remote_runtime_bootstrapping');

    expect(
      resolveDailyRecordBootstrapPhase({
        remoteSyncStatus: 'ready',
        record: null,
        runtime: null,
        gracePeriodExpired: false,
      })
    ).toBe('remote_record_bootstrapping');

    expect(
      resolveDailyRecordBootstrapPhase({
        remoteSyncStatus: 'ready',
        record: null,
        runtime: null,
        gracePeriodExpired: true,
      })
    ).toBe('remote_record_timeout');

    expect(
      resolveDailyRecordBootstrapPhase({
        remoteSyncStatus: 'ready',
        record: null,
        runtime: {
          date: '2025-01-08',
          availabilityState: 'confirmed_missing',
          consistencyState: 'missing',
          sourceOfTruth: 'none',
          retryability: 'not_applicable',
          recoveryAction: 'none',
          conflictSummary: null,
          observabilityTags: ['daily_record'],
          repairApplied: false,
        },
        gracePeriodExpired: false,
      })
    ).toBe('confirmed_empty');
  });

  it('does not confirm an empty day before the remote runtime can verify it', () => {
    expect(
      resolveDailyRecordBootstrapPhase({
        remoteSyncStatus: 'local_only',
        record: null,
        runtime: {
          date: '2025-01-08',
          availabilityState: 'confirmed_missing',
          consistencyState: 'missing',
          sourceOfTruth: 'none',
          retryability: 'not_applicable',
          recoveryAction: 'none',
          conflictSummary: null,
          observabilityTags: ['daily_record'],
          repairApplied: false,
        },
        gracePeriodExpired: false,
      })
    ).toBe('local_only');
  });

  it('deferes the empty state only while bootstrap remains pending', () => {
    expect(
      resolveCensusEmptyStatePolicy({
        branch: 'empty',
        currentDateString: '2025-01-02',
        todayDateString: '2025-01-01',
        isAuthenticated: true,
        bootstrapPhase: 'remote_record_bootstrapping',
      })
    ).toEqual({
      shouldDeferEmptyState: true,
      deferMs: 15_000,
    });

    expect(
      resolveCensusEmptyStatePolicy({
        branch: 'empty',
        currentDateString: '2025-01-02',
        todayDateString: '2025-01-01',
        isAuthenticated: true,
        bootstrapPhase: 'remote_record_timeout',
      })
    ).toEqual({
      shouldDeferEmptyState: true,
      deferMs: 800,
    });

    expect(
      resolveCensusEmptyStatePolicy({
        branch: 'empty',
        currentDateString: '2025-01-01',
        todayDateString: '2025-01-01',
        isAuthenticated: true,
        bootstrapPhase: 'remote_record_timeout',
      })
    ).toEqual({
      shouldDeferEmptyState: true,
      deferMs: 15_000,
    });
  });

  it('marks only pending phases as recoverable bootstrap states', () => {
    expect(isDailyRecordBootstrapPending('remote_runtime_bootstrapping')).toBe(true);
    expect(isDailyRecordBootstrapPending('remote_record_bootstrapping')).toBe(true);
    expect(isDailyRecordBootstrapPending('remote_record_timeout')).toBe(false);
    expect(
      shouldAttemptTodayEmptyRecovery({
        currentDateString: '2025-01-01',
        todayDateString: '2025-01-01',
        bootstrapPhase: 'remote_record_timeout',
      })
    ).toBe(true);
    expect(describeDailyRecordBootstrapPhase('remote_record_timeout')).toContain(
      'ventana de gracia'
    );
  });

  it('describes confirmed empty census days as a remote/local miss instead of a generic blank day', () => {
    expect(
      resolveCensusEmptyStateDiagnostic({
        branch: 'empty',
        currentDateString: '2026-05-10',
        todayDateString: '2026-05-10',
        isAuthenticated: true,
        bootstrapPhase: 'confirmed_empty',
      })
    ).toEqual({
      source: 'remote_missing',
      message:
        'Firebase y la copia local no tienen registro para esta fecha. Crea el dia solo si corresponde iniciar un censo nuevo.',
    });
  });

  it('keeps pending and local-only empty states distinguishable for diagnostics', () => {
    expect(
      resolveCensusEmptyStateDiagnostic({
        branch: 'empty',
        currentDateString: '2026-05-10',
        todayDateString: '2026-05-10',
        isAuthenticated: true,
        bootstrapPhase: 'remote_record_timeout',
      })
    ).toMatchObject({
      source: 'sync_pending',
      message: expect.stringContaining('Todavia se esta verificando'),
    });

    expect(
      resolveCensusEmptyStateDiagnostic({
        branch: 'empty',
        currentDateString: '2026-05-10',
        todayDateString: '2026-05-10',
        isAuthenticated: false,
        bootstrapPhase: 'local_only',
      })
    ).toMatchObject({
      source: 'local_cache_empty',
      message: expect.stringContaining('copia local'),
    });
  });

  it('prioritizes post-deploy and date diagnostics when those signals are explicit', () => {
    expect(
      resolveCensusEmptyStateDiagnostic({
        branch: 'empty',
        currentDateString: '2026-05-10',
        todayDateString: '2026-05-10',
        isAuthenticated: true,
        bootstrapPhase: 'remote_record_bootstrapping',
        hasPostDeployRefreshMarker: true,
      }).source
    ).toBe('post_deploy_refresh');

    expect(
      resolveCensusEmptyStateDiagnostic({
        branch: 'empty',
        currentDateString: '2026-05-09',
        todayDateString: '2026-05-10',
        isAuthenticated: true,
        bootstrapPhase: 'confirmed_empty',
      }).source
    ).toBe('date_mismatch');
  });

  it('records diagnostics only when the empty branch is visible', () => {
    expect(
      shouldRecordCensusEmptyStateDiagnostic({
        branch: 'register',
        source: 'remote_missing',
        isVisible: true,
      })
    ).toBe(false);

    expect(
      shouldRecordCensusEmptyStateDiagnostic({
        branch: 'empty',
        source: 'sync_pending',
        isVisible: false,
      })
    ).toBe(false);

    expect(
      shouldRecordCensusEmptyStateDiagnostic({
        branch: 'empty',
        source: 'remote_missing',
        isVisible: true,
      })
    ).toBe(true);
  });
});
