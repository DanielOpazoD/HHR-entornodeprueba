import type { RayenCudyrCategoriesResponse, RayenCudyrCategory } from '../contracts/rayenCudyr';
import type { ClinicalFillError } from '../contracts/clinicalFillContracts';
import {
  buildClinicalFillError,
  classifyRayenSyncIssueReason,
} from '../observability/rayenSyncDiagnostics';

export interface ClinicalCudyrSource {
  map: Map<string, RayenCudyrCategory>;
  historyAvailable: boolean;
}

interface ClinicalCudyrPreflightResult {
  source: ClinicalCudyrSource;
  unavailableError?: ClinicalFillError;
}

interface ClinicalCudyrPreflightDependencies {
  fetch: () => Promise<RayenCudyrCategoriesResponse>;
  trackRequest: <T>(operation: () => Promise<T>) => Promise<T>;
  recordTimeout: (value: unknown) => void;
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

/** Captures and classifies the single official CUDYR source before patient reads begin. */
export const captureClinicalCudyrSource = async ({
  fetch,
  trackRequest,
  recordTimeout,
}: ClinicalCudyrPreflightDependencies): Promise<ClinicalCudyrPreflightResult> => {
  try {
    const response = await trackRequest(fetch);
    const historyAvailable = isOfficialHistory(response);
    const detail =
      response.error ||
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
      },
      ...(detail
        ? {
            unavailableError: buildClinicalFillError({
              bedId: '*',
              source: 'cudyr',
              reason: classifyRayenSyncIssueReason('cudyr', detail),
              error: unavailableMessage(detail),
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
