import type { RayenCudyrCategoriesResponse, RayenCudyrCategory } from '../contracts/rayenCudyr';
import type { ClinicalFillError } from '../contracts/clinicalFillContracts';
import {
  buildClinicalFillError,
  classifyRayenSyncIssueReason,
} from '../observability/rayenSyncDiagnostics';

export interface ClinicalCudyrSource {
  map: Map<string, RayenCudyrCategory>;
  historyAvailable: boolean;
  captureContract?: 1;
  observedEpisodeIds?: string[];
  metadataStatus?: 'complete' | 'partial';
}

interface ClinicalCudyrPreflightResult {
  source: ClinicalCudyrSource;
  unavailableError?: ClinicalFillError;
}

interface ClinicalCudyrPreflightDependencies {
  fetch: () => Promise<RayenCudyrCategoriesResponse>;
  trackRequest: <T>(operation: () => Promise<T>) => Promise<T>;
  recordTimeout: (value: unknown) => void;
  requireCompleteMetadata?: boolean;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const hasUnambiguousMixedProvenance = (response: RayenCudyrCategoriesResponse): boolean =>
  response.source !== 'gestion_camas+ficha_medico' ||
  response.items.every(item => item.source === 'gestion_camas' || item.source === 'ficha_medico');

const isOfficialHistory = (response: RayenCudyrCategoriesResponse): boolean =>
  !response.error &&
  response.historyAvailable === true &&
  (response.source === 'gestion_camas' || response.source === 'gestion_camas+ficha_medico') &&
  hasUnambiguousMixedProvenance(response);

const normalizeItems = (response: RayenCudyrCategoriesResponse): RayenCudyrCategory[] => {
  if (response.error) return [];
  const defaultSource = response.source === 'gestion_camas' ? 'gestion_camas' : 'ficha_medico';
  return response.items.map(item => (item.source ? item : { ...item, source: defaultSource }));
};

const unavailableMessage = (detail?: string): string =>
  `CUDYR no pudo consultarse en Gestión de Camas${detail ? `: ${detail}` : '.'}`;

/** Captures and classifies the single official CUDYR source independently of patient reads. */
export const captureClinicalCudyrSource = async ({
  fetch,
  trackRequest,
  recordTimeout,
  requireCompleteMetadata = false,
}: ClinicalCudyrPreflightDependencies): Promise<ClinicalCudyrPreflightResult> => {
  try {
    const response = await trackRequest(fetch);
    const historyAvailable = isOfficialHistory(response);
    const detail =
      response.error ||
      (requireCompleteMetadata &&
      response.items.some(
        item => item.source === 'gestion_camas' && item.metadataComplete === false
      )
        ? 'faltan datos de autor, identidad de evaluación o detalle CUDYR'
        : undefined) ||
      (requireCompleteMetadata && response.metadataStatus === 'partial'
        ? response.warning || 'metadatos CUDYR incompletos'
        : undefined) ||
      (!historyAvailable
        ? !hasUnambiguousMixedProvenance(response)
          ? 'la extensión no informó la procedencia CUDYR de cada episodio'
          : response.warning || 'la extensión no confirmó el historial oficial'
        : undefined);
    if (detail) recordTimeout(detail);
    return {
      source: {
        map: new Map(normalizeItems(response).map(item => [item.encId, item])),
        historyAvailable,
        captureContract: response.captureContract,
        observedEpisodeIds: response.observedEpisodeIds,
        metadataStatus: response.metadataStatus,
      },
      ...(detail
        ? {
            unavailableError: buildClinicalFillError({
              bedId: '*',
              source: 'cudyr',
              reason: classifyRayenSyncIssueReason('cudyr', detail),
              error: historyAvailable
                ? `CUDYR se consultó con información incompleta: ${detail}`
                : unavailableMessage(detail),
            }),
          }
        : {}),
    };
  } catch (error) {
    return {
      source: { map: new Map(), historyAvailable: false },
      unavailableError: buildClinicalFillError({
        bedId: '*',
        source: 'cudyr',
        reason: classifyRayenSyncIssueReason('cudyr', error),
        error: unavailableMessage(message(error)),
      }),
    };
  }
};
