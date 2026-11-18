import { CENSUS_DEFAULT_RECIPIENTS } from '@/constants/email';
import { resolveFailedApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import type { CensusEmailBrowserRuntime } from '@/features/census/email/controllers/censusEmailBrowserRuntimeController';
import { resolveLegacyRecipients, resolveStoredRecipients } from '@/application/census/public';
import {
  CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST,
  ensureGlobalEmailRecipientList,
  getGlobalEmailRecipientListsWithResult,
  type GlobalEmailRecipientList,
} from '@/services/email/emailRecipientListService';
import { getSetting, saveSetting } from '@/services/storage/indexeddb/indexedDbSettingsService';
import { censusEmailBootstrapLogger } from '@/hooks/controllers/hookControllerLoggers';

export interface CensusEmailRecipientsBootstrapResult {
  recipients: string[];
  recipientsSource: 'firebase' | 'local' | 'default';
  recipientLists: GlobalEmailRecipientList[];
  activeRecipientList: GlobalEmailRecipientList | null;
  syncError: string | null;
}

interface ResolveCensusRecipientsBootstrapParams {
  canManageGlobalRecipientLists: boolean;
  browserRuntime: CensusEmailBrowserRuntime;
  activeListStorageKey: string;
  user: { uid?: string; email?: string | null } | null;
}

const getDefaultBootstrapResult = (): CensusEmailRecipientsBootstrapResult => ({
  recipients: CENSUS_DEFAULT_RECIPIENTS,
  recipientsSource: 'default',
  recipientLists: [],
  activeRecipientList: null,
  syncError: null,
});

const resolvePreferredActiveList = (
  lists: GlobalEmailRecipientList[],
  storedActiveListId: string | null
): GlobalEmailRecipientList | null => {
  if (lists.length === 0) {
    return null;
  }

  if (storedActiveListId) {
    const storedList = lists.find(list => list.id === storedActiveListId);
    if (storedList) {
      return storedList;
    }
  }

  return lists.find(list => list.id === CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id) ?? lists[0] ?? null;
};

const resolveRecipientListOutcomeErrorMessage = (
  fallback: string,
  input: {
    status: string;
    issues?: Array<{ userSafeMessage?: string; message?: string }>;
    userSafeMessage?: string;
  }
): string | null => {
  return resolveFailedApplicationOutcomeMessage(input, fallback);
};

export const resolveCensusRecipientsBootstrap = async ({
  canManageGlobalRecipientLists,
  browserRuntime,
  activeListStorageKey,
  user,
}: ResolveCensusRecipientsBootstrapParams): Promise<CensusEmailRecipientsBootstrapResult> => {
  const stored = await getSetting<string[] | null>('censusEmailRecipients', null);
  const storedRecipients = resolveStoredRecipients(stored);

  if (!canManageGlobalRecipientLists) {
    return storedRecipients
      ? {
          recipients: storedRecipients,
          recipientsSource: 'local',
          recipientLists: [],
          activeRecipientList: null,
          syncError: null,
        }
      : getDefaultBootstrapResult();
  }

  const storedActiveListId = await getSetting<string | null>(activeListStorageKey, null);
  let seedRecipients = storedRecipients ?? null;

  if (!seedRecipients) {
    const legacyRecipients = resolveLegacyRecipients(browserRuntime.getLegacyRecipients());
    if (legacyRecipients) {
      seedRecipients = legacyRecipients;
      await saveSetting('censusEmailRecipients', legacyRecipients);
      browserRuntime.clearLegacyRecipients();
    }
  }

  try {
    const listResult = await getGlobalEmailRecipientListsWithResult();
    const listResultError = resolveRecipientListOutcomeErrorMessage(
      'No se pudo cargar la lista global en Firebase.',
      listResult
    );
    if (listResultError) {
      throw new Error(listResultError);
    }
    let lists = listResult.data;
    if (lists.length === 0) {
      await ensureGlobalEmailRecipientList({
        listId: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id,
        name: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.name,
        description: CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.description,
        recipients: seedRecipients ?? CENSUS_DEFAULT_RECIPIENTS,
        updatedByUid: user?.uid ?? null,
        updatedByEmail: user?.email ?? null,
      });
      const refreshResult = await getGlobalEmailRecipientListsWithResult();
      const refreshResultError = resolveRecipientListOutcomeErrorMessage(
        'No se pudo cargar la lista global en Firebase.',
        refreshResult
      );
      if (refreshResultError) {
        throw new Error(refreshResultError);
      }
      lists = refreshResult.data;
    }

    const activeRecipientList = resolvePreferredActiveList(lists, storedActiveListId);
    if (activeRecipientList) {
      return {
        recipients: activeRecipientList.recipients,
        recipientsSource: 'firebase',
        recipientLists: lists,
        activeRecipientList,
        syncError: null,
      };
    }
  } catch (error) {
    censusEmailBootstrapLogger.warn('Failed to load global recipient lists', error);
    return {
      recipients: storedRecipients ?? CENSUS_DEFAULT_RECIPIENTS,
      recipientsSource: storedRecipients ? 'local' : 'default',
      recipientLists: [],
      activeRecipientList: null,
      syncError: 'No se pudo cargar la lista global en Firebase. Se usara la copia local.',
    };
  }

  return storedRecipients
    ? {
        recipients: storedRecipients,
        recipientsSource: 'local',
        recipientLists: [],
        activeRecipientList: null,
        syncError: null,
      }
    : getDefaultBootstrapResult();
};
