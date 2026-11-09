import { firestoreDb } from '@/services/storage/firestore';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { classifySyncError } from '@/services/storage/syncErrorCatalog';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import {
  buildEnsuredGlobalEmailRecipientList,
  buildGlobalEmailRecipientListId,
  CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST,
  EMAIL_RECIPIENT_LISTS_COLLECTION,
  GLOBAL_EMAIL_RECIPIENT_LIST_QUERY,
  normalizeGlobalEmailRecipientList,
  normalizeGlobalEmailRecipientLists,
  normalizeGlobalEmailRecipients,
  normalizeListName,
  normalizeString,
  areGlobalEmailRecipientsEqual,
  type GlobalEmailRecipientList,
  type SaveGlobalEmailRecipientListInput,
} from '@/services/email/emailRecipientListSupport';

export {
  areGlobalEmailRecipientsEqual,
  buildGlobalEmailRecipientListId,
  CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST,
  normalizeGlobalEmailRecipients,
  type GlobalEmailRecipientList,
};

type GlobalEmailRecipientListOutcome<T> = ApplicationOutcome<T>;

export const getGlobalEmailRecipientList = async (
  listId: string
): Promise<GlobalEmailRecipientList | null> => {
  const result = await getGlobalEmailRecipientListWithResult(listId);
  return result.status === 'success' ? result.data : null;
};

export const getGlobalEmailRecipientListWithResult = async (
  listId: string
): Promise<GlobalEmailRecipientListOutcome<GlobalEmailRecipientList | null>> => {
  try {
    const raw = await firestoreDb.getDoc<Partial<GlobalEmailRecipientList>>(
      EMAIL_RECIPIENT_LISTS_COLLECTION,
      listId
    );
    return createApplicationSuccess(normalizeGlobalEmailRecipientList(listId, raw));
  } catch (error) {
    recordOperationalErrorTelemetry('integration', 'get_global_email_recipient_list', error, {
      code: 'email_recipient_list_fetch_failed',
      message: 'Failed to fetch global recipient list.',
      severity: 'error',
      context: { listId },
      userSafeMessage: 'No se pudo cargar la lista global de destinatarios.',
    });
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: 'No se pudo cargar la lista global de destinatarios.',
        userSafeMessage: 'No se pudo cargar la lista global de destinatarios.',
      },
    ]);
  }
};

export const getGlobalEmailRecipientLists = async (): Promise<GlobalEmailRecipientList[]> => {
  const result = await getGlobalEmailRecipientListsWithResult();
  return result.status === 'success' ? result.data : [];
};

export const getGlobalEmailRecipientListsWithResult = async (): Promise<
  GlobalEmailRecipientListOutcome<GlobalEmailRecipientList[]>
> => {
  try {
    const rawLists = await firestoreDb.getDocs<Partial<GlobalEmailRecipientList>>(
      EMAIL_RECIPIENT_LISTS_COLLECTION,
      GLOBAL_EMAIL_RECIPIENT_LIST_QUERY
    );

    return createApplicationSuccess(normalizeGlobalEmailRecipientLists(rawLists));
  } catch (error) {
    recordOperationalErrorTelemetry('integration', 'get_global_email_recipient_lists', error, {
      code: 'email_recipient_lists_fetch_failed',
      message: 'Failed to fetch global recipient lists.',
      // A denied read means the session lost access; the session guard handles and explains
      // that, and a mail cannot fix it. Logged as degraded, not mailed as a failure.
      severity: classifySyncError(error).category === 'authorization' ? 'warning' : 'error',
      userSafeMessage: 'No se pudieron cargar las listas globales de destinatarios.',
    });
    return createApplicationFailed(
      [],
      [
        {
          kind: 'unknown',
          message: 'No se pudieron cargar las listas globales de destinatarios.',
          userSafeMessage: 'No se pudieron cargar las listas globales de destinatarios.',
        },
      ]
    );
  }
};

export const saveGlobalEmailRecipientList = async ({
  listId,
  name,
  description = null,
  recipients,
  updatedByUid = null,
  updatedByEmail = null,
}: SaveGlobalEmailRecipientListInput): Promise<void> => {
  const result = await saveGlobalEmailRecipientListWithResult({
    listId,
    name,
    description,
    recipients,
    updatedByUid,
    updatedByEmail,
  });
  if (result.status !== 'success') {
    throw new Error(
      resolveApplicationOutcomeMessage(result, 'No se pudo guardar la lista global.')
    );
  }
};

