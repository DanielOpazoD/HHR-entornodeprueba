import { useEffect } from 'react';
import type { CensusEmailBrowserRuntime } from '@/hooks/controllers/censusEmailBrowserRuntimeController';
import type { RecipientRuntimeState } from '@/hooks/controllers/censusEmailRecipientRuntimeController';
import { withRecipientListUseCases } from '@/hooks/controllers/censusEmailRecipientUseCaseLoader';

const ACTIVE_LIST_STORAGE_KEY = 'censusEmailActiveRecipientListId';
const RECIPIENTS_STORAGE_KEY = 'censusEmailRecipients';

interface UseCensusEmailRecipientBootstrapEffectParams {
  canManageGlobalRecipientLists: boolean;
  browserRuntime: CensusEmailBrowserRuntime;
  bootstrapEnabled: boolean;
  enabled: boolean;
  user: { uid?: string; email?: string | null } | null;
  applyRecipientRuntimeState: (nextState: RecipientRuntimeState) => void;
}

export const useCensusEmailRecipientBootstrapEffect = ({
  canManageGlobalRecipientLists,
  browserRuntime,
  bootstrapEnabled,
  enabled,
  user,
  applyRecipientRuntimeState,
}: UseCensusEmailRecipientBootstrapEffectParams): void => {
  useEffect(() => {
    if (!bootstrapEnabled) {
      return;
    }

    let isActive = true;

    const loadRecipients = async () => {
      const runtimeResult = await withRecipientListUseCases(
        ({ executeLoadCensusRecipientRuntimeState }) =>
          executeLoadCensusRecipientRuntimeState({
            canManageGlobalRecipientLists,
            browserRuntime,
            enabled: bootstrapEnabled,
            activeListStorageKey: ACTIVE_LIST_STORAGE_KEY,
            recipientsStorageKey: RECIPIENTS_STORAGE_KEY,
            user,
          })
      );

      if (!isActive) return;

      if (runtimeResult.status === 'success' && runtimeResult.data) {
        applyRecipientRuntimeState(runtimeResult.data);
      }
    };

    void loadRecipients();

    return () => {
      isActive = false;
    };
  }, [
    bootstrapEnabled,
    browserRuntime,
    canManageGlobalRecipientLists,
    enabled,
    applyRecipientRuntimeState,
    user,
  ]);
};
