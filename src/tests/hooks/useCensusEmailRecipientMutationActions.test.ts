import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCensusEmailRecipientMutationActions } from '@/hooks/useCensusEmailRecipientMutationActions';
import {
  buildCreateRecipientListMutationSpec,
  buildDeleteRecipientListMutationSpec,
  buildRenameRecipientListMutationSpec,
} from '@/hooks/controllers/censusEmailRecipientMutationActionController';

vi.mock('@/hooks/controllers/censusEmailRecipientMutationActionController', () => ({
  buildCreateRecipientListMutationSpec: vi.fn(),
  buildRenameRecipientListMutationSpec: vi.fn(),
  buildDeleteRecipientListMutationSpec: vi.fn(),
}));

describe('useCensusEmailRecipientMutationActions', () => {
  const runRecipientRuntimeMutation = vi.fn();
  const recipientLists = [
    {
      id: 'census-default',
      name: 'Default',
      description: null,
      recipients: ['uno@test.com'],
      scope: 'global' as const,
      updatedAt: '2026-04-20T00:00:00.000Z',
      updatedByUid: null,
      updatedByEmail: null,
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(buildCreateRecipientListMutationSpec).mockReturnValue({} as never);
    vi.mocked(buildRenameRecipientListMutationSpec).mockReturnValue({} as never);
    vi.mocked(buildDeleteRecipientListMutationSpec).mockReturnValue({} as never);
  });

  const renderMutationActions = () =>
    renderHook(() =>
      useCensusEmailRecipientMutationActions({
        canManageGlobalRecipientLists: true,
        recipients: ['uno@test.com'],
        recipientLists,
        activeRecipientListId: 'census-default',
        user: { uid: 'user-1', email: 'admin@test.com' },
        runRecipientRuntimeMutation,
        onLoadError: vi.fn(),
      })
    );

  it('builds and executes the create mutation spec', async () => {
    const { result } = renderMutationActions();

    await act(async () => {
      await result.current.createRecipientList('Nueva lista');
    });

    expect(buildCreateRecipientListMutationSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Nueva lista',
        recipients: ['uno@test.com'],
      })
    );
    expect(runRecipientRuntimeMutation).toHaveBeenCalledWith(
      vi.mocked(buildCreateRecipientListMutationSpec).mock.results[0]?.value
    );
  });

  it('builds and executes the rename mutation spec with the active list id', async () => {
    const { result } = renderMutationActions();

    await act(async () => {
      await result.current.renameActiveRecipientList('Renombrada');
    });

    expect(buildRenameRecipientListMutationSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        activeRecipientListId: 'census-default',
        name: 'Renombrada',
      })
    );
    expect(runRecipientRuntimeMutation).toHaveBeenCalledWith(
      vi.mocked(buildRenameRecipientListMutationSpec).mock.results[0]?.value
    );
  });

  it('builds and executes the delete mutation spec', async () => {
    const { result } = renderMutationActions();

    await act(async () => {
      await result.current.deleteRecipientList('census-default');
    });

    expect(buildDeleteRecipientListMutationSpec).toHaveBeenCalledWith({
      canManageGlobalRecipientLists: true,
      recipientLists,
      listId: 'census-default',
    });
    expect(runRecipientRuntimeMutation).toHaveBeenCalledWith(
      vi.mocked(buildDeleteRecipientListMutationSpec).mock.results[0]?.value
    );
  });
});
