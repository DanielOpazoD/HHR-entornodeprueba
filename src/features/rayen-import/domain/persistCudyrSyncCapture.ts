import type { ClinicalCudyrSource } from './clinicalCudyrPreflight';
import type { ClinicalFillError } from '../contracts/clinicalFillContracts';
import type { ArchiveCudyrHistoryRequest } from '@/types/domain/cudyrHistory';
import {
  buildClinicalFillError,
  classifyRayenSyncIssueReason,
} from '../observability/rayenSyncDiagnostics';
import { buildCudyrCaptureParts } from './cudyrCapturePlan';
import { createConcurrencyGate } from './concurrencyGate';

export type CudyrCaptureWriter = (
  request: ArchiveCudyrHistoryRequest
) => Promise<'persisted' | 'queued' | 'failed'>;

export const persistCudyrSyncCapture = async (input: {
  censusDate: string;
  runId: string;
  captureId: string;
  observedAt: string;
  episodes: string[];
  source: ClinicalCudyrSource;
  write: CudyrCaptureWriter;
  signal?: AbortSignal;
  recoverPlacements?: (
    episode: string
  ) => Promise<import('@/types/domain/cudyrPlacement').CudyrSourcePlacement[]>;
}): Promise<ClinicalFillError[]> => {
  const gate = createConcurrencyGate(3);
  const errors = await Promise.all(
    input.episodes.map(clinicalEpisodeId =>
      gate(async () => {
        let detail = '';
        let failed = false;
        let reason: ClinicalFillError['reason'] = 'historical_archive_failed';
        const recoveryErrors: ClinicalFillError[] = [];
        try {
          input.signal?.throwIfAborted();
          let recoveredPlacements;
          if (input.recoverPlacements) {
            try {
              const recovered = await input.recoverPlacements(clinicalEpisodeId);
              recoveredPlacements = recovered;
            } catch (error) {
              input.signal?.throwIfAborted();
              recoveryErrors.push(
                buildClinicalFillError({
                  bedId: '*',
                  clinicalEpisodeId,
                  source: 'bed_history',
                  reason: classifyRayenSyncIssueReason('bed_history', error),
                  error:
                    'No se pudo recuperar el historial de movimientos de camas. El guardado del CUDYR se verifica por separado. Reintente la sincronización.',
                })
              );
            }
          }
          const parts = buildCudyrCaptureParts({
            ...input,
            authorityDate: input.censusDate,
            clinicalEpisodeId,
            recoveredPlacements,
          });
          for (const part of parts) {
            input.signal?.throwIfAborted();
            const result = await input.write(part);
            if (result === 'queued' && !failed) {
              reason = 'historical_archive_failed';
              detail =
                'La captura CUDYR está guardada localmente y pendiente de confirmación del servidor.';
            }
            if (result === 'failed') {
              failed = true;
              reason = 'historical_archive_failed';
              detail =
                'No se pudo conservar la captura CUDYR; requiere reintentar la sincronización.';
            }
          }
        } catch {
          // The coordinator owns cancellation; no archive failure occurred for skipped work.
          if (input.signal?.aborted) return [];
          reason = 'historical_archive_failed';
          detail = 'No se pudo confirmar el archivo permanente CUDYR de este episodio.';
        }
        return detail
          ? [
              ...recoveryErrors,
              buildClinicalFillError({
                bedId: '*',
                clinicalEpisodeId,
                source: 'cudyr',
                reason,
                error: detail,
              }),
            ]
          : recoveryErrors;
      })
    )
  );
  return errors.flat();
};
