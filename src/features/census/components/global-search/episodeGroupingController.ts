/**
 * Episode Grouping Controller
 *
 * Pure business logic that groups sequential hospitalization events
 * (Ingreso, Egreso, Traslado, Fallecimiento) into unified episode blocks.
 *
 * Extracted from the view layer so it can be tested independently
 * without rendering React components.
 */

import type { HospitalizationEvent } from '@/types/domain/patientMaster';
import type { GroupedEpisode } from '@/features/census/components/global-search/globalSearchContracts';
import type {
  PatientHistoryResult,
  PatientMovement,
} from '@/services/patient/patientHistoryService';
import { getTodayISO } from '@/utils/dateCoreUtils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const calculateDaysBetween = (start: string, end: string): number => {
  const s = new Date(`${start}T12:00:00`);
  const e = new Date(`${end}T12:00:00`);
  return Math.max(Math.round((e.getTime() - s.getTime()) / (1000 * 3600 * 24)), 0);
};

const buildOpenEpisode = (
  admission: HospitalizationEvent,
  daysOfStay: number | null
): GroupedEpisode => ({
  id: admission.id,
  admission,
  discharge: null,
  diagnosis: admission.diagnosis || '',
  bedName: admission.bedName || '',
  daysOfStay,
});

const buildClosedEpisode = (
  admission: HospitalizationEvent,
  discharge: HospitalizationEvent
): GroupedEpisode => ({
  id: admission.id,
  admission,
  discharge,
  diagnosis: admission.diagnosis || discharge.diagnosis || '',
  bedName: admission.bedName || discharge.bedName || '',
  daysOfStay: calculateDaysBetween(admission.date, discharge.date),
});

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Groups sequential hospitalization events into unified episode blocks.
 *
 * Each block starts with an `Ingreso` and ends with the next closing event
 * (`Egreso`, `Traslado`, or `Fallecimiento`). If no closing event exists,
 * the patient is assumed to be currently admitted.
 *
 * @param events - Unsorted array of hospitalization events
 * @returns Episodes ordered most-recent-first
 */
export const groupEpisodesAsBlocks = (events: HospitalizationEvent[]): GroupedEpisode[] => {
  const sorted = [...events].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const grouped: GroupedEpisode[] = [];
  let currentAdmission: HospitalizationEvent | null = null;

  for (const event of sorted) {
    if (event.type === 'Ingreso') {
      // Close any unclosed admission as an open episode before starting a new one
      if (currentAdmission) {
        grouped.push(buildOpenEpisode(currentAdmission, null));
      }
      currentAdmission = event;
    } else if (currentAdmission) {
      // Closing event pairs with the current admission
      grouped.push(buildClosedEpisode(currentAdmission, event));
      currentAdmission = null;
    } else {
      // Orphan closing event without a matching admission
      grouped.push(buildOpenEpisode(event, null));
    }
  }

  // Currently admitted patient (open admission without discharge)
  if (currentAdmission) {
    const today = getTodayISO();
    grouped.push(
      buildOpenEpisode(currentAdmission, calculateDaysBetween(currentAdmission.date, today))
    );
  }

  return grouped.reverse();
};

/**
 * Resolve the census date that best represents the last day of hospitalization
 * for a grouped episode.
 *
 * Closed episodes navigate to the closing event date. Open episodes use the
 * provided `openEpisodeLastSeenDate` when available; otherwise they fall back
 * to the admission date.
 */
export const resolveEpisodeCensusTargetDate = (
  episode: GroupedEpisode,
  openEpisodeLastSeenDate?: string | null
): string => {
  if (episode.discharge?.date) {
    return episode.discharge.date;
  }

  if (openEpisodeLastSeenDate) {
    return openEpisodeLastSeenDate;
  }

  return episode.admission.date;
};

const mapMovementToClosingEventType = (
  movement: PatientMovement
): HospitalizationEvent['type'] | null => {
  if (movement.type === 'transfer') return 'Traslado';
  if (movement.type === 'discharge') {
    return movement.details === 'Fallecimiento' ? 'Fallecimiento' : 'Egreso';
  }
  return null;
};

const buildClosingEventFromHistory = (
  episode: GroupedEpisode,
  history: PatientHistoryResult
): HospitalizationEvent | null => {
  const closingMovements = history.movements
    .filter(
      movement =>
        movement.date >= episode.admission.date &&
        (movement.type === 'discharge' || movement.type === 'transfer')
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const closingMovement = closingMovements[closingMovements.length - 1];
  if (!closingMovement) {
    return null;
  }

  const closingType = mapMovementToClosingEventType(closingMovement);
  if (!closingType) {
    return null;
  }

  return {
    id: `${episode.id}__history_close__${closingMovement.date}`,
    type: closingType,
    date: closingMovement.date,
    diagnosis: episode.diagnosis,
    bedName: closingMovement.bedName || episode.bedName,
    ...(closingType === 'Traslado' && closingMovement.details
      ? { receivingCenter: closingMovement.details }
      : {}),
  };
};

/**
 * Reconciles grouped episodes from PatientMaster with the concrete movement
 * history loaded from daily records. This closes stale "open" episodes when
 * the history already shows a discharge/transfer for the same admission.
 */
export const reconcileGroupedEpisodesWithHistory = (
  episodes: GroupedEpisode[],
  history: PatientHistoryResult | null
): GroupedEpisode[] => {
  if (!history || episodes.length === 0) {
    return episodes;
  }

  return episodes.map(episode => {
    if (episode.discharge || episode.admission.type !== 'Ingreso') {
      return episode;
    }

    const historyClosingEvent = buildClosingEventFromHistory(episode, history);
    if (!historyClosingEvent) {
      return episode;
    }

    return buildClosedEpisode(episode.admission, historyClosingEvent);
  });
};
