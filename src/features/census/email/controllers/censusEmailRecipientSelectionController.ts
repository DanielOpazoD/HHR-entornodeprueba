import { CENSUS_DEFAULT_RECIPIENTS } from '@/constants/email';
import {
  CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST,
  type GlobalEmailRecipientList,
} from '@/services/email/emailRecipientListSupport';
import { resolveStoredRecipients } from '@/application/census/public';

export type CensusRecipientSelectionSource = 'firebase' | 'local' | 'default';

export interface CensusRecipientSelectionState {
  recipients: string[];
  recipientsSource: CensusRecipientSelectionSource;
  activeRecipientListId: string;
}

export interface BootstrapRecipientSelectionState extends CensusRecipientSelectionState {
  recipientLists: GlobalEmailRecipientList[];
  lastRemoteRecipients: string[] | null;
}

export const resolveStoredRecipientSelection = (
  storedRecipients: string[] | null,
  storedActiveListId?: string | null
): CensusRecipientSelectionState => {
  const resolvedStoredRecipients = resolveStoredRecipients(storedRecipients);
  return {
    recipients: resolvedStoredRecipients ?? CENSUS_DEFAULT_RECIPIENTS,
    recipientsSource: resolvedStoredRecipients ? 'local' : 'default',
    activeRecipientListId: storedActiveListId ?? CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id,
  };
};

export const resolveBootstrapRecipientSelection = (input: {
  recipientLists: GlobalEmailRecipientList[];
  activeRecipientList: GlobalEmailRecipientList | null;
  recipients: string[];
  recipientsSource: CensusRecipientSelectionSource;
  syncError: string | null;
}): BootstrapRecipientSelectionState => {
  if (input.activeRecipientList) {
    return {
      recipientLists: input.recipientLists,
      recipients: input.activeRecipientList.recipients,
      recipientsSource: 'firebase',
      activeRecipientListId: input.activeRecipientList.id,
      lastRemoteRecipients: input.activeRecipientList.recipients,
    };
  }

  return {
    recipientLists: input.recipientLists,
    recipients: input.recipients,
    recipientsSource: input.recipientsSource,
    activeRecipientListId: input.recipientLists[0]?.id ?? CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id,
    lastRemoteRecipients: null,
  };
};
