export interface CensusMovementSectionState<TItem> {
  isRenderable: boolean;
  isEmpty: boolean;
  items: TItem[];
}

export const resolveMovementSectionState = <TItem>(
  items: TItem[] | null | undefined
): CensusMovementSectionState<TItem> => {
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
