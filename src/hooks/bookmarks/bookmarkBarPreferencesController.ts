export type BookmarkBarAlignment = 'left' | 'center' | 'right' | 'custom';

export const resolveBookmarkBarAlignmentClass = (alignment: BookmarkBarAlignment): string => {
  switch (alignment) {
    case 'left':
      return 'justify-start';
    case 'center':
      return 'justify-center';
    case 'right':
      return 'justify-end';
    case 'custom':
      return '';
    default:
      return 'justify-start';
  }
};

export const clampBookmarkBarOffset = (offset: number): number => {
  if (Number.isNaN(offset)) return 0;
  return Math.max(0, Math.min(80, offset));
};
