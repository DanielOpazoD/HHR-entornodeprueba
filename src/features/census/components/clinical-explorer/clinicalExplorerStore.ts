import { useEffect, useSyncExternalStore } from 'react';

export interface ClinicalExplorerSelection {
  /** Census day the explorer was opened from. It never changes while the explorer is open. */
  censusDate: string;
  bedId: string;
}

// Memory only: several people share one computer, so a reload never reopens someone else's view.
let selection: ClinicalExplorerSelection | null = null;
let opener: HTMLElement | null = null;
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
  const active = typeof document === 'undefined' ? null : document.activeElement;
  opener = active instanceof HTMLElement && active !== document.body ? active : null;
  selection = next;
  emit();
};

const isReachable = (element: HTMLElement | null | undefined): element is HTMLElement =>
  Boolean(element?.isConnected && !element.closest('[hidden]'));

/**
 * Focus returns to whoever opened the explorer, else to the row's clinical trigger or the «⋯»
 * menu. Call it once the census is visible again, with the opener that close() handed back.
 */
export const restoreClinicalExplorerFocus = (bedId: string, from: HTMLElement | null): void => {
  const target = [
    from,
    document.querySelector<HTMLElement>(`[data-testid="clinical-panel-trigger-${bedId}"]`),
    document.querySelector<HTMLElement>('[aria-label="Más opciones del censo"]'),
  ].find(isReachable);
  target?.focus();
};

export const selectClinicalExplorerBed = (bedId: string): void => {
  if (!selection || selection.bedId === bedId) return;
  selection = { ...selection, bedId };
  emit();
};

/** Closes and hands back the element that opened it; automatic closes drop that reference too. */
export const closeClinicalExplorer = (): HTMLElement | null => {
  const from = opener;
  opener = null;
  if (!selection) return from;
  selection = null;
  emit();
  return from;
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
