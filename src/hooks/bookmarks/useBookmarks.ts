import { useCallback, useEffect, useState } from 'react';
import type { Bookmark, BookmarkInput } from '@/types/bookmarks';
import {
  addBookmark,
  exportBookmarksToJson,
  subscribeToBookmarks,
  updateBookmark,
} from '@/services/bookmarks/bookmarkService';

export const useBookmarks = () => {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToBookmarks(setBookmarks);
    return () => unsubscribe();
  }, []);

  const saveBookmark = useCallback(
    async (input: BookmarkInput, editingBookmark?: Bookmark) => {
      if (editingBookmark) {
        await updateBookmark(editingBookmark.id, input);
      } else {
        await addBookmark(input, bookmarks.length);
      }
    },
    [bookmarks.length]
  );

  const exportBookmarks = useCallback(() => {
    exportBookmarksToJson();
  }, []);

  return {
    bookmarks,
    saveBookmark,
    exportBookmarks,
  };
};
