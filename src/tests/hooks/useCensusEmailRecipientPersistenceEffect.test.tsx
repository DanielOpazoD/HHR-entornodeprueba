import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useCensusEmailRecipientPersistenceEffect } from '@/features/census/email/hooks/useCensusEmailRecipientPersistenceEffect';
import { saveSetting } from '@/services/storage/indexeddb/indexedDbSettingsService';

vi.mock('@/services/storage/indexeddb/indexedDbSettingsService', () => ({
  saveSetting: vi.fn(),
}));

describe('useCensusEmailRecipientPersistenceEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips persistence until recipients are ready', () => {
    renderHook(() =>
      useCensusEmailRecipientPersistenceEffect({
        activeRecipientListId: 'custom-list',
        recipientsReady: false,
        recipients: ['destino@test.com'],
      })
    );

    expect(saveSetting).not.toHaveBeenCalled();
  });

  it('persists recipients and active list once the runtime is ready', () => {
    const { rerender } = renderHook(
      ({
        activeRecipientListId,
        recipientsReady,
        recipients,
      }: {
        activeRecipientListId: string;
        recipientsReady: boolean;
        recipients: string[];
      }) =>
        useCensusEmailRecipientPersistenceEffect({
          activeRecipientListId,
          recipientsReady,
          recipients,
        }),
      {
        initialProps: {
          activeRecipientListId: 'census-default',
          recipientsReady: false,
          recipients: ['destino@test.com'],
        },
      }
    );

    rerender({
      activeRecipientListId: 'custom-list',
      recipientsReady: true,
      recipients: ['destino@test.com'],
    });

    expect(saveSetting).toHaveBeenCalledWith('censusEmailRecipients', ['destino@test.com']);
    expect(saveSetting).toHaveBeenCalledWith('censusEmailActiveRecipientListId', 'custom-list');
    expect(saveSetting).toHaveBeenCalledTimes(2);
  });
});
