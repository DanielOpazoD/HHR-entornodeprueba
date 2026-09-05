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
