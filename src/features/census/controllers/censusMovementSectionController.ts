import type { CensusMovementSectionModel } from '../types/censusMovementSectionModelTypes';

export const resolveMovementSectionState = <TItem>(
  items: TItem[] | null | undefined
): CensusMovementSectionModel<TItem> => {
  if (items === null) {
    return {
      isRenderable: false,
      isEmpty: true,
      items: [],
    };
  }

  const safeItems = items || [];

  return {
    isRenderable: true,
    isEmpty: safeItems.length === 0,
    items: safeItems,
  };
};
