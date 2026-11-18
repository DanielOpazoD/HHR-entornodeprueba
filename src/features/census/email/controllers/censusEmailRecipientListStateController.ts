import type { GlobalEmailRecipientList } from '@/services/email/emailRecipientListService';

export const upsertRecipientListState = (
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
