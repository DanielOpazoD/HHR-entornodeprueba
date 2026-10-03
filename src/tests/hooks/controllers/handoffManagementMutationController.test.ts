// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import {
  runHandoffMutation,
  shouldNotifyHandoffMutationFailure,
} from '@/hooks/controllers/handoffManagementMutationController';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const createRecord = (): DailyRecord =>
  ({
    date: '2026-04-05',
    beds: {},
  }) as DailyRecord;

describe('handoffManagementMutationController', () => {
  it('runs success callbacks with the current record snapshot and payload', async () => {
    const currentRecord = createRecord();
    const onSuccess = vi.fn();
    const notifyError = vi.fn();

    const result = await runHandoffMutation({
      execute: async () =>
        createApplicationSuccess({
          updatedRecord: currentRecord,
          extra: 'ok',
        }),
      getCurrentRecord: () => currentRecord,
      notifyError,
      failureOptions: {
        fallbackMessage: 'fallback',
        fallbackTitle: 'title',
      },
      onSuccess,
    });

    expect(result.status).toBe('success');
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRecord,
        data: expect.objectContaining({
          updatedRecord: currentRecord,
          extra: 'ok',
        }),
      })
    );
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('suppresses notifications for missing-record races', async () => {
    const notifyError = vi.fn();
    const onSuccess = vi.fn();

    const result = await runHandoffMutation({
      execute: async () =>
        createApplicationFailed(null, [], {
          reason: 'missing_record',
        }),
      getCurrentRecord: () => null,
      notifyError,
      failureOptions: {
        fallbackMessage: 'fallback',
        fallbackTitle: 'title',
      },
      onSuccess,
    });

    expect(result.status).toBe('aborted');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('reports non-missing failures to the user', async () => {
    const notifyError = vi.fn();

    const result = await runHandoffMutation({
      execute: async () =>
        createApplicationFailed(null, [
          {
            kind: 'validation',
            message: 'Detalle técnico',
            userSafeMessage: 'Mensaje visible',
          },
        ]),
      getCurrentRecord: createRecord,
      notifyError,
      failureOptions: {
        fallbackMessage: 'fallback',
        fallbackTitle: 'Error al guardar',
      },
    });

    expect(result.status).toBe('aborted');
    expect(notifyError).toHaveBeenCalledWith('Error al guardar', 'Mensaje visible');
  });

  it('only ignores failures classified as missing_record', () => {
    expect(
      shouldNotifyHandoffMutationFailure(
        createApplicationFailed(null, [], {
          reason: 'missing_record',
        })
      )
    ).toBe(false);

    expect(
      shouldNotifyHandoffMutationFailure(
        createApplicationFailed(null, [], {
          reason: 'validation_error',
        })
      )
    ).toBe(true);
  });
});
