import { getActiveHospitalId } from '@/constants/activeHospital';
import { readCudyrEpisodeCaptures } from '@/services/cudyr/cudyrHistoryService';
import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import { requestPatientFlowReport } from './patientFlowBridge';
import { decodePdfBase64 } from '../domain/historicalStatisticalDischargeRecovery';
import {
  CUDYR_PATIENT_FLOW_SOURCE,
  cudyrPlacementsFromPatientFlow,
} from '../mapping/cudyrPatientFlowPlacements';

const MAX_CACHED_ARCHIVED_FLOW_EPISODES = 500;
const EPISODE_ID_PATTERN = /^\d{1,30}$/;

// The archive is permanent and append-only, so once the server confirms an episode already has
// patient-flow evidence persisted, neither this tab nor subsequent reloads need to page its
// full capture history again. Only numeric episode IDs (no PHI) are stored locally.
const episodesWithArchivedFlowByHospital = new Map<string, Set<string>>();

const storageKeyForHospital = (hospitalId: string): string =>
  `hhr:cudyrArchivedFlowEpisodes:v1:${hospitalId}`;

const readPersistedEpisodes = (hospitalId: string): Set<string> => {
  const cached = new Set<string>();
  if (typeof window === 'undefined') return cached;
  try {
    const raw = window.localStorage.getItem(storageKeyForHospital(hospitalId));
    if (!raw) return cached;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return cached;
    for (const value of parsed) {
      if (typeof value === 'string' && EPISODE_ID_PATTERN.test(value)) {
        cached.add(value);
      }
    }
  } catch {
    // Corrupted or unavailable storage degrades cleanly to server verification.
  }
  return cached;
};

const archivedSetForActiveHospital = (): { hospitalId: string; episodes: Set<string> } => {
  const hospitalId = getActiveHospitalId();
  let episodes = episodesWithArchivedFlowByHospital.get(hospitalId);
  if (!episodes) {
    episodes = readPersistedEpisodes(hospitalId);
    episodesWithArchivedFlowByHospital.set(hospitalId, episodes);
  }
  return { hospitalId, episodes };
};

const persistArchivedEpisodes = (hospitalId: string, episodes: Set<string>): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKeyForHospital(hospitalId), JSON.stringify([...episodes]));
  } catch {
    // Quota or private-mode failures keep the in-memory set intact without interrupting sync.
  }
};

/** Record an episode whose patient-flow placement receipt is confirmed persisted on the server. */
export const markCudyrFlowArchived = (episode: string): void => {
  if (!EPISODE_ID_PATTERN.test(episode)) return;
  const { hospitalId, episodes } = archivedSetForActiveHospital();
  if (episodes.has(episode)) return;
  episodes.add(episode);
  while (episodes.size > MAX_CACHED_ARCHIVED_FLOW_EPISODES) {
    const oldest = episodes.values().next().value;
    if (oldest === undefined) break;
    episodes.delete(oldest);
  }
  persistArchivedEpisodes(hospitalId, episodes);
};

export const resetArchivedFlowEpisodesForTests = (options?: { keepStorage?: boolean }): void => {
  episodesWithArchivedFlowByHospital.clear();
  if (options?.keepStorage || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKeyForHospital(getActiveHospitalId()));
  } catch {
    // Ignore unavailable storage in non-browser environments.
  }
};

/** Run only as part of an authorized census sync. Archived flow prevents repeated PDF reads. */
export const recoverCudyrHospitalHistory = async (
  episode: string,
  rut: string,
  signal: AbortSignal,
  observedAt: string,
  identityKind: 'patient' | 'maternal' = 'patient',
  maternalRut?: string
) => {
  signal.throwIfAborted();
  if (archivedSetForActiveHospital().episodes.has(episode)) return [];
  let cursor;
  const seen = new Set<string>();
  do {
    const page = await readCudyrEpisodeCaptures({
      kind: 'episode-captures',
      clinicalEpisodeIds: [episode],
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    signal.throwIfAborted();
    if (
      page.captures.some(
        item =>
          item.capture.clinicalEpisodeId === episode &&
          item.capture.sourcePlacements?.some(p => p.sourceVersion === CUDYR_PATIENT_FLOW_SOURCE)
      )
    ) {
      markCudyrFlowArchived(episode);
      return [];
    }
    cursor = page.nextCursor;
    if (cursor) {
      if (seen.has(cursor.id) || seen.size >= 1000)
        throw new Error('Lectura de archivo incompleta.');
      seen.add(cursor.id);
    }
  } while (cursor);
  const report = await requestPatientFlowReport(episode, 15_000, signal);
  signal.throwIfAborted();
  if (report.error || !report.base64) throw new Error('Informe de movimientos no disponible.');
  const text = await extractPdfTextFromBuffer(decodePdfBase64(report.base64));
  signal.throwIfAborted();
  return cudyrPlacementsFromPatientFlow(text, episode, rut, observedAt, identityKind, maternalRut);
};
