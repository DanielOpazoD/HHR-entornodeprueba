// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  createApplicationFailed,
  createApplicationPartial,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import {
  dispatchExportManagerNotice,
  presentBackupExportOutcome,
} from '@/hooks/controllers/backupExportOutcomeController';

describe('backupExportOutcomeController', () => {
  it('maps success to success notification', () => {
    const notice = presentBackupExportOutcome(createApplicationSuccess(null), {
      successTitle: 'ok',
      partialTitle: 'partial',
      failedTitle: 'failed',
      fallbackErrorMessage: 'fallback',
    });

    expect(notice).toEqual({
      channel: 'success',
      title: 'ok',
      message: undefined,
      state: 'ok',
      actionRequired: false,
    });
  });

  it('maps partial to warning notification', () => {
    const notice = presentBackupExportOutcome(
      createApplicationPartial(null, [
        { kind: 'unknown', message: 'backup warning', userSafeMessage: 'warning safe' },
      ]),
      {
        successTitle: 'ok',
        partialTitle: 'partial',
        failedTitle: 'failed',
        fallbackErrorMessage: 'fallback',
      }
    );

    expect(notice.channel).toBe('warning');
    expect(notice.message).toContain('warning safe');
    expect(notice.state).toBe('pending');
    expect(notice.actionRequired).toBe(false);
  });

  it('maps failed to error notification', () => {
    const notice = presentBackupExportOutcome(
      createApplicationFailed(null, [
        { kind: 'unknown', message: 'broken', userSafeMessage: 'broken safe' },
      ]),
      {
        successTitle: 'ok',
        partialTitle: 'partial',
        failedTitle: 'failed',
        fallbackErrorMessage: 'fallback',
      }
    );

    expect(notice).toEqual({
      channel: 'error',
      title: 'failed',
      message: 'broken safe',
      state: 'blocked',
      actionRequired: true,
    });
  });

  it('dispatches each notification channel to the matching port method', () => {
    const port = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    dispatchExportManagerNotice({ channel: 'success', title: 'Ok', message: 'Saved' }, port);
    dispatchExportManagerNotice({ channel: 'warning', title: 'Warn', message: 'Partial' }, port);
    dispatchExportManagerNotice({ channel: 'error', title: 'Err', message: 'Failed' }, port);

    expect(port.success).toHaveBeenCalledWith('Ok', 'Saved');
    expect(port.warning).toHaveBeenCalledWith('Warn', 'Partial');
    expect(port.error).toHaveBeenCalledWith('Err', 'Failed');
  });
});
