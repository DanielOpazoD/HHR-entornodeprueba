import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';

const upsertRecipientListState = (
  previousLists: GlobalEmailRecipientList[],
  nextList: GlobalEmailRecipientList
): GlobalEmailRecipientList[] => {
  const existingIndex = previousLists.findIndex(list => list.id === nextList.id);
  if (existingIndex === -1) {
    return [nextList, ...previousLists];
  }

  const updatedLists = [...previousLists];
  updatedLists[existingIndex] = nextList;
  return updatedLists;
};

export const resolveRecipientListForSelection = (
  recipientLists: GlobalEmailRecipientList[],
  listId: string
): GlobalEmailRecipientList | undefined => recipientLists.find(list => list.id === listId);

export const resolveRecipientListsAfterDelete = (
  recipientLists: GlobalEmailRecipientList[],
  listId: string
): GlobalEmailRecipientList[] => recipientLists.filter(list => list.id !== listId);

export const resolveRecipientListsAfterCreate = (
  recipientLists: GlobalEmailRecipientList[],
  nextList: GlobalEmailRecipientList
): {
  recipientLists: GlobalEmailRecipientList[];
  activeRecipientList: GlobalEmailRecipientList;
} => ({
  recipientLists: upsertRecipientListState(recipientLists, nextList),
  activeRecipientList: nextList,
});

export const resolveRecipientListsAfterRename = (
  recipientLists: GlobalEmailRecipientList[],
  nextList: GlobalEmailRecipientList
): GlobalEmailRecipientList[] => upsertRecipientListState(recipientLists, nextList);

export const resolveRecipientSelectionAfterDelete = ({
  recipientLists,
  listId,
  fallbackList,
}: {
  recipientLists: GlobalEmailRecipientList[];
  listId: string;
  fallbackList?: GlobalEmailRecipientList | null;
}): { recipientLists: GlobalEmailRecipientList[]; activeRecipientListId: string | null } => ({
  recipientLists: resolveRecipientListsAfterDelete(recipientLists, listId),
  activeRecipientListId: fallbackList?.id ?? null,
});
