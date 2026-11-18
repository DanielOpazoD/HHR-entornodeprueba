import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCensusEmailRecipientRuntimeState } from '@/features/census/email/hooks/useCensusEmailRecipientRuntimeState';

const remoteList = {
  id: 'census-default',
  name: 'Censo',
  description: 'Lista institucional',
  recipients: ['remote@example.com'],
  scope: 'global' as const,
  updatedAt: '2026-04-27T00:00:00.000Z',
  updatedByUid: null,
  updatedByEmail: null,
};

describe('useCensusEmailRecipientRuntimeState', () => {
  it('applies full runtime state and derives metadata for effects', () => {
    const { result } = renderHook(() => useCensusEmailRecipientRuntimeState());

    act(() => {
      result.current.applyRecipientRuntimeState({
        recipientLists: [remoteList],
        recipients: remoteList.recipients,
        recipientsSource: 'firebase',
        activeRecipientListId: remoteList.id,
        recipientsSyncError: null,
        lastRemoteRecipients: remoteList.recipients,
      });
    });

    expect(result.current.recipientLists).toEqual([remoteList]);
    expect(result.current.recipients).toEqual(['remote@example.com']);
    expect(result.current.recipientsSource).toBe('firebase');
    expect(result.current.runtimeMetadata).toEqual({
      recipientsReady: true,
      activeRecipientListId: 'census-default',
      lastRemoteRecipients: ['remote@example.com'],
    });
  });

  it('applies deferred sync metadata without losing the active list id', () => {
    const { result } = renderHook(() => useCensusEmailRecipientRuntimeState());

    act(() => {
      result.current.setActiveRecipientListId('custom');
      result.current.applyRecipientSyncState({
        recipientsSource: 'firebase',
        recipientsSyncError: null,
        lastRemoteRecipients: ['synced@example.com'],
      });
    });

    expect(result.current.recipientsSource).toBe('firebase');
    expect(result.current.recipientsSyncError).toBeNull();
    expect(result.current.runtimeMetadata).toMatchObject({
      activeRecipientListId: 'custom',
      lastRemoteRecipients: ['synced@example.com'],
    });
  });
});
