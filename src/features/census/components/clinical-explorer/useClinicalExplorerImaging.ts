import { useEffect, useRef, useState } from 'react';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import {
  mergeMMRADExamLists,
  openMMRADExamListMemory,
  readRememberedMMRADExams,
} from '@/components/modals/controllers/radiologyExamListMemory';
import { searchMmradStudies } from '@/components/modals/controllers/mmradStudySearch';
import type { MMRADExam, MMRADSearchResult } from '@/services/radiology/mmradService';
import { asMmradDateBound, sortStudiesNewestFirst } from './clinicalExplorerImagingModel';

export type ClinicalExplorerImagingPhase = 'listing' | 'ready' | 'empty' | 'error';

export interface ClinicalExplorerImagingResult {
  phase: ClinicalExplorerImagingPhase;
  studies: MMRADExam[];
  /** Why the list could not be read at all. */
  message: string;
  /** Why a remembered list could not be refreshed; the list stays. */
  refreshMessage: string | null;
  /** The slower search for a mistyped check digit did not finish; a study may be missing. */
  partial: boolean;
  retry: () => void;
}

interface UseClinicalExplorerImagingParams {
  rut: string;
  patientName: string;
  /** ISO day. Studies before it belong to an earlier attention and are not requested. */
  admissionDate: string;
  enabled: boolean;
}

interface ImagingState {
  studies: MMRADExam[];
  /** The exact search answered. */
  complete: boolean;
  /** The mistyped-check-digit search answered or was not needed. */
  alternateSettled: boolean;
  error: string | null;
  refreshMessage: string | null;
  partial: boolean;
}

const IDLE: ImagingState = {
  studies: [],
  complete: false,
  alternateSettled: false,
  error: null,
  refreshMessage: null,
  partial: false,
};
/** Arrow-key navigation steps through patients; MMRAD allows 20 searches a minute per address. */
const SETTLE_MS = 400;

/**
 * A remembered list is shown at once, but whether the search is complete is decided by this
 * mount's own answers: the memory keeps each answer as it arrives, so an empty remembered list
 * may still be waiting for the other search.
 */
const fromRemembered = (result: MMRADSearchResult): ImagingState => ({
  studies: sortStudiesNewestFirst(result.examenes),
  complete: false,
  alternateSettled: false,
  error: null,
  refreshMessage: null,
  partial: result.check_digit_search === 'partial',
});



/**
 * MMRAD studies of the hospitalization, the same two searches the radiology modal runs (exact RUT
 * and mistyped check digit), remembered per session so switching patients back is instant. A
 * failed refresh keeps the remembered list; a failed first read is a failure, not "no studies".
 */
export const useClinicalExplorerImaging = ({
  rut,
  patientName,
  admissionDate,
  enabled,
}: UseClinicalExplorerImagingParams): ClinicalExplorerImagingResult => {
  // What a session read leaves with it, whether or not the area is mounted when it changes; the
  // MMRAD memory forgets on the same change.
  const generation = useSessionEpoch();
  const dateFrom = asMmradDateBound(admissionDate) ?? '';
  const key = `${generation}|${rut}|${dateFrom}`;
  // State belongs to one search key; another patient starts from what the session remembers.
  const [stored, setStored] = useState<{ key: string; data: ImagingState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const remembered = enabled && rut ? readRememberedMMRADExams({ rut, dateFrom, dateTo: '' }) : undefined;
  const state = stored?.key === key ? stored.data : remembered ? fromRemembered(remembered) : IDLE;

  useEffect(() => {
    if (!enabled || !rut) return;
    const run = ++sequence.current;
    const isCurrent = (): boolean => run === sequence.current;
    const memory = openMMRADExamListMemory({ rut, dateFrom, dateTo: '' });
    const update = (change: (current: ImagingState) => ImagingState): void =>
      setStored(current => ({
        key,
        data: change(
          current?.key === key ? current.data : memory.remembered ? fromRemembered(memory.remembered) : IDLE
        ),
      }));

    const timer = window.setTimeout(() => {
      // The same routine the radiology modal runs; this hook only decides what to keep.
      searchMmradStudies(
        { rut, patientName, dateFrom, dateTo: '' },
        {
          isCurrent,
          // Without a session scope the memory does not merge, so the two answers are merged here.
          // Only a successful exact search clears an earlier failure.
          onShown: (shown, exact) =>
            update(current => ({
              ...current,
              studies: sortStudiesNewestFirst(mergeMMRADExamLists(current.studies, shown.examenes)),
              complete: exact || current.complete,
              error: exact ? null : current.error,
              refreshMessage: exact ? null : current.refreshMessage,
              partial: current.partial || shown.check_digit_search === 'partial',
            })),
          onExactError: message =>
            update(current =>
              current.studies.length > 0
                ? { ...current, refreshMessage: message }
                : { ...current, error: message }
            ),
          onAlternateSettled: () => update(current => ({ ...current, alternateSettled: true })),
        }
      );
    }, SETTLE_MS);

    return () => {
      window.clearTimeout(timer);
      sequence.current += 1;
    };
  }, [enabled, rut, patientName, dateFrom, key, attempt]);

  // "Sin estudios" only once both searches answered; a failed exact search stays a failure.
  const phase: ClinicalExplorerImagingPhase = state.error
    ? 'error'
    : state.studies.length > 0
      ? 'ready'
      : state.complete && state.alternateSettled
        ? 'empty'
        : 'listing';

  return {
    phase,
    studies: state.studies,
    message: state.error ?? '',
    refreshMessage: state.refreshMessage,
    partial: state.partial,
    retry: () => setAttempt(value => value + 1),
  };
};
