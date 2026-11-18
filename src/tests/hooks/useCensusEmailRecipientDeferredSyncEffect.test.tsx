import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCensusEmailRecipientDeferredSyncEffect } from '@/features/census/email/hooks/useCensusEmailRecipientDeferredSyncEffect';
import { scheduleDeferredRecipientSync } from '@/features/census/email/controllers/censusEmailRecipientDeferredSyncController';
import { CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST } from '@/services/email/emailRecipientListService';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';

vi.mock('@/features/census/email/controllers/censusEmailRecipientDeferredSyncController', () => ({
  scheduleDeferredRecipientSync: vi.fn(),
}));

describe('useCensusEmailRecipientDeferredSyncEffect', () => {
  const cancelSync = vi.fn();
  const globalList: GlobalEmailRecipientList = {
    ...CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST,
    recipients: ['anterior@test.com'],
    scope: 'global',
    updatedAt: '2026-04-19T00:00:00.000Z',
    updatedByUid: 'admin-1',
    updatedByEmail: 'admin@test.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(scheduleDeferredRecipientSync).mockReturnValue(cancelSync);
  });

  afterEach(() => {
    cancelSync.mockReset();
  });

  it('schedules deferred sync when the runtime input is actionable', () => {
    const onSyncStart = vi.fn();
    const onSyncState = vi.fn();
    const onSyncComplete = vi.fn();

    renderHook(() =>
      useCensusEmailRecipientDeferredSyncEffect({
        enabled: true,
        canManageGlobalRecipientLists: true,
        recipientsReady: true,
        recipients: ['destino@test.com'],
        lastRemoteRecipients: ['anterior@test.com'],
        recipientLists: [globalList],
        activeRecipientListId: 'census-default',
        user: { uid: 'admin-1', email: 'admin@test.com' },
        onSyncStart,
        onSyncState,
        onSyncComplete,
      })
    );

    expect(scheduleDeferredRecipientSync).toHaveBeenCalledTimes(1);
    expect(scheduleDeferredRecipientSync).toHaveBeenCalledWith(
      expect.objectContaining({
        syncInput: expect.objectContaining({
          canManageGlobalRecipientLists: true,
          recipientsReady: true,
          recipients: ['destino@test.com'],
          lastRemoteRecipients: ['anterior@test.com'],
          activeRecipientListId: 'census-default',
          actor: { uid: 'admin-1', email: 'admin@test.com' },
        }),
        recipients: ['destino@test.com'],
        onSyncStart,
        onSyncState,
        onSyncComplete,
        executeSync: expect.any(Function),
      })
    );
  });

  it('does not schedule sync when the runtime input should be skipped', () => {
    renderHook(() =>
      useCensusEmailRecipientDeferredSyncEffect({
        enabled: true,
        canManageGlobalRecipientLists: true,
        recipientsReady: true,
        recipients: ['destino@test.com'],
        lastRemoteRecipients: ['destino@test.com'],
        recipientLists: [{ ...globalList, recipients: ['destino@test.com'] }],
        activeRecipientListId: 'census-default',
        user: { uid: 'admin-1', email: 'admin@test.com' },
        onSyncStart: vi.fn(),
        onSyncState: vi.fn(),
        onSyncComplete: vi.fn(),
      })
    );

    expect(scheduleDeferredRecipientSync).not.toHaveBeenCalled();
  });

  it('cancels the previous deferred sync when dependencies stop requiring it', () => {
    const { rerender } = renderHook(
      ({
        recipients,
        lastRemoteRecipients,
      }: {
        recipients: string[];
        lastRemoteRecipients: string[] | null;
      }) =>
        useCensusEmailRecipientDeferredSyncEffect({
          enabled: true,
          canManageGlobalRecipientLists: true,
          recipientsReady: true,
          recipients,
          lastRemoteRecipients,
          recipientLists: [{ ...globalList, recipients }],
          activeRecipientListId: 'census-default',
          user: { uid: 'admin-1', email: 'admin@test.com' },
          onSyncStart: vi.fn(),
          onSyncState: vi.fn(),
          onSyncComplete: vi.fn(),
        }),
      {
        initialProps: {
          recipients: ['destino@test.com'],
          lastRemoteRecipients: ['anterior@test.com'],
        },
      }
    );

    rerender({
      recipients: ['destino@test.com'],
      lastRemoteRecipients: ['destino@test.com'],
    });

    expect(cancelSync).toHaveBeenCalledTimes(1);
  });
});
