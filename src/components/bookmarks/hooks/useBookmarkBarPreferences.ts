import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  saveBookmarkPreferences,
  subscribeToBookmarkPreferences,
} from '@/services/bookmarks/bookmarkService';
import {
  BookmarkBarAlignment,
  clampBookmarkBarOffset,
  resolveBookmarkBarAlignmentClass,
} from '@/components/bookmarks/controllers/bookmarkBarPreferencesController';

const SAVE_DEBOUNCE_MS = 500;

interface UseBookmarkBarPreferencesResult {
  alignment: BookmarkBarAlignment;
  customOffset: number;
  alignmentClass: string;
  customPaddingStyle: CSSProperties | undefined;
  setAlignmentPreference: (nextAlignment: BookmarkBarAlignment) => void;
  setCustomOffsetPreference: (nextOffset: number) => void;
}

export const useBookmarkBarPreferences = (): UseBookmarkBarPreferencesResult => {
  const [alignment, setAlignment] = useState<BookmarkBarAlignment>('left');
  const [customOffset, setCustomOffset] = useState(50);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToBookmarkPreferences(prefs => {
      setAlignment(prefs.alignment);
      setCustomOffset(clampBookmarkBarOffset(prefs.customOffset));
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const savePreferences = useCallback((nextAlignment: BookmarkBarAlignment, nextOffset: number) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveBookmarkPreferences({ alignment: nextAlignment, customOffset: nextOffset });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const setAlignmentPreference = useCallback(
    (nextAlignment: BookmarkBarAlignment) => {
      setAlignment(nextAlignment);
      savePreferences(nextAlignment, customOffset);
    },
    [customOffset, savePreferences]
  );

  const setCustomOffsetPreference = useCallback(
    (nextOffset: number) => {
      const clampedOffset = clampBookmarkBarOffset(nextOffset);
      setCustomOffset(clampedOffset);
      savePreferences(alignment, clampedOffset);
    },
    [alignment, savePreferences]
  );

  const alignmentClass = useMemo(() => resolveBookmarkBarAlignmentClass(alignment), [alignment]);

  const customPaddingStyle =
    alignment === 'custom' ? { paddingLeft: `${customOffset}%` } : undefined;

  return {
    alignment,
    customOffset,
    alignmentClass,
    customPaddingStyle,
    setAlignmentPreference,
    setCustomOffsetPreference,
  };
};
