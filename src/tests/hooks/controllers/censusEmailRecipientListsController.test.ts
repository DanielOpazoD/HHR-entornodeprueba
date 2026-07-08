import { describe, expect, it, vi } from 'vitest';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';
import {
  applyRecipientListSelection,
  buildRecipientDeferredSyncHandlers,
  runRecipientRuntimeMutation,
} from '@/hooks/controllers/censusEmailRecipientListsController';
import type { RecipientRuntimeMutationSpec } from '@/hooks/controllers/censusEmailRecipientMutationActionController';

describe('censusEmailRecipientListsController', () => {
  const remoteList: GlobalEmailRecipientList = {
    id: 'census-default',
    name: 'Censo',
    description: '',
    recipients: ['uno@example.com'],
    scope: 'global',
    updatedAt: '2026-04-30T10:00:00.000Z',
    updatedByUid: null,
    updatedByEmail: null,
  };

  it('applies full runtime state only when the selected list exists and can be managed', () => {
    const applyRecipientRuntimeState = vi.fn();
    const setActiveRecipientListId = vi.fn();

    applyRecipientListSelection({
      canManageGlobalRecipientLists: true,
      recipientLists: [remoteList],
      listId: remoteList.id,
      applyRecipientRuntimeState,
      setActiveRecipientListId,
    });

    expect(setActiveRecipientListId).not.toHaveBeenCalled();
    expect(applyRecipientRuntimeState).toHaveBeenCalledWith({
      recipientLists: [remoteList],
      recipients: ['uno@example.com'],
      recipientsSource: 'firebase',
      activeRecipientListId: remoteList.id,
      recipientsSyncError: null,
      lastRemoteRecipients: ['uno@example.com'],
    });
  });

  it('keeps only the active id when the user cannot manage remote lists', () => {
    const applyRecipientRuntimeState = vi.fn();
    const setActiveRecipientListId = vi.fn();

    applyRecipientListSelection({
      canManageGlobalRecipientLists: false,
      recipientLists: [remoteList],
      listId: remoteList.id,
      applyRecipientRuntimeState,
      setActiveRecipientListId,
    });

    expect(applyRecipientRuntimeState).not.toHaveBeenCalled();
    expect(setActiveRecipientListId).toHaveBeenCalledWith(remoteList.id);
  });

  it('runs mutation specs through the runtime state adapters', async () => {
    const spec: RecipientRuntimeMutationSpec<{ id: string }> = {
      execute: vi.fn().mockResolvedValue({
        status: 'success',
        data: { id: 'census-default' },
      }),
      resolveRuntimeState: vi.fn().mockReturnValue({
        recipientLists: [remoteList],
        recipients: remoteList.recipients,
        recipientsSource: 'firebase',
        activeRecipientListId: remoteList.id,
        recipientsSyncError: null,
        lastRemoteRecipients: remoteList.recipients,
      }),
      fallbackMessage: 'fallback',
    };
    const applyRecipientRuntimeState = vi.fn();
    const setIsRecipientsSyncing = vi.fn();
    const setRecipientsSyncError = vi.fn();

    await runRecipientRuntimeMutation(spec, {
      applyRecipientRuntimeState,
      setIsRecipientsSyncing,
      setRecipientsSyncError,
    });

    expect(setIsRecipientsSyncing).toHaveBeenNthCalledWith(1, true);
    expect(setRecipientsSyncError).toHaveBeenNthCalledWith(1, null);
    expect(applyRecipientRuntimeState).toHaveBeenCalledWith({
      recipientLists: [remoteList],
      recipients: remoteList.recipients,
      recipientsSource: 'firebase',
      activeRecipientListId: remoteList.id,
      recipientsSyncError: null,
      lastRemoteRecipients: remoteList.recipients,
    });
    expect(setIsRecipientsSyncing).toHaveBeenLastCalledWith(false);
  });

  it('builds stable deferred sync handlers for recipient list runtime state', () => {
    const applyRecipientSyncState = vi.fn();
    const setIsRecipientsSyncing = vi.fn();
    const setRecipientsSyncError = vi.fn();

    const handlers = buildRecipientDeferredSyncHandlers({
      applyRecipientSyncState,
      setIsRecipientsSyncing,
      setRecipientsSyncError,
    });
    const nextSyncState = {
      recipientsSource: 'firebase' as const,
      recipientsSyncError: null,
      lastRemoteRecipients: ['uno@example.com'],
    };

    handlers.onSyncStart();
    handlers.onSyncState(nextSyncState);
    handlers.onSyncComplete();

    expect(setIsRecipientsSyncing).toHaveBeenNthCalledWith(1, true);
    expect(setRecipientsSyncError).toHaveBeenCalledWith(null);
    expect(applyRecipientSyncState).toHaveBeenCalledWith(nextSyncState);
    expect(setIsRecipientsSyncing).toHaveBeenLastCalledWith(false);
  });
});
