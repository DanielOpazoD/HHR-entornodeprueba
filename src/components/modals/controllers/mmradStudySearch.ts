import { normalizeDicomPatientId } from '@/services/radiology/dicomTypes';
import {
  searchMMRADCheckDigitExams,
  searchMMRADExams,
  type MMRADSearchResult,
} from '@/services/radiology/mmradService';
import { openMMRADExamListMemory } from './radiologyExamListMemory';

export interface MmradStudySearchQuery {
  rut: string;
  /** Enables the slower search for exams MMRAD registered under a mistyped check digit. */
  patientName?: string;
  /** ISO days or '' for no bound; part of the memory key. */
  dateFrom: string;
  dateTo: string;
}

export interface MmradStudySearchHandlers {
  /** False once the caller moved on (another patient, another query, unmounted). */
  isCurrent: () => boolean;
  /** A list to show. `exact` is true for the exact-RUT answer, false for the check-digit one. */
  onShown: (result: MMRADSearchResult, exact: boolean) => void;
  /** The exact search failed; `remembered` says whether a list was already on screen. */
  onExactError: (message: string, remembered: boolean) => void;
  /** The check-digit search answered or failed, or was not needed. */
  onAlternateSettled?: () => void;
}

export interface MmradStudySearchHandle {
  /** What this session already remembered for the query, to paint before any answer. */
  remembered: MMRADSearchResult | undefined;
  /** Settles when the exact search answered or failed; never rejects. */
  done: Promise<void>;
}

/**
 * The one MMRAD study search: the exact RUT, the mistyped-check-digit variant when a name is
 * known, and the per-session memory that merges both answers and voids replies of a session that
 * ended. The radiology modal and the clinical explorer run this routine and only differ in what
 * they do with the answers.
 */
export const searchMmradStudies = (
  query: MmradStudySearchQuery,
  handlers: MmradStudySearchHandlers
): MmradStudySearchHandle => {
  const { rut, patientName, dateFrom, dateTo } = query;
  const memory = openMMRADExamListMemory({ rut, dateFrom, dateTo });
  const params = { rut, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined };
  const show = (data: MMRADSearchResult, exact: boolean): void => {
    const shown = memory.remember(data);
    if (shown && handlers.isCurrent()) handlers.onShown(shown, exact);
  };
  const settleAlternate = (): void => {
    if (handlers.isCurrent()) handlers.onAlternateSettled?.();
  };

  if (patientName) {
    // Exams registered with a mistyped check digit come from a slower request that runs at the
    // same time; they join the list when they arrive. Only a reply for this RUT is shown.
    void searchMMRADCheckDigitExams({ ...params, patientName })
      .then(
        data => {
          if (normalizeDicomPatientId(data.rut) === normalizeDicomPatientId(rut)) show(data, false);
        },
        () => show({ rut, examenes: [], check_digit_search: 'partial' }, false)
      )
      .finally(settleAlternate);
  } else {
    settleAlternate();
  }

  const done = searchMMRADExams(params).then(
    data => show(data, true),
    (error: unknown) => {
      if (!handlers.isCurrent()) return;
      const message = error instanceof Error ? error.message : 'Error al buscar exámenes';
      handlers.onExactError(message, Boolean(memory.remembered));
    }
  );

  return { remembered: memory.remembered, done };
};
