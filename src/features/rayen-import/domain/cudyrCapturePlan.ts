import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { ClinicalCudyrSource } from './clinicalCudyrPreflight';
import type {
  ArchiveCudyrHistoryRequest,
  CudyrSourceEvaluation,
} from '@/types/domain/cudyrHistory';

/** Include today's active movements: a patient can leave the bed while the source is read. */
export const collectCudyrCaptureEpisodes = (record: DailyRecord): string[] => {
  const episodes = Object.values(record.beds).flatMap(patient => [
    patient?.clinicalEpisodeId,
    patient?.clinicalCrib?.clinicalEpisodeId,
  ]);
  for (const movement of [
    ...(record.discharges ?? []),
    ...(record.transfers ?? []),
    ...(record.cma ?? []),
  ]) {
    if (!movement.deletedAt)
      episodes.push(movement.clinicalEpisodeId || movement.originalData?.clinicalEpisodeId);
  }
  return [...new Set(episodes.filter((id): id is string => Boolean(id)))];
};

export const buildCudyrCaptureParts = ({
  authorityDate,
  runId,
  captureId,
  observedAt,
  clinicalEpisodeId,
  source,
  recoveredPlacements,
}: {
  authorityDate: string;
  runId: string;
  captureId: string;
  observedAt: string;
  clinicalEpisodeId: string;
  source: ClinicalCudyrSource;
  recoveredPlacements?: import('@/types/domain/cudyrPlacement').CudyrSourcePlacement[];
}): ArchiveCudyrHistoryRequest[] => {
  const row = source.map.get(clinicalEpisodeId);
  const official = source.historyAvailable && row?.source === 'gestion_camas';
  const entries = official ? (row.observations ?? row.history ?? []) : [];
  if (entries.length > 256)
    throw new Error('El historial CUDYR excede el límite por episodio; requiere revisión.');
  // The boundary validator will reject missing source IDs or malformed source values. Never
  // fabricate an evaluation ID or silently drop an invalid row to report an empty capture.
  const evaluations: CudyrSourceEvaluation[] = entries.map(({ id, ...entry }) => ({
    ...entry,
    sourceEvaluationId: id ?? '',
    clinicalEpisodeId,
    source: 'gestion_camas',
  }));
  const nativePlacements = official ? row.sourcePlacements || [] : [];
  const recovered = recoveredPlacements || [];
  if (nativePlacements.length > 32 || recovered.length > 32)
    throw new Error('El historial de camas excede el límite de captura.');
  // Native assignments and PDF rows can describe the same movement while carrying
  // different provenance/closure evidence. Keep both without counting their combined
  // length against a single receipt, or discarding one source's evidence.
  const separateRecovery = nativePlacements.length + recovered.length > 32;
  const placements = separateRecovery ? nativePlacements : [...nativePlacements, ...recovered];
  const totalParts = Math.max(1, Math.ceil(evaluations.length / 32));
  const status = !source.historyAvailable
    ? 'unavailable'
    : source.captureContract !== 1
      ? 'legacy_extension'
      : source.observedEpisodeIds?.includes(clinicalEpisodeId)
        ? 'observed'
        : 'not_observed';
  const parts: ArchiveCudyrHistoryRequest[] = Array.from({ length: totalParts }, (_, part) => ({
    schemaVersion: 1,
    authorityDate,
    runId,
    evaluations: evaluations.slice(part * 32, (part + 1) * 32),
    capture: {
      id: captureId,
      clinicalEpisodeId,
      sourceRunId: runId,
      observedAt,
      status,
      metadataStatus:
        source.captureContract !== 1
          ? 'unknown'
          : source.metadataStatus === 'complete' && row?.metadataComplete !== false
            ? 'complete'
            : 'partial',
      part,
      totalParts,
      totalEvaluations: evaluations.length,
      ...(recoveredPlacements?.length
        ? { sourcePlacements: placements }
        : official && row.sourcePlacements !== undefined
          ? { sourcePlacements: row.sourcePlacements }
          : {}),
    },
  }));
  if (separateRecovery) {
    parts.push({
      schemaVersion: 1,
      authorityDate,
      runId,
      evaluations: [],
      capture: {
        id: crypto.randomUUID(),
        clinicalEpisodeId,
        sourceRunId: runId,
        observedAt,
        // A flow report provides movements, never evidence of an empty CUDYR query.
        status: 'not_observed',
        metadataStatus: 'partial',
        part: 0,
        totalParts: 1,
        totalEvaluations: 0,
        sourcePlacements: recovered,
      },
    });
  }
  return parts;
};