export const saveGlobalEmailRecipientListWithResult = async ({
  listId,
  name,
  description = null,
  recipients,
  updatedByUid = null,
  updatedByEmail = null,
}: SaveGlobalEmailRecipientListInput): Promise<
  GlobalEmailRecipientListOutcome<{ saved: boolean }>
> => {
  const normalizedNow = new Date().toISOString();
  try {
    await firestoreDb.setDoc<GlobalEmailRecipientList>(EMAIL_RECIPIENT_LISTS_COLLECTION, listId, {
      id: listId,
      name: normalizeListName(name),
      description: normalizeString(description),
      recipients: normalizeGlobalEmailRecipients(recipients),
      scope: 'global',
      updatedAt: normalizedNow,
      updatedByUid: normalizeString(updatedByUid),
      updatedByEmail: normalizeString(updatedByEmail),
    });
    return createApplicationSuccess({ saved: true });
  } catch (error) {
    recordOperationalErrorTelemetry('integration', 'save_global_email_recipient_list', error, {
      code: 'email_recipient_list_save_failed',
      message: 'Failed to save global recipient list.',
      severity: 'error',
      context: { listId },
      userSafeMessage: 'No se pudo guardar la lista global de destinatarios.',
    });
    return createApplicationFailed({ saved: false }, [
      {
        kind: 'unknown',
        message: 'No se pudo guardar la lista global de destinatarios.',
        userSafeMessage: 'No se pudo guardar la lista global de destinatarios.',
      },
    ]);
  }
};

export const deleteGlobalEmailRecipientList = async (listId: string): Promise<void> => {
  const result = await deleteGlobalEmailRecipientListWithResult(listId);
  if (result.status !== 'success') {
    throw new Error(
      resolveApplicationOutcomeMessage(result, 'No se pudo eliminar la lista global.')
    );
  }
};

export const deleteGlobalEmailRecipientListWithResult = async (
  listId: string
): Promise<GlobalEmailRecipientListOutcome<{ deleted: boolean }>> => {
  try {
    await firestoreDb.deleteDoc(EMAIL_RECIPIENT_LISTS_COLLECTION, listId);
    return createApplicationSuccess({ deleted: true });
  } catch (error) {
    recordOperationalErrorTelemetry('integration', 'delete_global_email_recipient_list', error, {
      code: 'email_recipient_list_delete_failed',
      message: 'Failed to delete global recipient list.',
      severity: 'error',
      context: { listId },
      userSafeMessage: 'No se pudo eliminar la lista global de destinatarios.',
    });
    return createApplicationFailed({ deleted: false }, [
      {
        kind: 'unknown',
        message: 'No se pudo eliminar la lista global de destinatarios.',
        userSafeMessage: 'No se pudo eliminar la lista global de destinatarios.',
      },
    ]);
  }
};

export const ensureGlobalEmailRecipientList = async (
  input: SaveGlobalEmailRecipientListInput
): Promise<GlobalEmailRecipientList> => {
  const existing = await getGlobalEmailRecipientList(input.listId);
  if (existing) {
    return existing;
  }

  await saveGlobalEmailRecipientList(input);

  return {
    ...buildEnsuredGlobalEmailRecipientList(input),
  };
};

export const subscribeToGlobalEmailRecipientList = (
  listId: string,
  onUpdate: (list: GlobalEmailRecipientList | null) => void
): (() => void) =>
  firestoreDb.subscribeDoc<Partial<GlobalEmailRecipientList>>(
    EMAIL_RECIPIENT_LISTS_COLLECTION,
    listId,
    data => onUpdate(normalizeGlobalEmailRecipientList(listId, data))
  );

export const subscribeToGlobalEmailRecipientLists = (
  onUpdate: (lists: GlobalEmailRecipientList[]) => void
): (() => void) =>
  firestoreDb.subscribeQuery<Partial<GlobalEmailRecipientList>>(
    EMAIL_RECIPIENT_LISTS_COLLECTION,
    GLOBAL_EMAIL_RECIPIENT_LIST_QUERY,
    rawLists => onUpdate(normalizeGlobalEmailRecipientLists(rawLists))
  );
