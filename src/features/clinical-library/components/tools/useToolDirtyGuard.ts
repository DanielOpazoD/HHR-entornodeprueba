import { useEffect } from 'react';

/**
 * Syncs tool dirty state with its container (drawer exit confirmation) and arms a
 * `beforeunload` guard while unsaved form data exists.
 */
export const useToolDirtyGuard = (dirty: boolean, onDirtyChange?: (dirty: boolean) => void) => {
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty]);
};
