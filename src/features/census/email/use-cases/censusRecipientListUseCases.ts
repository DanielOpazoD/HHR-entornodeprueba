import {
  deleteGlobalEmailRecipientListWithResult,
  saveGlobalEmailRecipientListWithResult,
  type GlobalEmailRecipientList,
} from '@/services/email/emailRecipientListService';
import { getSetting } from '@/services/storage/indexeddb/indexedDbSettingsService';
import type { CensusEmailBrowserRuntime } from '@/features/census/email/controllers/censusEmailBrowserRuntimeController';
import { resolveCensusRecipientsBootstrap } from '@/features/census/email/controllers/censusEmailRecipientsBootstrapController';
import { resolveBootstrapRecipientSelection } from '@/features/census/email/controllers/censusEmailRecipientSelectionController';
import {
  buildCreatedRecipientList,
  buildRecipientListSavePayload,
  resolveCreateRecipientListError,
  resolveDeleteRecipientListError,
  resolveRecipientListFallback,
  resolveRenamedRecipientListName,
  resolveRenameRecipientListError,
} from '@/features/census/email/controllers/censusEmailRecipientListController';
import {
  buildRecipientSyncPayload,
  resolveActiveRecipientListForSync,
  shouldSkipRecipientSync,
} from '@/features/census/email/controllers/censusEmailRecipientSyncController';
import {
  resolveBootstrapRecipientFallbackMessage,
  resolveBootstrapRecipientRuntimeState,
  resolveStoredRecipientRuntimeState,
} from '@/features/census/email/controllers/censusEmailRecipientRuntimeController';
import { createApplicationSuccess } from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import {
  buildRecipientListServiceFailure,
  buildRecipientListUnknownFailure,
  buildRecipientListValidationFailure,
} from '@/features/census/email/controllers/censusRecipientListOutcomeController';

interface RecipientListActor {
  uid?: string;
  email?: string | null;
}

export interface BootstrapCensusRecipientListsInput {
  canManageGlobalRecipientLists: boolean;
  browserRuntime: CensusEmailBrowserRuntime;
  activeListStorageKey: string;
  user: RecipientListActor | null;
}

export interface LoadCensusRecipientRuntimeInput extends BootstrapCensusRecipientListsInput {
  enabled: boolean;
  recipientsStorageKey: string;
}

export type CensusRecipientRuntimeState = ReturnType<typeof resolveStoredRecipientRuntimeState>;

export const executeBootstrapCensusRecipientLists = async (
  input: BootstrapCensusRecipientListsInput
) => {
  try {
    const bootstrap = await resolveCensusRecipientsBootstrap(input);
    return createApplicationSuccess(bootstrap);
  } catch (error) {
    return buildRecipientListUnknownFailure(
      null,
      error,
      'No se pudieron cargar las listas de destinatarios del censo.'
    );
  }
};

export const executeLoadCensusRecipientRuntimeState = async (
  input: LoadCensusRecipientRuntimeInput
): Promise<ApplicationOutcome<CensusRecipientRuntimeState>> => {
  if (!input.canManageGlobalRecipientLists || !input.enabled) {
    const [storedRecipients, storedActiveListId] = await Promise.all([
      getSetting<string[] | null>(input.recipientsStorageKey, null),
      getSetting<string | null>(input.activeListStorageKey, null),
    ]);

    return createApplicationSuccess(
      resolveStoredRecipientRuntimeState(storedRecipients, storedActiveListId)
    );
  }

  const bootstrapResult = await executeBootstrapCensusRecipientLists(input);
  if (bootstrapResult.status === 'success' && bootstrapResult.data) {
    return createApplicationSuccess(
      resolveBootstrapRecipientRuntimeState({
        ...resolveBootstrapRecipientSelection(bootstrapResult.data),
        syncError: bootstrapResult.data.syncError,
      })
    );
  }

  const storedRecipients = await getSetting<string[] | null>(input.recipientsStorageKey, null);
  return createApplicationSuccess(
    resolveStoredRecipientRuntimeState(
      storedRecipients,
      null,
      resolveBootstrapRecipientFallbackMessage(bootstrapResult)
    )
  );
};

export interface SyncCensusRecipientListInput {
  canManageGlobalRecipientLists: boolean;
  recipientsReady: boolean;
  recipients: string[];
  lastRemoteRecipients: string[] | null;
  recipientLists: GlobalEmailRecipientList[];
  activeRecipientListId: string;
  actor: RecipientListActor | null;
}

