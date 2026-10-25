import { useCallback, useState } from 'react';
import { CENSUS_DEFAULT_RECIPIENTS } from '@/constants/email';
import { CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST } from '@/services/email/emailRecipientListSupport';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListSupport';
import {
  applyRecipientSyncRuntimeMetadata,
  type RecipientRuntimeMetadata,
  type RecipientRuntimeState,
  resolveRecipientRuntimeMetadata,
  resolveRecipientSyncState,
} from '@/hooks/controllers/censusEmailRecipientRuntimeController';

export const useCensusEmailRecipientRuntimeState = () => {
  const [recipients, setRecipientsState] = useState<string[]>(CENSUS_DEFAULT_RECIPIENTS);
  const [recipientLists, setRecipientLists] = useState<GlobalEmailRecipientList[]>([]);
  const [recipientsSource, setRecipientsSource] = useState<'firebase' | 'local' | 'default'>(
    'default'
  );
  const [isRecipientsSyncing, setIsRecipientsSyncing] = useState(false);
  const [recipientsSyncError, setRecipientsSyncError] = useState<string | null>(null);
  const [runtimeMetadata, setRuntimeMetadata] = useState<RecipientRuntimeMetadata>({
    recipientsReady: false,
    activeRecipientListId: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id,
    lastRemoteRecipients: null,
  });

  const setActiveRecipientListId = useCallback((listId: string) => {
    setRuntimeMetadata(current => ({
      ...current,
      activeRecipientListId: listId,
    }));
  }, []);

  const setRecipients = useCallback((nextRecipients: string[]) => {
    setRecipientsState(nextRecipients);
  }, []);

  const applyRecipientRuntimeState = useCallback((nextState: RecipientRuntimeState) => {
    setRecipientLists(nextState.recipientLists);
    setRecipientsState(nextState.recipients);
    setRecipientsSource(nextState.recipientsSource);
    setRecipientsSyncError(nextState.recipientsSyncError);
    setRuntimeMetadata(resolveRecipientRuntimeMetadata(nextState));
  }, []);

  const applyRecipientSyncState = useCallback(
    (nextState: ReturnType<typeof resolveRecipientSyncState>) => {
      if (nextState.recipientsSource) {
        setRecipientsSource(nextState.recipientsSource);
      }
      setRecipientsSyncError(nextState.recipientsSyncError);
      setRuntimeMetadata(current => applyRecipientSyncRuntimeMetadata(current, nextState));
    },
    []
  );

  return {
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
  };
};
