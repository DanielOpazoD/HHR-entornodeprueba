import {
  areGlobalEmailRecipientsEqual,
  CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST,
  type GlobalEmailRecipientList,
} from '@/services/email/emailRecipientListSupport';
import { buildRecipientListSavePayload } from '@/hooks/controllers/censusEmailRecipientListController';

interface RecipientSyncActor {
  uid?: string;
  email?: string | null;
}

export interface DeferredRecipientSyncInput {
  canManageGlobalRecipientLists: boolean;
  recipientsReady: boolean;
  recipients: string[];
  lastRemoteRecipients: string[] | null;
  recipientLists: GlobalEmailRecipientList[];
  activeRecipientListId: string;
  actor: RecipientSyncActor | null;
}

export const shouldSkipRecipientSync = (input: {
  canManageGlobalRecipientLists: boolean;
  recipientsReady: boolean;
  recipients: string[];
  lastRemoteRecipients: string[] | null;
}): boolean =>
  !input.canManageGlobalRecipientLists ||
  !input.recipientsReady ||
  areGlobalEmailRecipientsEqual(input.recipients, input.lastRemoteRecipients);

export const resolveActiveRecipientListForSync = (
  recipientLists: GlobalEmailRecipientList[],
  activeRecipientListId: string
): GlobalEmailRecipientList | null =>
  recipientLists.find(list => list.id === activeRecipientListId) ??
  recipientLists.find(list => list.id === CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id) ??
  null;

export const buildRecipientSyncPayload = (input: {
  activeList: GlobalEmailRecipientList | null;
  recipients: string[];
  actor: RecipientSyncActor | null;
}) =>
  buildRecipientListSavePayload({
    listId: input.activeList?.id ?? CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.id,
    name: input.activeList?.name ?? CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.name,
    description: input.activeList?.description ?? CENSUS_GLOBAL_EMAIL_RECIPIENT_LIST.description,
    recipients: input.recipients,
    actor: input.actor,
  });

export const resolveDeferredRecipientSyncInput = (
  input: DeferredRecipientSyncInput
): DeferredRecipientSyncInput | null =>
  shouldSkipRecipientSync({
    canManageGlobalRecipientLists: input.canManageGlobalRecipientLists,
    recipientsReady: input.recipientsReady,
    recipients: input.recipients,
    lastRemoteRecipients: input.lastRemoteRecipients,
  })
    ? null
    : input;
