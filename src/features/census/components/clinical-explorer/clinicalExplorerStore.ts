import { useEffect, useSyncExternalStore } from 'react';
import { onSessionChange } from '@/services/storage/sessionStorageTransition';
import { lazyWithRetry } from '@/utils/lazyWithRetry';

// Online-only consultation mode; it reads Eloísa, Syslab and MMRAD and never joins the precache.
export const ClinicalExplorerView = lazyWithRetry(() =>
  import('./ClinicalExplorerView').then(module => ({ default: module.ClinicalExplorerView }))
);

export interface ClinicalExplorerSelection {
  /** Census day the explorer was opened from. It never changes while the explorer is open. */
  censusDate: string;
  bedId: string;
}

// Memory only: several people share one computer, so a reload never reopens someone else's view.
let selection: ClinicalExplorerSelection | null = null;
let opener: HTMLElement | null = null;
// Settled once the view's module has loaded or failed; from then on the body renders without
// suspending. Behind a Suspense placeholder React would hold the arrived view back 300 ms.
let viewSettled = false;
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
const settleView = (): void => {
  viewSettled = true;
  emit();
};

/** Opens at once with its way back; the body follows when its module is ready. */
export const openClinicalExplorer = (next: ClinicalExplorerSelection): void => {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  opener = active instanceof HTMLElement && active !== document.body ? active : null;
  selection = next;
  emit();
  if (!viewSettled) void ClinicalExplorerView.preload().then(settleView, settleView);
};

/** False until the view's module settles; the census shows its loading placeholder meanwhile. */
export const useClinicalExplorerViewSettled = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => viewSettled,
    () => false
  );

const isReachable = (element: HTMLElement | null | undefined): element is HTMLElement =>
  Boolean(element?.isConnected && !element.closest('[hidden]'));

/**
 * Focus returns to whoever opened the explorer, else to the row's first button (its actions
 * cell) or the «⋯» menu. The «Accesos» ring and the panel that opened it are gone by then. Call it
 * once the census is visible again, with the opener that close() handed back.
 */
export const restoreClinicalExplorerFocus = (bedId: string, from: HTMLElement | null): void => {
  const target = [
    from,
    document.querySelector<HTMLElement>(
      `[data-testid="patient-row"][data-bed-id="${bedId}"] button:not([disabled])`
    ),
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

// Every admission and logout: the next person starts in the census.
onSessionChange(() => {
  closeClinicalExplorer();
});
