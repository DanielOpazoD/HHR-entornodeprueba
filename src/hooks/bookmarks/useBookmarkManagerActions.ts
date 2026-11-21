import { useCallback } from 'react';
import type { Bookmark } from '@/types/bookmarks';
import { deleteBookmark, reorderBookmarks } from '@/services/bookmarks/bookmarkService';

export const useBookmarkManagerActions = () => {
  const saveBookmarkOrder = useCallback(async (bookmarks: Bookmark[]) => {
    await reorderBookmarks(bookmarks);
  }, []);

  const removeBookmark = useCallback(async (id: string) => {
    await deleteBookmark(id);
  }, []);

  return {
    saveBookmarkOrder,
    removeBookmark,
  };
};
