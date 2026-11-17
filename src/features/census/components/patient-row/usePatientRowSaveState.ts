import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { PatientRowSaveResult } from './inputCellTypes';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

/** UI state only: the existing daily-record authority owns persistence and ordering. */
export const usePatientRowSaveState = (scopeKey: string) => {
  const activeRef = useRef<{ scopeKey: string; request: object | null }>({
    scopeKey,
    request: null,
  });
  const [status, setStatus] = useState<'ready' | 'saving' | 'failed'>('ready');

  // A new scope starts ready; a save still running for the old one no longer reports here.
  if (useChangedOnRender([scopeKey])) setStatus('ready');
  useLayoutEffect(() => {
    const active = { scopeKey, request: null };
    activeRef.current = active;
    return () => {
      if (activeRef.current === active) activeRef.current.request = null;
    };
  }, [scopeKey]);

  const save = useCallback(
    async (operation: () => PatientRowSaveResult): Promise<boolean> => {
      const active = activeRef.current;
      if (active.scopeKey !== scopeKey || active.request) return false;
      const request = {};
      active.request = request;
      setStatus('saving');
      try {
        const confirmed = (await operation()) === true;
        if (activeRef.current !== active || active.request !== request) return false;
        setStatus(confirmed ? 'ready' : 'failed');
        return confirmed;
      } catch {
        if (activeRef.current === active && active.request === request) setStatus('failed');
        return false;
      } finally {
        if (activeRef.current === active && active.request === request) active.request = null;
      }
    },
    [scopeKey]
  );

  return { save, isSaving: status === 'saving', failed: status === 'failed' };
};
