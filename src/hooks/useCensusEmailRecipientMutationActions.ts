import { useCallback } from 'react';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';
import type { RecipientRuntimeMutationSpec } from '@/hooks/controllers/censusEmailRecipientMutationActionController';
import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';

const loadMutationActions = createCachedRuntimeLoader(
  () => import('@/hooks/controllers/censusEmailRecipientMutationActionController')
);

interface RecipientListActor {
  uid?: string;
  email?: string | null;
}

interface UseCensusEmailRecipientMutationActionsParams {
  canManageGlobalRecipientLists: boolean;
  recipients: string[];
  recipientLists: GlobalEmailRecipientList[];
  activeRecipientListId: string;
  user: RecipientListActor | null;
  onLoadError: (message: string) => void;
  runRecipientRuntimeMutation: <TData>(spec: RecipientRuntimeMutationSpec<TData>) => Promise<void>;
}

interface UseCensusEmailRecipientMutationActionsResult {
  createRecipientList: (name: string) => Promise<void>;
  renameActiveRecipientList: (name: string) => Promise<void>;
  deleteRecipientList: (listId: string) => Promise<void>;
}

export const useCensusEmailRecipientMutationActions = ({
  canManageGlobalRecipientLists,
  recipients,
  recipientLists,
  activeRecipientListId,
  user,
  runRecipientRuntimeMutation,
  onLoadError,
}: UseCensusEmailRecipientMutationActionsParams): UseCensusEmailRecipientMutationActionsResult => {
  const loadActions = useCallback(async () => {
    try {
      return await loadMutationActions();
    } catch {
      onLoadError(
        'No se pudieron cargar las acciones de las listas de destinatarios. Intente nuevamente.'
      );
      return null;
    }
  }, [onLoadError]);
  const createRecipientList = useCallback(
    async (name: string) => {
      const actions = await loadActions();
      if (!actions) return;
      await runRecipientRuntimeMutation(
        actions.buildCreateRecipientListMutationSpec({
          canManageGlobalRecipientLists,
          name,
          recipients,
          recipientLists,
          actor: user,
        })
      );
    },
    [
      loadActions,
      canManageGlobalRecipientLists,
      recipients,
      recipientLists,
      runRecipientRuntimeMutation,
      user,
    ]
  );

  const renameActiveRecipientList = useCallback(
    async (name: string) => {
      const actions = await loadActions();
      if (!actions) return;
      await runRecipientRuntimeMutation(
        actions.buildRenameRecipientListMutationSpec({
          canManageGlobalRecipientLists,
          activeRecipientListId,
          name,
          recipients,
          recipientLists,
          actor: user,
        })
      );
    },
    [
      loadActions,
      activeRecipientListId,
      canManageGlobalRecipientLists,
      recipients,
      recipientLists,
      runRecipientRuntimeMutation,
      user,
    ]
  );

  const deleteRecipientList = useCallback(
    async (listId: string) => {
      const actions = await loadActions();
      if (!actions) return;
      await runRecipientRuntimeMutation(
        actions.buildDeleteRecipientListMutationSpec({
          canManageGlobalRecipientLists,
          recipientLists,
          listId,
        })
      );
    },
    [loadActions, canManageGlobalRecipientLists, recipientLists, runRecipientRuntimeMutation]
  );

  return {
    createRecipientList,
    renameActiveRecipientList,
    deleteRecipientList,
  };
};
