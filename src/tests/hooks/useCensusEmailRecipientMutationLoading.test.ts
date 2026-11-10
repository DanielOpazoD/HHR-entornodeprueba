import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCensusEmailRecipientMutationActions } from '@/hooks/useCensusEmailRecipientMutationActions';

vi.mock('@/hooks/controllers/censusEmailRecipientMutationActionController', () => {
  throw new Error('unavailable');
});

it('reports load failures for each list action without mutating recipients', async () => {
  const runRecipientRuntimeMutation = vi.fn();
  const onLoadError = vi.fn();
  const { result } = renderHook(() =>
    useCensusEmailRecipientMutationActions({
      canManageGlobalRecipientLists: true,
      recipients: ['synthetic@example.com'],
      recipientLists: [],
      activeRecipientListId: 'synthetic-list',
      user: { uid: 'synthetic-user' },
      runRecipientRuntimeMutation,
      onLoadError,
    })
  );
  await act(async () => {
    await result.current.createRecipientList('Synthetic');
    await result.current.renameActiveRecipientList('Synthetic renamed');
    await result.current.deleteRecipientList('synthetic-list');
  });
  expect(runRecipientRuntimeMutation).not.toHaveBeenCalled();
  expect(onLoadError).toHaveBeenCalledTimes(3);
  expect(onLoadError).toHaveBeenCalledWith(expect.stringContaining('No se pudieron cargar'));
});
