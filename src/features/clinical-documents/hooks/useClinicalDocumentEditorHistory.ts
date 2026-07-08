/**
 * useClinicalDocumentEditorHistory
 *
 * Owns the rich-text editor's undo/redo buffer: the snapshot stack, the
 * debounced snapshot push, and the can-undo/can-redo state. Extracted from
 * {@link useClinicalDocumentRichTextEditorController} to keep that hook within
 * the module size budget. All buffer refs stay internal; the controller drives
 * it through stable method callbacks so the React Compiler / exhaustive-deps can
 * reason about it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { normalizeClinicalDocumentContentForStorage } from '@/features/clinical-documents/controllers/clinicalDocumentRichTextController';

const HISTORY_DEBOUNCE_MS = 500;

export interface ClinicalDocumentEditorHistory {
  historyState: { canUndo: boolean; canRedo: boolean };
  /** Resets the buffer to a single entry (external value load / blur sync). */
  seedHistory: (html: string) => void;
  /**
   * Moves the cursor and returns the snapshot to apply, or `null` if there is
   * nothing to undo/redo. Flags the move so the next external-value sync does
   * not treat it as a foreign change.
   */
  navigateHistory: (direction: 'undo' | 'redo') => string | null;
  /** Reads and clears the "currently applying history" flag. */
  consumeApplyingFlag: () => boolean;
  pushHistorySnapshot: (html: string) => void;
  debouncedPushHistorySnapshot: (html: string) => void;
  flushPendingHistorySnapshot: () => void;
}

export const useClinicalDocumentEditorHistory = (): ClinicalDocumentEditorHistory => {
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const isApplyingHistoryRef = useRef(false);
  const historyDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHistoryHtmlRef = useRef<string | null>(null);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  const updateHistoryState = useCallback(() => {
    const index = historyIndexRef.current;
    const length = historyRef.current.length;
    setHistoryState({ canUndo: index > 0, canRedo: index >= 0 && index < length - 1 });
  }, []);

  const seedHistory = useCallback(
    (html: string) => {
      historyRef.current = [html];
      historyIndexRef.current = 0;
      updateHistoryState();
    },
    [updateHistoryState]
  );

  const consumeApplyingFlag = useCallback(() => {
    const wasApplying = isApplyingHistoryRef.current;
    isApplyingHistoryRef.current = false;
    return wasApplying;
  }, []);

  const navigateHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      const index = historyIndexRef.current;
      if (direction === 'undo' ? index <= 0 : index >= historyRef.current.length - 1) {
        return null;
      }
      historyIndexRef.current = direction === 'undo' ? index - 1 : index + 1;
      isApplyingHistoryRef.current = true;
      updateHistoryState();
      return historyRef.current[historyIndexRef.current] ?? '';
    },
    [updateHistoryState]
  );

  const pushHistorySnapshot = useCallback(
    (html: string) => {
      const normalizedHtml = normalizeClinicalDocumentContentForStorage(html);
      if (normalizedHtml === historyRef.current[historyIndexRef.current]) {
        return;
      }
      historyRef.current = [
        ...historyRef.current.slice(0, historyIndexRef.current + 1),
        normalizedHtml,
      ];
      historyIndexRef.current = historyRef.current.length - 1;
      updateHistoryState();
    },
    [updateHistoryState]
  );

  const flushPendingHistorySnapshot = useCallback(() => {
    if (historyDebounceTimerRef.current) {
      clearTimeout(historyDebounceTimerRef.current);
      historyDebounceTimerRef.current = null;
    }
    const pending = pendingHistoryHtmlRef.current;
    if (pending !== null) {
      pendingHistoryHtmlRef.current = null;
      pushHistorySnapshot(pending);
    }
  }, [pushHistorySnapshot]);

  const debouncedPushHistorySnapshot = useCallback(
    (html: string) => {
      pendingHistoryHtmlRef.current = html;
      if (historyDebounceTimerRef.current) {
        clearTimeout(historyDebounceTimerRef.current);
      }
      historyDebounceTimerRef.current = setTimeout(() => {
        historyDebounceTimerRef.current = null;
        pendingHistoryHtmlRef.current = null;
        pushHistorySnapshot(html);
      }, HISTORY_DEBOUNCE_MS);
    },
    [pushHistorySnapshot]
  );

  // Clean up the debounced snapshot on unmount. Switching documents re-keys the
  // editor subtree, which unmounts WITHOUT firing blur; without this the 500ms
  // timer survives and fires after unmount, doing wasted work (and, on older
  // React, a setState-after-unmount warning). We DISCARD rather than flush: this
  // instance's history is about to be thrown away, and content is never lost
  // because the controller's `onChange` already runs eagerly on every edit.
  useEffect(
    () => () => {
      if (historyDebounceTimerRef.current) {
        clearTimeout(historyDebounceTimerRef.current);
        historyDebounceTimerRef.current = null;
      }
      pendingHistoryHtmlRef.current = null;
    },
    []
  );

  return {
    historyState,
    seedHistory,
    navigateHistory,
    consumeApplyingFlag,
    pushHistorySnapshot,
    debouncedPushHistorySnapshot,
    flushPendingHistorySnapshot,
  };
};
