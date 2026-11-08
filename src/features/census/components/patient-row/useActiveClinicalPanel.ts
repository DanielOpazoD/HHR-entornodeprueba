import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

// One owner across census rows (including clinical cribs), without caching clinical snapshots.
let activePanel: symbol | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const activate = (owner: symbol | null): void => {
  if (activePanel === owner) return;
  activePanel = owner;
  listeners.forEach(listener => listener());
};

export const useActiveClinicalPanel = (identity: string) => {
  const owner = useMemo(() => Symbol(identity), [identity]);
  // Boolean snapshots rerender only the old and new owners, not every census row.
  const isOpen = useSyncExternalStore(
    subscribe,
    () => activePanel === owner,
    () => false
  );
  const close = useCallback(() => {
    if (activePanel === owner) activate(null);
  }, [owner]);
  const open = useCallback(() => activate(owner), [owner]);
  useEffect(() => close, [close]);
  return { isOpen, open, close };
};

// Each mounted panel registers how to open it, so the «Accesos» ring and the drawer's
// previous/next arrows open a patient's panel without clicking a row button.
const openersByKey = new Map<string, () => void>();

export const useClinicalPanelOpener = (key: string | null, open: () => void): void => {
  useEffect(() => {
    if (!key) return;
    openersByKey.set(key, open);
    return () => {
      if (openersByKey.get(key) === open) openersByKey.delete(key);
    };
  }, [key, open]);
};

/** Opens the mounted panel registered under `key`; false when no row offers it. */
export const openClinicalPanel = (key: string): boolean => {
  const open = openersByKey.get(key);
  open?.();
  return Boolean(open);
};
