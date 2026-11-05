import { useEffect, useSyncExternalStore } from 'react';

export interface ClinicalExplorerSelection {
  /** Census day the explorer was opened from. It never changes while the explorer is open. */
  censusDate: string;
  bedId: string;
}

// Memory only: several people share one computer, so a reload never reopens someone else's view.
let selection: ClinicalExplorerSelection | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = (): ClinicalExplorerSelection | null => selection;
const readServer = (): ClinicalExplorerSelection | null => null;

export const openClinicalExplorer = (next: ClinicalExplorerSelection): void => {
  selection = next;
  emit();
};

export const selectClinicalExplorerBed = (bedId: string): void => {
  if (!selection || selection.bedId === bedId) return;
  selection = { ...selection, bedId };
  emit();
};

export const closeClinicalExplorer = (): void => {
  if (!selection) return;
  selection = null;
  emit();
};

/** Changing the census day leaves the explorer: it belongs to the day it was opened from. */
export const useClinicalExplorerSelection = (
  censusDate: string
): ClinicalExplorerSelection | null => {
  const current = useSyncExternalStore(subscribe, read, readServer);
  const matches = current?.censusDate === censusDate;
  useEffect(() => {
    if (current && !matches) closeClinicalExplorer();
  }, [current, matches]);
  return matches ? current : null;
};

if (typeof window !== 'undefined') {
  // setSessionGeneration posts this on every admission and logout: the next person starts in
  // the census. Closing is always safe, so the sender is not checked.
  window.addEventListener('message', event => {
    if (event.data?.type === 'HHR_RAYEN_SESSION_CHANGED') closeClinicalExplorer();
  });
}
