import { useSyncExternalStore, type MouseEvent } from 'react';
import { onSessionChange } from '@/services/storage/sessionStorageTransition';

interface ExamOrderSelection {
  /** Census day the patients were chosen on; another day starts with nothing chosen. */
  censusDate: string;
  /** Patient and episode keys, in the order they were chosen. */
  keys: readonly string[];
}

// Memory only: several people share one computer, so nobody inherits another person's choice.
let selection: ExamOrderSelection | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = (): ExamOrderSelection | null => selection;
const readServer = (): ExamOrderSelection | null => null;
const NOTHING_CHOSEN: readonly string[] = [];

export const toggleExamOrderPatient = (censusDate: string, key: string): void => {
  const keys = selection?.censusDate === censusDate ? selection.keys : NOTHING_CHOSEN;
  const next = keys.includes(key) ? keys.filter(item => item !== key) : [...keys, key];
  selection = next.length > 0 ? { censusDate, keys: next } : null;
  emit();
};

export const clearExamOrderSelection = (): void => {
  if (!selection) return;
  selection = null;
  emit();
};

export const useExamOrderSelection = (censusDate: string): readonly string[] => {
  const current = useSyncExternalStore(subscribe, read, readServer);
  return current?.censusDate === censusDate ? current.keys : NOTHING_CHOSEN;
};

/** One boolean per row, so choosing a patient re-renders only the rows that change. */
export const useIsExamOrderPatientSelected = (censusDate: string | null, key: string | null) =>
  useSyncExternalStore(
    subscribe,
    () =>
      Boolean(censusDate && key) &&
      selection?.censusDate === censusDate &&
      selection.keys.includes(key!),
    () => false
  );

/** Marks a name that Shift + click chooses; the launcher leaves the choice alone there. */
export const EXAM_ORDER_NAME_ATTRIBUTE = 'data-exam-order-name';

/** Shift + click on a name chooses that patient; the browser's text selection stays out of it. */
export const handleExamOrderNameMouseDown = (
  event: MouseEvent<HTMLElement>,
  censusDate: string,
  key: string
): void => {
  if (!event.shiftKey || event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest('button')) return;
  event.preventDefault();
  toggleExamOrderPatient(censusDate, key);
};

// Every admission and logout: the next person starts with nothing chosen.
onSessionChange(() => {
  clearExamOrderSelection();
});
