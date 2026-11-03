import { buildMMRADExamKey } from '@/components/modals/controllers/radiologyViewerModalController';
import { normalizeDicomPatientId } from '@/services/radiology/dicomTypes';
import type { MMRADExam, MMRADSearchResult } from '@/services/radiology/mmradService';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

export interface MMRADExamListQuery {
  rut: string;
  /** '' when the filter is empty. */
  dateFrom: string;
  /** '' when the filter is empty. */
  dateTo: string;
}

const normalizeModality = (exam: MMRADExam) => (exam.mod || '').trim().toUpperCase();

// The exam key falls back to name and date until MMRAD publishes a report link, so the same exam
// changes key when it is reported. A shared link, or no link before, identifies it across keys.
const isSameExamWithNewLinks = (previous: MMRADExam, exam: MMRADExam): boolean =>
  Boolean(previous.informe_html_url && previous.informe_html_url === exam.informe_html_url) ||
  Boolean(previous.pdf_url && previous.pdf_url === exam.pdf_url) ||
  (!previous.informe_html_url &&
    !previous.pdf_url &&
    previous.nombre_examen === exam.nombre_examen &&
    previous.fecha_examen === exam.fecha_examen &&
    normalizeModality(previous) === normalizeModality(exam));

/**
 * A refresh updates the exams it lists and adds the new ones; it never deletes. A partial or failed
 * MMRAD read is not proof that a remembered exam is gone (CEN-01, SAVE-01): the function answers an
 * empty list when the RIS login lacks its search page, and a CT report it could not fetch as null.
 */
export const mergeMMRADExamLists = (remembered: MMRADExam[], fresh: MMRADExam[]): MMRADExam[] => {
  const unpaired = [...remembered];
  const pairs: (MMRADExam | undefined)[] = fresh.map(() => undefined);
  // Each pass pairs every exam before the next, looser one, so it cannot take another's match:
  // unchanged first (same-key exams stay apart), then by key, then across a key change.
  const passes = [
    (previous: MMRADExam, exam: MMRADExam) => JSON.stringify(previous) === JSON.stringify(exam),
    (previous: MMRADExam, exam: MMRADExam) =>
      buildMMRADExamKey(previous) === buildMMRADExamKey(exam),
    isSameExamWithNewLinks,
  ];
  for (const matches of passes) {
    fresh.forEach((exam, index) => {
      if (pairs[index]) return;
      const found = unpaired.findIndex(previous => matches(previous, exam));
      if (found >= 0) pairs[index] = unpaired.splice(found, 1)[0];
    });
  }
  const updated = fresh.map((exam, index) => {
    const previous = pairs[index];
    return previous?.report && !exam.report ? { ...exam, report: previous.report } : exam;
  });
  return [...updated, ...unpaired];
};

// Memory only: several people share a computer, so no Web Storage or IndexedDB. Never purged by age
// or size; everything goes when the session that remembered it ends.
const remembered = new Map<string, MMRADSearchResult>();
let rememberedScope: string | null = null;
let epoch = 0;

const readSessionScope = (): string | null => {
  const owner = getStoredSessionOwnerKey();
  const generation = getSessionGeneration();
  return owner && generation ? JSON.stringify([owner, generation]) : null;
};

const forget = () => {
  remembered.clear();
  epoch += 1;
  rememberedScope = readSessionScope();
};

const currentScope = (): string | null => {
  if (readSessionScope() !== rememberedScope) forget();
  return rememberedScope;
};

const entryKey = (scope: string, query: MMRADExamListQuery) =>
  JSON.stringify([scope, normalizeDicomPatientId(query.rut), query.dateFrom, query.dateTo]);

if (typeof window !== 'undefined') {
  // setSessionGeneration posts this on every admission and logout. Forgetting is always safe, so
  // the sender is not checked.
  window.addEventListener('message', event => {
    if (event.data?.type === 'HHR_RAYEN_SESSION_CHANGED') forget();
  });
}

export const readRememberedMMRADExams = (
  query: MMRADExamListQuery
): MMRADSearchResult | undefined => {
  const scope = currentScope();
  return scope ? remembered.get(entryKey(scope, query)) : undefined;
};

/**
 * Binds one search to the session that started it. `remember` merges the reply into the list that
 * session remembers and returns what to show; null means the session changed and the reply is void.
 */
export const openMMRADExamListMemory = (query: MMRADExamListQuery) => {
  const scope = currentScope();
  const openedEpoch = epoch;
  return {
    remembered: scope ? remembered.get(entryKey(scope, query)) : undefined,
    remember: (result: MMRADSearchResult): MMRADSearchResult | null => {
      if (!scope) return result;
      if (currentScope() !== scope || epoch !== openedEpoch) return null;
      if (normalizeDicomPatientId(result.rut) !== normalizeDicomPatientId(query.rut)) return result;
      const key = entryKey(scope, query);
      const previous = remembered.get(key);
      const next = previous
        ? { ...result, examenes: mergeMMRADExamLists(previous.examenes, result.examenes) }
        : result;
      remembered.set(key, next);
      return next;
    },
  };
};
