// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  createApplicationDegraded,
  createApplicationFailed,
  createApplicationPartial,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import { presentDailyRecordRefreshOutcome } from '@/hooks/controllers/dailyRecordRefreshOutcomeController';
import type { SyncOutcome } from '@/application/daily-record/syncDailyRecordUseCase';

const emptySyncOutcome: SyncOutcome = {
  record: null,
  sync: null,
};

describe('dailyRecordRefreshOutcomeController', () => {
  it('returns null channel for success', () => {
    expect(presentDailyRecordRefreshOutcome(createApplicationSuccess(emptySyncOutcome))).toEqual({
      channel: null,
    });
  });

  it('maps partial to warning', () => {
    const notice = presentDailyRecordRefreshOutcome(
      createApplicationPartial(
        {
          ...emptySyncOutcome,
          conflict: {
            kind: 'missing_remote_record',
            severity: 'warning',
            retryStrategy: 'manual_retry',
            recommendedAction: 'review_remote_record',
            runbook: 'docs/RUNBOOK_SYNC_RESILIENCE.md',
          },
        },
        [{ kind: 'unknown', message: 'partial warning', userSafeMessage: 'partial warning' }],
        { userSafeMessage: 'partial warning' }
      )
    );
    expect(notice.channel).toBe('warning');
    expect(notice.state).toBe('degraded');
    expect(notice.actionRequired).toBe(false);
    expect(notice.title).toBe('Registro remoto no disponible');
    expect(notice.message).toContain('Revisa el registro remoto');
  });

  it('maps degraded to warning', () => {
    const notice = presentDailyRecordRefreshOutcome(
      createApplicationDegraded(
        {
          ...emptySyncOutcome,
          conflict: {
            kind: 'remote_blocked',
            severity: 'warning',
            retryStrategy: 'manual_review',
            recommendedAction: 'continue_with_local_copy',
            runbook: 'docs/RUNBOOK_SYNC_RESILIENCE.md',
          },
        },
        [{ kind: 'unknown', message: 'degraded warning', userSafeMessage: 'degraded warning' }],
        { userSafeMessage: 'degraded warning' }
      )
    );
    expect(notice.channel).toBe('warning');
    expect(notice.state).toBe('degraded');
    expect(notice.actionRequired).toBe(false);
    expect(notice.title).toBe('Sincronización remota bloqueada');
    expect(notice.message).toContain('copia local');
  });

  it('maps retryable failure to a non-blocking retry warning', () => {
    const notice = presentDailyRecordRefreshOutcome(
      createApplicationFailed(
        {
          ...emptySyncOutcome,
          conflict: {
            kind: 'sync_failed',
            severity: 'error',
            retryStrategy: 'automatic_retry',
            recommendedAction: 'retry_sync',
            runbook: 'docs/RUNBOOK_SYNC_RESILIENCE.md',
          },
        },
        [{ kind: 'unknown', message: 'failed', userSafeMessage: 'failed' }],
        { userSafeMessage: 'failed' }
      )
    );
    expect(notice.channel).toBe('warning');
    expect(notice.state).toBe('retrying');
    expect(notice.actionRequired).toBe(false);
    expect(notice.title).toBe('Sincronización fallida');
    expect(notice.message).toContain('Intenta sincronizar nuevamente');
  });
});
