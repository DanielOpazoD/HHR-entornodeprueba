import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleDeferredRecipientSync } from '@/features/census/email/controllers/censusEmailRecipientDeferredSyncController';
import type { DeferredRecipientSyncInput } from '@/features/census/email/controllers/censusEmailRecipientSyncController';

const buildSyncInput = (): DeferredRecipientSyncInput => ({
  canManageGlobalRecipientLists: true,
  recipientsReady: true,
  recipients: ['a@test.com'],
  lastRemoteRecipients: ['b@test.com'],
  recipientLists: [
    { id: 'census-default', name: 'Base', description: null, recipients: [] },
  ] as never,
  activeRecipientListId: 'census-default',
  actor: { uid: 'u1', email: 'admin@test.com' },
});

describe('censusEmailRecipientDeferredSyncController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs deferred sync and maps the resolved runtime state', async () => {
    const onSyncStart = vi.fn();
    const onSyncState = vi.fn();
    const onSyncComplete = vi.fn();
    const executeSync = vi.fn().mockResolvedValue({
      status: 'success',
      data: { skipped: false },
    });

    scheduleDeferredRecipientSync({
      syncInput: buildSyncInput(),
      recipients: ['nuevo@test.com'],
      executeSync,
      onSyncStart,
      onSyncState,
      onSyncComplete,
    });

    await vi.advanceTimersByTimeAsync(250);

    expect(onSyncStart).toHaveBeenCalledTimes(1);
    expect(executeSync).toHaveBeenCalledWith(buildSyncInput());
    expect(onSyncState).toHaveBeenCalledWith({
      recipientsSource: 'firebase',
      recipientsSyncError: null,
      lastRemoteRecipients: ['nuevo@test.com'],
    });
    expect(onSyncComplete).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending sync before it starts', async () => {
    const executeSync = vi.fn();
    const onSyncComplete = vi.fn();

    const cancel = scheduleDeferredRecipientSync({
      syncInput: buildSyncInput(),
      recipients: ['nuevo@test.com'],
      executeSync,
      onSyncStart: vi.fn(),
      onSyncState: vi.fn(),
      onSyncComplete,
    });

    cancel();
    await vi.advanceTimersByTimeAsync(250);

    expect(executeSync).not.toHaveBeenCalled();
    expect(onSyncComplete).toHaveBeenCalledTimes(1);
  });

  it('suppresses late sync state updates after cancellation', async () => {
    let resolveSync: ((value: { status: string; data: { skipped: boolean } }) => void) | undefined;
    const executeSync = vi.fn(
      () =>
        new Promise<{ status: string; data: { skipped: boolean } }>(resolve => {
          resolveSync = resolve;
        })
    );
    const onSyncState = vi.fn();
    const onSyncComplete = vi.fn();

    const cancel = scheduleDeferredRecipientSync({
      syncInput: buildSyncInput(),
      recipients: ['nuevo@test.com'],
      executeSync,
      onSyncStart: vi.fn(),
      onSyncState,
      onSyncComplete,
    });

    await vi.advanceTimersByTimeAsync(250);
    cancel();
    resolveSync?.({ status: 'success', data: { skipped: false } });
    await Promise.resolve();

    expect(onSyncState).not.toHaveBeenCalled();
    expect(onSyncComplete).toHaveBeenCalledTimes(1);
  });
});
