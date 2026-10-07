import type { ClinicalCudyrSource } from './clinicalCudyrPreflight';
import type { ClinicalFillError } from '../contracts/clinicalFillContracts';
import type { ArchiveCudyrHistoryRequest } from '@/types/domain/cudyrHistory';
import { buildClinicalFillError } from '../observability/rayenSyncDiagnostics';
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
}): Promise<ClinicalFillError[]> => {
  const gate = createConcurrencyGate(3);
  const errors = await Promise.all(
    input.episodes.map(clinicalEpisodeId =>
      gate(async () => {
        let detail = '';
        let failed = false;
        try {
          const parts = buildCudyrCaptureParts({
            ...input,
            authorityDate: input.censusDate,
            clinicalEpisodeId,
          });
          for (const part of parts) {
            const result = await input.write(part);
            if (result === 'queued' && !failed)
              detail =
                'La captura CUDYR está guardada localmente y pendiente de confirmación del servidor.';
            if (result === 'failed') {
              failed = true;
              detail =
                'No se pudo conservar la captura CUDYR; requiere reintentar la sincronización.';
            }
          }
        } catch {
          detail = 'No se pudo confirmar el archivo permanente CUDYR de este episodio.';
        }
        return detail
          ? buildClinicalFillError({
              bedId: '*',
              clinicalEpisodeId,
              source: 'cudyr',
              reason: 'historical_archive_failed',
              error: detail,
            })
          : null;
      })
    )
  );
  return errors.filter((error): error is ClinicalFillError => error !== null);
};
