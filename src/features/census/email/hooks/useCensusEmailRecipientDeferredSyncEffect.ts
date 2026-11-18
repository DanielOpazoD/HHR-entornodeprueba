import { useEffect } from 'react';
import { scheduleDeferredRecipientSync } from '@/features/census/email/controllers/censusEmailRecipientDeferredSyncController';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';
import { resolveRecipientSyncState } from '@/features/census/email/controllers/censusEmailRecipientRuntimeController';
import { resolveDeferredRecipientSyncInput } from '@/features/census/email/controllers/censusEmailRecipientSyncController';
import { withRecipientListUseCases } from '@/features/census/email/controllers/censusEmailRecipientUseCaseLoader';

interface UseCensusEmailRecipientDeferredSyncEffectParams {
  enabled: boolean;
  canManageGlobalRecipientLists: boolean;
  recipientsReady: boolean;
  recipients: string[];
  lastRemoteRecipients: string[] | null;
  recipientLists: GlobalEmailRecipientList[];
  activeRecipientListId: string;
  user: { uid?: string; email?: string | null } | null;
  onSyncStart: () => void;
  onSyncState: (nextState: ReturnType<typeof resolveRecipientSyncState>) => void;
  onSyncComplete: () => void;
}

export const useCensusEmailRecipientDeferredSyncEffect = ({
  enabled,
  canManageGlobalRecipientLists,
  recipientsReady,
  recipients,
  lastRemoteRecipients,
  recipientLists,
  activeRecipientListId,
  user,
  onSyncStart,
  onSyncState,
  onSyncComplete,
}: UseCensusEmailRecipientDeferredSyncEffectParams): void => {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const syncInput = resolveDeferredRecipientSyncInput({
      canManageGlobalRecipientLists,
      recipientsReady,
      recipients,
      lastRemoteRecipients,
      recipientLists,
      activeRecipientListId,
      actor: user,
    });
    if (!syncInput) {
      return;
    }

    return scheduleDeferredRecipientSync({
      syncInput,
      recipients,
      executeSync: input =>
        withRecipientListUseCases(({ executeSyncCensusRecipientList }) =>
          executeSyncCensusRecipientList(input)
        ),
      onSyncStart,
      onSyncState,
      onSyncComplete,
    });
  }, [
    activeRecipientListId,
    canManageGlobalRecipientLists,
    enabled,
    lastRemoteRecipients,
    onSyncComplete,
    onSyncStart,
    onSyncState,
    recipientLists,
    recipients,
    recipientsReady,
    user,
  ]);
};
