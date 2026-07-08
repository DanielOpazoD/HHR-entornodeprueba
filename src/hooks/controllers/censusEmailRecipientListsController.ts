import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';
import type { CensusEmailBrowserRuntime } from '@/hooks/controllers/censusEmailBrowserRuntimeController';
import type { RecipientRuntimeMutationSpec } from '@/hooks/controllers/censusEmailRecipientMutationActionController';
import { executeRecipientRuntimeMutationSpec } from '@/hooks/controllers/censusEmailRecipientMutationRunner';
import {
  resolveRecipientSelectionRuntimeState,
  type RecipientRuntimeState,
  type resolveRecipientSyncState,
} from '@/hooks/controllers/censusEmailRecipientRuntimeController';

export interface UseCensusEmailRecipientListsParams {
  canManageGlobalRecipientLists: boolean;
  browserRuntime: CensusEmailBrowserRuntime;
  bootstrapEnabled: boolean;
  enabled: boolean;
  user: { uid?: string; email?: string | null } | null;
}

export interface UseCensusEmailRecipientListsReturn {
  recipients: string[];
  setRecipients: (recipients: string[]) => void;
  recipientLists: GlobalEmailRecipientList[];
  activeRecipientListId: string;
  setActiveRecipientListId: (listId: string) => void;
  createRecipientList: (name: string) => Promise<void>;
  renameActiveRecipientList: (name: string) => Promise<void>;
  deleteRecipientList: (listId: string) => Promise<void>;
  recipientsSource: 'firebase' | 'local' | 'default';
  isRecipientsSyncing: boolean;
  recipientsSyncError: string | null;
}

interface RecipientListSelectionInput {
  canManageGlobalRecipientLists: boolean;
  recipientLists: GlobalEmailRecipientList[];
  listId: string;
  applyRecipientRuntimeState: (state: RecipientRuntimeState) => void;
  setActiveRecipientListId: (listId: string) => void;
}

export const applyRecipientListSelection = ({
  canManageGlobalRecipientLists,
  recipientLists,
  listId,
  applyRecipientRuntimeState,
  setActiveRecipientListId,
}: RecipientListSelectionInput): void => {
  const nextState = resolveRecipientSelectionRuntimeState({
    canManageGlobalRecipientLists,
    recipientLists,
    listId,
  });

  if (!nextState.shouldApplyActiveList) {
    setActiveRecipientListId(nextState.activeRecipientListId);
    return;
  }

  applyRecipientRuntimeState(nextState.runtimeState);
};

interface RecipientRuntimeMutationInput {
  applyRecipientRuntimeState: (state: RecipientRuntimeState) => void;
  setIsRecipientsSyncing: (isSyncing: boolean) => void;
  setRecipientsSyncError: (message: string | null) => void;
}

interface RecipientDeferredSyncHandlersInput {
  applyRecipientSyncState: (state: ReturnType<typeof resolveRecipientSyncState>) => void;
  setIsRecipientsSyncing: (isSyncing: boolean) => void;
  setRecipientsSyncError: (message: string | null) => void;
}

export const buildRecipientDeferredSyncHandlers = ({
  applyRecipientSyncState,
  setIsRecipientsSyncing,
  setRecipientsSyncError,
}: RecipientDeferredSyncHandlersInput) => ({
  onSyncStart: () => {
    setIsRecipientsSyncing(true);
    setRecipientsSyncError(null);
  },
  onSyncState: applyRecipientSyncState,
  onSyncComplete: () => {
    setIsRecipientsSyncing(false);
  },
});

export const runRecipientRuntimeMutation = async <T>(
  spec: RecipientRuntimeMutationSpec<T>,
  {
    applyRecipientRuntimeState,
    setIsRecipientsSyncing,
    setRecipientsSyncError,
  }: RecipientRuntimeMutationInput
): Promise<void> => {
  await executeRecipientRuntimeMutationSpec(spec, {
    applyRuntimeState: applyRecipientRuntimeState,
    resolveRuntimeState: spec.resolveRuntimeState,
    setRecipientsSyncing: setIsRecipientsSyncing,
    setRecipientsSyncError,
  });
};
