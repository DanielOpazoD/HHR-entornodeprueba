import { useEffect } from 'react';
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
