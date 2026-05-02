import type { MasterPatient } from '@/types/domain/patientMaster';
import type { PatientHistoryResult } from '@/services/patient/patientHistoryService';
import type { PatientEpisodeTimelineState } from '@/features/census/components/global-search/globalSearchContracts';
import type { HospitalizationEvent } from '@/types/domain/patientMaster';
import {
  groupEpisodesAsBlocks,
  reconcileGroupedEpisodesWithHistory,
} from '@/features/census/components/global-search/episodeGroupingController';

const mapHistoryMovementsToHospitalizationEvents = (
  history: PatientHistoryResult | null
): HospitalizationEvent[] => {
  if (!history) {
    return [];
  }

  return history.movements
    .map((movement): HospitalizationEvent | null => {
      if (movement.type === 'admission') {
        return {
          id: `${movement.date}-history-ingreso-${movement.bedId}`,
          type: 'Ingreso',
          date: movement.date,
          diagnosis: 'S/D',
          bedName: movement.bedName,
        };
      }

      if (movement.type === 'discharge') {
        return {
          id: `${movement.date}-history-egreso-${movement.bedId}`,
          type: movement.details === 'Fallecimiento' ? 'Fallecimiento' : 'Egreso',
          date: movement.date,
          diagnosis: movement.details || 'S/D',
          bedName: movement.bedName,
        };
      }

      if (movement.type === 'transfer') {
        return {
          id: `${movement.date}-history-traslado-${movement.bedId}`,
          type: 'Traslado',
          date: movement.date,
          diagnosis: 'S/D',
          bedName: movement.bedName,
          receivingCenter: movement.details,
        };
      }

      return null;
    })
    .filter((event): event is HospitalizationEvent => event !== null);
};

/**
 * Builds the search timeline state from the two sources this feature uses:
 * Firestore `patientMaster` for the indexed episode list and daily-record
 * history for the concrete closing movement.
 */
export const buildPatientEpisodeTimelineState = (
  patient: MasterPatient,
  history: PatientHistoryResult | null
): PatientEpisodeTimelineState => {
  const indexedEpisodes = groupEpisodesAsBlocks(patient.hospitalizations ?? []);
  const historyEpisodes = groupEpisodesAsBlocks(
    mapHistoryMovementsToHospitalizationEvents(history)
  );
  const sourceEpisodes = historyEpisodes.length > 0 ? historyEpisodes : indexedEpisodes;

  const groupedEpisodes = reconcileGroupedEpisodesWithHistory(sourceEpisodes, history);

  return {
    groupedEpisodes,
    episodeCount: groupedEpisodes.length,
    hasEpisodes: groupedEpisodes.length > 0,
  };
};
