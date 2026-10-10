import { readCudyrEpisodeCaptures } from '@/services/cudyr/cudyrHistoryService';
import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';
import { requestPatientFlowReport } from './patientFlowBridge';
import { decodePdfBase64 } from '../domain/historicalStatisticalDischargeRecovery';
import {
  CUDYR_PATIENT_FLOW_SOURCE,
  cudyrPlacementsFromPatientFlow,
} from '../mapping/cudyrPatientFlowPlacements';

/** Run only as part of an authorized census sync. Archived flow prevents repeated PDF reads. */
export const recoverCudyrHospitalHistory = async (
  episode: string,
  rut: string,
  signal: AbortSignal,
  observedAt: string,
  identityKind: 'patient' | 'maternal' = 'patient'
) => {
  signal.throwIfAborted();
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
    )
      return [];
    cursor = page.nextCursor;
    if (cursor) {
      if (seen.has(cursor.id) || seen.size >= 1000)
        throw new Error('Lectura de archivo incompleta.');
      seen.add(cursor.id);
    }
  } while (cursor);
  const report = await requestPatientFlowReport(episode, 15_000);
  signal.throwIfAborted();
  if (report.error || !report.base64) throw new Error('Informe de movimientos no disponible.');
  const text = await extractPdfTextFromBuffer(decodePdfBase64(report.base64));
  signal.throwIfAborted();
  return cudyrPlacementsFromPatientFlow(text, episode, rut, observedAt, identityKind);
};
