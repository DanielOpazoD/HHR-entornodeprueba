import type { Bookmark, BookmarkInput } from '@/types/bookmarks';

export interface BookmarkEditorFormState {
  name: string;
  url: string;
  icon: string;
  notes: string;
}

export const DEFAULT_BOOKMARK_ICON = '🔗';

export const createBookmarkEditorInitialState = (
  initialData?: Bookmark
): BookmarkEditorFormState => {
  if (!initialData) {
    return {
      name: '',
      url: '',
      icon: DEFAULT_BOOKMARK_ICON,
      notes: '',
    };
  }

  return {
    name: initialData.name,
    url: initialData.url,
    icon: initialData.icon || DEFAULT_BOOKMARK_ICON,
    notes: initialData.notes || '',
  };
};

export const normalizeBookmarkUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

export const buildBookmarkInput = (state: BookmarkEditorFormState): BookmarkInput => ({
  name: state.name,
  url: normalizeBookmarkUrl(state.url),
  icon: state.icon,
  notes: state.notes,
});
