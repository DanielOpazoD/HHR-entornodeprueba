import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';
import {
  resolveRecipientListsAfterCreate,
  resolveRecipientListsAfterRename,
  resolveRecipientSelectionAfterDelete,
} from './censusEmailRecipientMutationController';
import {
  resolveActiveRecipientRuntimeState,
  type RecipientRuntimeState,
} from './censusEmailRecipientRuntimeController';

export const resolveRecipientRuntimeAfterCreate = (
  recipientLists: GlobalEmailRecipientList[],
  nextList: GlobalEmailRecipientList
): RecipientRuntimeState => {
  const nextState = resolveRecipientListsAfterCreate(recipientLists, nextList);
  return resolveActiveRecipientRuntimeState(
    nextState.recipientLists,
    nextState.activeRecipientList
  );
};

export const resolveRecipientRuntimeAfterRename = (
  recipientLists: GlobalEmailRecipientList[],
  nextList: GlobalEmailRecipientList
): RecipientRuntimeState => {
  const nextRecipientLists = resolveRecipientListsAfterRename(recipientLists, nextList);
  return resolveActiveRecipientRuntimeState(nextRecipientLists, nextList);
};

export const resolveRecipientRuntimeAfterDelete = (input: {
  recipientLists: GlobalEmailRecipientList[];
  listId: string;
  fallbackList: GlobalEmailRecipientList;
}): RecipientRuntimeState => {
  const nextState = resolveRecipientSelectionAfterDelete({
    recipientLists: input.recipientLists,
    listId: input.listId,
    fallbackList: input.fallbackList,
  });
  return resolveActiveRecipientRuntimeState(nextState.recipientLists, input.fallbackList);
};

export const resolveRecipientRuntimeAfterDeleteOutcome = (input: {
  recipientLists: GlobalEmailRecipientList[];
  listId: string;
  fallbackList?: GlobalEmailRecipientList | null;
}): RecipientRuntimeState | null => {
  if (!input.fallbackList) {
    return null;
  }

  return resolveRecipientRuntimeAfterDelete({
    recipientLists: input.recipientLists,
    listId: input.listId,
    fallbackList: input.fallbackList,
  });
};