export const executeSyncCensusRecipientList = async (
  input: SyncCensusRecipientListInput
): Promise<ApplicationOutcome<{ skipped: boolean }>> => {
  try {
    if (
      shouldSkipRecipientSync({
        canManageGlobalRecipientLists: input.canManageGlobalRecipientLists,
        recipientsReady: input.recipientsReady,
        recipients: input.recipients,
        lastRemoteRecipients: input.lastRemoteRecipients,
      })
    ) {
      return createApplicationSuccess({ skipped: true });
    }

    const activeList = resolveActiveRecipientListForSync(
      input.recipientLists,
      input.activeRecipientListId
    );

    const saveResult = await saveGlobalEmailRecipientListWithResult(
      buildRecipientSyncPayload({
        activeList,
        recipients: input.recipients,
        actor: input.actor,
      })
    );
    if (saveResult.status !== 'success') {
      return buildRecipientListServiceFailure({ skipped: false }, saveResult);
    }

    return createApplicationSuccess({ skipped: false });
  } catch (error) {
    return buildRecipientListUnknownFailure(
      { skipped: false },
      error,
      'No se pudo sincronizar la lista global.'
    );
  }
};

export interface CreateCensusRecipientListInput {
  canManageGlobalRecipientLists: boolean;
  name: string;
  recipients: string[];
  recipientLists: GlobalEmailRecipientList[];
  actor: RecipientListActor | null;
}

export const executeCreateCensusRecipientList = async (
  input: CreateCensusRecipientListInput
): Promise<ApplicationOutcome<GlobalEmailRecipientList | null>> => {
  const validationError = resolveCreateRecipientListError(
    input.canManageGlobalRecipientLists,
    input.name
  );
  if (validationError) {
    return buildRecipientListValidationFailure(null, validationError);
  }

  try {
    const createdList = buildCreatedRecipientList(
      input.name,
      input.recipients,
      input.recipientLists.map(list => list.id),
      input.actor
    );

    const saveResult = await saveGlobalEmailRecipientListWithResult(
      buildRecipientListSavePayload({
        listId: createdList.id,
        name: createdList.name,
        description: createdList.description ?? '',
        recipients: input.recipients,
        actor: input.actor,
      })
    );
    if (saveResult.status !== 'success') {
      return buildRecipientListServiceFailure(null, saveResult);
    }

    return createApplicationSuccess(createdList);
  } catch (error) {
    return buildRecipientListUnknownFailure(null, error, 'No se pudo crear la lista global.');
  }
};

export interface RenameCensusRecipientListInput {
  canManageGlobalRecipientLists: boolean;
  activeList: GlobalEmailRecipientList | undefined;
  name: string;
  recipients: string[];
  actor: RecipientListActor | null;
}

export const executeRenameCensusRecipientList = async (
  input: RenameCensusRecipientListInput
): Promise<ApplicationOutcome<GlobalEmailRecipientList | null>> => {
  const validationError = resolveRenameRecipientListError(
    input.canManageGlobalRecipientLists,
    input.activeList,
    input.name
  );
  if (validationError || !input.activeList) {
    return buildRecipientListValidationFailure(null, validationError || 'Lista no encontrada.');
  }

  try {
    const resolvedName = resolveRenamedRecipientListName(input.activeList.id, input.name);
    const saveResult = await saveGlobalEmailRecipientListWithResult(
      buildRecipientListSavePayload({
        listId: input.activeList.id,
        name: resolvedName,
        description: input.activeList.description ?? '',
        recipients: input.recipients,
        actor: input.actor,
      })
    );
    if (saveResult.status !== 'success') {
      return buildRecipientListServiceFailure(null, saveResult);
    }

    return createApplicationSuccess({
      ...input.activeList,
      name: resolvedName,
      recipients: input.recipients,
      updatedAt: new Date().toISOString(),
      updatedByUid: input.actor?.uid ?? null,
      updatedByEmail: input.actor?.email ?? null,
    });
  } catch (error) {
    return buildRecipientListUnknownFailure(
      null,
      error,
      'No se pudo actualizar el nombre de la lista global.'
    );
  }
};

export interface DeleteCensusRecipientListInput {
  canManageGlobalRecipientLists: boolean;
  recipientLists: GlobalEmailRecipientList[];
  listId: string;
}

export const executeDeleteCensusRecipientList = async (
  input: DeleteCensusRecipientListInput
): Promise<ApplicationOutcome<{ fallbackList: GlobalEmailRecipientList | null }>> => {
  const validationError = resolveDeleteRecipientListError(
    input.canManageGlobalRecipientLists,
    input.recipientLists,
    input.listId
  );
  const fallbackList = resolveRecipientListFallback(input.recipientLists, input.listId);
  if (validationError || !fallbackList) {
    return buildRecipientListValidationFailure(
      { fallbackList: null },
      validationError || 'No se encontró lista alternativa.'
    );
  }

  try {
    const deleteResult = await deleteGlobalEmailRecipientListWithResult(input.listId);
    if (deleteResult.status !== 'success') {
      return buildRecipientListServiceFailure({ fallbackList }, deleteResult);
    }
    return createApplicationSuccess({ fallbackList });
  } catch (error) {
    return buildRecipientListUnknownFailure(
      { fallbackList },
      error,
      'No se pudo eliminar la lista global.'
    );
  }
};
