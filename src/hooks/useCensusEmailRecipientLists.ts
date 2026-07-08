import { useCallback, useMemo } from 'react';
import type { RecipientRuntimeMutationSpec } from '@/hooks/controllers/censusEmailRecipientMutationActionController';
import {
  applyRecipientListSelection,
  buildRecipientDeferredSyncHandlers,
  runRecipientRuntimeMutation as runRecipientRuntimeMutationController,
  type UseCensusEmailRecipientListsParams,
  type UseCensusEmailRecipientListsReturn,
} from '@/hooks/controllers/censusEmailRecipientListsController';
import { useCensusEmailRecipientBootstrapEffect } from '@/hooks/useCensusEmailRecipientBootstrapEffect';
import { useCensusEmailRecipientDeferredSyncEffect } from '@/hooks/useCensusEmailRecipientDeferredSyncEffect';
import { useCensusEmailRecipientMutationActions } from '@/hooks/useCensusEmailRecipientMutationActions';
import { useCensusEmailRecipientPersistenceEffect } from '@/hooks/useCensusEmailRecipientPersistenceEffect';
import { useCensusEmailRecipientRuntimeState } from '@/hooks/useCensusEmailRecipientRuntimeState';

export type {
  UseCensusEmailRecipientListsParams,
  UseCensusEmailRecipientListsReturn,
} from '@/hooks/controllers/censusEmailRecipientListsController';

export const useCensusEmailRecipientLists = ({
  canManageGlobalRecipientLists,
  browserRuntime,
  bootstrapEnabled,
  enabled,
  user,
}: UseCensusEmailRecipientListsParams): UseCensusEmailRecipientListsReturn => {
  const {
    recipients,
    setRecipients,
    recipientLists,
    recipientsSource,
    isRecipientsSyncing,
    setIsRecipientsSyncing,
    recipientsSyncError,
    setRecipientsSyncError,
    runtimeMetadata,
    setActiveRecipientListId,
    applyRecipientRuntimeState,
    applyRecipientSyncState,
  } = useCensusEmailRecipientRuntimeState();

  const selectActiveRecipientList = useCallback(
    (listId: string) => {
      applyRecipientListSelection({
        canManageGlobalRecipientLists,
        recipientLists,
        listId,
        applyRecipientRuntimeState,
        setActiveRecipientListId,
      });
    },
    [
      applyRecipientRuntimeState,
      canManageGlobalRecipientLists,
      recipientLists,
      setActiveRecipientListId,
    ]
  );

  const runRecipientRuntimeMutation = useCallback(
    async <T>(spec: RecipientRuntimeMutationSpec<T>) => {
      await runRecipientRuntimeMutationController(spec, {
        applyRecipientRuntimeState,
        setIsRecipientsSyncing,
        setRecipientsSyncError,
      });
    },
    [applyRecipientRuntimeState, setIsRecipientsSyncing, setRecipientsSyncError]
  );

  const deferredSyncHandlers = useMemo(
    () =>
      buildRecipientDeferredSyncHandlers({
        applyRecipientSyncState,
        setIsRecipientsSyncing,
        setRecipientsSyncError,
      }),
    [applyRecipientSyncState, setIsRecipientsSyncing, setRecipientsSyncError]
  );

  useCensusEmailRecipientBootstrapEffect({
    canManageGlobalRecipientLists,
    browserRuntime,
    bootstrapEnabled,
    enabled,
    user,
    applyRecipientRuntimeState,
  });

  useCensusEmailRecipientPersistenceEffect({
    activeRecipientListId: runtimeMetadata.activeRecipientListId,
    recipientsReady: runtimeMetadata.recipientsReady,
    recipients,
  });

  useCensusEmailRecipientDeferredSyncEffect({
    enabled,
    canManageGlobalRecipientLists,
    recipientsReady: runtimeMetadata.recipientsReady,
    recipients,
    lastRemoteRecipients: runtimeMetadata.lastRemoteRecipients,
    recipientLists,
    activeRecipientListId: runtimeMetadata.activeRecipientListId,
    user,
    ...deferredSyncHandlers,
  });

  const { createRecipientList, renameActiveRecipientList, deleteRecipientList } =
    useCensusEmailRecipientMutationActions({
      canManageGlobalRecipientLists,
      recipients,
      recipientLists,
      activeRecipientListId: runtimeMetadata.activeRecipientListId,
      user,
      runRecipientRuntimeMutation,
    });

  return {
    recipients,
    setRecipients,
    recipientLists,
    activeRecipientListId: runtimeMetadata.activeRecipientListId,
    setActiveRecipientListId: selectActiveRecipientList,
    createRecipientList,
    renameActiveRecipientList,
    deleteRecipientList,
    recipientsSource,
    isRecipientsSyncing,
    recipientsSyncError,
  };
};
