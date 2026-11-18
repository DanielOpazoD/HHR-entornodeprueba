import {
  resolveStoredRecipientSelection,
  type BootstrapRecipientSelectionState,
  type CensusRecipientSelectionSource,
  type CensusRecipientSelectionState,
} from '@/features/census/email/controllers/censusEmailRecipientSelectionController';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';
import { resolveRecipientListForSelection } from '@/features/census/email/controllers/censusEmailRecipientMutationController';

interface ApplicationOutcomeLike<TData = unknown> {
  status: string;
  data?: TData;
  issues?: Array<{ message?: string; userSafeMessage?: string }>;
  userSafeMessage?: string;
}

export interface RecipientRuntimeState extends CensusRecipientSelectionState {
  recipientLists: GlobalEmailRecipientList[];
  recipientsSyncError: string | null;
  lastRemoteRecipients: string[] | null;
}

export interface RecipientRuntimeMetadata {
  recipientsReady: boolean;
  activeRecipientListId: string;
  lastRemoteRecipients: string[] | null;
}

export const resolveActiveRecipientRuntimeState = (
  recipientLists: GlobalEmailRecipientList[],
  list: GlobalEmailRecipientList
): RecipientRuntimeState => ({
  recipientLists,
  recipients: list.recipients,
  recipientsSource: 'firebase',
  activeRecipientListId: list.id,
  recipientsSyncError: null,
  lastRemoteRecipients: list.recipients,
});

export const resolveRecipientSelectionRuntimeState = ({
  canManageGlobalRecipientLists,
  recipientLists,
  listId,
}: {
  canManageGlobalRecipientLists: boolean;
  recipientLists: GlobalEmailRecipientList[];
  listId: string;
}):
  | { shouldApplyActiveList: false; activeRecipientListId: string }
  | { shouldApplyActiveList: true; runtimeState: RecipientRuntimeState } => {
  const activeList = resolveRecipientListForSelection(recipientLists, listId);
  if (!activeList || !canManageGlobalRecipientLists) {
    return {
      shouldApplyActiveList: false,
      activeRecipientListId: listId,
    };
  }

  return {
    shouldApplyActiveList: true,
    runtimeState: resolveActiveRecipientRuntimeState(recipientLists, activeList),
  };
};

export const resolveStoredRecipientRuntimeState = (
  storedRecipients: string[] | null,
  storedActiveListId?: string | null,
  syncError: string | null = null
): RecipientRuntimeState => ({
  ...resolveStoredRecipientSelection(storedRecipients, storedActiveListId),
  recipientLists: [],
  recipientsSyncError: syncError,
  lastRemoteRecipients: null,
});

export const resolveBootstrapRecipientRuntimeState = (
  input: BootstrapRecipientSelectionState & {
    syncError: string | null;
  }
): RecipientRuntimeState => ({
  recipientLists: input.recipientLists,
  recipients: input.recipients,
  recipientsSource: input.recipientsSource,
  activeRecipientListId: input.activeRecipientListId,
  recipientsSyncError: input.syncError,
  lastRemoteRecipients: input.lastRemoteRecipients,
});

export const resolveBootstrapRecipientFallbackMessage = (result: ApplicationOutcomeLike): string =>
  resolveApplicationOutcomeMessage(
    result,
    'No se pudo cargar la lista global en Firebase. Se usara la copia local.'
  );

export const resolveRecipientRuntimeMetadata = (
  state: RecipientRuntimeState
): RecipientRuntimeMetadata => ({
  recipientsReady: true,
  activeRecipientListId: state.activeRecipientListId,
  lastRemoteRecipients: state.lastRemoteRecipients,
});

export const resolveRecipientSyncState = (
  result: ApplicationOutcomeLike<{ skipped?: boolean }>,
  recipients: string[]
): {
  recipientsSource: CensusRecipientSelectionSource | null;
  recipientsSyncError: string | null;
  lastRemoteRecipients: string[] | null;
} => {
  if (result.status === 'success') {
    if (result.data?.skipped) {
      return {
        recipientsSource: null,
        recipientsSyncError: null,
        lastRemoteRecipients: null,
      };
    }

    return {
      recipientsSource: 'firebase',
      recipientsSyncError: null,
      lastRemoteRecipients: recipients,
    };
  }

  return {
    recipientsSource: null,
    recipientsSyncError: resolveApplicationOutcomeMessage(
      result,
      'No se pudo sincronizar la lista global en Firebase. Se mantiene la copia local.'
    ),
    lastRemoteRecipients: null,
  };
};

export const applyRecipientSyncRuntimeMetadata = (
  current: RecipientRuntimeMetadata,
  syncState: ReturnType<typeof resolveRecipientSyncState>
): RecipientRuntimeMetadata => ({
  ...current,
  lastRemoteRecipients: syncState.lastRemoteRecipients ?? current.lastRemoteRecipients,
});

export const resolveRecipientMutationFailureMessage = (
  result: ApplicationOutcomeLike,
  fallbackMessage: string
): string => resolveApplicationOutcomeMessage(result, fallbackMessage);
