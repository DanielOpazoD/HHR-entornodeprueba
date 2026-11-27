import { useCallback, useEffect, useMemo } from 'react';
import type { RecipientRuntimeMutationSpec } from '@/features/census/email/controllers/censusEmailRecipientMutationActionController';
import {
  applyRecipientListSelection,
  buildRecipientDeferredSyncHandlers,
  runRecipientRuntimeMutation as runRecipientRuntimeMutationController,
  type UseCensusEmailRecipientListsParams,
  type UseCensusEmailRecipientListsReturn,
} from '@/features/census/email/controllers/censusEmailRecipientListsController';
import { useCensusEmailRecipientBootstrapEffect } from '@/features/census/email/hooks/useCensusEmailRecipientBootstrapEffect';
import { useCensusEmailRecipientDeferredSyncEffect } from '@/features/census/email/hooks/useCensusEmailRecipientDeferredSyncEffect';
import { useCensusEmailRecipientMutationActions } from '@/features/census/email/hooks/useCensusEmailRecipientMutationActions';
import { useCensusEmailRecipientRuntimeState } from '@/features/census/email/hooks/useCensusEmailRecipientRuntimeState';
import { saveSetting } from '@/services/storage/indexeddb/indexedDbSettingsService';

const ACTIVE_LIST_STORAGE_KEY = 'censusEmailActiveRecipientListId';
const RECIPIENTS_STORAGE_KEY = 'censusEmailRecipients';

interface UseCensusEmailRecipientPersistenceEffectParams {
  activeRecipientListId: string;
  recipientsReady: boolean;
  recipients: string[];
}

export const useCensusEmailRecipientPersistenceEffect = ({
  activeRecipientListId,
  recipientsReady,
  recipients,
}: UseCensusEmailRecipientPersistenceEffectParams): void => {
  useEffect(() => {
    if (!recipientsReady) return;
    void saveSetting(RECIPIENTS_STORAGE_KEY, recipients);
    void saveSetting(ACTIVE_LIST_STORAGE_KEY, activeRecipientListId);
  }, [activeRecipientListId, recipients, recipientsReady]);
};

export type {
  UseCensusEmailRecipientListsParams,
  UseCensusEmailRecipientListsReturn,
} from '@/features/census/email/controllers/censusEmailRecipientListsController';

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
      onLoadError: setRecipientsSyncError,
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
